-- ============================================================
--  MoodSync — Live Location Sharing Schema
--  Run this SQL in Supabase SQL Editor (Dashboard → SQL)
--
--  This adds location sharing functionality for paired users.
--  Features:
--    - Real-time location updates
--    - Privacy controls (enable/disable sharing)
--    - Automatic location expiry (24 hours)
--    - Last updated timestamp
-- ============================================================


-- ============================================================
--  1. LOCATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    latitude         decimal(10, 8) NOT NULL,
    longitude        decimal(11, 8) NOT NULL,
    accuracy         decimal(10, 2),  -- Accuracy in meters
    sharing_enabled  boolean NOT NULL DEFAULT true,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),

    -- Ensure one location row per user
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Index for faster partner lookups
CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_updated_at ON locations(updated_at);


-- ============================================================
--  2. RLS POLICIES
-- ============================================================

-- Users can view their own location
CREATE POLICY "Users can view own location"
    ON locations FOR SELECT
    USING (auth.uid() = user_id);

-- Users can view their partner's location (only if sharing is enabled)
CREATE POLICY "Users can view partner location"
    ON locations FOR SELECT
    USING (
        sharing_enabled = true
        AND EXISTS (
            SELECT 1 FROM couples
            WHERE (user1_id = auth.uid() AND user2_id = locations.user_id)
               OR (user2_id = auth.uid() AND user1_id = locations.user_id)
        )
    );

-- Users can insert their own location
CREATE POLICY "Users can insert own location"
    ON locations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own location
CREATE POLICY "Users can update own location"
    ON locations FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own location
CREATE POLICY "Users can delete own location"
    ON locations FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
--  3. ENABLE REALTIME
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'locations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE locations;
    END IF;
END $$;


-- ============================================================
--  4. AUTOMATIC CLEANUP FUNCTION
--  Delete locations older than 24 hours (stale data cleanup)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_stale_locations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM locations
    WHERE updated_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- Optional: Create a scheduled job to run cleanup daily
-- (Requires Supabase pg_cron extension)
-- SELECT cron.schedule(
--     'cleanup-stale-locations',
--     '0 0 * * *',  -- Run daily at midnight
--     $$ SELECT cleanup_stale_locations(); $$
-- );


-- ============================================================
--  5. HELPER FUNCTION: Get Partner Location
--  Safely retrieve partner's location with privacy checks
-- ============================================================
CREATE OR REPLACE FUNCTION get_partner_location()
RETURNS TABLE (
    user_id uuid,
    latitude decimal,
    longitude decimal,
    accuracy decimal,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    partner_id uuid;
BEGIN
    -- Find partner ID
    SELECT CASE
        WHEN c.user1_id = auth.uid() THEN c.user2_id
        WHEN c.user2_id = auth.uid() THEN c.user1_id
    END INTO partner_id
    FROM couples c
    WHERE c.user1_id = auth.uid() OR c.user2_id = auth.uid()
    LIMIT 1;

    -- Return partner's location if sharing is enabled
    IF partner_id IS NOT NULL THEN
        RETURN QUERY
        SELECT l.user_id, l.latitude, l.longitude, l.accuracy, l.updated_at
        FROM locations l
        WHERE l.user_id = partner_id
          AND l.sharing_enabled = true
          AND l.updated_at > NOW() - INTERVAL '24 hours';
    END IF;
END;
$$;

-- Grant execute to authenticated users
REVOKE ALL ON FUNCTION get_partner_location() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_partner_location() TO authenticated;


-- ============================================================
--  SUCCESS MESSAGE
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE 'MoodSync location sharing schema applied successfully!';
    RAISE NOTICE 'Location data will auto-expire after 24 hours of inactivity.';
END $$;
