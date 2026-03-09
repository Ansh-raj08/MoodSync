// =============================================================
//  pairing.js — Secure Partner Pairing System
//  MoodSync · Pair-code exchange + request / accept / reject
//
//  Dependencies: supabaseClient.js, auth.js (must load first)
//
//  Flow:
//    1. Each user gets a unique pair_code on signup (profiles table).
//    2. User A enters User B's code → pairing_requests row created.
//    3. User B sees request → accepts → couples row created.
//    4. Both users are now paired → redirected to mood.html.
//
//  Public API:
//    getMyPairCode()            → string | null
//    sendPairRequest(code)      → request row
//    getIncomingRequests()      → [...requests with sender profile]
//    getOutgoingRequests()      → [...requests with receiver profile]
//    acceptPairRequest(id)      → couple row
//    rejectPairRequest(id)      → void
//    subscribeToPairRequests(cb)→ channel
//
//  Also handles pair.html DOM logic via DOMContentLoaded.
// =============================================================

"use strict";

// =============================================================
//  Pairing API
// =============================================================

/**
 * Get the current user's unique pair code.
 * @returns {Promise<string|null>}
 */
async function getMyPairCode() {
    const profile = await getProfile();
    return profile?.pair_code || null;
}

/**
 * Look up a profile by pair code.
 * @param {string} code
 * @returns {Promise<Object>} profile row
 * @throws {Error} with a specific message for auth issues vs. not-found
 */
async function findUserByPairCode(code) {
    // --- Sanitise input ---
    const sanitised = code.trim().toLowerCase();
    console.debug("[pairing.findUser] raw input:", JSON.stringify(code));
    console.debug("[pairing.findUser] sanitised:", JSON.stringify(sanitised));

    if (!sanitised) throw new Error("Pair code is empty.");

    // --- Verify session is present before querying ---
    const sessionUser = await getUser();
    console.debug("[pairing.findUser] session uid:", sessionUser?.id ?? "NONE — not authenticated");
    if (!sessionUser) throw new Error("You must be logged in to use a pair code.");

    // --- Query ---
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, name, email, pair_code")
        .ilike("pair_code", sanitised)   // case-insensitive DB-level match
        .maybeSingle();

    console.debug("[pairing.findUser] supabase data:", data);
    console.debug("[pairing.findUser] supabase error:", error);

    if (error) {
        // Distinguish RLS/auth errors from network errors
        if (error.code === "PGRST301" || error.message?.includes("JWT")) {
            throw new Error("Session expired. Please log out and log back in.");
        }
        if (error.code === "42501" || error.message?.includes("policy")) {
            throw new Error("Permission denied. RLS policy may need to be updated in Supabase — see console.");
        }
        throw new Error("Database error: " + error.message);
    }

    if (!data) {
        console.warn("[pairing.findUser] No profile found for code:", sanitised);
        throw new Error("Invalid pair code. No user found.");
    }

    return data;
}

/**
 * Send a pairing request to the owner of the given pair code.
 * Validates: not self, not already paired, no duplicate pending request.
 * @param {string} pairCode
 * @returns {Promise<Object>} The created pairing_requests row
 */
async function sendPairRequest(pairCode) {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    // Already paired?
    const existingCouple = await getCouple();
    if (existingCouple) throw new Error("You are already paired with someone.");

    // Find the target — throws with a specific message if not found or auth fails
    const target = await findUserByPairCode(pairCode);
    if (target.id === user.id) throw new Error("You cannot pair with yourself.");

    // Check if target already paired
    const { data: targetCouple } = await supabaseClient
        .from("couples")
        .select("id")
        .or(`user1_id.eq.${target.id},user2_id.eq.${target.id}`)
        .limit(1);
    if (targetCouple && targetCouple.length > 0) {
        throw new Error("This user is already paired with someone.");
    }

    // Check for duplicate pending request between the two
    const { data: dup } = await supabaseClient
        .from("pairing_requests")
        .select("id")
        .eq("status", "pending")
        .or(
            `and(sender_id.eq.${user.id},receiver_id.eq.${target.id}),` +
            `and(sender_id.eq.${target.id},receiver_id.eq.${user.id})`
        )
        .limit(1);
    if (dup && dup.length > 0) {
        throw new Error("A pairing request already exists between you two.");
    }

    // Create the request
    const { data, error } = await supabaseClient
        .from("pairing_requests")
        .insert({ sender_id: user.id, receiver_id: target.id, status: "pending" })
        .select()
        .single();

    if (error) throw new Error("Failed to send request: " + error.message);
    return data;
}

/**
 * Get pending incoming requests (received by current user).
 * Includes the sender's profile for display.
 * @returns {Promise<Array>}
 */
async function getIncomingRequests() {
    const user = await getUser();
    if (!user) return [];

    const { data, error } = await supabaseClient
        .from("pairing_requests")
        .select("id, status, created_at, sender_id, profiles!pairing_requests_sender_id_fkey(id, name, email)")
        .eq("receiver_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

    if (error) { console.error("[pairing.incoming]", error.message); return []; }

    // Normalise the joined profile → .sender
    return (data || []).map(r => ({
        ...r,
        sender: r.profiles || null,
    }));
}

/**
 * Get pending outgoing requests (sent by current user).
 * @returns {Promise<Array>}
 */
async function getOutgoingRequests() {
    const user = await getUser();
    if (!user) return [];

    const { data, error } = await supabaseClient
        .from("pairing_requests")
        .select("id, status, created_at, receiver_id, profiles!pairing_requests_receiver_id_fkey(id, name, email)")
        .eq("sender_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

    if (error) { console.error("[pairing.outgoing]", error.message); return []; }

    return (data || []).map(r => ({
        ...r,
        receiver: r.profiles || null,
    }));
}

/**
 * Accept a pairing request → creates the couple.
 * @param {string} requestId
 * @returns {Promise<Object>} couple row
 */
async function acceptPairRequest(requestId) {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    // Fetch the request (must be pending + receiver = me)
    const { data: req, error: fetchErr } = await supabaseClient
        .from("pairing_requests")
        .select("*")
        .eq("id", requestId)
        .eq("receiver_id", user.id)
        .eq("status", "pending")
        .single();

    if (fetchErr || !req) throw new Error("Request not found or already handled.");

    // Mark accepted
    const { error: updateErr } = await supabaseClient
        .from("pairing_requests")
        .update({ status: "accepted" })
        .eq("id", requestId);
    if (updateErr) throw new Error("Failed to accept: " + updateErr.message);

    // Create couple
    const { data: couple, error: coupleErr } = await supabaseClient
        .from("couples")
        .insert({ user1_id: req.sender_id, user2_id: req.receiver_id })
        .select()
        .single();
    if (coupleErr) throw new Error("Failed to create couple: " + coupleErr.message);

    return couple;
}

/**
 * Reject a pairing request.
 * @param {string} requestId
 */
async function rejectPairRequest(requestId) {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    const { error } = await supabaseClient
        .from("pairing_requests")
        .update({ status: "rejected" })
        .eq("id", requestId)
        .eq("receiver_id", user.id);

    if (error) throw new Error("Failed to reject: " + error.message);
}

/**
 * Subscribe to realtime changes on pairing_requests.
 * @param {Function} callback
 * @returns {Object} channel (call .unsubscribe())
 */
function subscribeToPairRequests(callback) {
    return supabaseClient
        .channel("pairing-updates")
        .on("postgres_changes",
            { event: "*", schema: "public", table: "pairing_requests" },
            payload => callback(payload))
        .subscribe();
}

// =============================================================
//  pair.html Page Logic
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "pair.html") return;

    // Auth guard (but not couple guard — user comes here to pair)
    const user = await requireAuth();
    if (!user) return;

    // Already paired? → skip to mood logging
    const couple = await getCouple();
    if (couple) { window.location.replace("mood.html"); return; }

    await _initPairPage(user);
});

async function _initPairPage(user) {
    const profile = await getProfile();

    // Display pair code
    const codeEl = document.getElementById("myPairCode");
    if (codeEl && profile) codeEl.textContent = profile.pair_code;

    const nameEl = document.getElementById("pairUserName");
    if (nameEl && profile) nameEl.textContent = profile.name;

    // Load existing requests
    await _renderPairRequests();

    // --- Send request form ---
    const form      = document.getElementById("pairForm");
    const input     = document.getElementById("pairCodeInput");
    const submitBtn = document.getElementById("pairSubmitBtn");
    const msgEl     = document.getElementById("pairMessage");

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const code = input.value.trim().toLowerCase();
            if (!code) { _pairMsg(msgEl, "Enter a pair code.", "error"); return; }

            submitBtn.disabled   = true;
            submitBtn.textContent = "Sending…";
            _pairMsg(msgEl, "", "");

            try {
                await sendPairRequest(code);
                _pairMsg(msgEl, "Request sent! Waiting for your partner to accept.", "success");
                input.value = "";
                await _renderPairRequests();
            } catch (err) {
                _pairMsg(msgEl, err.message, "error");
            } finally {
                submitBtn.disabled   = false;
                submitBtn.textContent = "Send Request";
            }
        });
    }

    // --- Copy code ---
    const copyBtn = document.getElementById("copyCodeBtn");
    if (copyBtn && profile) {
        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(profile.pair_code);
                copyBtn.textContent = "Copied ✓";
                setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
            } catch {
                _pairMsg(msgEl, "Could not copy — select and copy manually.", "error");
            }
        });
    }

    // --- Realtime subscription ---
    subscribeToPairRequests(async () => {
        await _renderPairRequests();
        // If a couple now exists (partner accepted while we're on this page) → go
        const couple = await getCouple();
        if (couple) window.location.href = "mood.html";
    });

    // --- Logout ---
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", (e) => { e.preventDefault(); signOut(); });
}

// ---- Render incoming + outgoing ----
async function _renderPairRequests() {
    const inEl  = document.getElementById("incomingRequests");
    const outEl = document.getElementById("outgoingRequests");

    if (inEl) {
        const reqs = await getIncomingRequests();
        if (!reqs.length) {
            inEl.innerHTML = '<p class="pair-empty">No incoming requests yet.</p>';
        } else {
            inEl.innerHTML = reqs.map(r => `
                <div class="pair-request glass-card">
                    <div class="pair-request__info">
                        <span class="pair-request__name">${_esc(r.sender?.name || "Someone")}</span>
                        <span class="pair-request__email">${_esc(r.sender?.email || "")}</span>
                    </div>
                    <div class="pair-request__actions">
                        <button class="btn btn--glass btn--sm" onclick="_onAccept('${r.id}')">Accept</button>
                        <button class="btn btn--ghost btn--sm" onclick="_onReject('${r.id}')">Reject</button>
                    </div>
                </div>`).join("");
        }
    }

    if (outEl) {
        const reqs = await getOutgoingRequests();
        if (!reqs.length) {
            outEl.innerHTML = '<p class="pair-empty">No sent requests.</p>';
        } else {
            outEl.innerHTML = reqs.map(r => `
                <div class="pair-request pair-request--sent glass-card">
                    <div class="pair-request__info">
                        <span class="pair-request__name">${_esc(r.receiver?.name || "Someone")}</span>
                        <span class="pair-request__status">⏳ Pending</span>
                    </div>
                </div>`).join("");
        }
    }
}

// Global handlers called from inline onclick (simple for MVP)
async function _onAccept(id) {
    try {
        await acceptPairRequest(id);
        window.location.href = "mood.html";
    } catch (err) { alert("Accept failed: " + err.message); }
}

async function _onReject(id) {
    try {
        await rejectPairRequest(id);
        await _renderPairRequests();
    } catch (err) { alert("Reject failed: " + err.message); }
}

// ---- Helpers ----
function _pairMsg(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.className = "pair-message" + (type ? " pair-message--" + type : "");
    el.hidden = !msg;
}

function _esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}
