// ============================================================
//  login.js — Sign-In Form Validation
//  MoodSync · No server · localStorage-based auth simulation
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

    // ---- Elements ----
    const loginForm     = document.getElementById("loginForm");
    const emailInput    = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const emailError    = document.getElementById("emailError");
    const passwordError = document.getElementById("passwordError");
    const formError     = document.getElementById("formError");
    const loginBtn      = document.getElementById("loginBtn");
    const toggleBtn     = document.getElementById("togglePassword");
    const eyeIcon       = document.getElementById("eyeIcon");
    const forgotBtn     = document.getElementById("forgotBtn");

    if (!loginForm) return;

    // ---- Helpers ----

    function isValidEmail(val) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
    }

    function showFieldError(group, errorEl, message) {
        group.classList.add("form-group--error");
        errorEl.textContent = message;
        errorEl.hidden = false;
    }

    function clearFieldError(group, errorEl) {
        group.classList.remove("form-group--error");
        errorEl.hidden = true;
        errorEl.textContent = "";
    }

    function showFormError(message) {
        formError.textContent = message;
        formError.hidden = false;
        formError.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function clearFormError() {
        formError.hidden = true;
        formError.textContent = "";
    }

    function setLoading(state) {
        loginBtn.classList.toggle("is-loading", state);
        loginBtn.querySelector(".btn__icon").textContent = state ? "⏳" : "✨";
    }

    // ---- Live validation on blur ----

    emailInput.addEventListener("blur", () => {
        const val = emailInput.value.trim();
        if (!val) {
            showFieldError(
                document.getElementById("emailGroup"),
                emailError,
                "Email address is required."
            );
        } else if (!isValidEmail(val)) {
            showFieldError(
                document.getElementById("emailGroup"),
                emailError,
                "Please enter a valid email address."
            );
        } else {
            clearFieldError(document.getElementById("emailGroup"), emailError);
        }
    });

    emailInput.addEventListener("input", () => {
        clearFieldError(document.getElementById("emailGroup"), emailError);
        clearFormError();
    });

    passwordInput.addEventListener("blur", () => {
        if (!passwordInput.value) {
            showFieldError(
                document.getElementById("passwordGroup"),
                passwordError,
                "Password is required."
            );
        } else if (passwordInput.value.length < 6) {
            showFieldError(
                document.getElementById("passwordGroup"),
                passwordError,
                "Password must be at least 6 characters."
            );
        } else {
            clearFieldError(document.getElementById("passwordGroup"), passwordError);
        }
    });

    passwordInput.addEventListener("input", () => {
        clearFieldError(document.getElementById("passwordGroup"), passwordError);
        clearFormError();
    });

    // ---- Toggle password visibility ----

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            const isHidden = passwordInput.type === "password";
            passwordInput.type = isHidden ? "text" : "password";
            eyeIcon.textContent = isHidden ? "🙈" : "👁";
            toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        });
    }

    // ---- Forgot password ----

    if (forgotBtn) {
        forgotBtn.addEventListener("click", () => {
            // In a local-storage app, just show a friendly message
            showFormError("Password recovery is not available in local mode. Try checking your browser storage.");
        });
    }

    // ---- Form submit ----

    loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        clearFormError();

        const email    = emailInput.value.trim();
        const password = passwordInput.value;
        let valid = true;

        // Validate email
        if (!email) {
            showFieldError(document.getElementById("emailGroup"), emailError, "Email address is required.");
            valid = false;
        } else if (!isValidEmail(email)) {
            showFieldError(document.getElementById("emailGroup"), emailError, "Please enter a valid email address.");
            valid = false;
        } else {
            clearFieldError(document.getElementById("emailGroup"), emailError);
        }

        // Validate password
        if (!password) {
            showFieldError(document.getElementById("passwordGroup"), passwordError, "Password is required.");
            valid = false;
        } else if (password.length < 6) {
            showFieldError(document.getElementById("passwordGroup"), passwordError, "Password must be at least 6 characters.");
            valid = false;
        } else {
            clearFieldError(document.getElementById("passwordGroup"), passwordError);
        }

        if (!valid) return;

        // ---- Simulate auth ----
        setLoading(true);

        setTimeout(() => {
            setLoading(false);

            // Check stored credentials, or treat first login as auto-register.
            const storedEmail    = localStorage.getItem("moodSync_email");
            const storedPassword = localStorage.getItem("moodSync_password");

            if (!storedEmail && !storedPassword) {
                // First time — save credentials and log in
                localStorage.setItem("moodSync_email", email);
                localStorage.setItem("moodSync_password", password);
                localStorage.setItem("moodSync_loggedIn", "true");
                redirectAfterLogin();

            } else if (email === storedEmail && password === storedPassword) {
                // Correct credentials
                localStorage.setItem("moodSync_loggedIn", "true");
                redirectAfterLogin();

            } else {
                // Wrong credentials
                showFormError("Incorrect email or password. Please try again.");
                passwordInput.value = "";
                passwordInput.focus();
            }
        }, 800);
    });

    // ---- Redirect ----

    function redirectAfterLogin() {
        // If setup hasn't been done, go to setup first
        const couple = localStorage.getItem("moodSync_couple");
        if (!couple) {
            window.location.href = "setup.html";
        } else {
            window.location.href = "mood.html";
        }
    }

    // ---- Auto-redirect if already logged in ----

    if (localStorage.getItem("moodSync_loggedIn") === "true") {
        redirectAfterLogin();
    }

});
