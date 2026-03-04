// ============================================================
//  algorithm.js — Relationship Health Algorithm
//  MoodSync · All calculation logic lives here
//
//  Mood scale stored: 1–6
//    1 = Awful, 2 = Bad, 3 = Okay, 4 = Good, 5 = Great, 6 = Amazing
//  Internal normalisation: (value − 1) / 5  → 0.0 – 1.0
//
//  Health Score weights:
//    40% Mood Average
//    25% Mood Trend (last 7 days)
//    20% Mood Difference (partner parity — graceful when no partner data)
//    15% Interaction Frequency (last 14 days)
// ============================================================

// ---- Storage accessor ----

/**
 * Returns the raw mood log object from localStorage.
 * Shape: { "YYYY-MM-DD": { mood: number, note: string, timestamp: string } }
 */
function getMoodHistory() {
    try {
        return JSON.parse(localStorage.getItem("moodSync_logs") || "{}");
    } catch {
        return {};
    }
}

/**
 * Returns the couple profile from localStorage.
 * Shape: { userName, partnerName, startDate, createdAt }
 */
function getCoupleProfile() {
    try {
        return JSON.parse(localStorage.getItem("couple") || "null");
    } catch {
        return null;
    }
}

// ---- Internal helpers ----

/** Normalise a 1-6 mood value to 0.0–1.0 */
function normaliseMood(value) {
    return (Math.max(1, Math.min(6, value)) - 1) / 5;
}

/**
 * Returns an array of log entries sorted oldest → newest.
 * Each item: { date: "YYYY-MM-DD", mood, note, timestamp }
 */
function getSortedEntries(logs) {
    return Object.entries(logs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, entry]) => ({ date, ...entry }));
}

/**
 * Returns entries that fall within the last N calendar days (including today).
 */
function getRecentEntries(sortedEntries, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return sortedEntries.filter(e => e.date >= cutoffStr);
}

// ---- Exported calculation functions ----

/**
 * Calculates average mood for given entries.
 * Returns normalised value 0.0–1.0, or null if no entries.
 */
function calculateMoodAverage(sortedEntries) {
    if (!sortedEntries.length) return null;
    const sum = sortedEntries.reduce((acc, e) => acc + normaliseMood(e.mood), 0);
    return sum / sortedEntries.length;
}

/**
 * Calculates mood trend over the last 7 logged days.
 * Returns: "improving" | "stable" | "declining" | "insufficient"
 */
function calculateTrend(sortedEntries) {
    const recent = getRecentEntries(sortedEntries, 7);
    if (recent.length < 3) return "insufficient";

    // Split into earlier half and later half
    const mid   = Math.floor(recent.length / 2);
    const early = recent.slice(0, mid);
    const late  = recent.slice(-mid);

    const earlyAvg = early.reduce((a, e) => a + normaliseMood(e.mood), 0) / early.length;
    const lateAvg  = late.reduce((a, e)  => a + normaliseMood(e.mood), 0) / late.length;

    const delta = lateAvg - earlyAvg;

    if (delta >  0.08) return "improving";
    if (delta < -0.08) return "declining";
    return "stable";
}

/**
 * Calculates trend score 0.0–1.0 for score weighting.
 */
function trendToScore(trend) {
    switch (trend) {
        case "improving":    return 1.0;
        case "stable":       return 0.6;
        case "declining":    return 0.2;
        case "insufficient": return 0.5; // neutral penalty
        default:             return 0.5;
    }
}

/**
 * Calculates interaction frequency score 0.0–1.0
 * based on how many of the last 14 days have a log entry.
 */
function calculateFrequency(sortedEntries) {
    const WINDOW = 14;
    const recent = getRecentEntries(sortedEntries, WINDOW);
    return Math.min(recent.length / WINDOW, 1.0);
}

/**
 * Calculates prediction confidence 0–100.
 * Based on logging frequency over the last 14 days,
 * penalised further if total history is thin (<7 entries).
 */
function calculateConfidence(sortedEntries) {
    const WINDOW = 14;
    const recent = getRecentEntries(sortedEntries, WINDOW);
    let base = recent.length / WINDOW;

    // Thin history penalty
    if (sortedEntries.length < 7) {
        base *= sortedEntries.length / 7;
    }

    return Math.round(Math.min(base, 1.0) * 100);
}

/**
 * Calculates mood difference score.
 * When partner data is available, uses |userAvg - partnerAvg|.
 * Falls back to full score (1.0) when no partner data exists.
 *
 * @param {number|null} userAvgNorm   Normalised user average (0–1)
 * @param {number|null} partnerAvgNorm Normalised partner average (0–1), or null
 * @returns {number} 0.0–1.0 (1.0 = perfectly in sync)
 */
function calculateMoodDifferenceScore(userAvgNorm, partnerAvgNorm) {
    if (userAvgNorm === null) return 0.5;
    if (partnerAvgNorm === null) return 1.0; // no partner data — no penalty
    const diff = Math.abs(userAvgNorm - partnerAvgNorm);
    return Math.max(0, 1 - diff * 2); // diff of 0.5 → score 0
}

/**
 * Master function: calculates the Relationship Health Score (0–100).
 *
 * Weights:
 *   40% Mood Average
 *   25% Mood Trend
 *   20% Mood Difference
 *   15% Interaction Frequency
 *
 * @param {Object} logs         Raw logs from getMoodHistory()
 * @param {number|null} partnerAvgNorm  Partner's normalised mood average (reserved for future)
 * @returns {{ score: number, trend: string, confidence: number, average: number|null }}
 */
function calculateHealthScore(logs, partnerAvgNorm = null) {
    const entries    = getSortedEntries(logs);
    const userAvg    = calculateMoodAverage(entries);
    const trend      = calculateTrend(entries);
    const frequency  = calculateFrequency(entries);
    const confidence = calculateConfidence(entries);
    const diffScore  = calculateMoodDifferenceScore(userAvg, partnerAvgNorm);

    // If no data at all
    if (userAvg === null) {
        return { score: 0, trend: "insufficient", confidence: 0, average: null };
    }

    const score = Math.round(
        (userAvg        * 0.40 * 100) +
        (trendToScore(trend) * 0.25 * 100) +
        (diffScore       * 0.20 * 100) +
        (frequency       * 0.15 * 100)
    );

    return {
        score:      Math.min(100, Math.max(0, score)),
        trend,
        confidence,
        average:    Math.round(userAvg * 5 + 1), // back to 1–6 scale for display
        frequency:  Math.round(frequency * 100),
    };
}
