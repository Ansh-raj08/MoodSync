// ============================================================
//  ui.js — Dashboard UI Connector
//  MoodSync · Bridges the data/algorithm layer with the DOM
//
//  Responsibilities:
//    1. Fetch couple data  →  couple.js  (getCouple)
//    2. Fetch mood logs    →  storage.js (getMoodHistory)
//    3. Run analytics      →  algorithm.js (MoodAlgorithm)
//    4. Paint dashboard    →  this file (render* functions)
//
//  NO calculation logic lives here.
//  NO storage reads/writes beyond the public module APIs.
//
//  How to activate:
//    Add to dashboard.html after algorithm.js + storage.js + couple.js:
//      <script src="js/storage.js"></script>
//      <script src="js/couple.js"></script>
//      <script src="js/algorithm.js"></script>
//      <script src="js/ui.js"></script>
//
//  Migration note:
//    This file targets the NEW data model (userId-based, 1–9 scale).
//    To complete the migration, setup.js must call createCouple() and
//    mood.js must call saveMood(userId, score) from storage.js.
// ============================================================

"use strict";

// ---- Mood display map (1–9 scale) ----
const UI_MOODS = {
    1: { label: "Very Bad",  emoji: "😫", color: "var(--clr-rose)"     },
    2: { label: "Very Bad",  emoji: "😫", color: "var(--clr-rose)"     },
    3: { label: "Bad",       emoji: "😔", color: "var(--clr-pink)"     },
    4: { label: "Bad",       emoji: "😔", color: "var(--clr-pink)"     },
    5: { label: "Neutral",   emoji: "😐", color: "var(--clr-teal)"     },
    6: { label: "Good",      emoji: "🙂", color: "var(--clr-mint)"     },
    7: { label: "Good",      emoji: "😄", color: "var(--clr-mint)"     },
    8: { label: "Great",     emoji: "🥰", color: "var(--clr-lavender)" },
    9: { label: "Great",     emoji: "🥰", color: "var(--clr-purple)"   },
};

const UI_TREND = {
    improving:    { icon: "📈", label: "Improving",       color: "var(--clr-mint)",           desc: "Your mood has been on the rise this week. Keep it up!" },
    stable:       { icon: "➖", label: "Stable",           color: "var(--clr-teal)",           desc: "Your mood has been consistent — steady emotional balance." },
    declining:    { icon: "📉", label: "Declining",        color: "var(--clr-rose)",           desc: "A dip in mood this week. Be kind to yourself." },
    insufficient: { icon: "⏳", label: "Not enough data",  color: "var(--clr-text-secondary)", desc: "Log at least 3 days this week to unlock trend analysis." },
};

// ============================================================
//  loadDashboard  — entry point called by DOMContentLoaded
// ============================================================

/**
 * Main dashboard loader.
 * Reads data, runs the algorithm, and paints every UI card.
 */
function loadDashboard() {

    // ── Step 1: Get couple data ──────────────────────────────
    const couple = getCouple();       // couple.js

    if (!couple) {
        // No couple set up — redirect to setup
        window.location.replace("setup.html");
        return;
    }

    const [userId, partnerId] = getUserIds();   // couple.js

    // ── Step 2: Fetch mood logs ──────────────────────────────
    const userLogs    = getMoodHistory(userId);         // storage.js
    const partnerLogs = getMoodHistory(partnerId);      // storage.js

    // ── Step 3: Run analytics ────────────────────────────────
    const algo   = new MoodAlgorithm(userLogs, partnerLogs);    // algorithm.js
    const result = algo.getHealthScore();
    const avg    = algo.calculateMoodAverage();

    // ── Step 4: Update dashboard cards ──────────────────────
    _renderHeader(couple);
    _toggleEmptyState(userLogs.length === 0);

    if (userLogs.length > 0) {
        _renderScoreCard(result.healthScore);
        _renderTrendCard(result.trend, userLogs);
        _renderConfidenceCard(result.confidence);
        _renderAverageCard(avg);
        _renderRecentLogs(userLogs);
    }
}

// ============================================================
//  Render helpers  (private — prefixed with _)
// ============================================================

function _renderHeader(couple) {
    const titleEl = document.getElementById("coupleTitle");
    const sinceEl = document.getElementById("coupleSince");
    if (!titleEl) return;

    // Support both { userA/userB } (new) and { userName/partnerName } (setup.js)
    const nameA = couple.userName  || couple.userA || "You";
    const nameB = couple.partnerName || couple.userB || "Partner";
    titleEl.textContent = `${nameA} & ${nameB}`;

    if (sinceEl && couple.createdAt) {
        const since = new Date(couple.createdAt + "T00:00:00");
        const days  = Math.floor((Date.now() - since.getTime()) / 86_400_000);
        sinceEl.textContent =
            `Together for ${days} day${days !== 1 ? "s" : ""} · since ` +
            since.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
}

function _toggleEmptyState(isEmpty) {
    const emptyEl = document.getElementById("dashEmpty");
    const gridEl  = document.getElementById("dashGrid");
    if (emptyEl) emptyEl.hidden = !isEmpty;
    if (gridEl)  gridEl.hidden  =  isEmpty;
}

// ---- Health Score card ----

function _renderScoreCard(score) {
    const numberEl = document.getElementById("scoreNumber");
    const circleEl = document.getElementById("scoreCircle");
    const descEl   = document.getElementById("scoreDesc");

    if (numberEl) numberEl.textContent = score;
    if (descEl)   descEl.textContent   = _scoreDescription(score);

    if (circleEl) {
        const CIRCUMFERENCE = 314;   // 2π × r(50)
        const offset  = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;
        const color   = score >= 70 ? "var(--clr-mint)"
                      : score >= 50 ? "var(--clr-lavender)"
                      : score >= 30 ? "var(--clr-pink)"
                      : "var(--clr-rose)";

        circleEl.style.stroke           = color;
        circleEl.style.strokeDashoffset = CIRCUMFERENCE;   // reset
        circleEl.style.transition       = "stroke-dashoffset 1.2s cubic-bezier(0.25,0.1,0.25,1), stroke 0.4s ease";

        requestAnimationFrame(() => requestAnimationFrame(() => {
            circleEl.style.strokeDashoffset = offset;
        }));
    }
}

function _scoreDescription(score) {
    if (score >= 85) return "Thriving 🥰 — your relationship is in great shape.";
    if (score >= 70) return "Healthy 💚 — things are going well overall.";
    if (score >= 50) return "Steady 💙 — some highs and lows, but balanced.";
    if (score >= 30) return "Needs attention 💛 — try to log more and connect.";
    return "Check in 🩷 — not enough data for a full picture yet.";
}

// ---- Trend card ----

function _renderTrendCard(trend, userLogs) {
    const meta    = UI_TREND[trend] || UI_TREND.insufficient;
    const iconEl  = document.getElementById("trendIcon");
    const labelEl = document.getElementById("trendLabel");
    const descEl  = document.getElementById("trendDesc");
    const barsEl  = document.getElementById("trendBars");

    if (iconEl)  iconEl.textContent  = meta.icon;
    if (labelEl) { labelEl.textContent = meta.label; labelEl.style.color = meta.color; }
    if (descEl)  descEl.textContent  = meta.desc;

    if (!barsEl) return;

    // Build a date-keyed lookup for fast access
    const byDate = {};
    userLogs.forEach(e => { byDate[e.date] = e; });

    barsEl.innerHTML = "";
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const d   = new Date(today);
        d.setDate(today.getDate() - i);
        const key   = d.toISOString().slice(0, 10);
        const entry = byDate[key];

        const bar = document.createElement("div");
        bar.className = "trend-bar";
        bar.setAttribute("title", entry
            ? `${_shortDate(key)}: ${UI_MOODS[entry.score]?.label ?? entry.score}`
            : `${_shortDate(key)}: no log`
        );

        if (entry) {
            const heightPct = ((entry.score - 1) / 8) * 100;    // 1–9 → 0–100%
            const color     = UI_MOODS[entry.score]?.color ?? "var(--clr-lavender)";
            bar.innerHTML   = `<div class="trend-bar__fill" style="height:${heightPct}%;background:${color};"></div>`;
        } else {
            bar.classList.add("trend-bar--empty");
        }

        barsEl.appendChild(bar);
    }
}

// ---- Confidence card ----

function _renderConfidenceCard(confidence) {
    const pct    = Math.round(confidence * 100);
    const numEl  = document.getElementById("confNumber");
    const barEl  = document.getElementById("confBarFill");
    const descEl = document.getElementById("confDesc");

    if (numEl)  numEl.textContent  = pct;
    if (descEl) descEl.textContent = pct >= 80 ? "High confidence — consistent logging streak."
                                   : pct >= 50 ? "Moderate confidence — keep logging daily."
                                   : pct >= 25 ? "Low confidence — more data needed."
                                   : "Very low — start logging regularly to unlock predictions.";

    if (barEl) {
        const color = pct >= 70 ? "var(--clr-mint)"
                    : pct >= 40 ? "var(--clr-lavender)"
                    : "var(--clr-pink)";
        barEl.style.background = color;
        barEl.style.width      = "0%";
        barEl.style.transition = "width 1s cubic-bezier(0.25,0.1,0.25,1)";
        requestAnimationFrame(() => requestAnimationFrame(() => {
            barEl.style.width = pct + "%";
        }));
    }
}

// ---- Average Mood card ----

function _renderAverageCard(avgNorm) {
    const emojiEl = document.getElementById("avgEmoji");
    const labelEl = document.getElementById("avgLabel");
    const descEl  = document.getElementById("avgDesc");

    if (avgNorm === null || avgNorm === undefined) {
        if (emojiEl) emojiEl.textContent = "—";
        if (labelEl) labelEl.textContent = "No data";
        return;
    }

    // Convert normalised 0–1 back to 1–9 scale for display lookup
    const raw     = Math.round(avgNorm * 8 + 1);
    const clamped = Math.max(1, Math.min(9, raw));
    const info    = UI_MOODS[clamped];

    if (emojiEl) emojiEl.textContent = info.emoji;
    if (labelEl) { labelEl.textContent = info.label; labelEl.style.color = info.color; }
    if (descEl)  descEl.textContent = `Your typical day scores ${clamped}/9 on the mood scale.`;
}

// ---- Recent Logs card ----

function _renderRecentLogs(userLogs) {
    const listEl = document.getElementById("logList");
    if (!listEl) return;

    // Last 5 entries, newest first
    const sorted = [...userLogs]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);

    if (!sorted.length) {
        listEl.innerHTML = `<li class="log-item log-item--empty">No entries logged yet.</li>`;
        return;
    }

    listEl.innerHTML = sorted.map(entry => {
        const info = UI_MOODS[entry.score] || UI_MOODS[5];
        return `
        <li class="log-item">
            <span class="log-item__emoji">${info.emoji}</span>
            <div class="log-item__body">
                <div class="log-item__top">
                    <span class="log-item__date">${_shortDate(entry.date)}</span>
                    <span class="log-item__mood" style="color:${info.color}">${info.label}</span>
                </div>
            </div>
        </li>`;
    }).join("");
}

// ============================================================
//  Utilities
// ============================================================

function _shortDate(dateStr) {
    return new Date(dateStr + "T00:00:00")
        .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ============================================================
//  Boot
// ============================================================

document.addEventListener("DOMContentLoaded", loadDashboard);
