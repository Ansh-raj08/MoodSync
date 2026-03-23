-- =============================================================
--  MoodSync Dissolution System Migration
--
--  CRITICAL: This migration adds relationship-level scoping
--  to enable safe dissolution with 15-day grace period.
--
--  Changes:
--    1. Add dissolution tracking to couples table
--    2. Add couple_id to mood_logs and messages
--    3. Backfill existing data
--    4. Create safe cleanup function
--    5. Update RLS policies
--
--  Safety: ONLY delete by couple_id, NEVER by user_id
-- =============================================================

-- =============================================================
-- STEP 1: Add dissolution tracking to couples table
-- =============================================================

ALTER TABLE couples
    ADD COLUMN dissolution_initiated_at timestamptz,
    ADD COLUMN dissolution_initiated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN dissolution_scheduled_for timestamptz,
    ADD COLUMN dissolution_cancelled_at timestamptz;

-- Add constraint to ensure consistency between initiation and scheduling
ALTER TABLE couples
    ADD CONSTRAINT check_dissolution_consistency
    CHECK (
        (dissolution_scheduled_for IS NULL AND dissolution_initiated_at IS NULL)
        OR (dissolution_scheduled_for IS NOT NULL AND dissolution_initiated_at IS NOT NULL)
    );

-- Index for cleanup job performance
CREATE INDEX idx_couples_dissolution_scheduled
    ON couples (dissolution_scheduled_for)
    WHERE dissolution_scheduled_for IS NOT NULL
      AND dissolution_cancelled_at IS NULL;

-- Comments for documentation
COMMENT ON COLUMN couples.dissolution_initiated_at IS 'Timestamp when dissolution was first initiated by either partner';
COMMENT ON COLUMN couples.dissolution_initiated_by IS 'User ID of who initiated dissolution (nullable if user deleted their account)';
COMMENT ON COLUMN couples.dissolution_scheduled_for IS 'Timestamp when cleanup will occur (15 days after initiation)';
COMMENT ON COLUMN couples.dissolution_cancelled_at IS 'Timestamp when dissolution was cancelled (nullifies scheduled deletion)';

-- =============================================================
-- STEP 2: Add couple_id to shared data tables
-- =============================================================

-- Add nullable columns first (will be backfilled, then made NOT NULL)
ALTER TABLE mood_logs
    ADD COLUMN couple_id uuid REFERENCES couples(id) ON DELETE SET NULL;

ALTER TABLE messages
    ADD COLUMN couple_id uuid REFERENCES couples(id) ON DELETE SET NULL;

-- Add performance indexes
CREATE INDEX idx_mood_logs_couple_id ON mood_logs (couple_id);
CREATE INDEX idx_messages_couple_id ON messages (couple_id);

COMMENT ON COLUMN mood_logs.couple_id IS 'Relationship context - enables safe scoped deletion during dissolution';
COMMENT ON COLUMN messages.couple_id IS 'Relationship context - enables safe scoped deletion during dissolution';

-- =============================================================
-- STEP 3: Backfill existing data
-- =============================================================

-- Function to backfill mood_logs with current couple_id
-- Assigns each user's current relationship to ALL their historical logs
CREATE OR REPLACE FUNCTION backfill_mood_logs_couple_id()
RETURNS TABLE (updated_count bigint)
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated_count bigint;
BEGIN
    -- For each mood log without a couple_id, find the user's current couple
    UPDATE mood_logs ml
    SET couple_id = c.id
    FROM couples c
    WHERE ml.couple_id IS NULL
      AND (c.user1_id = ml.user_id OR c.user2_id = ml.user_id);

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RAISE NOTICE 'Backfilled % mood logs with couple_id', v_updated_count;

    RETURN QUERY SELECT v_updated_count;
END;
$$;

-- Function to backfill messages with current couple_id
CREATE OR REPLACE FUNCTION backfill_messages_couple_id()
RETURNS TABLE (updated_count bigint)
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated_count bigint;
BEGIN
    -- For each message without a couple_id, find the couple relationship
    -- between sender and receiver
    UPDATE messages m
    SET couple_id = c.id
    FROM couples c
    WHERE m.couple_id IS NULL
      AND (
          (c.user1_id = m.sender_id AND c.user2_id = m.receiver_id)
          OR (c.user1_id = m.receiver_id AND c.user2_id = m.sender_id)
      );

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RAISE NOTICE 'Backfilled % messages with couple_id', v_updated_count;

    RETURN QUERY SELECT v_updated_count;
END;
$$;

-- =============================================================
-- STEP 4: Create safe cleanup function
-- =============================================================

-- CRITICAL: This function ONLY deletes by couple_id
-- NEVER delete by user_id to prevent data loss
CREATE OR REPLACE FUNCTION cleanup_dissolved_relationships()
RETURNS TABLE (
    couple_id uuid,
    user1_id uuid,
    user2_id uuid,
    mood_logs_deleted integer,
    messages_deleted integer,
    couple_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_couple_id uuid;
    v_user1_id uuid;
    v_user2_id uuid;
    v_mood_count integer;
    v_msg_count integer;
BEGIN
    -- Find couples where grace period has expired
    FOR v_couple_id, v_user1_id, v_user2_id IN
        SELECT c.id, c.user1_id, c.user2_id
        FROM couples c
        WHERE c.dissolution_scheduled_for IS NOT NULL
          AND c.dissolution_scheduled_for <= NOW()
          AND c.dissolution_cancelled_at IS NULL
    LOOP
        -- Count before deletion (for audit logging)
        SELECT COUNT(*) INTO v_mood_count
        FROM mood_logs WHERE mood_logs.couple_id = v_couple_id;

        SELECT COUNT(*) INTO v_msg_count
        FROM messages WHERE messages.couple_id = v_couple_id;

        -- CRITICAL SAFETY: Delete ONLY by couple_id (NEVER by user_id)
        DELETE FROM mood_logs WHERE mood_logs.couple_id = v_couple_id;
        DELETE FROM messages WHERE messages.couple_id = v_couple_id;

        -- Delete pairing requests between these users
        DELETE FROM pairing_requests
        WHERE (sender_id = v_user1_id AND receiver_id = v_user2_id)
           OR (sender_id = v_user2_id AND receiver_id = v_user1_id);

        -- Finally, delete the couple record
        DELETE FROM couples WHERE couples.id = v_couple_id;

        -- Return results for audit log
        RETURN QUERY SELECT
            v_couple_id,
            v_user1_id,
            v_user2_id,
            v_mood_count,
            v_msg_count,
            true;
    END LOOP;

    RETURN;
END;
$$;

-- Grant execute to service role only (NOT to authenticated users)
-- This prevents users from manually triggering cleanup
REVOKE ALL ON FUNCTION cleanup_dissolved_relationships() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_dissolved_relationships() FROM authenticated;

COMMENT ON FUNCTION cleanup_dissolved_relationships() IS
'Safely deletes shared data for couples past grace period. ONLY deletes by couple_id. Call manually or via scheduled job.';

-- =============================================================
-- STEP 5: Update RLS policies to respect couple_id
-- =============================================================

-- Drop old mood_logs partner view policy
DROP POLICY IF EXISTS "Partners can view each other mood logs" ON mood_logs;

-- New policy: Partners can only view logs from their CURRENT couple_id
CREATE POLICY "Partners can view mood logs from current relationship"
    ON mood_logs FOR SELECT
    USING (
        -- Can always see own logs
        auth.uid() = user_id
        OR
        -- Can see partner's logs from current active relationship
        EXISTS (
            SELECT 1 FROM couples c
            WHERE c.id = mood_logs.couple_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
              -- Exclude couples pending dissolution (grace period)
              AND (c.dissolution_scheduled_for IS NULL
                   OR c.dissolution_cancelled_at IS NOT NULL)
        )
    );

-- Drop old messages view policy
DROP POLICY IF EXISTS "Message participants can view" ON messages;

-- New policy: Only view messages from current active relationship
CREATE POLICY "Users can view messages from current relationship"
    ON messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM couples c
            WHERE c.id = messages.couple_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
              -- Exclude couples pending dissolution (grace period)
              AND (c.dissolution_scheduled_for IS NULL
                   OR c.dissolution_cancelled_at IS NOT NULL)
        )
    );

-- =============================================================
-- STEP 6: Create audit log table (optional but recommended)
-- =============================================================

CREATE TABLE IF NOT EXISTS dissolution_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    couple_id uuid NOT NULL,
    user1_id uuid NOT NULL,
    user2_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('initiated', 'cancelled', 'completed')),
    initiated_by uuid,
    mood_logs_deleted integer,
    messages_deleted integer,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dissolution_audit_couple ON dissolution_audit_log (couple_id);
CREATE INDEX idx_dissolution_audit_created ON dissolution_audit_log (created_at DESC);
CREATE INDEX idx_dissolution_audit_event ON dissolution_audit_log (event_type);

-- Enable RLS (only admins can view via service_role key)
ALTER TABLE dissolution_audit_log ENABLE ROW LEVEL SECURITY;

-- No policies = no access for regular users
-- Admins can query via service_role key for monitoring

COMMENT ON TABLE dissolution_audit_log IS
'Audit trail for all dissolution events. Queryable only with service_role key for monitoring and compliance.';

-- =============================================================
-- STEP 7: Helper function to log audit events (optional)
-- =============================================================

CREATE OR REPLACE FUNCTION log_dissolution_event(
    p_couple_id uuid,
    p_event_type text,
    p_initiated_by uuid DEFAULT NULL,
    p_mood_logs_deleted integer DEFAULT NULL,
    p_messages_deleted integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user1_id uuid;
    v_user2_id uuid;
    v_audit_id uuid;
BEGIN
    -- Get user IDs from couple (or from existing audit log if couple is deleted)
    SELECT user1_id, user2_id INTO v_user1_id, v_user2_id
    FROM couples WHERE id = p_couple_id;

    -- If couple doesn't exist (already deleted), try to get from last audit entry
    IF v_user1_id IS NULL THEN
        SELECT user1_id, user2_id INTO v_user1_id, v_user2_id
        FROM dissolution_audit_log
        WHERE couple_id = p_couple_id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    -- Insert audit log
    INSERT INTO dissolution_audit_log (
        couple_id, user1_id, user2_id, event_type,
        initiated_by, mood_logs_deleted, messages_deleted
    )
    VALUES (
        p_couple_id, v_user1_id, v_user2_id, p_event_type,
        p_initiated_by, p_mood_logs_deleted, p_messages_deleted
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

COMMENT ON FUNCTION log_dissolution_event IS
'Helper function to create audit log entries for dissolution events. Call from application or triggers.';

-- =============================================================
-- INSTRUCTIONS FOR DEPLOYMENT
-- =============================================================

/*

DEPLOYMENT CHECKLIST:

1. BACKUP DATABASE FIRST
   - Take full database backup before running this migration

2. RUN MIGRATION IN STAGING FIRST
   - Test on staging/dev environment with production-like data
   - Verify backfill works correctly
   - Test cleanup function with test data

3. RUN IN PRODUCTION (during low-traffic period)

   Step 3a: Execute structure changes
   - First 2 sections complete instantly

   Step 3b: Run backfill functions manually
   SELECT * FROM backfill_mood_logs_couple_id();
   SELECT * FROM backfill_messages_couple_id();

   Step 3c: Verify backfill
   SELECT COUNT(*) FROM mood_logs WHERE couple_id IS NULL;  -- Should be low/zero
   SELECT COUNT(*) FROM messages WHERE couple_id IS NULL;   -- Should be low/zero

   Step 3d: OPTIONAL - Make couple_id NOT NULL (after confirming app is deployed)
   -- Wait until application code is updated to include couple_id in all INSERTs
   -- ALTER TABLE mood_logs ALTER COLUMN couple_id SET NOT NULL;
   -- ALTER TABLE messages ALTER COLUMN couple_id SET NOT NULL;

4. MONITOR
   - Check for errors in application logs
   - Verify new mood logs and messages include couple_id
   - Monitor RLS policy performance

5. MANUAL CLEANUP PROCESS (WEEKLY OR AS NEEDED)

   -- Check for expired dissolutions
   SELECT id, user1_id, user2_id, dissolution_scheduled_for,
          NOW() - dissolution_scheduled_for AS expired_by
   FROM couples
   WHERE dissolution_scheduled_for <= NOW()
     AND dissolution_cancelled_at IS NULL;

   -- Run cleanup
   SELECT * FROM cleanup_dissolved_relationships();

   -- Verify
   SELECT COUNT(*) FROM couples
   WHERE dissolution_scheduled_for <= NOW()
     AND dissolution_cancelled_at IS NULL;  -- Should be 0

ROLLBACK PLAN (if issues arise):

-- Emergency: Delay all scheduled dissolutions by 30 days
UPDATE couples
SET dissolution_scheduled_for = dissolution_scheduled_for + INTERVAL '30 days'
WHERE dissolution_scheduled_for IS NOT NULL
  AND dissolution_cancelled_at IS NULL;

-- If needed: Revert couple_id to nullable
ALTER TABLE mood_logs ALTER COLUMN couple_id DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN couple_id DROP NOT NULL;

-- If needed: Re-enable old RLS policies (check supabase-rls-fixes.sql)

*/
