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
