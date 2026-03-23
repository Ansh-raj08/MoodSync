// =============================================================
//  mood.js — Daily Mood Logging
//  MoodSync · Mood selection, notes, Supabase persistence
//
//  Dependencies: supabaseClient.js, auth.js, data.js
//
//  PHASE 1 STABILIZATION:
//  - Uses subscribeWithCleanup for realtime subscriptions
//  - Consistent error handling
//
//  Mood scale (5 anchor points on a 1–9 range):
//    1 = Very Bad · 3 = Bad · 5 = Neutral · 7 = Good · 9 = Great
//
//  Public API:
//    saveMood(score, note?)      → mood_logs row
//    getMoodHistory(userId, days?) → sorted array
//    getTodayMood()              → row | null
//
//  Also handles mood.html DOM logic via DOMContentLoaded.
// =============================================================

"use strict";

// ---- Mood display map (full 1–9 range) ----
const MOOD_MAP = {
    1: { emoji: "😫", label: "Very Bad",  color: "var(--clr-rose)" },
    2: { emoji: "😫", label: "Very Bad",  color: "var(--clr-rose)" },
    3: { emoji: "😔", label: "Bad",       color: "var(--clr-pink)" },
    4: { emoji: "😔", label: "Bad",       color: "var(--clr-pink)" },
    5: { emoji: "😐", label: "Neutral",   color: "var(--clr-teal)" },
    6: { emoji: "🙂", label: "Good",      color: "var(--clr-mint)" },
    7: { emoji: "😄", label: "Good",      color: "var(--clr-mint)" },
    8: { emoji: "🥰", label: "Great",     color: "var(--clr-lavender)" },
    9: { emoji: "🥰", label: "Great",     color: "var(--clr-purple)" },
};

// 5 selectable options shown in the mood picker UI
const MOOD_OPTIONS = [
    { value: 1, emoji: "😫", label: "Very Bad" },
    { value: 3, emoji: "😔", label: "Bad" },
    { value: 5, emoji: "😐", label: "Neutral" },
    { value: 7, emoji: "😄", label: "Good" },
    { value: 9, emoji: "🥰", label: "Great" },
];

// =============================================================
//  Mood Data API (Supabase)
// =============================================================

/**
 * Save a mood entry for the current user.
 * @param {number} score - 1–9
 * @param {string} [note]
 * @returns {Promise<Object>} inserted row
 */
async function saveMood(score, note = "") {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    // Get current couple (required for relationship-scoped data)
    const couple = await getCouple();
    if (!couple) throw new Error("You must be paired to log mood.");

    const clamped = Math.max(1, Math.min(9, Math.round(score)));

    const { data, error } = await supabaseClient
        .from("mood_logs")
        .insert({
            user_id: user.id,
            couple_id: couple.id,  // CRITICAL: Relationship-scoped for safe deletion
            score:   clamped,
            note:    note.trim() || null,
        })
        .select()
        .single();

    if (error) throw new Error("Failed to save mood: " + error.message);
    return data;
}

/**
 * Fetch mood history for a user.
 * @param {string} userId
 * @param {number} [days] - Number of calendar days (omit = all-time)
 * @returns {Promise<Array<{date: string, userId: string, score: number, note: string|null}>>}
 *          Sorted oldest → newest.
 */
async function getMoodHistory(userId, days) {
    let query = supabaseClient
        .from("mood_logs")
        .select("id, user_id, score, note, logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: true });

    if (days && days > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (days - 1));
        cutoff.setHours(0, 0, 0, 0);
        query = query.gte("logged_at", cutoff.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error("Failed to fetch moods: " + error.message);

    return (data || []).map(row => ({
        date:   row.logged_at.slice(0, 10),
        userId: row.user_id,
        score:  row.score,
        note:   row.note,
    }));
}

/**
 * Check if the current user already logged mood today.
 * @returns {Promise<Object|null>}
 */
async function getTodayMood() {
    const user = await getUser();
    if (!user) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data } = await supabaseClient
        .from("mood_logs")
        .select("score, note, logged_at")
        .eq("user_id", user.id)
        .gte("logged_at", today.toISOString())
        .order("logged_at", { ascending: false })
        .limit(1);

    if (!data || !data.length) return null;
    return { date: data[0].logged_at.slice(0, 10), score: data[0].score, note: data[0].note };
}

// =============================================================
//  mood.html Page Logic
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "mood.html") return;

    // Auth + couple guard
    const ctx = await requireCouple();
    if (!ctx) return;

    await _initMoodPage(ctx.user);

    // Check and show dissolution banner if pending
    if (typeof checkAndShowDissolutionBanner === "function") {
        await checkAndShowDissolutionBanner();
    }
});

async function _initMoodPage(user) {
    // Set today's date header
    const dateEl = document.getElementById("todayDate");
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", year: "numeric",
        });
    }

    // Check if already logged today
    const todayMood = await getTodayMood();
    if (todayMood) {
        _showAlreadyLogged(todayMood);
        return;
    }

    // Show the form
    const section = document.getElementById("moodSection");
    if (section) section.hidden = false;

    // Wire mood picker
    let selectedScore = null;
    document.querySelectorAll(".mood-option input[name='mood']").forEach(radio => {
        radio.addEventListener("change", () => {
            selectedScore = parseInt(radio.value, 10);
            document.querySelectorAll(".mood-option").forEach(o => o.classList.remove("mood-option--active"));
            radio.closest(".mood-option").classList.add("mood-option--active");
        });

        // Also handle click events for reliability
        radio.addEventListener("click", () => {
            selectedScore = parseInt(radio.value, 10);
        });
    });

    // Character counter
    const noteInput = document.getElementById("moodNote");
    const charCount = document.getElementById("charCount");
    if (noteInput && charCount) {
        noteInput.addEventListener("input", () => { charCount.textContent = noteInput.value.length; });
    }

    // Submit
    const form      = document.getElementById("moodForm");
    const submitBtn = document.getElementById("submitBtn");

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            // Check DOM state directly for reliability
            const checkedRadio = form.querySelector("input[name='mood']:checked");
            if (!checkedRadio) {
                alert("Please select a mood first.");
                return;
            }

            const score = parseInt(checkedRadio.value, 10);
            if (!score || score < 1 || score > 9) {
                alert("Please select a valid mood.");
                return;
            }

            submitBtn.disabled  = true;
            submitBtn.innerHTML = '<span class="btn__icon">⏳</span> Saving…';

            try {
                const note = noteInput ? noteInput.value.trim() : "";
                await saveMood(score, note);

                const info = MOOD_MAP[score] || MOOD_MAP[5];
                _showMoodSuccess(score, info);
            } catch (err) {
                console.error("[mood] Save failed:", err.message);
                submitBtn.disabled  = false;
                submitBtn.innerHTML = '<span class="btn__icon">✨</span> Save Today\'s Mood';
                alert("Failed to save: " + err.message);
            }
        });
    }

    // Logout - clean up subscriptions before signing out
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            unsubscribeAll();
            signOut();
        });
    }
}

function _showAlreadyLogged(mood) {
    const banner  = document.getElementById("loggedBanner");
    const section = document.getElementById("moodSection");
    if (banner)  banner.hidden  = false;
    if (section) section.hidden = true;

    const info = MOOD_MAP[mood.score] || MOOD_MAP[5];
    const emoji = document.getElementById("loggedEmoji");
    const label = document.getElementById("loggedLabel");
    if (emoji) emoji.textContent = info.emoji;
    if (label) label.textContent = "Feeling " + info.label.toLowerCase();
}

function _showMoodSuccess(score, info) {
    const section = document.getElementById("moodSection");
    const success = document.getElementById("moodSuccess");
    if (section) section.hidden = true;
    if (success) success.hidden = false;

    const emoji = document.getElementById("successEmoji");
    const text  = document.getElementById("successText");
    if (emoji) emoji.textContent = info.emoji;
    if (text)  text.textContent  = "You're feeling " + info.label.toLowerCase() + " today.";
}
