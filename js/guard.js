// ============================================================
//  guard.js — First-Visit Protection
//  MoodSync · Shared route guard for protected pages
//
//  Include this script BEFORE other page scripts on any page
//  that requires setup to be completed (mood.html, dashboard.html).
//
//  Usage in HTML:
//    <script src="js/guard.js"></script>   ← add before page scripts
//
//  Future-ready:
//    – Swap localStorage check for an auth token/API check here
//      when a backend is introduced.
// ============================================================

(function () {
    "use strict";

    var SETUP_KEY      = "couple";
    var SETUP_PAGE     = "setup.html";
    var CURRENT_PAGE   = window.location.pathname.split("/").pop();

    // Don't redirect if we're already on the setup page
    if (CURRENT_PAGE === SETUP_PAGE) return;

    // Redirect to setup if couple profile is missing
    if (!localStorage.getItem(SETUP_KEY)) {
        window.location.replace(SETUP_PAGE);
    }
}());
