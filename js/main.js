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

    window.addEventListener("scroll", () => {

        if (window.scrollY > 40) {
            navbar.classList.add("navbar--scrolled");
        } else {
            navbar.classList.remove("navbar--scrolled");
        }

    });

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