// ===============================
// Mobile Navbar Toggle
// ===============================

const hamburger = document.querySelector(".navbar__hamburger");
const navLinks = document.querySelector(".navbar__links");

if (hamburger && navLinks) {

    hamburger.addEventListener("click", () => {
        hamburger.classList.toggle("is-active");
        navLinks.classList.toggle("is-open");

        // Prevent page scroll when menu is open
        document.body.classList.toggle("menu-open");
    });

    // Close menu when a link is clicked
    const navItems = navLinks.querySelectorAll("a");

    navItems.forEach(link => {
        link.addEventListener("click", () => {
            hamburger.classList.remove("is-active");
            navLinks.classList.remove("is-open");
            document.body.classList.remove("menu-open");
        });
    });

}


// ===============================
// Navbar Scroll Effect
// ===============================

const navbar = document.querySelector(".navbar");

if (navbar) {
    let _scrollTicking = false;

    window.addEventListener("scroll", () => {
        if (_scrollTicking) return;
        _scrollTicking = true;

        requestAnimationFrame(() => {
            if (window.scrollY > 40) {
                navbar.classList.add("navbar--scrolled");
            } else {
                navbar.classList.remove("navbar--scrolled");
            }
            _scrollTicking = false;
        });
    }, { passive: true });

}


// ===============================
// Fade-In Animation on Scroll
// ===============================

if ("IntersectionObserver" in window) {

    const observerOptions = {
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries) => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);

            }

        });

    }, observerOptions);


    const fadeElements = document.querySelectorAll(
        ".glass-card, .section__header, .hero__inner, .cta__inner"
    );

    fadeElements.forEach(el => {
        el.classList.add("fade-target");
        observer.observe(el);
    });

}


// ===============================
// Project Discontinued Lock Screen
// ===============================

const MOODSYNC_DISCONTINUED_VERSION = "Discontinued 24 Apr 2026";

function updateDiscontinuedVersionText() {
    const settingsVersion = document.querySelector(".app-info__value");
    if (settingsVersion) {
        settingsVersion.textContent = MOODSYNC_DISCONTINUED_VERSION;
    }

    const fixedVersionLabels = document.querySelectorAll("body > div[style*='position:fixed'][style*='bottom:12px']");
    fixedVersionLabels.forEach(label => {
        label.textContent = MOODSYNC_DISCONTINUED_VERSION;
    });
}

function enableDiscontinuedMode() {
    if (window.__moodSyncDiscontinuedApplied) {
        return;
    }
    window.__moodSyncDiscontinuedApplied = true;

    updateDiscontinuedVersionText();

    const style = document.createElement("style");
    style.id = "moodsync-discontinued-style";
    style.textContent = `
        html.moodsync-discontinued,
        body.moodsync-discontinued {
            overflow: hidden !important;
        }

        #moodsync-discontinued-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: grid;
            place-items: center;
            padding: 1.25rem;
            background:
                radial-gradient(circle at 20% 20%, rgba(255, 92, 92, 0.2), transparent 45%),
                radial-gradient(circle at 80% 15%, rgba(255, 120, 120, 0.14), transparent 45%),
                linear-gradient(140deg, rgba(5, 8, 20, 0.96), rgba(24, 10, 12, 0.96));
            backdrop-filter: blur(4px);
        }

        .moodsync-discontinued-banner {
            width: min(760px, 100%);
            border: 1px solid rgba(255, 110, 110, 0.55);
            border-radius: 18px;
            padding: clamp(1.2rem, 3vw, 2rem);
            background: rgba(15, 18, 34, 0.92);
            box-shadow:
                0 24px 80px rgba(0, 0, 0, 0.58),
                0 0 0 1px rgba(255, 102, 102, 0.2) inset;
            color: #f9f3f3;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            text-align: left;
        }

        .moodsync-discontinued-tag {
            display: inline-block;
            margin-bottom: 0.75rem;
            padding: 0.35rem 0.75rem;
            border-radius: 999px;
            background: rgba(255, 89, 89, 0.15);
            border: 1px solid rgba(255, 89, 89, 0.48);
            color: #ffb5b5;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .moodsync-discontinued-title {
            margin: 0;
            font-size: clamp(1.6rem, 3.5vw, 2.25rem);
            line-height: 1.2;
            color: #ffffff;
        }

        .moodsync-discontinued-note {
            margin: 0.9rem 0 0;
            color: rgba(255, 235, 235, 0.9);
            font-size: clamp(0.95rem, 2.1vw, 1.05rem);
            line-height: 1.5;
        }

        .moodsync-discontinued-meta {
            margin-top: 1rem;
            color: rgba(255, 198, 198, 0.95);
            font-weight: 600;
            letter-spacing: 0.03em;
        }
    `;
    document.head.appendChild(style);

    document.documentElement.classList.add("moodsync-discontinued");
    document.body.classList.add("moodsync-discontinued");

    const overlay = document.createElement("div");
    overlay.id = "moodsync-discontinued-overlay";
    overlay.innerHTML = `
        <section class="moodsync-discontinued-banner" aria-live="polite" aria-label="Project Mood Sync status">
            <span class="moodsync-discontinued-tag">Final Status</span>
            <h1 class="moodsync-discontinued-title">Project Mood Sync Discontinued</h1>
            <p class="moodsync-discontinued-note">
                This project has reached its final state and is now permanently inactive.
            </p>
            <p class="moodsync-discontinued-meta">Date: 24 Apr 2026</p>
        </section>
    `;
    document.body.appendChild(overlay);

    const stopInteraction = event => {
        if (overlay.contains(event.target)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    };

    [
        "click",
        "dblclick",
        "contextmenu",
        "submit",
        "keydown",
        "keyup",
        "keypress",
        "pointerdown",
        "pointerup",
        "touchstart",
        "touchend"
    ].forEach(eventName => {
        document.addEventListener(eventName, stopInteraction, true);
    });

    const interactiveElements = document.querySelectorAll("a, button, input, select, textarea, summary, [contenteditable], [tabindex]");
    interactiveElements.forEach(element => {
        if (element.closest("#moodsync-discontinued-overlay")) {
            return;
        }

        if ("disabled" in element) {
            element.disabled = true;
        }

        if (element.tagName === "A") {
            element.removeAttribute("href");
        }

        element.setAttribute("aria-disabled", "true");
        element.setAttribute("tabindex", "-1");
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enableDiscontinuedMode);
} else {
    enableDiscontinuedMode();
}