// ============================================================
//  setup.js — Couple Setup Feature
//  MoodSync · Captures, validates, and persists relationship data
//
//  Storage key: "couple"  (localStorage)
//  Data shape:
//    {
//      userName:    string,   // Required · min 2 chars
//      partnerName: string,   // Required · min 2 chars
//      startDate:   string,   // Optional · "YYYY-MM-DD" or ""
//      createdAt:   string,   // ISO date string, set on first save
//      version:     number    // Schema version for future migrations
//    }
//
//  Future-ready:
//    – version field supports schema migrations
//    – Designed to swap localStorage for API calls (PostgreSQL)
//    – partnerCode field reserved for partner-invite system
// ============================================================

// ---- Constants ----

const STORAGE_KEY   = "couple";
const REDIRECT_PATH = "mood.html";
const MIN_NAME_LEN  = 2;
const MAX_NAME_LEN  = 50;

// ---- DOM references (resolved after DOMContentLoaded) ----

let form;
let userNameInput;
let partnerNameInput;
let startDateInput;
let submitBtn;

// ============================================================
//  Validation
// ============================================================

/**
 * Validate a name field.
 * @param {string} value - Raw input string
 * @returns {{ valid: boolean, message: string }}
 */
function validateName(value) {
    const trimmed = value.trim();

    if (!trimmed) {
        return { valid: false, message: "This field is required." };
    }
    if (trimmed.length < MIN_NAME_LEN) {
        return { valid: false, message: `Must be at least ${MIN_NAME_LEN} characters.` };
    }
    if (trimmed.length > MAX_NAME_LEN) {
        return { valid: false, message: `Must be ${MAX_NAME_LEN} characters or fewer.` };
    }
    // Disallow purely numeric names
    if (/^\d+$/.test(trimmed)) {
        return { valid: false, message: "Please enter a real name." };
    }

    return { valid: true, message: "" };
}

/**
 * Display or clear a validation error for a field.
 * @param {string} fieldId   - "userName" | "partnerName"
 * @param {string} message   - Error text ("" clears the error)
 */
function setFieldError(fieldId, message) {
    const input    = document.getElementById(fieldId);
    const errorEl  = document.getElementById("err-" + fieldId);
    const groupEl  = document.getElementById("group-" + fieldId);

    if (!input || !errorEl) return;

    if (message) {
        input.classList.add("form-input--error");
        errorEl.textContent = message;
        if (groupEl) groupEl.classList.add("form-group--error");
    } else {
        input.classList.remove("form-input--error");
        errorEl.textContent = "";
        if (groupEl) groupEl.classList.remove("form-group--error");
    }
}

/**
 * Run full validation on both name fields.
 * @returns {boolean} True if all required fields are valid.
 */
function validateForm() {
    const userResult    = validateName(userNameInput.value);
    const partnerResult = validateName(partnerNameInput.value);

    setFieldError("userName",    userResult.message);
    setFieldError("partnerName", partnerResult.message);

    return userResult.valid && partnerResult.valid;
}

// ============================================================
//  Storage — abstracted for easy backend swap later
// ============================================================

/**
 * Persist couple data to localStorage.
 * Replace this function body to integrate a REST API.
 * @param {Object} coupleData
 */
function saveCouple(coupleData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(coupleData));
}

/**
 * Read couple data from localStorage.
 * @returns {Object|null}
 */
function loadCouple() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
        return null;
    }
}

// ============================================================
//  Prefill — restore existing data if user revisits setup
// ============================================================

function prefillForm() {
    const existing = loadCouple();
    if (!existing) return;

    if (userNameInput && existing.userName) {
        userNameInput.value = existing.userName;
    }
    if (partnerNameInput && existing.partnerName) {
        partnerNameInput.value = existing.partnerName;
    }
    if (startDateInput && existing.startDate) {
        startDateInput.value = existing.startDate;
    }

    // Update button label to indicate an edit
    if (submitBtn) {
        submitBtn.querySelector(".btn__text") &&
            (submitBtn.querySelector(".btn__text").textContent = "Update & Continue");
    }
}

// ============================================================
//  Submit handler
// ============================================================

function handleSubmit(event) {
    event.preventDefault();

    if (!validateForm()) return;

    // Build the couple object
    const existing  = loadCouple();
    const today     = new Date().toISOString().slice(0, 10);

    /** @type {CoupleProfile} */
    const couple = {
        userName:    userNameInput.value.trim(),
        partnerName: partnerNameInput.value.trim(),
        startDate:   startDateInput.value || "",   // Optional
        createdAt:   existing?.createdAt || today, // Preserve original creation date
        version:     1,                            // Schema version — increment on breaking changes
        // partnerCode: null  ← reserved for future partner-invite feature
    };

    // Persist
    saveCouple(couple);

    // Visual feedback before redirect
    setSubmitLoading(true);

    // Redirect after brief delay so the user sees the transition
    setTimeout(() => {
        window.location.href = REDIRECT_PATH;
    }, 600);
}

// ---- Loading state on submit button ----

function setSubmitLoading(loading) {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    const iconEl = submitBtn.querySelector(".btn__icon");
    if (loading) {
        submitBtn.classList.add("btn--loading");
        if (iconEl) iconEl.textContent = "⏳";
    } else {
        submitBtn.classList.remove("btn--loading");
        if (iconEl) iconEl.textContent = "✨";
    }
}

// ============================================================
//  Live validation — clears error as user types
// ============================================================

function attachLiveValidation() {
    ["userName", "partnerName"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;

        input.addEventListener("input", () => {
            // Only clear error; full re-validate on blur
            if (input.classList.contains("form-input--error")) {
                const result = validateName(input.value);
                if (result.valid) setFieldError(id, "");
            }
        });

        input.addEventListener("blur", () => {
            const result = validateName(input.value);
            setFieldError(id, result.message);
        });
    });
}

// ============================================================
//  Boot
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

    // Resolve DOM refs
    form             = document.getElementById("setupForm");
    userNameInput    = document.getElementById("userName");
    partnerNameInput = document.getElementById("partnerName");
    startDateInput   = document.getElementById("startDate");
    submitBtn        = document.getElementById("setupSubmitBtn");

    // Guard: all required elements must exist
    if (!form || !userNameInput || !partnerNameInput) return;

    // Set max date for startDate to today (no future relationships yet)
    if (startDateInput) {
        startDateInput.max = new Date().toISOString().slice(0, 10);
    }

    prefillForm();
    attachLiveValidation();

    form.addEventListener("submit", handleSubmit);
});
