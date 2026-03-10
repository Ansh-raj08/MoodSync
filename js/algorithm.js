// =============================================================
//  algorithm.js — Relationship Health Algorithm
//  MoodSync · Pure calculation — no DOM, no I/O
//
//  Mood scale: 1–9  (1 = Very Bad … 9 = Great)
//
//  Health Score breakdown:
//    40% Mood Average      (normalised 0-1)
//    25% Mood Trend        (last 7 days: improving / stable / declining)
//    20% Mood Difference   (alignment between partners)
//    15% Interaction Freq  (consistency of daily logging)
//
//  Public API:
//    calculateHealthScore(userLogs, partnerLogs)
//      → { healthScore, trend, confidence, average, partnerAverage, moodDiff }
// =============================================================

"use strict";

// =============================================================
//  Main Entry Point
// =============================================================

/**
 * Calculate the Relationship Health Score.
 *
 * @param {Array<{date: string, score: number}>} userLogs
 * @param {Array<{date: string, score: number}>} [partnerLogs]
 * @returns {{
 *   healthScore:     number,       // 0-100
 *   trend:           string,       // "improving"|"stable"|"declining"|"insufficient"
 *   confidence:      number,       // 0.0-1.0
 *   average:         number|null,  // 1-9 scale
 *   partnerAverage:  number|null,  // 1-9 scale
 *   moodDiff:        number|null,  // 0-100 alignment %
 * }}
 */
function calculateHealthScore(userLogs, partnerLogs = []) {
    const uSorted = [...userLogs].sort((a, b) => a.date.localeCompare(b.date));
    const pSorted = [...partnerLogs].sort((a, b) => a.date.localeCompare(b.date));

    const userAvgN    = _avgNorm(uSorted);
    const partnerAvgN = _avgNorm(pSorted);
    const trend       = _trend(uSorted);
    const trendScore  = _trendScore(trend);
    const diffScore   = _diffScore(userAvgN, partnerAvgN);
    const frequency   = _frequency(uSorted, 14);
    const confidence  = _confidence(uSorted, pSorted);

    // No data → bail early
    if (userAvgN === null) {
        return {
            healthScore: 0, trend: "insufficient", confidence: 0,
            average: null, partnerAverage: null, moodDiff: null,
        };
    }

    // Weighted sum
    const raw = (
        userAvgN   * 0.40 +
        trendScore * 0.25 +
        diffScore  * 0.20 +
        frequency  * 0.15
    ) * 100;

    return {
        healthScore:    Math.min(100, Math.max(0, Math.round(raw))),
        trend,
        confidence,
        average:        _toScale(userAvgN),
        partnerAverage: _toScale(partnerAvgN),
        moodDiff:       diffScore !== null ? Math.round(diffScore * 100) : null,
    };
}

// =============================================================
//  Internal Helpers
// =============================================================

/** Normalise 1-9 → 0.0-1.0 */
function _norm(score) {
    return (Math.max(1, Math.min(9, score)) - 1) / 8;
}

/** Convert normalised 0-1 back to 1-9 integer, or null */
function _toScale(normVal) {
    if (normVal === null) return null;
    return Math.max(1, Math.min(9, Math.round(normVal * 8 + 1)));
}

/** Average normalised score (0-1) or null */
function _avgNorm(logs) {
    if (!logs.length) return null;
    return logs.reduce((s, e) => s + _norm(e.score), 0) / logs.length;
}

/**
 * Mood trend over the last 7 days.
 * Compares the average of the last 3 entries vs the prior entries.
 */
function _trend(logs) {
    const w = _recent(logs, 7);
    if (w.length < 3) return "insufficient";

    const last3 = w.slice(-3);
    const prior = w.slice(0, -3);
    if (!prior.length) return "insufficient";

    const aRecent = last3.reduce((s, e) => s + _norm(e.score), 0) / last3.length;
    const aPrior  = prior.reduce((s, e) => s + _norm(e.score), 0) / prior.length;
    const delta   = aRecent - aPrior;

    if (delta >  0.08) return "improving";
    if (delta < -0.08) return "declining";
    return "stable";
}

/** Trend → numeric score */
function _trendScore(t) {
    return { improving: 1.0, stable: 0.6, declining: 0.2, insufficient: 0.5 }[t] ?? 0.5;
}

/**
 * Mood difference / alignment between partners.
 * 1.0 = perfectly aligned, 0.0 = maximally different.
 */
function _diffScore(uAvg, pAvg) {
    if (uAvg === null) return 0.5;
    if (pAvg === null) return 1.0;  // no partner data → no penalty
    return Math.max(0, 1 - Math.abs(uAvg - pAvg) * 2);
}

/** Logging consistency over `win` days (0-1) */
function _frequency(logs, win) {
    return Math.min(_recent(logs, win).length / win, 1.0);
}

/** Prediction confidence (0-1) */
function _confidence(uLogs, pLogs) {
    const uRec = _recent(uLogs, 14);
    let base = uRec.length / 14;

    if (uLogs.length < 7) base *= uLogs.length / 7;

    if (pLogs.length > 0) {
        const pRec = _recent(pLogs, 14);
        base = (base + pRec.length / 14) / 2;
    }

    return Math.min(base, 1.0);
}

/** Filter entries to last N calendar days */
function _recent(logs, days) {
    const c = new Date();
    c.setDate(c.getDate() - (days - 1));
    const cutoff = c.toISOString().slice(0, 10);
    return logs.filter(e => e.date >= cutoff);
}

// =============================================================
//  V2 Health Score (simpler, 0-100 mood scale)
// =============================================================

/**
 * Map a 1-9 mood score to 0-100 scale:
 *   Very Bad (1) → 20 · Bad (3) → 40 · Neutral (5) → 60
 *   Good (7) → 80 · Great (9) → 100
 */
function _toScale100(score) {
    return (Math.max(1, Math.min(9, score)) - 1) / 8 * 80 + 20;
}

/**
 * Average of logs on the 0-100 scale, using the last 14 days.
 * Falls back to all logs if fewer than 14 days are available.
 * Returns null when there are no logs at all.
 */
function _avg100(logs) {
    if (!logs.length) return null;
    const recent = _recent(logs, 14);
    const src = recent.length ? recent : logs;
    return src.reduce((s, e) => s + _toScale100(e.score), 0) / src.length;
}

/**
 * Calculate Relationship Health Score — V2.
 *
 * Formula:
 *   user1Avg      = mean of user1 logs mapped to 0-100 (14-day window)
 *   user2Avg      = mean of user2 logs mapped to 0-100 (14-day window)
 *   compatibility = 100 - |user1Avg - user2Avg|
 *   healthScore   = clamp( (user1Avg + user2Avg + compatibility) / 3, 0, 100 )
 *
 * @param {Array<{date: string, score: number}>} userLogs
 * @param {Array<{date: string, score: number}>} [partnerLogs]
 * @returns {{ healthScore: number, user1Avg: number|null, user2Avg: number|null, compatibility: number|null }}
 */
function calculateHealthScoreV2(userLogs, partnerLogs = []) {
    const u1 = _avg100(userLogs);
    const u2 = _avg100(partnerLogs);

    if (u1 === null) {
        return { healthScore: 0, user1Avg: null, user2Avg: null, compatibility: null };
    }

    const comp = u2 !== null
        ? Math.max(0, 100 - Math.abs(u1 - u2))
        : 100; // no partner data → no penalty

    const raw = (u1 + (u2 ?? u1) + comp) / 3;

    return {
        healthScore:   Math.round(Math.min(100, Math.max(0, raw))),
        user1Avg:      Math.round(u1),
        user2Avg:      u2 !== null ? Math.round(u2) : null,
        compatibility: Math.round(comp),
    };
}
