-- ============================================================
--  MoodSync: Fix couple_id Missing Column Error
--
--  This migration adds couple_id to mood_logs and messages
--  and safely backfills existing data.
--
--  SAFETY: Run during low-traffic period, take backup first
-- ============================================================

-- Step 1: Add couple_id columns (nullable initially for safety)
ALTER TABLE mood_logs
    ADD COLUMN IF NOT EXISTS couple_id uuid REFERENCES couples(id) ON DELETE SET NULL;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS couple_id uuid REFERENCES couples(id) ON DELETE SET NULL;

-- Step 2: Add performance indexes
CREATE INDEX IF NOT EXISTS idx_mood_logs_couple_id ON mood_logs (couple_id);
CREATE INDEX IF NOT EXISTS idx_messages_couple_id ON messages (couple_id);

-- Step 3: Backfill existing mood_logs with current couple relationships
UPDATE mood_logs ml
SET couple_id = c.id
FROM couples c
WHERE ml.couple_id IS NULL
  AND (c.user1_id = ml.user_id OR c.user2_id = ml.user_id);

-- Step 4: Backfill existing messages with couple relationships
UPDATE messages m
SET couple_id = c.id
FROM couples c
WHERE m.couple_id IS NULL
  AND (
      (c.user1_id = m.sender_id AND c.user2_id = m.receiver_id)
      OR (c.user1_id = m.receiver_id AND c.user2_id = m.sender_id)
  );

-- Step 5: Update RLS policies to respect couple_id
DROP POLICY IF EXISTS "Partners can view each other mood logs" ON mood_logs;

CREATE POLICY "Partners can view mood logs from current relationship"
    ON mood_logs FOR SELECT
    USING (
        -- Can always see own logs
        auth.uid() = user_id
        OR
        -- Can see partner's logs from current relationship only
        EXISTS (
            SELECT 1 FROM couples c
            WHERE c.id = mood_logs.couple_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
    );

-- Step 6: Verification queries (run these to check results)
-- SELECT COUNT(*) as total_moods, COUNT(couple_id) as with_couple_id FROM mood_logs;
-- SELECT COUNT(*) as total_messages, COUNT(couple_id) as with_couple_id FROM messages;

-- Step 7: [OPTIONAL] Make NOT NULL after confirming app works
-- Uncomment these ONLY after verifying frontend saves mood successfully:
-- ALTER TABLE mood_logs ALTER COLUMN couple_id SET NOT NULL;
-- ALTER TABLE messages ALTER COLUMN couple_id SET NOT NULL;