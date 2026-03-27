// =============================================================
//  voice-call.js — WebRTC Voice Calling for MoodSync
//
//  Features:
//  - 1:1 voice calls between paired users
//  - WebRTC with Supabase Realtime signaling
//  - Call/Answer/Reject/End/Mute controls
//  - Robust error handling and cleanup
//
//  Dependencies: supabaseClient.js, auth.js, data.js
// =============================================================

"use strict";

// =============================================================
//  CONSTANTS & STATE
// =============================================================

const CALL_STATES = {
    IDLE: 'idle',
    CALLING: 'calling',
    INCOMING: 'incoming',
    IN_CALL: 'in_call'
};

const CALL_EVENTS = {
    OFFER: 'call_offer',
    ANSWER: 'call_answer',
    ICE_CANDIDATE: 'ice_candidate',
    REJECT: 'call_reject',
    END: 'call_end',
    TIMEOUT: 'call_timeout'
};

// WebRTC Configuration
const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

// Call state management
let callState = CALL_STATES.IDLE;
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let callChannel = null;
let callTimeout = null;
let currentPartnerId = null;
let isMuted = false;

// =============================================================
//  CORE CALL MANAGEMENT
// =============================================================

/**
 * Initialize voice calling system
 * Call this on pages that need voice call functionality
 */
async function initVoiceCalling() {
    try {
        const ctx = await requireCouple();
        if (!ctx) {
            console.warn("[voice] User not paired - voice calling disabled");
            return false;
        }

        currentPartnerId = ctx.partner.id;
        await _setupSignalingChannel(ctx.user.id, ctx.partner.id);
        _setupCallUI();

        console.log("[voice] Voice calling initialized");
        return true;
    } catch (error) {
        console.error("[voice] Failed to initialize:", error.message);
        return false;
    }
}

/**
 * Start an outgoing voice call
 */
async function startCall() {
    if (callState !== CALL_STATES.IDLE) {
        console.warn("[voice] Cannot start call - not in idle state");
        return false;
    }

    if (!currentPartnerId) {
        throw new Error("No partner found for call");
    }

    try {
        callState = CALL_STATES.CALLING;
        _updateCallUI();

        // Get user media (audio only)
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });

        // Create peer connection
        peerConnection = new RTCPeerConnection(RTC_CONFIG);
        _setupPeerConnectionEvents();

        // Add local stream
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        await _sendSignal(CALL_EVENTS.OFFER, {
            offer: offer,
            callerId: (await getUser()).id
        });

        // Set call timeout
        callTimeout = setTimeout(() => {
            if (callState === CALL_STATES.CALLING) {
                _endCall('timeout');
            }
        }, 30000); // 30 second timeout

        console.log("[voice] Call initiated");
        return true;

    } catch (error) {
        console.error("[voice] Failed to start call:", error.message);
        _endCall('error');

        if (error.name === 'NotAllowedError') {
            alert("Microphone access denied. Please allow microphone access and try again.");
        } else {
            alert("Failed to start call: " + error.message);
        }
        return false;
    }
}

/**
 * Accept an incoming voice call
 */
async function acceptCall(offer) {
    if (callState !== CALL_STATES.INCOMING) {
        console.warn("[voice] Cannot accept - not in incoming state");
        return false;
    }

    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });

        // Create peer connection
        peerConnection = new RTCPeerConnection(RTC_CONFIG);
        _setupPeerConnectionEvents();

        // Add local stream
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Set remote description and create answer
        await peerConnection.setRemoteDescription(offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Send answer
        await _sendSignal(CALL_EVENTS.ANSWER, {
            answer: answer,
            receiverId: (await getUser()).id
        });

        callState = CALL_STATES.IN_CALL;
        _updateCallUI();

        console.log("[voice] Call accepted");
        return true;

    } catch (error) {
        console.error("[voice] Failed to accept call:", error.message);
        _rejectCall();

        if (error.name === 'NotAllowedError') {
            alert("Microphone access denied. Cannot join call.");
        } else {
            alert("Failed to join call: " + error.message);
        }
        return false;
    }
}

/**
 * Reject an incoming call
 */
async function rejectCall() {
    if (callState !== CALL_STATES.INCOMING) {
        console.warn("[voice] Cannot reject - not in incoming state");
        return false;
    }

    await _sendSignal(CALL_EVENTS.REJECT, {
        rejectedBy: (await getUser()).id
    });

    _rejectCall();
    return true;
}

/**
 * End the current call
 */
async function endCall() {
    if (callState === CALL_STATES.IDLE) {
        console.warn("[voice] No active call to end");
        return false;
    }

    await _sendSignal(CALL_EVENTS.END, {
        endedBy: (await getUser()).id
    });

    _endCall('user');
    return true;
}

/**
 * Toggle mute state
 */
function toggleMute() {
    if (!localStream || callState !== CALL_STATES.IN_CALL) {
        return false;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMuted = !audioTrack.enabled;
        _updateCallUI();
        console.log("[voice] Mute toggled:", isMuted ? "muted" : "unmuted");
        return true;
    }

    return false;
}

// =============================================================
//  SIGNALING (SUPABASE REALTIME)
// =============================================================

async function _setupSignalingChannel(userId, partnerId) {
    // Create deterministic channel name for the pair
    const channelId = [userId, partnerId].sort().join('-');
    const channelName = `voice_call_${channelId}`;

    callChannel = supabaseClient.channel(channelName);

    callChannel.on('broadcast', { event: CALL_EVENTS.OFFER }, (payload) => {
        _handleCallOffer(payload.payload);
    });

    callChannel.on('broadcast', { event: CALL_EVENTS.ANSWER }, (payload) => {
        _handleCallAnswer(payload.payload);
    });

    callChannel.on('broadcast', { event: CALL_EVENTS.ICE_CANDIDATE }, (payload) => {
        _handleIceCandidate(payload.payload);
    });

    callChannel.on('broadcast', { event: CALL_EVENTS.REJECT }, (payload) => {
        _handleCallReject(payload.payload);
    });

    callChannel.on('broadcast', { event: CALL_EVENTS.END }, (payload) => {
        _handleCallEnd(payload.payload);
    });

    await callChannel.subscribe();
    console.log("[voice] Signaling channel connected:", channelName);
}

async function _sendSignal(event, payload) {
    if (!callChannel) {
        console.error("[voice] No signaling channel available");
        return false;
    }

    try {
        await callChannel.send({
            type: 'broadcast',
            event: event,
            payload: payload
        });
        console.log("[voice] Signal sent:", event);
        return true;
    } catch (error) {
        console.error("[voice] Failed to send signal:", error.message);
        return false;
    }
}

// =============================================================
//  SIGNAL HANDLERS
// =============================================================

async function _handleCallOffer(data) {
    const currentUser = await getUser();

    // Ignore own offers
    if (data.callerId === currentUser.id) return;

    // Handle duplicate/conflicting calls
    if (callState !== CALL_STATES.IDLE) {
        console.warn("[voice] Incoming call while busy - auto-rejecting");
        await _sendSignal(CALL_EVENTS.REJECT, { rejectedBy: currentUser.id });
        return;
    }

    callState = CALL_STATES.INCOMING;
    _updateCallUI();

    // Store offer for when user accepts
    window._pendingCallOffer = data.offer;

    console.log("[voice] Incoming call from partner");
}

async function _handleCallAnswer(data) {
    const currentUser = await getUser();

    // Ignore own answers
    if (data.receiverId === currentUser.id) return;

    if (callState !== CALL_STATES.CALLING || !peerConnection) {
        console.warn("[voice] Received answer in wrong state");
        return;
    }

    try {
        await peerConnection.setRemoteDescription(data.answer);
        callState = CALL_STATES.IN_CALL;
        _clearCallTimeout();
        _updateCallUI();

        console.log("[voice] Call answered - connection established");
    } catch (error) {
        console.error("[voice] Failed to handle answer:", error.message);
        _endCall('error');
    }
}

async function _handleIceCandidate(data) {
    if (!peerConnection || callState === CALL_STATES.IDLE) return;

    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log("[voice] ICE candidate added");
    } catch (error) {
        console.error("[voice] Failed to add ICE candidate:", error.message);
    }
}

async function _handleCallReject(data) {
    const currentUser = await getUser();

    // Ignore own rejections
    if (data.rejectedBy === currentUser.id) return;

    if (callState === CALL_STATES.CALLING) {
        console.log("[voice] Call rejected by partner");
        _endCall('rejected');
    }
}

async function _handleCallEnd(data) {
    const currentUser = await getUser();

    // Ignore own end signals
    if (data.endedBy === currentUser.id) return;

    console.log("[voice] Call ended by partner");
    _endCall('remote');
}

// =============================================================
//  WEBRTC PEER CONNECTION
// =============================================================

function _setupPeerConnectionEvents() {
    if (!peerConnection) return;

    // Handle ICE candidates
    peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            await _sendSignal(CALL_EVENTS.ICE_CANDIDATE, {
                candidate: event.candidate
            });
        }
    };

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        console.log("[voice] Remote stream received");
        remoteStream = event.streams[0];

        // Play remote audio
        const remoteAudio = document.getElementById('remoteAudio');
        if (remoteAudio) {
            remoteAudio.srcObject = remoteStream;
            remoteAudio.play().catch(e => console.warn("[voice] Auto-play failed:", e.message));
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log("[voice] Connection state:", peerConnection.connectionState);

        if (peerConnection.connectionState === 'failed') {
            console.error("[voice] Connection failed");
            _endCall('connection_failed');
        }
    };

    // Handle ICE connection state
    peerConnection.oniceconnectionstatechange = () => {
        console.log("[voice] ICE connection state:", peerConnection.iceConnectionState);

        if (peerConnection.iceConnectionState === 'failed') {
            console.error("[voice] ICE connection failed");
            _endCall('ice_failed');
        }
    };
}

// =============================================================
//  CLEANUP & STATE MANAGEMENT
// =============================================================

function _endCall(reason) {
    console.log("[voice] Ending call:", reason);

    // Stop all media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Clear remote stream
    remoteStream = null;

    // Clear timeout
    _clearCallTimeout();

    // Reset state
    callState = CALL_STATES.IDLE;
    isMuted = false;
    window._pendingCallOffer = null;

    // Update UI
    _updateCallUI();

    // Clear remote audio
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }

    console.log("[voice] Call cleanup completed");
}

function _rejectCall() {
    _endCall('rejected');
}

function _clearCallTimeout() {
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }
}

// =============================================================
//  UI STATE MANAGEMENT
// =============================================================

function _setupCallUI() {
    // Ensure UI elements exist
    if (!document.getElementById('remoteAudio')) {
        const audio = document.createElement('audio');
        audio.id = 'remoteAudio';
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
    }

    // Initial UI update
    _updateCallUI();
}

function _updateCallUI() {
    const callBtn = document.getElementById('callBtn');
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    const endBtn = document.getElementById('endCallBtn');
    const muteBtn = document.getElementById('muteBtn');
    const callStatus = document.getElementById('callStatus');

    // Reset all buttons
    [callBtn, acceptBtn, rejectBtn, endBtn, muteBtn].forEach(btn => {
        if (btn) btn.style.display = 'none';
    });

    // Update based on call state
    switch (callState) {
        case CALL_STATES.IDLE:
            if (callBtn) {
                callBtn.style.display = 'inline-block';
                callBtn.textContent = '📞 Call';
                callBtn.disabled = false;
            }
            if (callStatus) callStatus.textContent = '';
            break;

        case CALL_STATES.CALLING:
            if (endBtn) {
                endBtn.style.display = 'inline-block';
                endBtn.textContent = '❌ Cancel';
            }
            if (callStatus) callStatus.textContent = 'Calling...';
            break;

        case CALL_STATES.INCOMING:
            if (acceptBtn) acceptBtn.style.display = 'inline-block';
            if (rejectBtn) rejectBtn.style.display = 'inline-block';
            if (callStatus) callStatus.textContent = 'Incoming call...';
            break;

        case CALL_STATES.IN_CALL:
            if (endBtn) {
                endBtn.style.display = 'inline-block';
                endBtn.textContent = '❌ End Call';
            }
            if (muteBtn) {
                muteBtn.style.display = 'inline-block';
                muteBtn.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
            }
            if (callStatus) callStatus.textContent = 'In call';
            break;
    }
}

// =============================================================
//  EVENT LISTENERS (call from page-specific JS)
// =============================================================

function setupVoiceCallListeners() {
    const callBtn = document.getElementById('callBtn');
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    const endBtn = document.getElementById('endCallBtn');
    const muteBtn = document.getElementById('muteBtn');

    if (callBtn) {
        callBtn.addEventListener('click', startCall);
    }

    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            if (window._pendingCallOffer) {
                acceptCall(window._pendingCallOffer);
            }
        });
    }

    if (rejectBtn) {
        rejectBtn.addEventListener('click', rejectCall);
    }

    if (endBtn) {
        endBtn.addEventListener('click', endCall);
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMute);
    }
}

// =============================================================
//  CLEANUP ON PAGE UNLOAD
// =============================================================

window.addEventListener('beforeunload', () => {
    if (callState !== CALL_STATES.IDLE) {
        _endCall('page_unload');
    }

    if (callChannel) {
        callChannel.unsubscribe();
    }
});

// =============================================================
//  PUBLIC API
// =============================================================

// Export functions for use in other modules
window.VoiceCall = {
    init: initVoiceCalling,
    start: startCall,
    accept: acceptCall,
    reject: rejectCall,
    end: endCall,
    toggleMute: toggleMute,
    setupListeners: setupVoiceCallListeners,
    getState: () => callState,
    isMuted: () => isMuted
};