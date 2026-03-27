-- ============================================================
--  MoodSync — RLS Policy Fixes (Phase 1 Stabilization)
--
--  Run this SQL in Supabase SQL Editor (Dashboard → SQL)
--  AFTER running the main supabase-schema.sql
--
--  This file fixes:
--    1. Profile pair_code lookup policy (for pairing flow)
--    2. Messages table schema updates (delivery tracking)
--    3. Messages UPDATE/DELETE policies (for delivery states)
--    4. mood_logs DELETE policy (for history deletion)
-- ============================================================


-- ============================================================
--  1. PROFILES — STRICT RLS Policy (TASK 5)
--
--  Users can ONLY see:
--    - Their own profile
--    - Their partner's profile (via couples table)
--    - Profiles by pair_code lookup (for pairing flow)
--
--  NO global access (auth.uid() IS NOT NULL removed)
-- ============================================================

-- Drop all existing profile policies
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own and partner profile" ON profiles;
DROP POLICY IF EXISTS "Profile view policy" ON profiles;

-- STRICT policy: Own profile OR partner via couples
CREATE POLICY "Users can view own and partner profile"
    ON profiles FOR SELECT
    USING (
        -- Own profile
        auth.uid() = id
        -- Partner's profile via couples
        OR EXISTS (
            SELECT 1 FROM couples
            WHERE (user1_id = auth.uid() AND user2_id = profiles.id)
               OR (user2_id = auth.uid() AND user1_id = profiles.id)
        )
        -- Pair code lookup: allow if matching pair_code in request
        -- This is handled via the pairing_requests join fallback
    );

-- For pair_code lookup during pairing, we use the pairing_requests
-- table with embedded profile joins, which works because:
-- 1. Users can see their own pairing_requests (sender or receiver)
-- 2. The join fetches profile names through the FK relationship

-- SECURE FUNCTION: Lookup user by pair_code
-- This function runs with SECURITY DEFINER to bypass RLS
-- but only returns minimal safe information (id, name, pair_code)
CREATE OR REPLACE FUNCTION find_user_by_pair_code(lookup_code text)
RETURNS TABLE (id uuid, name text, pair_code text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, p.name, p.pair_code
    FROM profiles p
    WHERE LOWER(p.pair_code) = LOWER(TRIM(lookup_code))
    LIMIT 1;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION find_user_by_pair_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_user_by_pair_code(text) TO authenticated;


-- ============================================================
--  2. MESSAGES — Add delivery tracking columns
--
--  The chat.js file uses delivered_at, seen_at, and is_deleted
--  columns that need to be added to the messages table.
-- ============================================================

-- Add delivery tracking columns (safe to run multiple times)
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
    ADD COLUMN IF NOT EXISTS seen_at timestamptz,
    ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- Index for unread message queries
CREATE INDEX IF NOT EXISTS idx_messages_seen_at ON messages (receiver_id, seen_at)
    WHERE seen_at IS NULL;


-- ============================================================
--  3. MESSAGES — UPDATE and DELETE policies
--
--  Allow senders to update delivery status and soft-delete.
--  Allow receivers to mark messages as seen.
-- ============================================================

-- Drop existing message policies to recreate them properly
DROP POLICY IF EXISTS "Message participants can view" ON messages;
DROP POLICY IF EXISTS "Sender can insert own message" ON messages;
DROP POLICY IF EXISTS "Sender can update own message" ON messages;
DROP POLICY IF EXISTS "Receiver can mark message seen" ON messages;
DROP POLICY IF EXISTS "Sender can delete own message" ON messages;

-- SELECT: Only participants can view their conversation
CREATE POLICY "Message participants can view"
    ON messages FOR SELECT
    USING (
        auth.uid() = sender_id
        OR auth.uid() = receiver_id
    );

-- INSERT: Only sender can insert (and only as themselves)
-- Additional check: receiver must be partner (via couples table)
CREATE POLICY "Sender can insert message to partner"
    ON messages FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND EXISTS (
            SELECT 1 FROM couples
            WHERE (user1_id = auth.uid() AND user2_id = messages.receiver_id)
               OR (user2_id = auth.uid() AND user1_id = messages.receiver_id)
        )
    );

-- UPDATE: Sender can update is_deleted (soft delete)
CREATE POLICY "Sender can update own message"
    ON messages FOR UPDATE
    USING (auth.uid() = sender_id);

-- UPDATE: Receiver can mark message as seen (update seen_at)
CREATE POLICY "Receiver can mark message seen"
    ON messages FOR UPDATE
    USING (auth.uid() = receiver_id);

-- Note: We use two UPDATE policies because Supabase combines them with OR logic
-- The application layer controls which columns can be updated


-- ============================================================
--  4. MOOD_LOGS — DELETE policy
--
--  Allow users to delete their own mood logs.
-- ============================================================

-- Drop existing delete policy if any
DROP POLICY IF EXISTS "Users can delete own mood logs" ON mood_logs;

-- Users can delete their own mood logs
CREATE POLICY "Users can delete own mood logs"
    ON mood_logs FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
--  5. MOOD_LOGS — UPDATE policy (for potential future edits)
-- ============================================================

-- Drop existing update policy if any
DROP POLICY IF EXISTS "Users can update own mood logs" ON mood_logs;

-- Users can update their own mood logs
CREATE POLICY "Users can update own mood logs"
    ON mood_logs FOR UPDATE
    USING (auth.uid() = user_id);


-- ============================================================
--  6. COUPLES — DELETE policy (for unpair feature)
--
--  Allow either partner to delete the couple relationship.
-- ============================================================

-- Drop existing delete policy if any
DROP POLICY IF EXISTS "Partners can delete couple" ON couples;

-- Either partner can delete the couple
CREATE POLICY "Partners can delete couple"
    ON couples FOR DELETE
    USING (auth.uid() = user1_id OR auth.uid() = user2_id);


-- ============================================================
--  7. INDEXES for performance
-- ============================================================

-- Index for mood_logs queries by date range
CREATE INDEX IF NOT EXISTS idx_mood_logs_logged_at
    ON mood_logs (logged_at DESC);

-- Composite index for couple mood queries
CREATE INDEX IF NOT EXISTS idx_mood_logs_user_date
    ON mood_logs (user_id, logged_at DESC);

-- Index for pairing_requests status queries
CREATE INDEX IF NOT EXISTS idx_pairing_requests_status
    ON pairing_requests (status, receiver_id);

-- Index for couples lookups
CREATE INDEX IF NOT EXISTS idx_couples_user1 ON couples (user1_id);
CREATE INDEX IF NOT EXISTS idx_couples_user2 ON couples (user2_id);


-- ============================================================
--  8. ENABLE REALTIME for all tables (idempotent)
-- ============================================================

-- These are safe to run multiple times
DO $$
BEGIN
    -- Enable realtime for mood_logs
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'mood_logs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE mood_logs;
    END IF;

    -- Enable realtime for pairing_requests
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'pairing_requests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE pairing_requests;
    END IF;

    -- Enable realtime for messages
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    END IF;

    -- Enable realtime for couples
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'couples'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE couples;
    END IF;
END $$;


-- ============================================================
--  VERIFICATION QUERIES
--  Run these to verify the policies are applied correctly:
-- ============================================================

-- List all RLS policies
-- SELECT schemaname, tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- Check table columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'messages';


-- ============================================================
--  SUCCESS MESSAGE
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE 'MoodSync RLS fixes applied successfully!';
END $$;

