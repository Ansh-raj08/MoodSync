// ============================================================
//  algorithm.js — Relationship Health Algorithm
//  MoodSync · All calculation logic lives here
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  MoodAlgorithm (class)  ← primary API (new data model)  │
//  │    Mood scale: 1–9  (1=Very Bad … 9=Great)              │
//  │    Input: MoodEntry[]  { date, userId, score }          │
//  ├─────────────────────────────────────────────────────────┤
//  │  Legacy standalone functions  (compat shim)             │
//  │    Used by dashboard.js  ·  Mood scale: 1–6             │
//  └─────────────────────────────────────────────────────────┘
//
//  Health Score weights (both systems):
//    40% Mood Average
//    25% Mood Trend (7 days)
//    20% Mood Difference (between partners)
//    15% Interaction Frequency (last 14 days)
// ============================================================

// ============================================================
//  MoodAlgorithm — Class-based analytics engine
//  Accepts the new storage.js data model (1–9 scale).
//
//  Usage:
//    const algo   = new MoodAlgorithm(userLogs, partnerLogs);
//    const result = algo.getHealthScore();
//    // → { healthScore: 78, trend: "improving", confidence: 0.82 }
// ============================================================

class MoodAlgorithm {

    /**
     * @param {Array<{date: string, userId: string, score: number}>} userLogs
     *   Mood entries for the primary user, sorted any order.
     * @param {Array<{date: string, userId: string, score: number}>} [partnerLogs]
     *   Mood entries for the partner.  Omit or pass [] if unavailable.
     */
    constructor(userLogs = [], partnerLogs = []) {
        // Sort both log sets oldest → newest on construction
        this._user    = [...userLogs].sort((a, b) => a.date.localeCompare(b.date));
        this._partner = [...partnerLogs].sort((a, b) => a.date.localeCompare(b.date));
    }

    // ----------------------------------------------------------
    //  Internal helpers
    // ----------------------------------------------------------

    /**
     * Normalise a 1–9 mood score to 0.0–1.0.
     * @param {number} score
     * @returns {number}
     */
    _normalise(score) {
        return (Math.max(1, Math.min(9, score)) - 1) / 8;
    }

    /**
     * Return entries from the given log that fall within the last N days
     * (inclusive of today).
     * @param {Array} logs
     * @param {number} days
     * @returns {Array}
     */
    _recent(logs, days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (days - 1));
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return logs.filter(e => e.date >= cutoffStr);
    }

    // ----------------------------------------------------------
    //  Public calculation methods
    // ----------------------------------------------------------

    /**
     * Calculate the user's average normalised mood (0.0–1.0).
     * Uses all available log entries.
     *
     * @returns {number|null} — null if no entries exist
     */
    calculateMoodAverage() {
        if (!this._user.length) return null;
        const sum = this._user.reduce((acc, e) => acc + this._normalise(e.score), 0);
        return sum / this._user.length;
    }

    /**
     * Calculate mood trend over the last 7 days.
     *
     * Strategy: compare the average of the last 3 days against the
     * average of the 4 days before that (days 4–7).  A delta > ±0.08
     * (on the 0–1 scale) signals a direction change.
     *
     * @returns {"improving"|"stable"|"declining"|"insufficient"}
     */
    calculateTrend() {
        const window7 = this._recent(this._user, 7);
        if (window7.length < 3) return "insufficient";

        // Last 3 days vs previous 4 days
        const recent3 = window7.slice(-3);
        const prior4  = window7.slice(0, -3);

        if (!prior4.length) return "insufficient";

        const avg = (arr) =>
            arr.reduce((a, e) => a + this._normalise(e.score), 0) / arr.length;

        const delta = avg(recent3) - avg(prior4);

        if (delta >  0.08) return "improving";
        if (delta < -0.08) return "declining";
        return "stable";
    }

    /**
     * Calculate how in-sync the two partners' moods are.
     *
     * Uses the absolute difference of normalised averages.
     * Returns 1.0 (full score) when no partner data is available.
     *
     * @returns {number} 0.0–1.0
     */
    calculateMoodDifference() {
        const userAvg = this.calculateMoodAverage();
        if (userAvg === null) return 0.5;
        if (!this._partner.length) return 1.0; // no partner data — no penalty

        const partnerSum = this._partner.reduce(
            (acc, e) => acc + this._normalise(e.score), 0
        );
        const partnerAvg = partnerSum / this._partner.length;

        const diff = Math.abs(userAvg - partnerAvg);
        return Math.max(0, 1 - diff * 2); // diff of 0.5 → score 0
    }

    /**
     * Calculate interaction frequency: proportion of the last 14 days
     * that have at least one mood log entry.
     *
     * @returns {number} 0.0–1.0
     */
    calculateInteractionFrequency() {
        const WINDOW = 14;
        const recent = this._recent(this._user, WINDOW);
        // Count unique dates
        const uniqueDates = new Set(recent.map(e => e.date));
        return Math.min(uniqueDates.size / WINDOW, 1.0);
    }

    /**
     * Compute the Relationship Health Score (0–100) and supporting
     * metrics.
     *
     * Weights:
     *   40% Mood Average
     *   25% Mood Trend
     *   20% Mood Difference (partner sync)
     *   15% Interaction Frequency
     *
     * @returns {{
     *   healthScore : number,          // 0–100
     *   trend       : string,          // "improving" | "stable" | "declining" | "insufficient"
     *   confidence  : number,          // 0.0–1.0
     * }}
     */
    getHealthScore() {
        const avg       = this.calculateMoodAverage();
        const trend     = this.calculateTrend();
        const moodDiff  = this.calculateMoodDifference();
        const frequency = this.calculateInteractionFrequency();

        // Trend → numeric weight
        const trendScore = {
            improving:    1.0,
            stable:       0.6,
            declining:    0.2,
            insufficient: 0.5,
        }[trend] ?? 0.5;

        // Confidence: based on how many of the last 14 days have logs
        const recentCount = this._recent(this._user, 14).length;
        let confidence = recentCount / 14;
        if (this._user.length < 7) {
            // Thin-history penalty
            confidence *= this._user.length / 7;
        }
        confidence = Math.round(Math.min(confidence, 1.0) * 100) / 100;

        if (avg === null) {
            return { healthScore: 0, trend: "insufficient", confidence: 0 };
        }

        const rawScore =
            avg       * 0.40 * 100 +
            trendScore * 0.25 * 100 +
            moodDiff   * 0.20 * 100 +
            frequency  * 0.15 * 100;

        const healthScore = Math.min(100, Math.max(0, Math.round(rawScore)));

        return { healthScore, trend, confidence };
    }
}

// ============================================================
//  Legacy compatibility layer
//  Used by dashboard.js (1–6 mood scale, object-based log shape).
//  Do not remove until dashboard.js is migrated to MoodAlgorithm.
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
