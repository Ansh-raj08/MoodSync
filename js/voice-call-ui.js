// =============================================================
//  voice-call-ui.js — Enhanced UI State Management
//
//  Companion to voice-call.js for advanced UI control
//  Handles complex call state transitions and visual feedback
// =============================================================

"use strict";

let callStartTime = null;
let durationInterval = null;

// =============================================================
//  ENHANCED UI STATE MANAGEMENT
// =============================================================

/**
 * Enhanced UI update function to replace the basic one in voice-call.js
 */
function updateVoiceCallUI() {
    const state = window.VoiceCall ? window.VoiceCall.getState() : 'idle';

    // Hide all state-specific controls first
    _hideAllCallControls();

    // Update based on current state
    switch (state) {
        case 'idle':
            _showIdleState();
            break;

        case 'calling':
            _showCallingState();
            break;

        case 'incoming':
            _showIncomingState();
            break;

        case 'in_call':
            _showActiveCallState();
            break;

        default:
            console.warn('[voice-ui] Unknown call state:', state);
            _showIdleState();
    }
}

function _hideAllCallControls() {
    const elements = [
        'callBtn',
        'incomingCallControls',
        'activeCallControls',
        'callingState'
    ];

    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    _stopCallDuration();
}

function _showIdleState() {
    const callBtn = document.getElementById('callBtn');
    if (callBtn) {
        callBtn.style.display = 'inline-block';
        callBtn.disabled = false;
        callBtn.innerHTML = '<span class="btn__icon">📞</span> Call Partner';
    }

    _clearCallStatus();
}

function _showCallingState() {
    const callingState = document.getElementById('callingState');
    if (callingState) {
        callingState.style.display = 'flex';
    }

    // Show cancel button that acts as end call
    const cancelBtn = document.getElementById('cancelCallBtn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            if (window.VoiceCall) {
                window.VoiceCall.end();
            }
        };
    }

    _updateCallStatus('Calling...', 'calling');
}

function _showIncomingState() {
    const incomingControls = document.getElementById('incomingCallControls');
    if (incomingControls) {
        incomingControls.style.display = 'block';
    }

    _updateCallStatus('Incoming call', 'incoming');
    _playIncomingCallSound();
}

function _showActiveCallState() {
    const activeControls = document.getElementById('activeCallControls');
    if (activeControls) {
        activeControls.style.display = 'block';
    }

    _updateCallStatus('Connected', 'connected');
    _startCallDuration();
    _stopIncomingCallSound();
}

// =============================================================
//  CALL STATUS & DURATION
// =============================================================

function _updateCallStatus(text, type = '') {
    const statusEl = document.getElementById('callStatus');
    if (statusEl) {
        statusEl.textContent = text;
        statusEl.className = `call-status ${type}`;
    }
}

function _clearCallStatus() {
    _updateCallStatus('');
    _stopCallDuration();
}

function _startCallDuration() {
    callStartTime = Date.now();

    durationInterval = setInterval(() => {
        const elapsed = Date.now() - callStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;

        const timeString = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;

        const durationEl = document.getElementById('callDuration');
        if (durationEl) {
            durationEl.textContent = timeString;
        }
    }, 1000);
}

function _stopCallDuration() {
    if (durationInterval) {
        clearInterval(durationInterval);
        durationInterval = null;
    }

    callStartTime = null;

    const durationEl = document.getElementById('callDuration');
    if (durationEl) {
        durationEl.textContent = '00:00';
    }
}

// =============================================================
//  MUTE BUTTON ENHANCEMENT
// =============================================================

function updateMuteButton(isMuted) {
    const muteBtn = document.getElementById('muteBtn');
    if (!muteBtn) return;

    if (isMuted) {
        muteBtn.innerHTML = '<span class="btn__icon">🔊</span> Unmute';
        muteBtn.classList.add('muted');
    } else {
        muteBtn.innerHTML = '<span class="btn__icon">🔇</span> Mute';
        muteBtn.classList.remove('muted');
    }
}

// =============================================================
//  AUDIO FEEDBACK
// =============================================================

let incomingRingAudio = null;

function _playIncomingCallSound() {
    // Create a simple ring tone using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Create oscillator for ring tone
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Ring tone pattern (two tones)
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.5);

        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 1.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 1.5);

        // Repeat every 3 seconds
        incomingRingAudio = setInterval(() => {
            _playIncomingCallSound();
        }, 3000);

    } catch (error) {
        console.warn('[voice-ui] Could not play ring tone:', error.message);
    }
}

function _stopIncomingCallSound() {
    if (incomingRingAudio) {
        clearInterval(incomingRingAudio);
        incomingRingAudio = null;
    }
}

// =============================================================
//  CONNECTION QUALITY INDICATOR
// =============================================================

function updateConnectionQuality(stats) {
    // Simple connection quality based on packet loss and RTT
    let quality = 'good';

    if (stats.packetsLost > 5 || stats.roundTripTime > 300) {
        quality = 'poor';
    } else if (stats.packetsLost > 2 || stats.roundTripTime > 150) {
        quality = 'fair';
    }

    const indicator = document.querySelector('.status-indicator');
    if (indicator) {
        indicator.className = `status-indicator quality-${quality}`;
    }
}

// =============================================================
//  ERROR HANDLING & USER FEEDBACK
// =============================================================

function showCallError(message, type = 'error') {
    // Create or update error message
    let errorEl = document.getElementById('callError');

    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'callError';
        errorEl.className = 'call-error';

        const voiceSection = document.getElementById('voiceCallSection');
        if (voiceSection) {
            voiceSection.appendChild(errorEl);
        }
    }

    errorEl.innerHTML = `
        <div class="error-content ${type}">
            <span class="error-icon">${type === 'warning' ? '⚠️' : '❌'}</span>
            <span class="error-message">${message}</span>
            <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;

    errorEl.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }, 5000);
}

function showCallNotification(message, type = 'info') {
    // Show temporary notification
    const notification = document.createElement('div');
    notification.className = `call-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${type === 'success' ? '✅' : 'ℹ️'}</span>
            <span>${message}</span>
        </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('show'), 100);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// =============================================================
//  INTEGRATION WITH MAIN VOICE-CALL.JS
// =============================================================

/**
 * Initialize enhanced UI - call this after VoiceCall.init()
 */
function initVoiceCallUI() {
    // Override the basic UI update function
    if (window.VoiceCall) {
        // Store original function
        window.VoiceCall._originalUpdateUI = window.VoiceCall._updateCallUI || (() => {});

        // Replace with enhanced version
        window.VoiceCall._updateCallUI = updateVoiceCallUI;

        // Enhance mute callback
        const originalToggleMute = window.VoiceCall.toggleMute;
        window.VoiceCall.toggleMute = () => {
            const result = originalToggleMute();
            if (result !== false) {
                // Get mute state somehow - this would need to be exposed from main module
                updateMuteButton(window.VoiceCall._isMuted || false);
            }
            return result;
        };
    }

    // Set up periodic connection quality monitoring
    setInterval(() => {
        if (window.VoiceCall && window.VoiceCall.getState() === 'in_call') {
            // This would need WebRTC stats access from main module
            // updateConnectionQuality(stats);
        }
    }, 5000);

    console.log('[voice-ui] Enhanced UI initialized');
}

// =============================================================
//  CSS FOR ERROR/NOTIFICATION STYLES
// =============================================================

// Add dynamic styles
const style = document.createElement('style');
style.textContent = `
    .call-error {
        margin-top: 1rem;
        animation: slideIn 0.3s ease;
    }

    .error-content {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        border-radius: 8px;
        background: rgba(255, 75, 43, 0.1);
        border: 1px solid rgba(255, 75, 43, 0.3);
        color: #ff4b2b;
    }

    .error-content.warning {
        background: rgba(255, 193, 7, 0.1);
        border-color: rgba(255, 193, 7, 0.3);
        color: #ffc107;
    }

    .error-close {
        background: none;
        border: none;
        color: currentColor;
        font-size: 1.2rem;
        cursor: pointer;
        margin-left: auto;
        padding: 0;
        width: 20px;
        height: 20px;
    }

    .call-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        max-width: 300px;
    }

    .call-notification.show {
        opacity: 1;
        transform: translateX(0);
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(20px);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #333;
    }

    .call-notification.success .notification-content {
        background: rgba(86, 171, 47, 0.9);
        color: white;
    }

    .quality-good { background: #4caf50; }
    .quality-fair { background: #ff9800; }
    .quality-poor { background: #f44336; }
`;

document.head.appendChild(style);

// Export enhanced UI functions
window.VoiceCallUI = {
    init: initVoiceCallUI,
    update: updateVoiceCallUI,
    updateMute: updateMuteButton,
    showError: showCallError,
    showNotification: showCallNotification,
    updateConnectionQuality: updateConnectionQuality
};