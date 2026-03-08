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
//  Main Loader
// =============================================================

async function loadDashboard(user, couple) {
    const gridEl  = document.getElementById("dashGrid");
    const emptyEl = document.getElementById("dashEmpty");
    if (gridEl)  gridEl.hidden  = true;
    if (emptyEl) emptyEl.hidden = true;

    try {
        const partnerId = getPartnerId(couple, user.id);

        // Parallel fetch: 7-day + all-time for both users + profiles
        const [uLogs7, pLogs7, uLogsAll, pLogsAll, uProfile, pProfile] = await Promise.all([
            getMoodHistory(user.id, 7),
            getMoodHistory(partnerId, 7),
            getMoodHistory(user.id),
            getMoodHistory(partnerId),
            getProfile(user.id),
            getProfile(partnerId),
        ]);

        // Header
        _renderHeader(uProfile, pProfile);

        // Empty state
        if (uLogsAll.length === 0) {
            if (emptyEl) emptyEl.hidden = false;
            return;
        }

        if (gridEl) gridEl.hidden = false;

        // Algorithm — full history for stable averages
        const result = calculateHealthScore(uLogsAll, pLogsAll);

        // Render cards
        _renderScoreCard(result.healthScore);
        _renderTrendCard(result.trend, uLogs7);
        _renderConfidenceCard(result.confidence);
        _renderAverageCard(result.average, result.partnerAverage);
        _renderMoodDiffCard(result.moodDiff);
        _renderRecentLogs(uLogs7, pLogs7, uProfile, pProfile);

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

function _renderHeader(uProfile, pProfile) {
    const titleEl = document.getElementById("coupleTitle");
    const subEl   = document.getElementById("coupleSince");

    if (titleEl) {
        titleEl.textContent = `${uProfile?.name || "You"} & ${pProfile?.name || "Partner"}`;
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
        const color = score >= 70 ? "var(--clr-mint)"
                    : score >= 50 ? "var(--clr-lavender)"
                    : score >= 30 ? "var(--clr-pink)"
                    : "var(--clr-rose)";

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
function _renderAverageCard(userAvg, partnerAvg) {
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
        let desc = `Your average mood is ${userAvg}/9.`;
        if (partnerAvg !== null) desc += ` Partner: ${partnerAvg}/9.`;
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

// ---- Recent logs (combined view) ----
function _renderRecentLogs(uLogs, pLogs, uProfile, pProfile) {
    const listEl = document.getElementById("logList");
    if (!listEl) return;

    const combined = [
        ...uLogs.map(l => ({ ...l, name: uProfile?.name || "You",     isUser: true })),
        ...pLogs.map(l => ({ ...l, name: pProfile?.name || "Partner", isUser: false })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

    if (!combined.length) {
        listEl.innerHTML = '<li class="log-item log-item--empty">No entries yet.</li>';
        return;
    }

    listEl.innerHTML = combined.map(e => {
        const info  = MOOD_MAP[e.score] || MOOD_MAP[5];
        const badge = e.isUser ? "" : '<span class="log-item__partner">Partner</span>';
        return `
        <li class="log-item">
            <span class="log-item__emoji">${info.emoji}</span>
            <div class="log-item__body">
                <div class="log-item__top">
                    <span class="log-item__date">${_shortDate(e.date)}</span>
                    <span class="log-item__mood" style="color:${info.color}">${info.label}</span>
                    ${badge}
                </div>
                <span class="log-item__name">${_escDash(e.name)}</span>
            </div>
        </li>`;
    }).join("");
}

// =============================================================
//  Utilities
// =============================================================

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
