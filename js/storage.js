// ============================================================
//  storage.js — Data Persistence Module
//  MoodSync · Single source of truth for mood data I/O
//
//  Storage key : "moods"
//  Data shape  : Array of MoodEntry objects
//
//  MoodEntry {
//    date   : "YYYY-MM-DD"   (one entry per userId per day)
//    userId : string
//    score  : number          (1–9 scale: 1=Very Bad … 9=Great)
//  }
//
//  Future-ready:
//    – Replace the read/write helpers below with API calls
//      (e.g. fetch("/api/moods")) to migrate to a backend.
//    – userId maps naturally to a PostgreSQL users.id column.
// ============================================================

"use strict";

// ---- Storage key (single source) ----
const MOODS_KEY = "moods";

// ============================================================
//  Internal helpers  (private — not exported)
// ============================================================

/**
 * Read the raw moods array from localStorage.
 * Always returns an array (never throws).
 * @returns {MoodEntry[]}
 */
function _readAll() {
    try {
        const raw = localStorage.getItem(MOODS_KEY);
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Persist the moods array to localStorage.
 * @param {MoodEntry[]} moods
 */
function _writeAll(moods) {
    localStorage.setItem(MOODS_KEY, JSON.stringify(moods));
}

/**
 * Get today's date string in "YYYY-MM-DD" format.
 * @returns {string}
 */
function _today() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Get the ISO date string for N days ago.
 * @param {number} daysBack
 * @returns {string}
 */
function _daysAgo(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().slice(0, 10);
}

// ============================================================
//  Public API
// ============================================================

/**
 * Save a mood entry for the given user on today's date.
 *
 * Rules:
 *   – One entry per user per day (idempotent: updates if already logged)
 *   – Score is clamped to the 1–9 range
 *
 * @param {string} userId  — Unique user identifier (e.g. "user_01")
 * @param {number} score   — Mood score on the 1–9 scale
 * @returns {MoodEntry}    — The saved entry
 */
function saveMood(userId, score) {
    if (!userId) throw new Error("saveMood: userId is required");

    const clampedScore = Math.max(1, Math.min(9, Math.round(score)));
    const today = _today();
    const moods = _readAll();

    // Check for an existing entry from this user today
    const existingIndex = moods.findIndex(
        (m) => m.userId === userId && m.date === today
    );

    const entry = { date: today, userId, score: clampedScore };

    if (existingIndex !== -1) {
        // Update in-place (overwrite today's score)
        moods[existingIndex] = entry;
    } else {
        moods.push(entry);
    }

    _writeAll(moods);
    return entry;
}

/**
 * Return mood logs for a specific user over the last N calendar days.
 *
 * @param {string} userId  — User to filter by
 * @param {number} [days]  — Window size in days (default: all-time)
 * @returns {MoodEntry[]}  — Sorted oldest → newest
 */
function getMoodHistory(userId, days) {
    if (!userId) throw new Error("getMoodHistory: userId is required");

    const moods = _readAll();
    let entries = moods.filter((m) => m.userId === userId);

    if (days !== undefined && days > 0) {
        const cutoff = _daysAgo(days - 1);          // inclusive
        entries = entries.filter((m) => m.date >= cutoff);
    }

    // Sort oldest → newest
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
}

/**
 * Return all stored mood logs (all users, all dates).
 *
 * @returns {MoodEntry[]} — Unsorted raw array
 */
function getAllMoods() {
    return _readAll();
}

/**
 * Delete all stored mood data.
 * Use with caution — intended for dev/testing or account reset flows.
 */
function clearMoodData() {
    localStorage.removeItem(MOODS_KEY);
}
