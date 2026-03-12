// =============================================================
//  dashboard.js — Relationship Dashboard
//  MoodSync · Data loading, card rendering, realtime updates
//
//  Dependencies: supabaseClient.js, auth.js, mood.js, algorithm.js
//
//  Flow:
//    1. requireCouple() guard
//    2. Fetch both partners' mood histories
//    3. Run calculateHealthScore()
//    4. Render all dashboard cards
//    5. Subscribe to realtime mood updates → auto-refresh
// =============================================================

"use strict";

// ---- Trend display meta ----
const TREND_META = {
    improving:    { icon: "📈", label: "Improving",      color: "var(--clr-mint)",           desc: "Your mood has been on the rise this week!" },
    stable:       { icon: "➖", label: "Stable",          color: "var(--clr-teal)",           desc: "Consistent mood — solid emotional balance." },
    declining:    { icon: "📉", label: "Declining",       color: "var(--clr-rose)",           desc: "A dip this week. Be kind to yourself." },
    insufficient: { icon: "⏳", label: "Not enough data", color: "var(--clr-text-secondary)", desc: "Log at least 3 days to unlock trend analysis." },
};

// =============================================================
//  Boot
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "dashboard.html") return;

    const ctx = await requireCouple();
    if (!ctx) return;

    await loadDashboard(ctx.user, ctx.couple);

    // Realtime: refresh when either partner logs a new mood
    subscribeToMoodUpdates(async (payload) => {
        const partnerId = getPartnerId(ctx.couple, ctx.user.id);
        if (payload.new.user_id === partnerId || payload.new.user_id === ctx.user.id) {
            await loadDashboard(ctx.user, ctx.couple);
        }
    });

    // Logout
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", (e) => { e.preventDefault(); signOut(); });
});

// =============================================================
//  Data Helpers
// =============================================================

/**
 * Fetch the last `days` days of mood logs for both partners in a
 * single Supabase query and return them as a flat array.
 */
async function fetchCoupleLogsDirectly(couple, days = 14) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    cutoff.setHours(0, 0, 0, 0);

    const { data, error } = await supabaseClient
        .from("mood_logs")
        .select("id, user_id, score, note, logged_at")
        .or(`user_id.eq.${couple.user1_id},user_id.eq.${couple.user2_id}`)
        .gte("logged_at", cutoff.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error("Failed to fetch couple logs: " + error.message);
    return (data || []).map(row => ({
        date:   row.logged_at.slice(0, 10),
        userId: row.user_id,
        score:  row.score,
        note:   row.note,
    }));
}

// =============================================================
//  Main Loader
// =============================================================

async function loadDashboard(user, couple) {
    const gridEl  = document.getElementById("dashGrid");
    const emptyEl = document.getElementById("dashEmpty");
    if (gridEl)  gridEl.hidden  = true;
    if (emptyEl) emptyEl.hidden = true;

    try {
        const partnerId = getPartnerId(couple, user.id);

        // Parallel fetch: 14-day couple logs (for health score + recent cards)
        //                 + all-time per-user (for trend / confidence / averages)
        //                 + both profiles
        const [coupleLogs14, uLogsAll, pLogsAll, uProfile, pProfile] = await Promise.all([
            fetchCoupleLogsDirectly(couple, 14),
            getMoodHistory(user.id),
            getMoodHistory(partnerId),
            getProfile(user.id),
            getProfile(partnerId),
        ]);

        // Split 14-day fetch by user
        const uLogs14 = coupleLogs14.filter(l => l.userId === user.id);
        const pLogs14 = coupleLogs14.filter(l => l.userId === partnerId);

        // Derive 7-day window from 14-day data (no extra network call)
        const cutoff7 = new Date();
        cutoff7.setDate(cutoff7.getDate() - 6);
        const cut7str  = cutoff7.toISOString().slice(0, 10);
        const uLogs7   = uLogs14.filter(l => l.date >= cut7str);
        const pLogs7   = pLogs14.filter(l => l.date >= cut7str);

        // Resolve display names with multi-layer fallback:
        //   1. profiles table   2. auth metadata   3. pairing_requests join   4. localStorage cache   5. literal fallback
        const cacheKey  = `ms_partner_${couple.id}`;
        const myName    = uProfile?.name || user.user_metadata?.name || "You";
        let partnerName = pProfile?.name;

        // pProfile can be null when the profiles SELECT policy only permits
        // reading own row. In that case try the accepted pairing_requests join —
        // same approach that already works on pair.html.
        if (!partnerName) {
            partnerName = await _fetchPartnerNameViaRequest(user.id, partnerId);
        }

        if (partnerName) {
            try { localStorage.setItem(cacheKey, partnerName); } catch (_) {}
        } else {
            try { partnerName = localStorage.getItem(cacheKey); } catch (_) {}
        }
        partnerName = partnerName || "Partner";

        // Header
        _renderHeader(myName, partnerName);

        // Empty state
        if (uLogsAll.length === 0) {
            if (emptyEl) emptyEl.hidden = false;
            return;
        }

        if (gridEl) gridEl.hidden = false;

        // V2 health score (14-day window, 0-100 scale)
        const v2 = calculateHealthScoreV2(uLogs14, pLogs14);

        // V1 metrics — trend, confidence, alignment (uses full history for stability)
        const v1 = calculateHealthScore(uLogsAll, pLogsAll);

        // Render cards
        _renderScoreCard(v2.healthScore);
        _renderTrendCard(v1.trend, uLogs7);
        _renderConfidenceCard(v1.confidence);
        _renderAverageCard(v1.average, v1.partnerAverage, myName, partnerName);
        _renderMoodDiffCard(v1.moodDiff);
        _renderMoodGraph(coupleLogs14, user.id, partnerId, myName, partnerName);
        _renderRecentLogs(uLogs14, pLogs14, myName, partnerName);
        _checkTodayLogged(user.id, uLogs14);

    } catch (err) {
        console.error("[dashboard] Load failed:", err.message);
        if (emptyEl) {
            emptyEl.hidden = false;
            const title = emptyEl.querySelector(".dash-empty__title");
            if (title) title.textContent = "Error loading data";
        }
    }
}

// =============================================================
//  Render Functions
// =============================================================

function _renderHeader(myName, partnerName) {
    const titleEl = document.getElementById("coupleTitle");
    const subEl   = document.getElementById("coupleSince");

    if (titleEl) {
        titleEl.textContent = `${myName} & ${partnerName}`;
    }
    if (subEl) subEl.textContent = "Your relationship insights";
}

// ---- Score ring ----
function _renderScoreCard(score) {
    const numEl    = document.getElementById("scoreNumber");
    const circleEl = document.getElementById("scoreCircle");
    const descEl   = document.getElementById("scoreDesc");

    if (numEl) numEl.textContent = score;
    if (descEl) descEl.textContent = _scoreDesc(score);

    if (circleEl) {
        const C = 314;
        const offset = C - (score / 100) * C;
        const color = score >= 80 ? "#3de09a"          // green
                    : score >= 60 ? "#f5c842"          // yellow
                    : score >= 40 ? "#f57c42"          // orange
                    : "#f74a6b";                       // red

        circleEl.style.stroke = color;
        circleEl.style.strokeDashoffset = C;
        circleEl.style.transition = "stroke-dashoffset 1.2s cubic-bezier(.25,.1,.25,1), stroke .4s ease";
        requestAnimationFrame(() => requestAnimationFrame(() => {
            circleEl.style.strokeDashoffset = offset;
        }));
    }
}

function _scoreDesc(s) {
    if (s >= 85) return "Thriving 🥰 — your relationship is in great shape.";
    if (s >= 70) return "Healthy 💚 — things are going well overall.";
    if (s >= 50) return "Steady 💙 — some highs and lows, but balanced.";
    if (s >= 30) return "Needs attention 💛 — try connecting more often.";
    return "Check in 🩷 — log more to build a fuller picture.";
}

// ---- Trend card ----
function _renderTrendCard(trend, userLogs) {
    const meta    = TREND_META[trend] || TREND_META.insufficient;
    const iconEl  = document.getElementById("trendIcon");
    const labelEl = document.getElementById("trendLabel");
    const descEl  = document.getElementById("trendDesc");
    const barsEl  = document.getElementById("trendBars");

    if (iconEl) iconEl.textContent = meta.icon;
    if (labelEl) { labelEl.textContent = meta.label; labelEl.style.color = meta.color; }
    if (descEl)  descEl.textContent = meta.desc;

    if (!barsEl) return;

    const byDate = {};
    userLogs.forEach(e => { byDate[e.date] = e; });

    barsEl.innerHTML = "";
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key   = d.toISOString().slice(0, 10);
        const entry = byDate[key];

        const bar = document.createElement("div");
        bar.className = "trend-bar";
        bar.title = entry
            ? `${_shortDate(key)}: ${MOOD_MAP[entry.score]?.label ?? entry.score}`
            : `${_shortDate(key)}: no log`;

        if (entry) {
            const h = ((entry.score - 1) / 8) * 100;
            const c = MOOD_MAP[entry.score]?.color ?? "var(--clr-lavender)";
            bar.innerHTML = `<div class="trend-bar__fill" style="height:${h}%;background:${c}"></div>`;
        } else {
            bar.classList.add("trend-bar--empty");
        }

        barsEl.appendChild(bar);
    }
}

// ---- Confidence ----
function _renderConfidenceCard(confidence) {
    const pct    = Math.round(confidence * 100);
    const numEl  = document.getElementById("confNumber");
    const barEl  = document.getElementById("confBarFill");
    const descEl = document.getElementById("confDesc");

    if (numEl) numEl.textContent = pct;
    if (descEl) {
        descEl.textContent =
            pct >= 80 ? "High confidence — consistent logging streak." :
            pct >= 50 ? "Moderate — keep logging daily for better insights." :
            pct >= 25 ? "Low — more data needed for reliable analysis." :
                        "Very low — start logging regularly.";
    }

    if (barEl) {
        const c = pct >= 70 ? "var(--clr-mint)"
                : pct >= 40 ? "var(--clr-lavender)"
                : "var(--clr-pink)";
        barEl.style.background  = c;
        barEl.style.width       = "0%";
        barEl.style.transition  = "width 1s cubic-bezier(.25,.1,.25,1)";
        requestAnimationFrame(() => requestAnimationFrame(() => {
            barEl.style.width = pct + "%";
        }));
    }
}

// ---- Average mood ----
function _renderAverageCard(userAvg, partnerAvg, myName, partnerName) {
    const emojiEl = document.getElementById("avgEmoji");
    const labelEl = document.getElementById("avgLabel");
    const descEl  = document.getElementById("avgDesc");

    if (userAvg === null) {
        if (emojiEl) emojiEl.textContent = "—";
        if (labelEl) labelEl.textContent = "No data";
        return;
    }

    const info = MOOD_MAP[userAvg] || MOOD_MAP[5];
    if (emojiEl) emojiEl.textContent = info.emoji;
    if (labelEl) { labelEl.textContent = info.label; labelEl.style.color = info.color; }

    if (descEl) {
        let desc = `${myName || "You"}'s average mood is ${userAvg}/9.`;
        if (partnerAvg !== null) desc += ` ${partnerName || "Partner"}: ${partnerAvg}/9.`;
        descEl.textContent = desc;
    }
}

// ---- Mood difference / alignment ----
function _renderMoodDiffCard(moodDiff) {
    const valEl  = document.getElementById("moodDiffValue");
    const descEl = document.getElementById("moodDiffDesc");
    if (!valEl) return;

    if (moodDiff === null) {
        valEl.textContent = "—";
        if (descEl) descEl.textContent = "Need partner data to show alignment.";
        return;
    }

    valEl.textContent = moodDiff + "%";
    if (descEl) {
        descEl.textContent =
            moodDiff >= 80 ? "Highly in sync — great emotional alignment!" :
            moodDiff >= 60 ? "Good alignment — mostly in tune with each other." :
            moodDiff >= 40 ? "Some differences — a conversation might help." :
                             "Out of sync — check in with your partner.";
    }
}

// ---- Recent logs — glass card grid ----
function _renderRecentLogs(uLogs, pLogs, myName, partnerName) {
    const containerEl = document.getElementById("logCards");
    if (!containerEl) return;

    const combined = [
        ...uLogs.map(l => ({ ...l, name: myName,      isUser: true })),
        ...pLogs.map(l => ({ ...l, name: partnerName, isUser: false })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

    if (!combined.length) {
        containerEl.innerHTML = '<p class="log-cards__empty">No entries in the last 14 days.</p>';
        return;
    }

    containerEl.innerHTML = combined.map((e, i) => {
        const info      = MOOD_MAP[e.score] || MOOD_MAP[5];
        const moodClass = _moodCardClass(e.score);
        const noteFrag  = e.note
            ? `<p class="log-card__note">${_escDash(e.note)}</p>`
            : "";
        return `
        <div class="log-card ${moodClass}" style="animation-delay:${i * 60}ms">
            <span class="log-card__emoji">${info.emoji}</span>
            <div class="log-card__body">
                <div class="log-card__top">
                    <span class="log-card__name">${_escDash(e.name)}</span>
                    <span class="log-card__mood" style="color:${info.color}">${info.label}</span>
                </div>
                <span class="log-card__time">${_shortDate(e.date)}</span>
                ${noteFrag}
            </div>
        </div>`;
    }).join("");
}

/** Return the CSS modifier class for a log card based on the raw score (1-9). */
function _moodCardClass(score) {
    if (score >= 9) return "log-card--great";
    if (score >= 7) return "log-card--good";
    if (score >= 5) return "log-card--neutral";
    if (score >= 3) return "log-card--sad";
    return "log-card--very-sad";
}

// ---- Mood Trend Graph (14-day, Chart.js) ----
function _renderMoodGraph(coupleLogs14, userId, partnerId, myName, partnerName) {
    const canvas = document.getElementById("moodTrendChart");
    if (!canvas || typeof Chart === "undefined") return;

    // Update legend labels
    const legendMyEl = document.getElementById("legendMyName");
    const legendPtEl = document.getElementById("legendPartnerName");
    if (legendMyEl) legendMyEl.textContent = myName;
    if (legendPtEl) legendPtEl.textContent = partnerName;

    // Build 14-day date labels (ISO keys + short display labels)
    const today     = new Date();
    const isoKeys   = [];
    const dispLabels = [];
    for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        isoKeys.push(d.toISOString().slice(0, 10));
        dispLabels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    }

    // For each user build a score array — one value per day (latest log wins; logs sorted asc)
    function scoresByDate(uid) {
        const map = {};
        coupleLogs14
            .filter(l => l.userId === uid)
            .forEach(l => { map[l.date] = l.score; });
        return isoKeys.map(d => (map[d] !== undefined ? map[d] : null));
    }

    const myScores      = scoresByDate(userId);
    const partnerScores = scoresByDate(partnerId);

    // Gradient fills — use a fixed height since canvas may not be painted yet
    const ctx = canvas.getContext("2d");
    const fillH = 260;
    const gradMe = ctx.createLinearGradient(0, 0, 0, fillH);
    gradMe.addColorStop(0, "rgba(201, 140, 245, 0.32)");
    gradMe.addColorStop(1, "rgba(201, 140, 245, 0.00)");
    const gradPartner = ctx.createLinearGradient(0, 0, 0, fillH);
    gradPartner.addColorStop(0, "rgba(247, 160, 190, 0.32)");
    gradPartner.addColorStop(1, "rgba(247, 160, 190, 0.00)");

    // Destroy previous chart instance before redraw (dashboard auto-refreshes on new logs)
    if (window._moodTrendChart instanceof Chart) {
        window._moodTrendChart.destroy();
    }

    const MOOD_TOOLTIP = {
        1: "😫 Very Bad", 2: "😫 Very Bad",
        3: "😔 Bad",      4: "😔 Bad",
        5: "😐 Neutral",
        6: "🙂 Good",     7: "😄 Good",
        8: "🥰 Great",    9: "🥰 Great",
    };

    window._moodTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: dispLabels,
            datasets: [
                {
                    label: myName,
                    data: myScores,
                    borderColor: "#c98cf5",
                    backgroundColor: gradMe,
                    tension: 0.45,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: "#c98cf5",
                    pointBorderColor: "rgba(255,255,255,0.55)",
                    pointBorderWidth: 2,
                    borderWidth: 2.5,
                    spanGaps: false,
                    fill: true,
                },
                {
                    label: partnerName,
                    data: partnerScores,
                    borderColor: "#f7a0be",
                    backgroundColor: gradPartner,
                    tension: 0.45,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: "#f7a0be",
                    pointBorderColor: "rgba(255,255,255,0.55)",
                    pointBorderWidth: 2,
                    borderWidth: 2.5,
                    spanGaps: false,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            animation: { duration: 900, easing: "easeInOutQuart" },
            layout: { padding: { top: 8, bottom: 4 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "rgba(14, 6, 28, 0.92)",
                    borderColor: "rgba(255,255,255,0.14)",
                    borderWidth: 1,
                    titleColor: "rgba(255,255,255,0.88)",
                    bodyColor: "rgba(255,255,255,0.65)",
                    padding: { x: 14, y: 10 },
                    cornerRadius: 14,
                    caretSize: 6,
                    callbacks: {
                        label(item) {
                            const v = item.raw;
                            if (v === null || v === undefined) return null;
                            return `  ${item.dataset.label}: ${MOOD_TOOLTIP[v] || v}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    border: { display: false },
                    grid: { color: "rgba(255,255,255,0.06)" },
                    ticks: {
                        color: "rgba(255,255,255,0.40)",
                        font: { size: 11, family: "Inter, sans-serif" },
                        maxRotation: 40,
                        autoSkip: true,
                        maxTicksLimit: 7,
                    },
                },
                y: {
                    min: 0.5,
                    max: 9.5,
                    border: { display: false },
                    grid: { color: "rgba(255,255,255,0.06)" },
                    ticks: {
                        color: "rgba(255,255,255,0.40)",
                        font: { size: 13 },
                        stepSize: 2,
                        callback(value) {
                            const map = { 1: "😫", 3: "😔", 5: "😐", 7: "😄", 9: "🥰" };
                            return map[value] || "";
                        },
                    },
                },
            },
        },
    });
}

// =============================================================
//  Partner-name resolution helper
// =============================================================

/**
 * Try to resolve the partner's display name via the accepted
 * pairing_requests row (both sender and receiver have RLS access to it).
 * Returns null if not found or the profile embed is blocked.
 */
async function _fetchPartnerNameViaRequest(userId, partnerId) {
    const { data } = await supabaseClient
        .from("pairing_requests")
        .select(
            "sender_id,receiver_id," +
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
//  Utilities
// =============================================================

function _checkTodayLogged(userId, logs14) {
    const ctaEl = document.getElementById("logMoodCta");
    if (!ctaEl) return;
    // UTC date comparison — consistent with how fetchCoupleLogsDirectly stores dates
    const todayStr    = new Date().toISOString().slice(0, 10);
    const loggedToday = logs14.some(l => l.userId === userId && l.date === todayStr);

    if (loggedToday) {
        ctaEl.innerHTML = '<span class="btn__icon">✓</span> Today\'s mood logged';
        ctaEl.classList.add("dash-cta--logged");
        ctaEl.removeAttribute("href");
    } else {
        ctaEl.innerHTML = '<span class="btn__icon">✨</span> Log Today\'s Mood';
        ctaEl.setAttribute("href", "mood.html");
        ctaEl.classList.remove("dash-cta--logged");
    }
}

function _shortDate(ds) {
    return new Date(ds + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
    });
}

function _escDash(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}
