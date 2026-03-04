// ============================================================
//  dashboard.js — Loads data, calls algorithm.js, updates DOM
//  MoodSync · No calculation logic lives here
// ============================================================

// Mood label lookup (1–6 scale, matching mood.js)
const DASH_MOODS = {
    1: { label: "Awful",   emoji: "😫", color: "var(--clr-rose)" },
    2: { label: "Bad",     emoji: "😔", color: "var(--clr-pink)" },
    3: { label: "Okay",    emoji: "😐", color: "var(--clr-teal)" },
    4: { label: "Good",    emoji: "🙂", color: "var(--clr-mint)" },
    5: { label: "Great",   emoji: "😄", color: "var(--clr-lavender)" },
    6: { label: "Amazing", emoji: "🥰", color: "var(--clr-purple)" },
};

const TREND_META = {
    improving:    { icon: "📈", label: "Improving",    color: "var(--clr-mint)",     desc: "Your mood has been on the rise this week. Keep it up!" },
    stable:       { icon: "➖", label: "Stable",        color: "var(--clr-teal)",     desc: "Your mood has been consistent — steady emotional balance." },
    declining:    { icon: "📉", label: "Declining",    color: "var(--clr-rose)",     desc: "A dip in mood this week. Be kind to yourself." },
    insufficient: { icon: "⏳", label: "Not enough data", color: "var(--clr-text-secondary)", desc: "Log at least 3 days this week to unlock trend analysis." },
};

function getScoreDesc(score) {
    if (score >= 85) return "Thriving 🥰 — your relationship is in great shape.";
    if (score >= 70) return "Healthy 💚 — things are going well overall.";
    if (score >= 50) return "Steady 💙 — some highs and lows, but balanced.";
    if (score >= 30) return "Needs attention 💛 — try to log more and connect.";
    return "Check in 🩷 — not enough data for a full picture yet.";
}

function formatDisplayDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ---- Main init ----

document.addEventListener("DOMContentLoaded", () => {

    // 1. Load data
    const logs    = getMoodHistory();        // from algorithm.js
    const couple  = getCoupleProfile();      // from algorithm.js
    const entries = Object.keys(logs);

    // 2. Populate couple header
    renderCoupleHeader(couple);

    // 3. No data state
    if (entries.length === 0) {
        document.getElementById("dashEmpty").hidden = false;
        document.getElementById("dashGrid").hidden  = true;
        return;
    }

    document.getElementById("dashEmpty").hidden = true;
    document.getElementById("dashGrid").hidden  = false;

    // 4. Run algorithm (all calc logic in algorithm.js)
    const result = calculateHealthScore(logs);

    // 5. Update UI
    renderScoreCard(result.score);
    renderTrendCard(result.trend, logs);
    renderConfidenceCard(result.confidence);
    renderAverageCard(result.average);
    renderRecentLogs(logs);
});

// ---- Render functions (UI only) ----

function renderCoupleHeader(couple) {
    const titleEl = document.getElementById("coupleTitle");
    const sinceEl = document.getElementById("coupleSince");

    if (!couple) return;

    titleEl.textContent = `${couple.userName} & ${couple.partnerName}`;

    if (couple.startDate) {
        const start = new Date(couple.startDate + "T00:00:00");
        const now   = new Date();
        const days  = Math.floor((now - start) / (1000 * 60 * 60 * 24));
        sinceEl.textContent = `Together for ${days} day${days !== 1 ? "s" : ""} · since ${start.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
    }
}

function renderScoreCard(score) {
    const numberEl = document.getElementById("scoreNumber");
    const circleEl = document.getElementById("scoreCircle");
    const descEl   = document.getElementById("scoreDesc");

    numberEl.textContent = score;
    descEl.textContent   = getScoreDesc(score);

    // Animate the SVG ring
    const circumference = 314; // 2π × 50
    const offset = circumference - (score / 100) * circumference;

    // Colour the ring based on score
    const color = score >= 70 ? "var(--clr-mint)"
                : score >= 50 ? "var(--clr-lavender)"
                : score >= 30 ? "var(--clr-pink)"
                : "var(--clr-rose)";

    circleEl.style.stroke            = color;
    circleEl.style.strokeDashoffset  = circumference; // start hidden
    circleEl.style.transition        = "stroke-dashoffset 1.2s cubic-bezier(0.25, 0.1, 0.25, 1), stroke 0.4s ease";

    // Trigger animation after paint
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            circleEl.style.strokeDashoffset = offset;
        });
    });
}

function renderTrendCard(trend, logs) {
    const meta    = TREND_META[trend] || TREND_META.insufficient;
    const iconEl  = document.getElementById("trendIcon");
    const labelEl = document.getElementById("trendLabel");
    const descEl  = document.getElementById("trendDesc");
    const barsEl  = document.getElementById("trendBars");

    iconEl.textContent  = meta.icon;
    labelEl.textContent = meta.label;
    labelEl.style.color = meta.color;
    descEl.textContent  = meta.desc;

    // Build mini bar chart for last 7 days
    const today  = new Date();
    barsEl.innerHTML = "";

    for (let i = 6; i >= 0; i--) {
        const d   = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const entry = logs[key];

        const bar = document.createElement("div");
        bar.className = "trend-bar";
        bar.setAttribute("title", entry
            ? `${formatDisplayDate(key)}: ${DASH_MOODS[entry.mood]?.label ?? entry.mood}`
            : formatDisplayDate(key) + ": no log"
        );

        if (entry) {
            const heightPct = ((entry.mood - 1) / 5) * 100;
            const color     = DASH_MOODS[entry.mood]?.color ?? "var(--clr-lavender)";
            bar.innerHTML = `<div class="trend-bar__fill" style="height:${heightPct}%; background:${color};"></div>`;
        } else {
            bar.classList.add("trend-bar--empty");
        }

        barsEl.appendChild(bar);
    }
}

function renderConfidenceCard(confidence) {
    const numEl  = document.getElementById("confNumber");
    const barEl  = document.getElementById("confBarFill");
    const descEl = document.getElementById("confDesc");

    numEl.textContent = confidence;

    const desc = confidence >= 80 ? "High confidence — consistent logging streak."
               : confidence >= 50 ? "Moderate confidence — keep logging daily."
               : confidence >= 25 ? "Low confidence — more data needed."
               : "Very low — start logging regularly to unlock predictions.";

    descEl.textContent = desc;

    // Colour the bar
    const color = confidence >= 70 ? "var(--clr-mint)"
                : confidence >= 40 ? "var(--clr-lavender)"
                : "var(--clr-pink)";

    // Animate
    barEl.style.width      = "0%";
    barEl.style.background = color;
    barEl.style.transition = "width 1s cubic-bezier(0.25, 0.1, 0.25, 1)";

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            barEl.style.width = confidence + "%";
        });
    });
}

function renderAverageCard(avgValue) {
    const emojiEl = document.getElementById("avgEmoji");
    const labelEl = document.getElementById("avgLabel");
    const descEl  = document.getElementById("avgDesc");

    if (!avgValue) {
        emojiEl.textContent = "—";
        labelEl.textContent = "No data";
        return;
    }

    const clamped = Math.min(6, Math.max(1, Math.round(avgValue)));
    const info    = DASH_MOODS[clamped];

    emojiEl.textContent = info.emoji;
    labelEl.textContent = info.label;
    labelEl.style.color = info.color;
    descEl.textContent  = `Your typical day scores ${clamped}/6 on the mood scale.`;
}

function renderRecentLogs(logs) {
    const listEl = document.getElementById("logList");

    // Get last 5 entries sorted newest first
    const sorted = Object.entries(logs)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 5);

    if (!sorted.length) {
        listEl.innerHTML = `<li class="log-item log-item--empty">No entries logged yet.</li>`;
        return;
    }

    listEl.innerHTML = sorted.map(([date, entry]) => {
        const info  = DASH_MOODS[entry.mood] || DASH_MOODS[3];
        const note  = entry.note ? `<span class="log-item__note">${escapeHtml(entry.note)}</span>` : "";
        return `
        <li class="log-item">
            <span class="log-item__emoji">${info.emoji}</span>
            <div class="log-item__body">
                <div class="log-item__top">
                    <span class="log-item__date">${formatDisplayDate(date)}</span>
                    <span class="log-item__mood" style="color:${info.color}">${info.label}</span>
                </div>
                ${note}
            </div>
        </li>`;
    }).join("");
}

// ---- Utility ----

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
