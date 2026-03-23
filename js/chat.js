// =============================================================
//  chat.js — Partner-to-Partner Messaging
//  MoodSync · Realtime chat between paired users
//
//  Dependencies: supabaseClient.js, auth.js, data.js
//
//  PHASE 1 STABILIZATION:
//  - No localStorage (all data from Supabase)
//  - Uses centralized getPartnerData() from data.js
//  - Proper realtime subscription cleanup via subscribeWithCleanup()
//  - Consistent error handling
//
//  Features:
//    1. MESSAGE INSERT   — pre-flight checks, full Supabase error logging
//    2. PARTNER NAME     — via getPartnerData() (no localStorage)
//    3. IMESSAGE ANIM    — spring bubbleIn + Sending… → ✓ Delivered → ⚠ Tap to retry
//    4. RETRY LOGIC      — failed bubbles store retry text; one tap re-sends
//    5. DUPLICATES       — Set of rendered IDs prevents double-render from realtime
//    6. VALIDATION       — trim, max 500 chars enforced client-side
// =============================================================

"use strict";

const CHAT_PAGE_LIMIT = 50;
const CHAT_MAX_CHARS  = 500;

// ---- Module-level state ---- //
let _user         = null;   // current auth user
let _couple       = null;   // current couple relationship
let _partnerId    = null;   // partner's user id
let _myName       = "You";
let _partnerName  = "Your Partner";
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
    _couple    = ctx.couple;
    _partnerId = getPartnerId(ctx.couple, ctx.user.id);

    if (!_user?.id || !_partnerId) {
        console.error("[chat] user or partnerId is null — aborting boot.");
        _setStatus("Session error — please refresh");
        return;
    }

    // ---- Resolve display names via getPartnerData() — NO localStorage ----
    const [uProfile, partnerData] = await Promise.all([
        getProfile(_user.id),
        getPartnerData(),
    ]);

    _myName      = uProfile?.name || _user.user_metadata?.name || "You";
    _partnerName = partnerData?.partnerName || "Your Partner";

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
            unsubscribeAll();  // Clean up all subscriptions before logout
            signOut();
        });

    // Load history FIRST, then subscribe so realtime doesn't double-render history
    await _loadRecentMessages();
    _subscribeRealtime();
});

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
        .select("id, sender_id, receiver_id, message, created_at, delivered_at, seen_at, is_deleted")
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
 */
async function _insertMessage(text) {
    const payload = {
        sender_id:    _user.id,
        receiver_id:  _partnerId,
        couple_id:    _couple.id,  // CRITICAL: Relationship-scoped for safe deletion
        message:      text,
        delivered_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseClient
        .from("messages")
        .insert(payload)
        .select("id, sender_id, receiver_id, message, created_at")
        .single();

    if (error) {
        console.error("[chat] INSERT failed:", error.code, error.message);
        throw new Error(`[${error.code}] ${error.message}`);
    }

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
        await _markMessagesAsSeen();
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
 * @param {"sending"|"delivered"|"seen"|"failed"|null} msgStatus
 * @param {string|null} retryText
 * @returns {HTMLElement|undefined}
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

    // Auto-detect delivery status from DB fields (for DB-loaded messages)
    if (!msgStatus && isMe) {
        if (row.seen_at)           msgStatus = "seen";
        else if (row.delivered_at) msgStatus = "delivered";
    }

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
    const rowEl      = document.createElement("div");
    rowEl.className  = `chat-message-row chat-message-row--${isMe ? "me" : "partner"}`;
    rowEl.dataset.id  = row.id;
    rowEl.dataset.day = dayKey;

    if (msgStatus === "sending") rowEl.classList.add("chat-message-row--pending");
    if (msgStatus === "failed")  rowEl.classList.add("chat-message-row--failed");
    if (retryText)               rowEl.dataset.retryText = retryText;

    // Compact: consecutive messages from same sender on same day
    const prev = containerEl.querySelectorAll(
        `.chat-message-row--${isMe ? "me" : "partner"}[data-day="${dayKey}"]`
    );
    if (prev.length > 0) rowEl.classList.add("chat-message-row--compact");

    // ---- Bubble ----
    const bubble = document.createElement("div");
    if (row.is_deleted) {
        bubble.className   = "chat-bubble chat-bubble--deleted";
        bubble.textContent = "Message deleted";
    } else {
        bubble.className = "chat-bubble";
        bubble.appendChild(document.createTextNode(row.message));   // XSS-safe

        // Delete button — own confirmed messages only
        if (isMe && msgStatus !== "sending" && msgStatus !== "failed") {
            const delBtn = document.createElement("button");
            delBtn.className   = "chat-delete-btn";
            delBtn.setAttribute("aria-label", "Delete message");
            delBtn.title       = "Delete message";
            delBtn.textContent = "✕";
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                _deleteMessage(row.id, rowEl);
            });
            bubble.appendChild(delBtn);
        }
    }

    // ---- Meta: time + WhatsApp-style delivery tick ----
    const metaEl     = document.createElement("div");
    metaEl.className = "chat-bubble-meta";

    const timeEl      = document.createElement("span");
    timeEl.className  = "chat-bubble-time";
    timeEl.textContent = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    metaEl.appendChild(timeEl);

    // Tick — only on my own messages
    if (isMe && msgStatus) {
        const tickEl    = document.createElement("span");
        tickEl.className = "chat-bubble-tick";

        if (msgStatus === "sending") {
            tickEl.textContent = "···";
            tickEl.classList.add("chat-bubble-tick--sending");
        } else if (msgStatus === "seen") {
            tickEl.textContent = "✓✓";
            tickEl.classList.add("chat-bubble-tick--seen");
        } else if (msgStatus === "delivered") {
            tickEl.textContent = "✓";
            tickEl.classList.add("chat-bubble-tick--delivered");
        } else if (msgStatus === "failed") {
            tickEl.textContent = "⚠";
            tickEl.classList.add("chat-bubble-tick--failed");
        }
        metaEl.appendChild(tickEl);
    }

    rowEl.appendChild(bubble);
    rowEl.appendChild(metaEl);

    // Tap-to-retry for failed messages
    if (msgStatus === "failed") {
        rowEl.addEventListener("click", () => _retryMessage(rowEl));
        rowEl.title = "Tap to retry";
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
            _appendMessage(confirmed, "bottom", false);  // auto-detects ✓ delivered from confirmed.delivered_at
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
//  Delivery / seen tracking
// =============================================================

/** Mark all unread partner messages in this conversation as seen. */
async function _markMessagesAsSeen() {
    if (!_user || !_partnerId) return;
    try {
        const { error } = await supabaseClient
            .from("messages")
            .update({ seen_at: new Date().toISOString() })
            .eq("sender_id", _partnerId)
            .eq("receiver_id", _user.id)
            .is("seen_at", null);
        if (error) console.error("[chat] markAsSeen:", error.message);
    } catch (err) {
        console.error("[chat] markAsSeen exception:", err.message);
    }
}

/** Handle a realtime UPDATE event — refresh tick or show deleted state. */
function _updateMessageInDom(row) {
    const rowEl = document.querySelector(`.chat-message-row[data-id="${row.id}"]`);
    if (!rowEl) return;

    const isMe = row.sender_id === _user.id;

    // Soft-delete: replace bubble content
    if (row.is_deleted) {
        const existingBubble = rowEl.querySelector(".chat-bubble");
        if (existingBubble && !existingBubble.classList.contains("chat-bubble--deleted")) {
            existingBubble.classList.add("chat-bubble--deleted");
            existingBubble.innerHTML = "";
            existingBubble.textContent = "Message deleted";
        }
    }

    // Tick update: seen_at just set → upgrade ✓ → ✓✓
    if (isMe && row.seen_at) {
        const tickEl = rowEl.querySelector(".chat-bubble-tick");
        if (tickEl && !tickEl.classList.contains("chat-bubble-tick--seen")) {
            tickEl.textContent = "✓✓";
            tickEl.className   = "chat-bubble-tick chat-bubble-tick--seen";
        }
    }
}

/** Soft-delete a message: confirm, UPDATE is_deleted, update DOM. */
async function _deleteMessage(messageId, rowEl) {
    if (!confirm("Delete this message? It will show as 'Message deleted' for both users.")) return;
    try {
        const { error } = await supabaseClient
            .from("messages")
            .update({ is_deleted: true })
            .eq("id", messageId)
            .eq("sender_id", _user.id);   // RLS: sender only
        if (error) { console.error("[chat] delete:", error.message); return; }

        // Update DOM immediately (realtime UPDATE will also fire)
        const bubble = rowEl?.querySelector(".chat-bubble");
        if (bubble && !bubble.classList.contains("chat-bubble--deleted")) {
            bubble.classList.add("chat-bubble--deleted");
            bubble.innerHTML = "";
            bubble.textContent = "Message deleted";
        }
    } catch (err) {
        console.error("[chat] deleteMessage exception:", err.message);
    }
}

// =============================================================
//  Realtime subscription (uses subscribeWithCleanup from data.js)
// =============================================================

function _subscribeRealtime() {
    // Channel name is order-independent so both users join the same channel
    const pairKey = [_user.id, _partnerId].sort().join("_");

    // Subscribe to INSERT events
    subscribeWithCleanup(
        `chat_insert_${pairKey}`,
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
            const row = payload.new;

            const ours =
                (row.sender_id === _user.id   && row.receiver_id === _partnerId) ||
                (row.sender_id === _partnerId && row.receiver_id === _user.id);

            if (!ours) return;

            _appendMessage(row, "bottom");

            // If partner sent this, mark it as seen immediately
            if (row.sender_id === _partnerId) {
                _markMessagesAsSeen();
            }
        }
    );

    // Subscribe to UPDATE events
    subscribeWithCleanup(
        `chat_update_${pairKey}`,
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
            const row = payload.new;

            const ours =
                (row.sender_id === _user.id   && row.receiver_id === _partnerId) ||
                (row.sender_id === _partnerId && row.receiver_id === _user.id);

            if (!ours) return;
            _updateMessageInDom(row);
        }
    );
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
