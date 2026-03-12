// =============================================================
//  chat.js — Partner-to-Partner Messaging
//  MoodSync · Realtime chat between paired users
//
//  Dependencies: supabaseClient.js, auth.js
//
//  Fixes in this version:
//    1. MESSAGE INSERT   — pre-flight checks, full Supabase error logging
//    2. PARTNER NAME     — 3-layer fallback (profile → pairing_requests → localStorage)
//    3. IMESSAGE ANIM    — spring bubbleIn + Sending… → ✓ Delivered → ⚠ Tap to retry
//    4. RETRY LOGIC      — failed bubbles store retry text; one tap re-sends
//    5. DUPLICATES       — Set of rendered IDs prevents double-render from realtime
//    6. VALIDATION       — trim, max 500 chars enforced client-side
//    7. DEBUG LOGGING    — sender_id, receiver_id, message, full Supabase error printed
// =============================================================

"use strict";

const CHAT_PAGE_LIMIT = 50;
const CHAT_MAX_CHARS  = 500;

// ---- Module-level state ---- //
let _user         = null;   // current auth user
let _partnerId    = null;   // partner's user id
let _myName       = "You";
let _partnerName  = "Your Partner";
let _channel      = null;   // realtime channel handle
let _oldestTs     = null;   // ISO string; cursor for "load older" pagination
let _loadingOlder = false;

// Rendered message IDs — dedup guard against realtime double-delivery
const _renderedIds = new Set();

// =============================================================
//  Boot
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "chat.html") return;

    const ctx = await requireCouple();
    if (!ctx) return;

    _user      = ctx.user;
    _partnerId = getPartnerId(ctx.couple, ctx.user.id);

    // ---- Critical pre-flight ----
    console.log("[chat] user.id    :", _user?.id);
    console.log("[chat] partnerId  :", _partnerId);
    console.log("[chat] couple.id  :", ctx.couple?.id);

    if (!_user?.id || !_partnerId) {
        console.error("[chat] user or partnerId is null — aborting boot.");
        _setStatus("Session error — please refresh");
        return;
    }

    // ---- Resolve display names (3-layer fallback) ----
    const cacheKey = `ms_partner_${ctx.couple.id}`;
    const [uProfile, pProfile] = await Promise.all([
        getProfile(_user.id),
        getProfile(_partnerId),
    ]);

    _myName      = uProfile?.name || _user.user_metadata?.name || "You";
    _partnerName = pProfile?.name || null;

    if (!_partnerName) {
        // Layer 2: pairing_requests join (works even when profiles RLS is strict)
        _partnerName = await _fetchPartnerNameViaRequest(_user.id, _partnerId);
        console.log("[chat] partner name via pairing_requests:", _partnerName);
    } else {
        try { localStorage.setItem(cacheKey, _partnerName); } catch (_) {}
    }

    if (!_partnerName) {
        // Layer 3: localStorage cache
        try { _partnerName = localStorage.getItem(cacheKey); } catch (_) {}
        console.log("[chat] partner name from cache:", _partnerName);
    }

    _partnerName = _partnerName || "Your Partner";

    // ---- Update top bar ----
    const partnerNameEl = document.getElementById("partnerName");
    const avatarEl      = document.getElementById("partnerAvatar");
    if (partnerNameEl) partnerNameEl.textContent = _partnerName;
    if (avatarEl)      avatarEl.textContent      = _partnerName.charAt(0).toUpperCase();
    _setStatus("Connected");

    // ---- Wire input ----
    const form    = document.getElementById("chatForm");
    const input   = document.getElementById("chatInput");
    const sendBtn = document.getElementById("chatSendBtn");

    input?.addEventListener("input", () => {
        const trimLen = input.value.trim().length;
        const rawLen  = input.value.length;
        sendBtn.disabled = trimLen === 0 || rawLen > CHAT_MAX_CHARS;
        _autoGrow(input);
    });

    // Enter = send, Shift+Enter = newline
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) form.dispatchEvent(new Event("submit"));
        }
    });

    form?.addEventListener("submit", (e) => {
        e.preventDefault();
        _sendMessage();
    });

    document.getElementById("loadMoreBtn")
        ?.addEventListener("click", _loadOlderMessages);

    document.getElementById("logoutBtn")
        ?.addEventListener("click", (e) => {
            e.preventDefault();
            if (_channel) supabaseClient.removeChannel(_channel);
            signOut();
        });

    // Load history FIRST, then subscribe so realtime doesn't double-render history
    await _loadRecentMessages();
    _subscribeRealtime();
});

// =============================================================
//  Partner name — pairing_requests join fallback
//  (Required when profiles RLS blocks direct partner lookup)
// =============================================================

async function _fetchPartnerNameViaRequest(userId, partnerId) {
    const { data } = await supabaseClient
        .from("pairing_requests")
        .select(
            "sender_id, receiver_id," +
            "sp:profiles!pairing_requests_sender_id_fkey(name)," +
            "rp:profiles!pairing_requests_receiver_id_fkey(name)"
        )
        .eq("status", "accepted")
        .or(
            `and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),` +
            `and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`
        )
        .limit(1)
        .maybeSingle();

    if (!data) return null;
    return (data.sender_id === partnerId ? data.sp?.name : data.rp?.name) || null;
}

// =============================================================
//  Supabase queries
// =============================================================

/**
 * Fetch the most recent CHAT_PAGE_LIMIT messages for this conversation.
 * Returns rows sorted ASC (oldest → newest) for top-to-bottom rendering.
 */
async function _fetchMessages({ before = null } = {}) {
    let query = supabaseClient
        .from("messages")
        .select("id, sender_id, receiver_id, message, created_at")
        .or(
            `and(sender_id.eq.${_user.id},receiver_id.eq.${_partnerId}),` +
            `and(sender_id.eq.${_partnerId},receiver_id.eq.${_user.id})`
        )
        .order("created_at", { ascending: false })   // newest first so LIMIT takes latest
        .limit(CHAT_PAGE_LIMIT);

    if (before) query = query.lt("created_at", before);

    const { data, error } = await query;
    if (error) {
        console.error("[chat] _fetchMessages error:", error.code, error.message);
        throw new Error(error.message);
    }

    return (data || []).reverse();   // flip to oldest-first for rendering
}

/**
 * Insert a new message row. Returns the confirmed row from DB.
 * Logs full Supabase error on failure so the root cause is visible in DevTools.
 */
async function _insertMessage(text) {
    const payload = {
        sender_id:   _user.id,
        receiver_id: _partnerId,
        message:     text,
    };

    console.log("[chat] INSERT payload →", payload);

    const { data, error } = await supabaseClient
        .from("messages")
        .insert(payload)
        .select("id, sender_id, receiver_id, message, created_at")
        .single();

    if (error) {
        console.error("[chat] INSERT failed:");
        console.error("  code    :", error.code);
        console.error("  message :", error.message);
        console.error("  hint    :", error.hint);
        console.error("  details :", error.details);
        throw new Error(`[${error.code}] ${error.message}`);
    }

    console.log("[chat] INSERT success id:", data?.id);
    return data;
}

// =============================================================
//  UI — loading history
// =============================================================

async function _loadRecentMessages() {
    const containerEl = document.getElementById("chatMessages");
    const emptyEl     = document.getElementById("chatEmpty");

    try {
        const rows = await _fetchMessages();
        if (!containerEl) return;

        if (rows.length === 0) {
            if (emptyEl) emptyEl.hidden = false;
            return;
        }

        if (emptyEl) emptyEl.hidden = true;
        _renderedIds.clear();

        _oldestTs = rows[0].created_at;
        _setLoadMoreVisible(true);

        rows.forEach(row => _appendMessage(row, "bottom", true));
        _scrollToBottom(false);
    } catch (err) {
        console.error("[chat] History load failed:", err.message);
        _setStatus("Error loading messages — refresh to retry");
    }
}

async function _loadOlderMessages() {
    if (_loadingOlder || !_oldestTs) return;
    _loadingOlder = true;

    const btn = document.getElementById("loadMoreBtn");
    if (btn) btn.textContent = "Loading…";

    try {
        const rows        = await _fetchMessages({ before: _oldestTs });
        const containerEl = document.getElementById("chatMessages");
        const emptyEl     = document.getElementById("chatEmpty");

        if (rows.length === 0) { _setLoadMoreVisible(false); return; }
        if (emptyEl) emptyEl.hidden = true;

        // Preserve scroll position so page doesn't jump after prepend
        const prevH = containerEl.scrollHeight;
        const prevT = containerEl.scrollTop;

        rows.forEach(row => _appendMessage(row, "top", true));

        _oldestTs = rows[0].created_at;
        containerEl.scrollTop = containerEl.scrollHeight - prevH + prevT;

        if (rows.length < CHAT_PAGE_LIMIT) _setLoadMoreVisible(false);
    } catch (err) {
        console.error("[chat] Load older failed:", err.message);
    } finally {
        _loadingOlder = false;
        if (btn) btn.textContent = "Load older messages ↑";
    }
}

// =============================================================
//  UI — render a single message row
// =============================================================

/**
 * Create and insert a message bubble into the chat list.
 *
 * @param {Object}  row
 * @param {"top"|"bottom"} pos
 * @param {boolean} skipScroll
 * @param {"sending"|"delivered"|"failed"|null} msgStatus  – iMessage delivery state
 * @param {string|null} retryText  – stored for tap-to-retry (failed messages only)
 * @returns {HTMLElement|undefined}  the created row element
 */
function _appendMessage(row, pos = "bottom", skipScroll = false, msgStatus = null, retryText = null) {
    // ---- Duplicate guard ----
    if (_renderedIds.has(row.id)) return;
    _renderedIds.add(row.id);

    const containerEl = document.getElementById("chatMessages");
    const emptyEl     = document.getElementById("chatEmpty");
    if (!containerEl) return;
    if (emptyEl && !emptyEl.hidden) emptyEl.hidden = true;

    const isMe = row.sender_id === _user.id;
    const dt   = new Date(row.created_at);

    // ---- Date separator ----
    const dayKey = dt.toISOString().slice(0, 10);
    const sepId  = `chat-sep-${dayKey}`;

    if (!document.getElementById(sepId)) {
        const sep       = document.createElement("div");
        sep.className   = "chat-date-sep";
        sep.id          = sepId;
        sep.textContent = _formatDay(dt);
        pos === "bottom"
            ? containerEl.appendChild(sep)
            : containerEl.insertBefore(sep, containerEl.firstChild);
    }

    // ---- Message row ----
    const rowEl       = document.createElement("div");
    rowEl.className   = `chat-message-row chat-message-row--${isMe ? "me" : "partner"}`;
    rowEl.dataset.id  = row.id;
    rowEl.dataset.day = dayKey;

    // Compact mode: consecutive messages from same sender on same day
    const prev = containerEl.querySelectorAll(
        `.chat-message-row--${isMe ? "me" : "partner"}[data-day="${dayKey}"]`
    );
    if (prev.length > 0) rowEl.classList.add("chat-message-row--compact");

    // iMessage state class
    if (msgStatus === "sending") rowEl.classList.add("chat-message-row--pending");
    if (msgStatus === "failed")  rowEl.classList.add("chat-message-row--failed");

    // Store retry text so the click handler can re-send
    if (retryText) rowEl.dataset.retryText = retryText;

    // ---- Bubble ----
    const bubble      = document.createElement("div");
    bubble.className  = "chat-bubble";
    bubble.textContent = row.message;   // textContent → XSS-safe

    // ---- Meta row: timestamp + delivery status ----
    const metaEl    = document.createElement("div");
    metaEl.className = "chat-bubble-meta";

    const timeEl      = document.createElement("span");
    timeEl.className  = "chat-bubble-time";
    timeEl.textContent = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    metaEl.appendChild(timeEl);

    // Delivery status — only for my own messages
    if (isMe && msgStatus) {
        const statusEl    = document.createElement("span");
        statusEl.className = "chat-bubble-status";

        if (msgStatus === "sending") {
            statusEl.textContent  = "Sending…";
            statusEl.className   += " chat-bubble-status--sending";
        } else if (msgStatus === "delivered") {
            statusEl.textContent  = "✓ Delivered";
            statusEl.className   += " chat-bubble-status--delivered";
            // Fade out after 3 s — keeps UI clean
            setTimeout(() => statusEl.classList.add("chat-bubble-status--fadeout"), 3000);
        } else if (msgStatus === "failed") {
            statusEl.textContent  = "⚠ Failed · Tap to retry";
            statusEl.className   += " chat-bubble-status--failed";
        }

        metaEl.appendChild(statusEl);
    }

    rowEl.appendChild(bubble);
    rowEl.appendChild(metaEl);

    // ---- Tap-to-retry ----
    if (msgStatus === "failed") {
        rowEl.addEventListener("click", () => _retryMessage(rowEl));
        rowEl.title = "Tap to retry sending this message";
    }

    // ---- Insert into DOM ----
    if (pos === "bottom") {
        containerEl.appendChild(rowEl);
    } else {
        const sep = document.getElementById(sepId);
        sep?.nextSibling
            ? containerEl.insertBefore(rowEl, sep.nextSibling)
            : containerEl.insertBefore(rowEl, containerEl.firstChild);
    }

    if (!skipScroll) _scrollToBottom(true);
    return rowEl;
}

// =============================================================
//  Send — optimistic UI + iMessage delivery states
// =============================================================

async function _sendMessage() {
    const input   = document.getElementById("chatInput");
    const sendBtn = document.getElementById("chatSendBtn");
    if (!input) return;

    // ---- Validate ----
    const text = input.value.trim();
    if (!text) return;
    if (text.length > CHAT_MAX_CHARS) {
        console.warn("[chat] Message too long:", text.length, "chars");
        return;
    }

    // ---- Pre-flight: ensure context is ready ----
    if (!_user?.id || !_partnerId) {
        console.error("[chat] Cannot send: _user.id or _partnerId is null");
        _setStatus("⚠ Session error — please refresh", 4000);
        return;
    }

    // ---- Clear input immediately for snappy UX ----
    const savedInput   = input.value;
    input.value        = "";
    input.style.height = "";
    sendBtn.disabled   = true;

    // ---- Spring animation on send button ----
    sendBtn.classList.add("chat-send-btn--pop");
    sendBtn.addEventListener("animationend",
        () => sendBtn.classList.remove("chat-send-btn--pop"), { once: true });

    // ---- Optimistic bubble ----
    const tempId  = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tempRow = {
        id:          tempId,
        sender_id:   _user.id,
        receiver_id: _partnerId,
        message:     text,
        created_at:  new Date().toISOString(),
    };

    const tempEl = _appendMessage(tempRow, "bottom", false, "sending", text);
    _scrollToBottom(true);

    try {
        const confirmed = await _insertMessage(text);

        // Remove optimistic bubble; render confirmed row with "Delivered" status.
        // Realtime may arrive first — _renderedIds dedup will handle that case.
        _renderedIds.delete(tempId);
        tempEl?.remove();

        if (!_renderedIds.has(confirmed.id)) {
            _appendMessage(confirmed, "bottom", false, "delivered");
        }

    } catch (err) {
        console.error("[chat] _sendMessage caught:", err.message);

        // Restore input so user doesn't lose their text
        input.value = savedInput;
        _autoGrow(input);
        sendBtn.disabled = input.value.trim().length === 0;

        // Replace optimistic bubble with a failed bubble (tap-to-retry)
        _renderedIds.delete(tempId);
        tempEl?.remove();

        const failedRow = {
            id:          `failed-${tempId}`,
            sender_id:   _user.id,
            receiver_id: _partnerId,
            message:     text,
            created_at:  new Date().toISOString(),
        };
        _appendMessage(failedRow, "bottom", false, "failed", text);
    }
}

// =============================================================
//  Retry — tap a failed bubble to re-send
// =============================================================

function _retryMessage(rowEl) {
    const retryText = rowEl.dataset.retryText;
    if (!retryText) return;

    const msgId = rowEl.dataset.id;

    // Clean up the failed bubble
    _renderedIds.delete(msgId);
    rowEl.remove();

    // Populate input and auto-send
    const input   = document.getElementById("chatInput");
    const sendBtn = document.getElementById("chatSendBtn");
    if (input) {
        input.value      = retryText;
        sendBtn.disabled = false;
        _autoGrow(input);
    }
    _sendMessage();
}

// =============================================================
//  Realtime subscription
// =============================================================

function _subscribeRealtime() {
    // Channel name is order-independent so both users join the same channel
    const pairKey = [_user.id, _partnerId].sort().join("_");

    _channel = supabaseClient
        .channel(`chat_${pairKey}`)
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            (payload) => {
                const row = payload.new;

                // Guard: only handle messages from this conversation
                const ours =
                    (row.sender_id === _user.id   && row.receiver_id === _partnerId) ||
                    (row.sender_id === _partnerId && row.receiver_id === _user.id);

                if (!ours) return;

                // Partner's incoming messages → normal render.
                // My own messages → already rendered as "delivered"; dedup blocks re-render.
                _appendMessage(row, "bottom");
            }
        )
        .subscribe((status) => {
            console.log("[chat] Realtime channel:", status);
        });
}

// =============================================================
//  Utilities
// =============================================================

function _setStatus(text, clearAfterMs = 0) {
    const el = document.getElementById("chatStatus");
    if (!el) return;
    el.textContent = text;
    if (clearAfterMs > 0) {
        setTimeout(() => { el.textContent = "Connected"; }, clearAfterMs);
    }
}

function _setLoadMoreVisible(visible) {
    const wrap = document.getElementById("loadMoreWrap");
    if (wrap) wrap.hidden = !visible;
}

function _scrollToBottom(smooth = true) {
    const el = document.getElementById("chatMessages");
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
}

function _autoGrow(textarea) {
    textarea.style.height = "auto";
    const lineH = parseInt(getComputedStyle(textarea).lineHeight, 10) || 22;
    textarea.style.height = Math.min(textarea.scrollHeight, lineH * 5 + 24) + "px";
}

function _formatDay(date) {
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString())     return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
