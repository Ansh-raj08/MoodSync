// =============================================================
//  supabaseClient.js — Supabase Client Initialisation
//  MoodSync · Centralised database & auth client
//
//  Every module that needs Supabase reads `supabaseClient`.
//  Load the CDN script BEFORE this file in HTML:
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// =============================================================

"use strict";

const SUPABASE_URL      = "https://bisvezgkbdyhfzotzyoj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpc3ZlemdrYmR5aGZ6b3R6eW9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzcwOTQsImV4cCI6MjA4ODM1MzA5NH0.0SbRnThjYtYY0G75qjDKc1omU7mzn9aOJPHWODihHvg";

if (typeof window.supabase === "undefined") {
    throw new Error(
        "[MoodSync] Supabase SDK not loaded. " +
        "Add the CDN <script> tag before supabaseClient.js."
    );
}

/** @type {import("@supabase/supabase-js").SupabaseClient} */
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "moodsync_auth",
    },
});
