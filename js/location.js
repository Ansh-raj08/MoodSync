// =============================================================
//  location.js — Live Location Sharing System
//  MoodSync · Real-time location tracking for paired users
//
//  Dependencies: supabaseClient.js, auth.js, data.js (must load first)
//
//  Features:
//    - Browser Geolocation API integration
//    - Privacy controls (enable/disable sharing)
//    - Real-time location updates via Supabase
//    - Automatic location refresh
//    - Distance calculation between partners
//
//  Public API:
//    getCurrentLocation()           → {latitude, longitude, accuracy} | null
//    updateMyLocation(lat, lon)     → location row
//    getMyLocation()                → location row | null
//    getPartnerLocation()           → location row | null
//    toggleLocationSharing(enabled) → location row
//    isLocationSharingEnabled()     → boolean
//    calculateDistance(loc1, loc2)  → distance in km
//    startLocationTracking(interval)→ tracking ID
//    stopLocationTracking(trackingId) → void
// =============================================================

"use strict";

// =============================================================
//  Geolocation Permission & Browser API
// =============================================================

/**
 * Check if geolocation is supported by the browser.
 * @returns {boolean}
 */
function isGeolocationSupported() {
    return "geolocation" in navigator;
}

/**
 * Get current device location using browser Geolocation API.
 * Prompts for permission if needed.
 *
 * @param {Object} [options] - Geolocation options
 * @param {boolean} [options.highAccuracy=true] - Request high accuracy
 * @param {number} [options.timeout=10000] - Timeout in milliseconds
 * @param {number} [options.maximumAge=0] - Maximum age of cached position
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
 * @throws {Error} if geolocation is not supported or permission denied
 */
async function getCurrentLocation(options = {}) {
    if (!isGeolocationSupported()) {
        throw new Error("Geolocation is not supported by your browser.");
    }

    const defaultOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        ...options
    };

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                let message = "Unable to retrieve location.";
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = "Location permission denied. Please enable location access in your browser settings.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = "Location information is unavailable.";
                        break;
                    case error.TIMEOUT:
                        message = "Location request timed out.";
                        break;
                }
                reject(new Error(message));
            },
            defaultOptions
        );
    });
}

/**
 * Watch device location for continuous tracking.
 * Returns a watch ID that can be used to stop tracking.
 *
 * @param {Function} callback - Called with {latitude, longitude, accuracy} on each update
 * @param {Function} errorCallback - Called on errors
 * @param {Object} [options] - Geolocation options
 * @returns {number} watch ID
 */
function watchLocation(callback, errorCallback, options = {}) {
    if (!isGeolocationSupported()) {
        throw new Error("Geolocation is not supported by your browser.");
    }

    const defaultOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000, // Accept cached location up to 30s old
        ...options
    };

    return navigator.geolocation.watchPosition(
        (position) => {
            callback({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
            });
        },
        (error) => {
            if (errorCallback) {
                errorCallback(error);
            }
        },
        defaultOptions
    );
}

/**
 * Stop watching device location.
 * @param {number} watchId - Watch ID returned by watchLocation()
 */
function clearLocationWatch(watchId) {
    if (navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
    }
}

// =============================================================
//  Location Database API
// =============================================================

/**
 * Update current user's location in the database.
 * Creates location row if it doesn't exist, updates if it does.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [accuracy] - Accuracy in meters
 * @param {boolean} [sharingEnabled=true] - Privacy control
 * @returns {Promise<Object>} location row
 */
async function updateMyLocation(latitude, longitude, accuracy = null, sharingEnabled = true) {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    // Validate coordinates
    if (typeof latitude !== "number" || typeof longitude !== "number") {
        throw new Error("Invalid coordinates.");
    }
    if (latitude < -90 || latitude > 90) {
        throw new Error("Latitude must be between -90 and 90.");
    }
    if (longitude < -180 || longitude > 180) {
        throw new Error("Longitude must be between -180 and 180.");
    }

    // Check if location row exists
    const { data: existing } = await supabaseClient
        .from("locations")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (existing) {
        // Update existing location
        const { data, error } = await supabaseClient
            .from("locations")
            .update({
                latitude,
                longitude,
                accuracy,
                sharing_enabled: sharingEnabled,
                updated_at: new Date().toISOString()
            })
            .eq("user_id", user.id)
            .select()
            .single();

        if (error) throw new Error("Failed to update location: " + error.message);
        return data;
    } else {
        // Insert new location
        const { data, error } = await supabaseClient
            .from("locations")
            .insert({
                user_id: user.id,
                latitude,
                longitude,
                accuracy,
                sharing_enabled: sharingEnabled
            })
            .select()
            .single();

        if (error) throw new Error("Failed to save location: " + error.message);
        return data;
    }
}

/**
 * Get current user's location from database.
 * @returns {Promise<Object|null>} location row
 */
async function getMyLocation() {
    const user = await getUser();
    if (!user) return null;

    const { data, error } = await supabaseClient
        .from("locations")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

    if (error) {
        console.error("[location.getMyLocation]", error.message);
        return null;
    }

    return data;
}

/**
 * Get partner's location from database.
 * Returns null if partner hasn't shared location or sharing is disabled.
 *
 * @returns {Promise<Object|null>} location row
 */
async function getPartnerLocation() {
    const user = await getUser();
    if (!user) return null;

    // Use the secure database function
    try {
        const { data, error } = await supabaseClient.rpc("get_partner_location");

        if (error) {
            console.error("[location.getPartnerLocation]", error.message);
            return null;
        }

        // RPC returns array
        const location = Array.isArray(data) ? data[0] : data;
        return location || null;
    } catch (err) {
        console.error("[location.getPartnerLocation]", err.message);
        return null;
    }
}

/**
 * Toggle location sharing on/off.
 * @param {boolean} enabled
 * @returns {Promise<Object>} updated location row
 */
async function toggleLocationSharing(enabled) {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    // Check if location exists
    const existing = await getMyLocation();

    if (existing) {
        // Update sharing flag
        const { data, error } = await supabaseClient
            .from("locations")
            .update({ sharing_enabled: enabled })
            .eq("user_id", user.id)
            .select()
            .single();

        if (error) throw new Error("Failed to update sharing: " + error.message);
        return data;
    } else {
        // Create location with sharing preference (without coordinates yet)
        // We'll get coordinates when user enables tracking
        throw new Error("No location data found. Please enable location tracking first.");
    }
}

/**
 * Check if location sharing is currently enabled for the user.
 * @returns {Promise<boolean>}
 */
async function isLocationSharingEnabled() {
    const location = await getMyLocation();
    return location?.sharing_enabled ?? false;
}

/**
 * Delete user's location from database.
 * Stops sharing location with partner.
 *
 * @returns {Promise<void>}
 */
async function deleteMyLocation() {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    const { error } = await supabaseClient
        .from("locations")
        .delete()
        .eq("user_id", user.id);

    if (error) throw new Error("Failed to delete location: " + error.message);
}

// =============================================================
//  Distance Calculation
// =============================================================

/**
 * Calculate distance between two coordinates using Haversine formula.
 * @param {Object} loc1 - {latitude, longitude}
 * @param {Object} loc2 - {latitude, longitude}
 * @returns {number} distance in kilometers
 */
function calculateDistance(loc1, loc2) {
    if (!loc1 || !loc2 || !loc1.latitude || !loc2.latitude) {
        return null;
    }

    const R = 6371; // Earth's radius in km
    const dLat = _toRad(loc2.latitude - loc1.latitude);
    const dLon = _toRad(loc2.longitude - loc1.longitude);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(_toRad(loc1.latitude)) *
        Math.cos(_toRad(loc2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(distance * 100) / 100; // Round to 2 decimals
}

/**
 * Convert degrees to radians.
 * @private
 */
function _toRad(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Format distance for display.
 * @param {number} km - Distance in kilometers
 * @returns {string} Formatted distance (e.g., "1.5 km" or "150 m")
 */
function formatDistance(km) {
    if (km === null || km === undefined) return "—";

    if (km < 1) {
        const meters = Math.round(km * 1000);
        return `${meters} m`;
    }

    return `${km.toFixed(1)} km`;
}

// =============================================================
//  Automatic Location Tracking
// =============================================================

/** @type {Map<string, {intervalId: number, watchId: number}>} Active tracking sessions */
const _activeTracking = new Map();

/**
 * Start automatic location tracking.
 * Updates location in database at specified interval.
 *
 * @param {number} [intervalMs=60000] - Update interval in milliseconds (default: 1 minute)
 * @param {Function} [onUpdate] - Callback called after each update
 * @param {Function} [onError] - Callback called on errors
 * @returns {string} tracking ID (use to stop tracking)
 */
function startLocationTracking(intervalMs = 60000, onUpdate = null, onError = null) {
    const trackingId = `tracking-${Date.now()}`;

    // Initial location update
    _updateLocationNow(onUpdate, onError);

    // Set up periodic updates
    const intervalId = setInterval(() => {
        _updateLocationNow(onUpdate, onError);
    }, intervalMs);

    // Also watch for significant location changes
    let watchId = null;
    try {
        watchId = watchLocation(
            async (position) => {
                try {
                    await updateMyLocation(
                        position.latitude,
                        position.longitude,
                        position.accuracy
                    );
                    if (onUpdate) onUpdate(position);
                } catch (err) {
                    console.error("[location.watchLocation]", err.message);
                    if (onError) onError(err);
                }
            },
            onError
        );
    } catch (err) {
        console.warn("[location.startTracking] Watch failed:", err.message);
    }

    _activeTracking.set(trackingId, { intervalId, watchId });

    console.log(`[location] Tracking started (ID: ${trackingId})`);
    return trackingId;
}

/**
 * Stop automatic location tracking.
 * @param {string} trackingId - ID returned by startLocationTracking()
 */
function stopLocationTracking(trackingId) {
    const tracking = _activeTracking.get(trackingId);
    if (!tracking) {
        console.warn(`[location] No active tracking with ID: ${trackingId}`);
        return;
    }

    clearInterval(tracking.intervalId);
    if (tracking.watchId) {
        clearLocationWatch(tracking.watchId);
    }

    _activeTracking.delete(trackingId);
    console.log(`[location] Tracking stopped (ID: ${trackingId})`);
}

/**
 * Stop all active location tracking sessions.
 */
function stopAllLocationTracking() {
    _activeTracking.forEach((tracking, id) => {
        stopLocationTracking(id);
    });
}

/**
 * Internal: Update location now.
 * @private
 */
async function _updateLocationNow(onUpdate, onError) {
    try {
        const position = await getCurrentLocation();
        await updateMyLocation(position.latitude, position.longitude, position.accuracy);
        if (onUpdate) onUpdate(position);
    } catch (err) {
        console.error("[location.updateNow]", err.message);
        if (onError) onError(err);
    }
}

// Auto-cleanup on page unload
if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", stopAllLocationTracking);
    window.addEventListener("pagehide", stopAllLocationTracking);
}

// =============================================================
//  Realtime Subscription Helpers
// =============================================================

/**
 * Subscribe to partner's location updates.
 * Uses the subscribeWithCleanup utility from data.js.
 *
 * @param {Function} callback - Called when partner's location updates
 * @returns {Object} subscription channel
 */
function subscribeToPartnerLocation(callback) {
    return subscribeWithCleanup(
        "partner-location",
        { event: "*", schema: "public", table: "locations" },
        async (payload) => {
            // Verify this is partner's location (not our own)
            const user = await getUser();
            if (!user) return;

            const updatedUserId = payload.new?.user_id || payload.old?.user_id;
            if (updatedUserId && updatedUserId !== user.id) {
                // This is partner's update
                callback(payload);
            }
        }
    );
}

// =============================================================
//  Utility: Time Since Last Update
// =============================================================

/**
 * Format time since last location update.
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Human-readable time (e.g., "2 minutes ago")
 */
function getTimeSinceUpdate(timestamp) {
    if (!timestamp) return "Never";

    const now = new Date();
    const updated = new Date(timestamp);
    const diffMs = now - updated;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins === 1) return "1 minute ago";
    if (diffMins < 60) return `${diffMins} minutes ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return "1 hour ago";
    if (diffHours < 24) return `${diffHours} hours ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "1 day ago";
    return `${diffDays} days ago`;
}
