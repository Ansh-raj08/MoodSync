// =============================================================
//  data.js — Centralized Data Utilities
//  MoodSync · Single source of truth for all data operations
//
//  Dependencies: supabaseClient.js, auth.js (must load first)
//
//  PHASE 1 STABILIZATION:
//  - No localStorage usage (all data from Supabase)
//  - Single partner resolution function
//  - Consistent error handling
//  - Realtime subscription management
//
//  Public API:
//    getCurrentUser()           → user | null (with session validation)
//    getPartnerData()           → { partnerId, partnerName } | null
//    getCoupleData()            → { couple, partnerId, myName, partnerName } | null
//    getMoodLogs(userIds, opts) → array of mood entries
//    subscribeWithCleanup(...)  → subscription with auto-cleanup
//    unsubscribeAll()           → clean up all active subscriptions
// =============================================================

"use strict";

// =============================================================
//  Subscription Management (TASK 5)
// =============================================================

/** @type {Map<string, Object>} Active realtime subscriptions */
const _activeSubscriptions = new Map();

/** @type {Set<string>} Processed event IDs to prevent duplicates */
const _processedEventIds = new Set();

/**
 * Subscribe to a Supabase realtime channel with automatic cleanup tracking.
 * @param {string} channelName - Unique name for this subscription
 * @param {Object} config - Supabase channel configuration
 * @param {Function} callback - Event handler
 * @returns {Object} channel
 */
function subscribeWithCleanup(channelName, config, callback) {
    // Unsubscribe from existing channel with same name
    if (_activeSubscriptions.has(channelName)) {
        const existing = _activeSubscriptions.get(channelName);
        supabaseClient.removeChannel(existing);
        _activeSubscriptions.delete(channelName);
    }

    const channel = supabaseClient
        .channel(channelName)
        .on("postgres_changes", config, (payload) => {
            // Dedup guard: prevent duplicate event processing
            const eventKey = `${payload.eventType}-${payload.new?.id || payload.old?.id}-${payload.commit_timestamp}`;
            if (_processedEventIds.has(eventKey)) return;
            _processedEventIds.add(eventKey);

            // Clean up old event IDs (keep last 1000)
            if (_processedEventIds.size > 1000) {
                const toRemove = [..._processedEventIds].slice(0, 500);
                toRemove.forEach(id => _processedEventIds.delete(id));
            }

            callback(payload);
        })
        .subscribe();

    _activeSubscriptions.set(channelName, channel);
    return channel;
}

/**
 * Unsubscribe from all active realtime channels.
 * Call this on page unload or navigation.
 */
function unsubscribeAll() {
    _activeSubscriptions.forEach((channel, name) => {
        supabaseClient.removeChannel(channel);
    });
    _activeSubscriptions.clear();
    _processedEventIds.clear();
}

/**
 * Unsubscribe from a specific channel by name.
 * @param {string} channelName
 */
function unsubscribeChannel(channelName) {
    if (_activeSubscriptions.has(channelName)) {
        const channel = _activeSubscriptions.get(channelName);
        supabaseClient.removeChannel(channel);
        _activeSubscriptions.delete(channelName);
    }
}

// Auto-cleanup on page unload
if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", unsubscribeAll);
    window.addEventListener("pagehide", unsubscribeAll);
}

// =============================================================
//  Session Validation (TASK 8)
// =============================================================

/**
 * Get the current authenticated user with session validation.
 * Returns null if no valid session exists.
 * @returns {Promise<Object|null>}
 */
async function getCurrentUser() {
    try {
        const { data: { user }, error } = await supabaseClient.auth.getUser();
        if (error) {
            console.error("[data.getCurrentUser] Auth error:", error.message);
            return null;
        }
        return user;
    } catch (err) {
        console.error("[data.getCurrentUser] Exception:", err.message);
        return null;
    }
}

/**
 * Require a valid user session. Redirects to login if not authenticated.
 * @returns {Promise<Object|null>} user or null (after redirect)
 */
async function requireValidSession() {
    const user = await getCurrentUser();
    if (!user) {
        window.location.replace("login.html");
        return null;
    }
    return user;
}

// =============================================================
//  Partner Resolution (TASK 2 - SINGLE SOURCE OF TRUTH)
// =============================================================

/**
 * Get partner data for the current user.
 * This is THE SINGLE function for partner resolution - use everywhere.
 *
 * Resolution order (NO localStorage):
 *   1. profiles table (direct lookup)
 *   2. pairing_requests table (RLS fallback)
 *
 * @returns {Promise<{partnerId: string, partnerName: string}|null>}
 */
async function getPartnerData() {
    try {
        const user = await getCurrentUser();
        if (!user) return null;

        // Get couple
        const couple = await getCouple();
        if (!couple) return null;

        const partnerId = couple.user1_id === user.id ? couple.user2_id : couple.user1_id;

        // Layer 1: Direct profile lookup
        let partnerName = null;
        const { data: partnerProfile, error: profileErr } = await supabaseClient
            .from("profiles")
            .select("name")
            .eq("id", partnerId)
            .maybeSingle();

        if (!profileErr && partnerProfile?.name) {
            partnerName = partnerProfile.name;
        }

        // Layer 2: Pairing requests fallback (works with strict RLS)
        if (!partnerName) {
            partnerName = await _fetchPartnerNameViaRequest(user.id, partnerId);
        }

        // Final fallback
        partnerName = partnerName || "Partner";

        return { partnerId, partnerName };
    } catch (err) {
        console.error("[data.getPartnerData] Error:", err.message);
        return null;
    }
}

/**
 * Get complete couple context for the current user.
 * Includes user profile, partner profile, and couple record.
 *
 * @returns {Promise<{user: Object, couple: Object, partnerId: string, myName: string, partnerName: string}|null>}
 */
async function getCoupleData() {
    try {
        const user = await getCurrentUser();
        if (!user) return null;

        const couple = await getCouple();
        if (!couple) return null;

        const partnerId = couple.user1_id === user.id ? couple.user2_id : couple.user1_id;

        // Fetch both profiles in parallel
        const [myProfile, partnerData] = await Promise.all([
            getProfile(user.id),
            getPartnerData(),
        ]);

        const myName = myProfile?.name || user.user_metadata?.name || "You";
        const partnerName = partnerData?.partnerName || "Partner";

        return {
            user,
            couple,
            partnerId,
            myName,
            partnerName,
        };
    } catch (err) {
        console.error("[data.getCoupleData] Error:", err.message);
        return null;
    }
}

/**
 * Internal: Fetch partner name via pairing_requests table.
 * This works even when profiles RLS blocks direct partner lookup.
 *
 * @param {string} userId
 * @param {string} partnerId
 * @returns {Promise<string|null>}
 */
async function _fetchPartnerNameViaRequest(userId, partnerId) {
    try {
        const { data, error } = await supabaseClient
            .from("pairing_requests")
            .select(
                "sender_id, receiver_id, " +
                "sp:profiles!pairing_requests_sender_id_fkey(name), " +
                "rp:profiles!pairing_requests_receiver_id_fkey(name)"
            )
            .eq("status", "accepted")
            .or(
                `and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),` +
                `and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`
            )
            .limit(1)
            .maybeSingle();

        if (error || !data) return null;

        return (data.sender_id === partnerId ? data.sp?.name : data.rp?.name) || null;
    } catch (err) {
        console.error("[data._fetchPartnerNameViaRequest] Error:", err.message);
        return null;
    }
}

// =============================================================
//  Mood Logs (TASK 6 - Centralized Data Fetching)
// =============================================================

/**
 * Fetch mood logs for one or more users.
 * Always fetches from Supabase - no caching.
 *
 * @param {string|string[]} userIds - Single user ID or array of user IDs
 * @param {Object} [options]
 * @param {number} [options.days] - Number of days to fetch (default: all)
 * @param {number} [options.limit] - Max number of entries
 * @param {boolean} [options.ascending=true] - Sort order
 * @returns {Promise<Array<{id: string, date: string, userId: string, score: number, note: string|null, loggedAt: string}>>}
 */
async function getMoodLogs(userIds, options = {}) {
    const { days, limit, ascending = true } = options;

    // Normalize to array
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    if (ids.length === 0) return [];

    try {
        let query = supabaseClient
            .from("mood_logs")
            .select("id, user_id, score, note, logged_at")
            .order("logged_at", { ascending });

        // Filter by users
        if (ids.length === 1) {
            query = query.eq("user_id", ids[0]);
        } else {
            query = query.in("user_id", ids);
        }

        // Date filter
        if (days && days > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (days - 1));
            cutoff.setHours(0, 0, 0, 0);
            query = query.gte("logged_at", cutoff.toISOString());
        }

        // Limit
        if (limit && limit > 0) {
            query = query.limit(limit);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error("Failed to fetch mood logs: " + error.message);
        }

        return (data || []).map(row => ({
            id:       row.id,
            date:     row.logged_at.slice(0, 10),
            userId:   row.user_id,
            score:    row.score,
            note:     row.note,
            loggedAt: row.logged_at,
        }));
    } catch (err) {
        console.error("[data.getMoodLogs] Error:", err.message);
        throw err;
    }
}

/**
 * Fetch mood logs for both users in a couple.
 * Ensures consistent data for health score calculation.
 *
 * @param {Object} couple - Couple record with user1_id and user2_id
 * @param {number} [days=14] - Number of days to fetch
 * @returns {Promise<Array>}
 */
async function getCoupleMoodLogs(couple, days = 14) {
    if (!couple?.user1_id || !couple?.user2_id) {
        throw new Error("Invalid couple record");
    }

    return getMoodLogs([couple.user1_id, couple.user2_id], { days, ascending: true });
}

// =============================================================
//  Error Handling Utilities (TASK 7)
// =============================================================

/**
 * Standardized error handler for Supabase operations.
 * @param {Error} error - The error object
 * @param {string} context - Where the error occurred
 * @param {boolean} [showToast=true] - Whether to show a toast notification
 * @returns {string} User-friendly error message
 */
function handleError(error, context, showToast = true) {
    const message = _friendlyErrorMessage(error);
    console.error(`[${context}]`, error.message || error);

    if (showToast && typeof window.showToast === "function") {
        window.showToast(message, "error");
    }

    return message;
}

/**
 * Convert error to user-friendly message.
 * @param {Error|Object} error
 * @returns {string}
 */
function _friendlyErrorMessage(error) {
    const msg = error?.message || String(error);

    // Auth errors
    if (msg.includes("Invalid login") || msg.includes("invalid_grant")) {
        return "Incorrect email or password.";
    }
    if (msg.includes("Email not confirmed")) {
        return "Please verify your email first.";
    }
    if (msg.includes("JWT") || msg.includes("session")) {
        return "Session expired. Please log in again.";
    }

    // RLS errors
    if (msg.includes("policy") || msg.includes("42501") || msg.includes("permission denied")) {
        return "Permission denied. Please try again.";
    }

    // Network errors
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("Failed to fetch")) {
        return "Network error. Check your connection.";
    }

    // Rate limiting
    if (msg.includes("rate limit") || msg.includes("too many")) {
        return "Too many requests. Please wait a moment.";
    }

    // Generic
    return msg || "Something went wrong. Please try again.";
}

/**
 * Wrap an async function with standardized error handling.
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context name for error logging
 * @returns {Function}
 */
function withErrorHandling(fn, context) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (err) {
            handleError(err, context);
            throw err;
        }
    };
}

// =============================================================
//  Health Score Helpers (TASK 4)
// =============================================================

/**
 * Calculate health score with consistent data.
 * Always fetches fresh data from Supabase to ensure cross-device consistency.
 *
 * @param {Object} couple - Couple record
 * @param {string} userId - Current user's ID
 * @returns {Promise<{v1: Object, v2: Object, userLogs: Array, partnerLogs: Array}>}
 */
async function calculateHealthScoreData(couple, userId) {
    const partnerId = couple.user1_id === userId ? couple.user2_id : couple.user1_id;

    // Fetch 14 days of logs for both users (fresh from DB)
    const coupleLogs = await getCoupleMoodLogs(couple, 14);

    // Split by user
    const userLogs = coupleLogs.filter(l => l.userId === userId);
    const partnerLogs = coupleLogs.filter(l => l.userId === partnerId);

    // Calculate both V1 and V2 scores using the same dataset
    const v1 = typeof calculateHealthScore === "function"
        ? calculateHealthScore(userLogs, partnerLogs)
        : null;

    const v2 = typeof calculateHealthScoreV2 === "function"
        ? calculateHealthScoreV2(userLogs, partnerLogs)
        : null;

    return { v1, v2, userLogs, partnerLogs };
}

// =============================================================
//  Graph Data Normalization (TASK 4 - FIX GRAPH)
// =============================================================

/**
 * Normalize mood logs for graph display.
 * Groups by date, averages multiple entries per day.
 *
 * @param {Array} logs - Raw mood logs array
 * @param {string} userId - Filter to specific user (optional)
 * @returns {Array<{date: string, score: number}>} Normalized data
 */
function normalizeGraphData(logs, userId = null) {
    if (!logs || logs.length === 0) return [];

    const filtered = userId ? logs.filter(l => l.userId === userId) : logs;
    if (filtered.length === 0) return [];

    const byDate = {};
    for (const log of filtered) {
        const date = log.date || log.logged_at?.slice(0, 10);
        if (!date) continue;
        if (!byDate[date]) byDate[date] = { total: 0, count: 0 };
        byDate[date].total += log.score;
        byDate[date].count += 1;
    }

    return Object.entries(byDate)
        .map(([date, { total, count }]) => ({
            date,
            score: Math.round((total / count) * 10) / 10,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// =============================================================
//  Timeline-Driven Graph System (COMPLETE REVAMP)
// =============================================================

/**
 * Generate a fixed timeline for the last N days.
 * Each day has: date, score (or null), hasData flag.
 *
 * @param {Array} logs - Normalized mood logs [{date, score}, ...]
 * @param {number} [days=14] - Number of days in timeline
 * @returns {Array<{date: string, displayDate: string, score: number|null, hasData: boolean}>}
 */
function generateTimeline(logs, days = 14) {
    const timeline = [];
    const today = new Date();

    // Create lookup map from logs
    const logMap = {};
    for (const log of (logs || [])) {
        logMap[log.date] = log.score;
    }

    // Generate each day in the timeline
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const isoDate = d.toISOString().slice(0, 10);
        const displayDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

        const score = logMap[isoDate] ?? null;

        timeline.push({
            date: isoDate,
            displayDate: displayDate,
            score: score,
            hasData: score !== null
        });
    }

    return timeline;
}

/**
 * Split timeline into segments of consecutive real data.
 * Each segment can be rendered as an independent line.
 *
 * @param {Array} timeline - From generateTimeline()
 * @returns {Array<Array<{index: number, date: string, score: number}>>}
 */
function splitIntoSegments(timeline) {
    const segments = [];
    let currentSegment = [];

    for (let i = 0; i < timeline.length; i++) {
        const point = timeline[i];

        if (point.hasData) {
            currentSegment.push({
                index: i,
                date: point.date,
                displayDate: point.displayDate,
                score: point.score
            });
        } else {
            // Gap found - save current segment if it has points
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
                currentSegment = [];
            }
        }
    }

    // Don't forget the last segment
    if (currentSegment.length > 0) {
        segments.push(currentSegment);
    }

    return segments;
}

/**
 * Create Chart.js datasets for timeline-driven rendering.
 * Returns separate datasets for each consecutive data segment.
 * PREMIUM: Includes glow layer for soft lighting effect.
 *
 * @param {Array} timeline - From generateTimeline()
 * @param {Object} options - Styling options
 * @returns {{segmentDatasets: Array, glowDatasets: Array, missingPointsDataset: Object, gapConnectors: Array}}
 */
function createTimelineDatasets(timeline, options = {}) {
    const {
        color = "#c98cf5",
        gradient = null,
        label = "Mood",
        showGapConnectors = true,
        enableGlow = true
    } = options;

    const segments = splitIntoSegments(timeline);
    const labels = timeline.map(t => t.displayDate);

    // Create glow layer datasets (rendered behind main lines)
    const glowDatasets = [];
    if (enableGlow) {
        // Convert hex to rgba for glow (subtle opacity)
        const glowColor = color.startsWith("#")
            ? `rgba(${parseInt(color.slice(1,3), 16)}, ${parseInt(color.slice(3,5), 16)}, ${parseInt(color.slice(5,7), 16)}, 0.2)`
            : color.replace(/[\d.]+\)$/, "0.2)");

        segments.forEach((segment, segIdx) => {
            const data = new Array(timeline.length).fill(null);
            segment.forEach(point => {
                data[point.index] = point.score;
            });

            glowDatasets.push({
                label: `_glow_${label}_${segIdx}`,
                data: data,
                borderColor: glowColor,
                backgroundColor: "transparent",
                tension: 0.4,
                pointRadius: 0,
                borderWidth: 8,  // Reduced for subtler glow
                spanGaps: false,
                fill: false,
                order: 5,  // Behind main lines
            });
        });
    }

    // Create a dataset for each consecutive data segment (main lines)
    const segmentDatasets = segments.map((segment, segIdx) => {
        // Create data array with nulls except for this segment's points
        const data = new Array(timeline.length).fill(null);
        segment.forEach(point => {
            data[point.index] = point.score;
        });

        return {
            label: label,  // All segments share the same label for tooltip
            data: data,
            borderColor: color,
            backgroundColor: gradient || "transparent",
            tension: 0.4,  // Increased for smoother curves
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: color,
            pointBorderColor: "rgba(255,255,255,0.85)",
            pointBorderWidth: 2,
            borderWidth: 2.5,
            spanGaps: false,
            fill: gradient ? true : false,
            order: 1,
            // Hide duplicate labels in legend (only first segment shows)
            hidden: false,
            // Animation config for draw-in effect
            animation: {
                duration: 1200,
                easing: "easeOutQuart",
            },
        };
    });

    // Create dataset for missing day indicators (very subtle)
    const missingData = timeline.map(t => t.hasData ? null : 5); // Center of scale for visual
    const missingPointsDataset = {
        label: `_missing_${label}`,
        data: missingData,
        borderColor: "transparent",
        backgroundColor: "transparent",
        pointRadius: 3,
        pointHoverRadius: 4,
        pointBackgroundColor: "rgba(255,255,255,0.08)",
        pointBorderColor: "rgba(255,255,255,0.12)",
        pointBorderWidth: 1,
        pointStyle: "circle",
        showLine: false,  // No line, just points
        order: 15,
    };

    // Create subtle gap connectors (straight faded lines)
    const gapConnectors = [];
    if (showGapConnectors && segments.length > 1) {
        for (let i = 0; i < segments.length - 1; i++) {
            const endOfCurrent = segments[i][segments[i].length - 1];
            const startOfNext = segments[i + 1][0];

            // Only connect if gap is reasonable (not too large)
            const gapSize = startOfNext.index - endOfCurrent.index;
            if (gapSize <= 5) {  // Max 5 days gap for connector
                const connectorData = new Array(timeline.length).fill(null);
                connectorData[endOfCurrent.index] = endOfCurrent.score;
                connectorData[startOfNext.index] = startOfNext.score;

                gapConnectors.push({
                    label: `_gap_${label}_${i}`,
                    data: connectorData,
                    borderColor: "rgba(255,255,255,0.06)",  // Very subtle
                    backgroundColor: "transparent",
                    tension: 0,  // Straight line
                    pointRadius: 0,
                    borderWidth: 1,
                    borderDash: [2, 4],
                    spanGaps: true,
                    fill: false,
                    order: 20,
                });
            }
        }
    }

    return { segmentDatasets, glowDatasets, missingPointsDataset, gapConnectors, labels };
}

/**
 * Prepare complete graph data for both users.
 * Main entry point for the revamped graph system.
 * PREMIUM: Includes glow layers and optimized rendering order.
 *
 * @param {Array} allLogs - Combined mood logs
 * @param {string} userId - Current user ID
 * @param {string} partnerId - Partner ID
 * @param {string} myName - User display name
 * @param {string} partnerName - Partner display name
 * @param {Object} gradients - {myGradient, partnerGradient}
 * @returns {{datasets: Array, labels: Array}}
 */
function prepareTimelineGraph(allLogs, userId, partnerId, myName, partnerName, gradients = {}) {
    // Normalize logs for each user
    const myLogs = normalizeGraphData(allLogs, userId);
    const partnerLogs = normalizeGraphData(allLogs, partnerId);

    // Generate timelines
    const myTimeline = generateTimeline(myLogs, 14);
    const partnerTimeline = generateTimeline(partnerLogs, 14);

    // Create datasets with glow enabled
    const myData = createTimelineDatasets(myTimeline, {
        color: "#c98cf5",
        gradient: gradients.myGradient,
        label: myName,
        showGapConnectors: true,
        enableGlow: true
    });

    const partnerData = createTimelineDatasets(partnerTimeline, {
        color: "#f7a0be",
        gradient: gradients.partnerGradient,
        label: partnerName,
        showGapConnectors: true,
        enableGlow: true
    });

    // Combine all datasets in correct render order (back to front)
    const datasets = [];

    // 1. Gap connectors (very back)
    datasets.push(...myData.gapConnectors);
    datasets.push(...partnerData.gapConnectors);

    // 2. Missing point indicators
    datasets.push(myData.missingPointsDataset);
    datasets.push(partnerData.missingPointsDataset);

    // 3. Glow layers (behind main lines for soft lighting)
    datasets.push(...myData.glowDatasets);
    datasets.push(...partnerData.glowDatasets);

    // 4. Real data segments on top
    datasets.push(...myData.segmentDatasets);
    datasets.push(...partnerData.segmentDatasets);

    return {
        datasets,
        labels: myData.labels  // Same for both users
    };
}

// =============================================================
//  Relationship Dissolution API
// =============================================================

/**
 * Initiate relationship dissolution with 15-day grace period.
 * Either partner can initiate.
 *
 * @returns {Promise<{coupleId: string, scheduledFor: string, daysRemaining: number}>}
 */
async function initiateDissolve() {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated.");

    const couple = await getCouple();
    if (!couple) throw new Error("No active relationship to dissolve.");

    // Check if already pending
    if (couple.dissolution_scheduled_for && !couple.dissolution_cancelled_at) {
        const scheduled = new Date(couple.dissolution_scheduled_for);
        const now = new Date();
        const daysRemaining = Math.ceil((scheduled - now) / (1000 * 60 * 60 * 24));
        throw new Error(`Dissolution already pending. ${daysRemaining} days remaining.`);
    }

    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + 15); // 15-day grace period

    const { data, error } = await supabaseClient
        .from("couples")
        .update({
            dissolution_initiated_at: new Date().toISOString(),
            dissolution_initiated_by: user.id,
            dissolution_scheduled_for: scheduledFor.toISOString(),
            dissolution_cancelled_at: null, // Clear any previous cancellation
        })
        .eq("id", couple.id)
        .select()
        .single();

    if (error) throw new Error("Failed to initiate dissolution: " + error.message);

    return {
        coupleId: data.id,
        scheduledFor: data.dissolution_scheduled_for,
        daysRemaining: 15,
    };
}

/**
 * Cancel pending dissolution.
 * Either partner can cancel.
 *
 * @returns {Promise<Object>} Updated couple record
 */
async function cancelDissolve() {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated.");

    const couple = await getCouple();
    if (!couple) throw new Error("No active relationship.");

    if (!couple.dissolution_scheduled_for) {
        throw new Error("No pending dissolution to cancel.");
    }

    if (couple.dissolution_cancelled_at) {
        throw new Error("Dissolution already cancelled.");
    }

    const { data, error } = await supabaseClient
        .from("couples")
        .update({
            dissolution_cancelled_at: new Date().toISOString(),
        })
        .eq("id", couple.id)
        .select()
        .single();

    if (error) throw new Error("Failed to cancel dissolution: " + error.message);

    return data;
}

/**
 * Get dissolution status for current relationship.
 *
 * @returns {Promise<{isPending: boolean, scheduledFor: string|null, initiatedBy: string|null, daysRemaining: number|null}|null>}
 */
async function getDissolveStatus() {
    const couple = await getCouple();
    if (!couple) return null;

    const isPending = !!(
        couple.dissolution_scheduled_for &&
        !couple.dissolution_cancelled_at &&
        new Date(couple.dissolution_scheduled_for) > new Date()
    );

    let daysRemaining = null;
    if (isPending) {
        const now = new Date();
        const scheduled = new Date(couple.dissolution_scheduled_for);
        daysRemaining = Math.ceil((scheduled - now) / (1000 * 60 * 60 * 24));
    }

    return {
        isPending,
        scheduledFor: couple.dissolution_scheduled_for,
        initiatedBy: couple.dissolution_initiated_by,
        daysRemaining,
        cancelledAt: couple.dissolution_cancelled_at,
    };
}

// =============================================================
//  Utility: HTML Escaping
// =============================================================

/**
 * HTML-escape a string to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
