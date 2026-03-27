-- =============================================================
--  FIX: Messages INSERT Policy for Couple Validation
--
--  This fixes the chat messaging issue by creating a proper
--  INSERT policy that validates sender-receiver relationships
--  through the couples table.
-- =============================================================

-- Step 1: Drop the old permissive INSERT policy
DROP POLICY IF EXISTS "Sender can insert own message" ON messages;

-- Step 2: Create new INSERT policy that validates couple relationship
CREATE POLICY "Users can insert messages to partner only"
    ON messages FOR INSERT
    WITH CHECK (
        -- User must be the sender
        auth.uid() = sender_id

        AND

        -- Receiver must be the user's partner via active couple relationship
        EXISTS (
            SELECT 1 FROM couples c
            WHERE c.id = couple_id
              -- User is part of this couple
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
              -- Receiver is the other partner in this couple
              AND (
                  (c.user1_id = auth.uid() AND c.user2_id = receiver_id)
                  OR (c.user2_id = auth.uid() AND c.user1_id = receiver_id)
              )
              -- Couple is not dissolved (grace period check)
              AND (c.dissolution_scheduled_for IS NULL
                   OR c.dissolution_cancelled_at IS NOT NULL)
        )
    );

-- Step 3: Also ensure UPDATE policy exists for soft delete
-- (The existing policy should work but let's be explicit)
DROP POLICY IF EXISTS "Users can update own messages" ON messages;

CREATE POLICY "Users can update own messages"
    ON messages FOR UPDATE
    USING (auth.uid() = sender_id)
    WITH CHECK (auth.uid() = sender_id);

-- Step 4: Verification queries to run after applying:
--
-- -- Check if couple_id column exists:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'messages' AND column_name = 'couple_id';
--
-- -- Check current policies:
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies WHERE tablename = 'messages';
--
-- -- Test insert (should work for paired users):
-- INSERT INTO messages (sender_id, receiver_id, couple_id, message)
-- VALUES (auth.uid(), 'partner-id', 'couple-id', 'test message');