// ============================================================
//  mood.js — Daily Mood Logging Logic
//  Saves entries to localStorage under key "moodSync_logs"
// ============================================================

const MOOD_LABELS = {
    1: { label: "Awful",   emoji: "😫" },
    2: { label: "Bad",     emoji: "😔" },
    3: { label: "Okay",    emoji: "😐" },
    4: { label: "Good",    emoji: "🙂" },
    5: { label: "Great",   emoji: "😄" },
    6: { label: "Amazing", emoji: "🥰" },
};

// ---------- Helpers ----------

function getTodayKey() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function getLogs() {
    try {
        return JSON.parse(localStorage.getItem("moodSync_logs") || "{}");
    } catch {
        return {};
    }
}

function saveLogs(logs) {
    localStorage.setItem("moodSync_logs", JSON.stringify(logs));
}

function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

// ---------- Initialise ----------

document.addEventListener("DOMContentLoaded", () => {

    const todayKey     = getTodayKey();
    const logs         = getLogs();
    const todayEntry   = logs[todayKey];

    // Elements
    const dateEl       = document.getElementById("todayDate");
    const moodForm     = document.getElementById("moodForm");
    const moodSection  = document.getElementById("moodSection");
    const moodSuccess  = document.getElementById("moodSuccess");
    const loggedBanner = document.getElementById("loggedBanner");
    const noteInput    = document.getElementById("moodNote");
    const charCount    = document.getElementById("charCount");

    // ---- Show today's date ----
    if (dateEl) {
        dateEl.textContent = formatDate(todayKey);
    }

    // ---- Already logged today? Show banner ----
    if (todayEntry && loggedBanner) {
        const info = MOOD_LABELS[todayEntry.mood] || MOOD_LABELS[3];
        document.getElementById("loggedEmoji").textContent  = info.emoji;
        document.getElementById("loggedLabel").textContent  = `Feeling ${info.label.toLowerCase()} today`;
        loggedBanner.hidden = false;
    }

    // ---- Character counter for note ----
    if (noteInput && charCount) {
        noteInput.addEventListener("input", () => {
            charCount.textContent = noteInput.value.length;
        });
    }

    // ---- Form submit ----
    if (moodForm) {
        moodForm.addEventListener("submit", (e) => {
            e.preventDefault();

            const formData = new FormData(moodForm);
            const moodValue = parseInt(formData.get("mood"), 10);
            const note = (noteInput ? noteInput.value.trim() : "") || "";

            if (!moodValue || !MOOD_LABELS[moodValue]) {
                highlightPicker();
                return;
            }

            // Build entry
            const entry = {
                mood: moodValue,
                note: note,
                timestamp: new Date().toISOString(),
            };

            // Save
            const allLogs = getLogs();
            allLogs[todayKey] = entry;
            saveLogs(allLogs);

            // Show success state
            showSuccess(moodValue);
        });
    }

    // ---------- Show success state ----------
    function showSuccess(moodValue) {
        const info = MOOD_LABELS[moodValue] || MOOD_LABELS[3];

        const successEmoji = document.getElementById("successEmoji");
        const successText  = document.getElementById("successText");

        if (successEmoji) successEmoji.textContent = info.emoji;
        if (successText)  successText.textContent  = `You're feeling ${info.label.toLowerCase()} today. Keep tracking to see your patterns.`;

        if (moodSection)  moodSection.hidden = true;
        if (loggedBanner) loggedBanner.hidden = true;
        if (moodSuccess)  moodSuccess.hidden = false;

        // Scroll to top of card
        moodSuccess.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // ---------- Highlight picker if no mood selected ----------
    function highlightPicker() {
        const picker = document.getElementById("moodPicker");
        if (!picker) return;
        picker.style.outline = "2px solid rgba(201, 140, 245, 0.5)";
        picker.style.borderRadius = "12px";
        picker.style.outlineOffset = "6px";
        setTimeout(() => {
            picker.style.outline = "";
            picker.style.outlineOffset = "";
        }, 1800);
        picker.scrollIntoView({ behavior: "smooth", block: "center" });
    }

});
