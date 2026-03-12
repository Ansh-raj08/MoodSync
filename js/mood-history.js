// =============================================================
//  mood-history.js — Full Mood History Page
//  MoodSync · Paginated log for both partners (all time)
//
//  Dependencies: supabaseClient.js, auth.js, mood.js
//
//  Flow:
//    1. requireCouple() guard
//    2. Resolve display names (same chain as dashboard)
//    3. Fetch mood_logs for both partners with pagination
//    4. Render entries — newest first
//    5. Pagination controls (50 logs per page)
//    6. Filter: All / Mine / Partner
// =============================================================

"use strict";

const HISTORY_PAGE_SIZE = 50;

let _ctx = null;          // { user, couple, partnerId, myName, partnerName }
let _currentPage  = 0;
let _totalCount   = 0;
let _activeFilter = "all"; // "all" | "me" | "partner"

// =============================================================
//  Boot
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "mood-history.html") return;

    const authCtx = await requireCouple();
    if (!authCtx) return;

    const partnerId = getPartnerId(authCtx.couple, authCtx.user.id);

    // Resolve names — same multi-layer chain used in dashboard.js
    const [uProfile, pProfile] = await Promise.all([
        getProfile(authCtx.user.id),
        getProfile(partnerId),
    ]);

    const cacheKey    = `ms_partner_${authCtx.couple.id}`;
    const myName      = uProfile?.name || authCtx.user.user_metadata?.name || "You";
    let   partnerName = pProfile?.name;

    if (!partnerName) {
        try { partnerName = localStorage.getItem(cacheKey); } catch (_) {}
    } else {
        try { localStorage.setItem(cacheKey, partnerName); } catch (_) {}
    }
    partnerName = partnerName || "Partner";

    _ctx = { user: authCtx.user, couple: authCtx.couple, partnerId, myName, partnerName };

    // Update page subtitle and filter button labels
    const subtitleEl = document.getElementById("historySubtitle");
    if (subtitleEl) subtitleEl.textContent = `${myName} & ${partnerName} · All time`;

    const filterMeBtn      = document.getElementById("filterMeBtn");
    const filterPartnerBtn = document.getElementById("filterPartnerBtn");
    if (filterMeBtn)      filterMeBtn.textContent      = myName;
    if (filterPartnerBtn) filterPartnerBtn.textContent = partnerName;

    // Filter buttons
    document.querySelectorAll(".history-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".history-filter-btn")
                .forEach(b => b.classList.remove("history-filter-btn--active"));
            btn.classList.add("history-filter-btn--active");
            _activeFilter = btn.dataset.filter;
            _currentPage  = 0;
            _loadPage();
        });
    });

    // Pagination
    document.getElementById("prevPageBtn")?.addEventListener("click", () => {
        if (_currentPage > 0) { _currentPage--; _loadPage(); }
    });
    document.getElementById("nextPageBtn")?.addEventListener("click", () => {
        const total = Math.ceil(_totalCount / HISTORY_PAGE_SIZE);
        if (_currentPage < total - 1) { _currentPage++; _loadPage(); }
    });

    // Logout
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", e => { e.preventDefault(); signOut(); });

    await _loadPage();
});

// =============================================================
//  Data fetch
// =============================================================

async function _loadPage() {
    const listEl    = document.getElementById("historyList");
    const emptyEl   = document.getElementById("historyEmpty");
    const loadingEl = document.getElementById("historyLoading");
    const paginEl   = document.getElementById("historyPagination");

    if (listEl)    listEl.hidden    = true;
    if (emptyEl)   emptyEl.hidden   = true;
    if (paginEl)   paginEl.hidden   = true;
    if (loadingEl) loadingEl.hidden = false;

    try {
        const { couple, user, partnerId } = _ctx;
        const from = _currentPage * HISTORY_PAGE_SIZE;
        const to   = from + HISTORY_PAGE_SIZE - 1;

        // Build Supabase query — filter depends on active tab
        let query = supabaseClient
            .from("mood_logs")
            .select("id, user_id, score, note, logged_at", { count: "exact" })
            .order("logged_at", { ascending: false })
            .range(from, to);

        if (_activeFilter === "me") {
            query = query.eq("user_id", user.id);
        } else if (_activeFilter === "partner") {
            query = query.eq("user_id", partnerId);
        } else {
            query = query.or(`user_id.eq.${couple.user1_id},user_id.eq.${couple.user2_id}`);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        if (loadingEl) loadingEl.hidden = true;
        _totalCount = count || 0;

        if (!data || data.length === 0) {
            if (emptyEl) emptyEl.hidden = false;
            return;
        }

        if (listEl) {
            listEl.hidden = false;
            _renderEntries(listEl, data);
        }

        _renderPagination();

    } catch (err) {
        console.error("[mood-history] Load failed:", err.message);
        if (loadingEl) loadingEl.hidden = true;
        const emptyEl = document.getElementById("historyEmpty");
        if (emptyEl) {
            emptyEl.hidden = false;
            const h = emptyEl.querySelector("h2");
            if (h) h.textContent = "Error loading history";
        }
    }
}

// =============================================================
//  Render
// =============================================================

function _renderEntries(containerEl, rows) {
    const { user, myName, partnerName } = _ctx;

    containerEl.innerHTML = rows.map((row, i) => {
        const info    = MOOD_MAP[row.score] || MOOD_MAP[5];
        const isMe    = row.user_id === user.id;
        const name    = isMe ? myName : partnerName;
        const whoClass = isMe ? "history-entry--me" : "history-entry--partner";

        const dt      = new Date(row.logged_at);
        const dateStr = dt.toLocaleDateString("en-US", {
            weekday: "short", year: "numeric", month: "long", day: "numeric",
        });
        const timeStr = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

        const noteHtml = row.note
            ? `<p class="history-entry__note">"${_hesc(row.note)}"</p>`
            : "";

        return `
        <div class="history-entry glass-card ${whoClass}" style="animation-delay:${Math.min(i, 15) * 35}ms">
            <div class="history-entry__emoji">${info.emoji}</div>
            <div class="history-entry__body">
                <div class="history-entry__top">
                    <span class="history-entry__mood" style="color:${info.color}">${info.label}</span>
                    <span class="history-entry__who">${_hesc(name)}</span>
                </div>
                <div class="history-entry__when">${dateStr} &middot; ${timeStr}</div>
                ${noteHtml}
            </div>
        </div>`;
    }).join("");
}

function _renderPagination() {
    const paginEl  = document.getElementById("historyPagination");
    const pageInfo = document.getElementById("pageInfo");
    const prevBtn  = document.getElementById("prevPageBtn");
    const nextBtn  = document.getElementById("nextPageBtn");
    if (!paginEl) return;

    const totalPages = Math.ceil(_totalCount / HISTORY_PAGE_SIZE);
    if (totalPages <= 1 && _currentPage === 0) {
        paginEl.hidden = true;
        return;
    }

    paginEl.hidden = false;
    if (pageInfo) {
        pageInfo.textContent =
            `Page ${_currentPage + 1} of ${totalPages} · ${_totalCount} entr${_totalCount === 1 ? "y" : "ies"}`;
    }
    if (prevBtn) prevBtn.disabled = _currentPage === 0;
    if (nextBtn) nextBtn.disabled = _currentPage >= totalPages - 1;

    // Scroll list into view smoothly
    document.getElementById("historyList")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// =============================================================
//  Utility
// =============================================================

/** HTML-escape a string to prevent XSS from user-supplied note content. */
function _hesc(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}
