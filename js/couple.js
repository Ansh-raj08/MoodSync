// ============================================================
//  couple.js — Relationship Setup Logic
//  Saves couple profile to localStorage and redirects to mood.html
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

    const setupForm    = document.getElementById("setupForm");
    const userNameInput    = document.getElementById("userName");
    const partnerNameInput = document.getElementById("partnerName");
    const startDateInput   = document.getElementById("startDate");

    if (!setupForm) return;

    // ---- If couple already set up, skip to mood page ----
    if (localStorage.getItem("moodSync_couple")) {
        window.location.href = "mood.html";
        return;
    }

    setupForm.addEventListener("submit", (e) => {
        e.preventDefault();

        const userName    = userNameInput.value.trim();
        const partnerName = partnerNameInput.value.trim();
        const startDate   = startDateInput.value;

        // Basic validation
        if (!userName || !partnerName || !startDate) return;

        // Save couple profile
        const couple = {
            userName,
            partnerName,
            startDate,
            createdAt: new Date().toISOString(),
        };

        localStorage.setItem("moodSync_couple", JSON.stringify(couple));

        // Redirect to mood logging page
        window.location.href = "mood.html";
    });

});
