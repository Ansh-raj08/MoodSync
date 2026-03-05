// ============================================================
//  create-account.js — Account Registration Logic
//  MoodSync · Handles signup form, localStorage user storage,
//  and redirect to mood.html on success.
//
//  localStorage keys used:
//    "users"       → array of registered user objects
//    "currentUser" → userId string of the active session
//
//  User object shape:
//    { userId: "user_123456", name: "Ansh", email: "ansh@example.com" }
// ============================================================

// ---- DOM references ----

var form          = document.getElementById("signupForm");
var nameInput     = document.getElementById("signupName");
var emailInput    = document.getElementById("signupEmail");
var passwordInput = document.getElementById("signupPassword");
var signupBtn     = document.getElementById("signupBtn");
var toggleBtn     = document.getElementById("togglePassword");
var eyeIcon       = document.getElementById("eyeIcon");

// ============================================================
//  Helpers
// ============================================================

/**
 * Read the users array from localStorage.
 * Always returns an array — never throws.
 * @returns {Array}
 */
function getUsers() {
    try {
        var raw = localStorage.getItem("users");
        var parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

/**
 * Save the users array back to localStorage.
 * @param {Array} users
 */
function saveUsers(users) {
    localStorage.setItem("users", JSON.stringify(users));
}

/**
 * Generate a unique user ID using the current timestamp.
 * Example: "user_1741182600000"
 * @returns {string}
 */
function generateUserId() {
    return "user_" + Date.now();
}

/**
 * Basic email format check.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
    // Simple regex: must have characters, @, domain, and TLD
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
//  Validation helpers — show / hide field errors
// ============================================================

/**
 * Show an error message under a specific field.
 * @param {string} groupId   - ID of the form-group wrapper element
 * @param {string} errorId   - ID of the <p class="field-error"> element
 * @param {string} message   - Text to display
 */
function showFieldError(groupId, errorId, message) {
    var group = document.getElementById(groupId);
    var error = document.getElementById(errorId);

    if (group) group.classList.add("form-group--error");
    if (error) {
        error.textContent = message;
        error.hidden = false;
    }
}

/**
 * Clear the error state for a specific field.
 * @param {string} groupId
 * @param {string} errorId
 */
function clearFieldError(groupId, errorId) {
    var group = document.getElementById(groupId);
    var error = document.getElementById(errorId);

    if (group) group.classList.remove("form-group--error");
    if (error) {
        error.textContent = "";
        error.hidden = true;
    }
}

/**
 * Show the global error banner at the top of the form.
 * @param {string} message
 */
function showFormError(message) {
    var banner = document.getElementById("formError");
    if (banner) {
        banner.textContent = message;
        banner.hidden = false;
    }
}

/** Hide the global error banner. */
function hideFormError() {
    var banner = document.getElementById("formError");
    if (banner) banner.hidden = true;
}

// ============================================================
//  Validate all fields — returns true if everything is OK
// ============================================================

/**
 * Run validation on all three fields.
 * Shows inline errors and returns false if anything is invalid.
 * @returns {boolean}
 */
function validateForm() {
    var valid = true;

    // Clear previous errors
    clearFieldError("nameGroup", "nameError");
    clearFieldError("emailGroup", "emailError");
    clearFieldError("passwordGroup", "passwordError");
    hideFormError();

    // --- Name ---
    var name = nameInput.value.trim();
    if (!name) {
        showFieldError("nameGroup", "nameError", "Please enter your name.");
        valid = false;
    } else if (name.length < 2) {
        showFieldError("nameGroup", "nameError", "Name must be at least 2 characters.");
        valid = false;
    }

    // --- Email ---
    var email = emailInput.value.trim().toLowerCase();
    if (!email) {
        showFieldError("emailGroup", "emailError", "Please enter your email address.");
        valid = false;
    } else if (!isValidEmail(email)) {
        showFieldError("emailGroup", "emailError", "Please enter a valid email address.");
        valid = false;
    } else {
        // Check for duplicate email in existing users
        var users = getUsers();
        var alreadyExists = users.some(function (u) {
            return u.email.toLowerCase() === email;
        });
        if (alreadyExists) {
            showFieldError("emailGroup", "emailError", "An account with this email already exists.");
            valid = false;
        }
    }

    // --- Password ---
    var password = passwordInput.value;
    if (!password) {
        showFieldError("passwordGroup", "passwordError", "Please enter a password.");
        valid = false;
    } else if (password.length < 6) {
        showFieldError("passwordGroup", "passwordError", "Password must be at least 6 characters.");
        valid = false;
    }

    return valid;
}

// ============================================================
//  Submit handler
// ============================================================

/**
 * Handle form submission:
 * 1. Validate inputs
 * 2. Create user object and save to localStorage
 * 3. Set currentUser session
 * 4. Redirect to mood.html
 */
function handleSubmit(event) {
    // Stop the page from reloading
    event.preventDefault();

    // Run validation — stop here if anything fails
    if (!validateForm()) return;

    // Gather clean values
    var name     = nameInput.value.trim();
    var email    = emailInput.value.trim().toLowerCase();
    var userId   = generateUserId();

    // Build the new user object
    var newUser = {
        userId: userId,
        name:   name,
        email:  email
        // Note: passwords are NOT stored in localStorage in this MVP.
        // In the full version, use bcrypt on the server side.
    };

    // Load existing users, add the new one, and save
    var users = getUsers();
    users.push(newUser);
    saveUsers(users);

    // Save the active session
    localStorage.setItem("currentUser", userId);

    // Visual feedback — show loading state on the button
    setButtonLoading(true);

    // Redirect to mood logging page after a short delay
    setTimeout(function () {
        window.location.href = "mood.html";
    }, 700);
}

// ============================================================
//  Password show / hide toggle
// ============================================================

function handlePasswordToggle() {
    var isPassword = passwordInput.type === "password";

    // Flip the input type
    passwordInput.type = isPassword ? "text" : "password";

    // Update the eye icon
    eyeIcon.textContent = isPassword ? "🙈" : "👁";
}

// ============================================================
//  Button loading state
// ============================================================

function setButtonLoading(loading) {
    if (!signupBtn) return;
    signupBtn.disabled = loading;

    var iconEl = signupBtn.querySelector(".btn__icon");

    if (loading) {
        signupBtn.classList.add("btn--loading");
        if (iconEl) iconEl.textContent = "⏳";
    } else {
        signupBtn.classList.remove("btn--loading");
        if (iconEl) iconEl.textContent = "✨";
    }
}

// ============================================================
//  Live validation — clear error as user types
// ============================================================

function attachLiveValidation() {
    // Clear name error while typing
    if (nameInput) {
        nameInput.addEventListener("input", function () {
            clearFieldError("nameGroup", "nameError");
        });
    }

    // Clear email error while typing
    if (emailInput) {
        emailInput.addEventListener("input", function () {
            clearFieldError("emailGroup", "emailError");
        });
    }

    // Clear password error while typing
    if (passwordInput) {
        passwordInput.addEventListener("input", function () {
            clearFieldError("passwordGroup", "passwordError");
        });
    }
}

// ============================================================
//  Boot — wire everything up after the page loads
// ============================================================

document.addEventListener("DOMContentLoaded", function () {

    // Guard: make sure the form exists on this page
    if (!form) return;

    // Attach submit handler
    form.addEventListener("submit", handleSubmit);

    // Attach password toggle
    if (toggleBtn) {
        toggleBtn.addEventListener("click", handlePasswordToggle);
    }

    // Attach live validation (clears errors as user types)
    attachLiveValidation();
});
