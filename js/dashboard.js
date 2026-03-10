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

        // Header
        _renderHeader(uProfile, pProfile);

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
        _renderAverageCard(v1.average, v1.partnerAverage);
        _renderMoodDiffCard(v1.moodDiff);
        _renderRecentLogs(uLogs14, pLogs14, uProfile, pProfile);

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

// ---- Recent logs — glass card grid ----
function _renderRecentLogs(uLogs, pLogs, uProfile, pProfile) {
    const containerEl = document.getElementById("logCards");
    if (!containerEl) return;

    const combined = [
        ...uLogs.map(l => ({ ...l, name: uProfile?.name || "You",     isUser: true })),
        ...pLogs.map(l => ({ ...l, name: pProfile?.name || "Partner", isUser: false })),
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
