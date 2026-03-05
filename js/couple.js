// ============================================================
//  couple.js — Relationship Linking Module
//  MoodSync · Pure data module — NO DOM logic lives here
//
//  The setup form is handled by setup.js.
//  This module provides a clean API for reading / writing
//  the couple relationship record.
//
//  Storage key : "couple"
//  Data shape  :
//    {
//      id        : "cp_XXXX"     (random 4-digit identifier)
//      userA     : "user_01"     (primary user ID)
//      userB     : "user_02"     (partner user ID)
//      createdAt : "YYYY-MM-DD"
//    }
//
//  Future-ready:
//    – Replace localStorage calls with API requests to link
//      two accounts server-side (PostgreSQL relationships table).
//    – The "id" field maps to a couples.id primary key.
//    – Add "inviteCode" for async partner-invite flows.
// ============================================================

"use strict";

const COUPLE_KEY = "couple";

// ============================================================
//  Internal helpers
// ============================================================

/**
 * Generate a short random couple ID.
 * Format: "cp_XXXX" (4-digit numeric suffix)
 * @returns {string}
 */
function _generateCoupleId() {
    const suffix = Math.floor(1000 + Math.random() * 9000); // 1000–9999
    return `cp_${suffix}`;
}

/**
 * Read the couple object from localStorage.
 * @returns {Object|null}
 */
function _readCouple() {
    try {
        return JSON.parse(localStorage.getItem(COUPLE_KEY) || "null");
    } catch {
        return null;
    }
}

// ============================================================
//  Public API
// ============================================================

/**
 * Create and persist a couple relationship record.
 * Overwrites any existing couple data.
 *
 * @param {string} userA — Primary user ID  (e.g. "user_01")
 * @param {string} userB — Partner user ID  (e.g. "user_02")
 * @returns {Object}     — Saved couple object
 */
function createCouple(userA, userB) {
    if (!userA || !userB)  throw new Error("createCouple: both userA and userB are required");
    if (userA === userB)   throw new Error("createCouple: userA and userB must be different");

    const couple = {
        id:        _generateCoupleId(),
        userA,
        userB,
        createdAt: new Date().toISOString().slice(0, 10),
        // Reserved for future partner-invite flow:
        // inviteCode: null,
        // status: "active"
    };

    localStorage.setItem(COUPLE_KEY, JSON.stringify(couple));
    return couple;
}

/**
 * Retrieve the current couple profile.
 *
 * @returns {Object|null} — null if no couple has been set up yet
 */
function getCouple() {
    return _readCouple();
}

/**
 * Return both user IDs as an array.
 *
 * @returns {[string, string]|null}
 *   Returns [userA, userB] if a couple exists, null otherwise.
 */
function getUserIds() {
    const couple = _readCouple();
    if (!couple) return null;
    return [couple.userA, couple.userB];
}
