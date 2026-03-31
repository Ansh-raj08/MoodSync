// =============================================================
//  settings.js — Relationship Settings
//  MoodSync · Dissolution UI and relationship management
//
//  Dependencies: supabaseClient.js, auth.js, data.js
//
//  Features:
//    - Display relationship info (partner name, paired since)
//    - Dissolution initiation with strong confirmation
//    - Cancel dissolution during grace period
//    - Typed confirmation: "dissolve relationship"
// =============================================================

"use strict";

// Track if modal listeners are already attached (prevent duplicates)
let modalListenersAttached = false;

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "settings.html") return;

    const ctx = await requireCouple();
    if (!ctx) return;

    await initSettingsPage(ctx);

    // Logout buttons - cleanup subscriptions before signing out
    const logoutBtn = document.getElementById("logoutBtn");
    const logoutBtnMain = document.getElementById("logoutBtnMain");
    
    const handleLogout = (e) => {
        e.preventDefault();
        e.stopPropagation();
        unsubscribeAll();
        signOut();
    };
    
    if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
    if (logoutBtnMain) logoutBtnMain.addEventListener("click", handleLogout);
});

async function initSettingsPage(ctx) {
    const { user, couple, dissolutionStatus } = ctx;

    // Load partner data
    const partnerData = await getPartnerData();
    const partnerNameEl = document.getElementById("partnerName");
    if (partnerNameEl) {
        partnerNameEl.textContent = partnerData?.partnerName || "Your Partner";
    }

    // Format paired since date
    const pairedSinceEl = document.getElementById("pairedSince");
    if (pairedSinceEl && couple.created_at) {
        const pairedDate = new Date(couple.created_at);
        pairedSinceEl.textContent = pairedDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    // Initialize location sharing toggle
    await initLocationSharingToggle();

    // Check if dissolution banner should show
    if (typeof checkAndShowDissolutionBanner === "function") {
        await checkAndShowDissolutionBanner();
    }

    // If dissolution is pending, show different UI in danger zone
    if (dissolutionStatus?.isPending) {
        showDissolutionPending(dissolutionStatus);
        return;
    }

    // Wire up dissolve button and modal
    wireupDissolveModal();
}

// =============================================================
//  Location Sharing Toggle
// =============================================================

async function initLocationSharingToggle() {
    const toggle = document.getElementById("locationSharingToggle");
    if (!toggle) return;

    // Load current sharing status
    try {
        const myLocation = await getMyLocation();
        toggle.checked = myLocation?.sharing_enabled ?? false;
    } catch (err) {
        console.error("[settings] Failed to load location status:", err);
        toggle.checked = false;
    }

    // Handle toggle change
    toggle.addEventListener("change", async () => {
        const enabled = toggle.checked;

        try {
            if (enabled) {
                // Need to get location permission and update location
                if (!isGeolocationSupported()) {
                    alert("Your browser doesn't support geolocation.");
                    toggle.checked = false;
                    return;
                }

                // Get current location (will trigger permission prompt)
                const position = await getCurrentLocation();

                // Save location with sharing enabled
                await updateMyLocation(
                    position.latitude,
                    position.longitude,
                    position.accuracy,
                    true
                );

                console.log("[settings] Location sharing enabled");
            } else {
                // Disable sharing
                await toggleLocationSharing(false);
                console.log("[settings] Location sharing disabled");
            }
        } catch (err) {
            console.error("[settings] Location toggle failed:", err);
            toggle.checked = !enabled; // Revert toggle

            if (err.message.includes("permission")) {
                alert("Location permission denied. Please enable location access in your browser settings.");
            } else {
                alert("Failed to update location sharing: " + err.message);
            }
        }
    });
}

function wireupDissolveModal() {
    // Prevent duplicate listeners
    if (modalListenersAttached) return;
    
    const dissolveBtn = document.getElementById("dissolveBtn");
    const modal = document.getElementById("dissolveModal");
    const modalOverlay = document.getElementById("modalOverlay");
    const modalCancelBtn = document.getElementById("modalCancelBtn");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const confirmInput = document.getElementById("confirmInput");
    const modalConfirmBtn = document.getElementById("modalConfirmBtn");

    if (!dissolveBtn || !modal) return;

    // Close modal function - NO navigation, only hide modal
    const closeModal = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        modal.hidden = true;
        if (confirmInput) {
            confirmInput.value = "";
        }
        if (modalConfirmBtn) {
            modalConfirmBtn.disabled = true;
        }
    };

    // Open modal
    dissolveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.hidden = false;
        if (confirmInput) {
            confirmInput.value = "";
        }
        if (modalConfirmBtn) {
            modalConfirmBtn.disabled = true;
        }
        setTimeout(() => confirmInput?.focus(), 100);
    });

    // Close modal handlers - ONLY close modal, NO navigation
    if (modalCancelBtn) {
        modalCancelBtn.addEventListener("click", closeModal);
    }
    
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener("click", closeModal);
    }
    
    if (modalOverlay) {
        modalOverlay.addEventListener("click", closeModal);
    }

    // Prevent clicks inside modal card from closing
    const modalCard = modal.querySelector(".modal__card");
    if (modalCard) {
        modalCard.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    // Escape key closes modal
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.hidden) {
            closeModal(e);
        }
    });

    // Enable confirm button only when typed correctly
    if (confirmInput) {
        confirmInput.addEventListener("input", () => {
            const typed = confirmInput.value.trim().toLowerCase();
            if (modalConfirmBtn) {
                modalConfirmBtn.disabled = typed !== "dissolve relationship";
            }
        });
    }

    // Confirm dissolution
    if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            modalConfirmBtn.disabled = true;
            modalConfirmBtn.textContent = "Processing...";

            try {
                const result = await initiateDissolve();

                // Show success message
                const scheduledDate = new Date(result.scheduledFor);
                const formattedDate = scheduledDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                });

                alert(`Dissolution initiated.\n\nGrace period ends on ${formattedDate}.\n\nEither partner can cancel during this time.`);

                // Reload to show pending state
                window.location.reload();
            } catch (err) {
                console.error("[settings] Dissolution failed:", err);
                alert("Failed to initiate dissolution:\n" + err.message);
                modalConfirmBtn.disabled = false;
                modalConfirmBtn.textContent = "Initiate Dissolution";
            }
        });
    }

    modalListenersAttached = true;
}

function showDissolutionPending(status) {
    const dissolveBtn = document.getElementById("dissolveBtn");
    const dangerZoneBody = document.getElementById("dangerZoneBody");

    if (!dangerZoneBody) return;

    // Replace danger zone content with pending state
    dangerZoneBody.innerHTML = `
        <div class="dissolution-pending">
            <div class="dissolution-pending__icon">⏳</div>
            <h3 class="dissolution-pending__title">Dissolution In Progress</h3>
            <p class="dissolution-pending__text">
                All shared data will be permanently deleted in
                <strong>${status.daysRemaining} day${status.daysRemaining !== 1 ? "s" : ""}</strong>.
            </p>
            <p class="dissolution-pending__scheduled">
                Scheduled for: <strong>${new Date(status.scheduledFor).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                })}</strong>
            </p>
            <p class="dissolution-pending__note">
                Either partner can cancel to keep the relationship.
            </p>
            <button class="btn btn--glass btn--lg" id="cancelDissolveBtn">
                <span class="btn__icon">↩️</span>
                Cancel Dissolution
            </button>
        </div>
    `;

    // Disable the dissolve button in the main UI
    if (dissolveBtn) {
        dissolveBtn.textContent = "Dissolution Pending";
        dissolveBtn.disabled = true;
        dissolveBtn.style.opacity = "0.5";
    }

    // Wire up cancel button
    const cancelBtn = document.getElementById("cancelDissolveBtn");
    if (cancelBtn) {
        cancelBtn.addEventListener("click", async () => {
            if (!confirm("Are you sure you want to cancel the dissolution and keep your relationship?")) return;

            cancelBtn.disabled = true;
            cancelBtn.innerHTML = '<span class="btn__icon">⏳</span> Cancelling...';

            try {
                await cancelDissolve();
                alert("Dissolution cancelled successfully!\n\nYour relationship will continue as normal.");
                window.location.reload();
            } catch (err) {
                console.error("[settings] Cancel failed:", err);
                alert("Failed to cancel:\n" + err.message);
                cancelBtn.disabled = false;
                cancelBtn.innerHTML = '<span class="btn__icon">↩️</span> Cancel Dissolution';
            }
        });
    }
}
