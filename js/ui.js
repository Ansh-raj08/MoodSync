// =============================================================
//  ui.js — Shared UI Utilities
//  MoodSync · Toast notifications, formatters, shared helpers
//
//  Lightweight utilities used across multiple pages.
//  No page-specific DOM logic lives here.
// =============================================================

"use strict";

// =============================================================
//  Toast Notification System
// =============================================================

/**
 * Show a brief overlay toast message.
 * @param {string} message
 * @param {"success"|"error"|"info"} [type="info"]
 * @param {number} [duration=3000]
 */
function showToast(message, type = "info", duration = 3000) {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.style.cssText =
            "position:fixed;top:24px;right:24px;z-index:10000;display:flex;flex-direction:column;gap:10px;pointer-events:none;";
        document.body.appendChild(container);
    }

    const icons = { success: "✅", error: "❌", info: "ℹ️" };
    const colors = {
        success: "rgba(136,221,216,0.15)",
        error:   "rgba(242,122,150,0.15)",
        info:    "rgba(201,140,245,0.15)",
    };

    const toast = document.createElement("div");
    toast.style.cssText =
        `background:${colors[type] || colors.info};backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);` +
        "border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:12px 20px;" +
        "color:rgba(255,255,255,0.9);font-family:var(--ff-sans);font-size:0.9rem;" +
        "display:flex;align-items:center;gap:8px;pointer-events:auto;" +
        "opacity:0;transform:translateY(-10px);transition:opacity .3s,transform .3s;";

    toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-10px)";
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// =============================================================
//  Date Formatters
// =============================================================

function formatDate(dateStr) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
    });
}

function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60)    return "just now";
    if (diff < 3600)  return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 172800) return "yesterday";
    return Math.floor(diff / 86400) + "d ago";
}

// =============================================================
//  Dissolution Banner (show on all coupled pages)
// =============================================================

/**
 * Check dissolution status and show banner if pending.
 * Call this in every page's DOMContentLoaded after requireCouple().
 */
async function checkAndShowDissolutionBanner() {
    // Check if getDissolveStatus is available (from data.js)
    if (typeof getDissolveStatus !== "function") {
        console.warn("[ui] getDissolveStatus not available");
        return;
    }

    const status = await getDissolveStatus();
    if (!status?.isPending) return;

    const banner = document.getElementById("dissolutionBanner");
    const countdown = document.getElementById("dissolutionCountdown");
    const cancelBtn = document.getElementById("cancelDissolutionBtn");

    if (!banner) return; // Banner not on this page

    // Update countdown text
    const days = status.daysRemaining;
    if (countdown) {
        countdown.textContent = days === 1
            ? "All shared data will be deleted tomorrow."
            : `All shared data will be deleted in ${days} days.`;
    }

    // Show banner
    banner.hidden = false;

    // Wire up cancel button (if present)
    if (cancelBtn) {
        cancelBtn.addEventListener("click", async () => {
            if (!confirm("Are you sure you want to cancel the dissolution and keep your relationship?")) return;

            cancelBtn.disabled = true;
            cancelBtn.textContent = "Cancelling...";

            try {
                await cancelDissolve();
                banner.hidden = true;
                showToast("Dissolution cancelled successfully!", "success");
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                console.error("[ui] Cancel dissolution failed:", err);
                alert("Failed to cancel:\n" + err.message);
                cancelBtn.disabled = false;
                cancelBtn.textContent = "Cancel Dissolution";
            }
        });
    }
}
