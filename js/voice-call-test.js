// =============================================================
//  Voice Call Integration Test & Verification Guide
//
//  This file provides testing instructions and debug utilities
//  for the voice calling feature integrated into chat.html
// =============================================================

console.log("🎯 Voice Call Integration Test Suite Loaded");

// =============================================================
//  INTEGRATION VERIFICATION
// =============================================================

/**
 * Run comprehensive voice call integration tests
 */
async function testVoiceCallIntegration() {
    console.log("\n=== 🔊 VOICE CALL INTEGRATION TEST ===\n");

    const results = {
        scriptsLoaded: false,
        userPaired: false,
        voiceCallInit: false,
        uiElements: false,
        eventListeners: false,
        microphoneAccess: false
    };

    // 1. Check if voice call scripts are loaded
    console.log("1️⃣ Checking script dependencies...");
    results.scriptsLoaded = !!(window.VoiceCall && window.VoiceCallUI);
    console.log(results.scriptsLoaded ? "✅ Voice call scripts loaded" : "❌ Voice call scripts missing");

    // 2. Check user pairing status
    console.log("\n2️⃣ Checking user pairing...");
    try {
        const ctx = await requireCouple();
        results.userPaired = !!(ctx && ctx.user && ctx.partner);
        console.log(results.userPaired ?
            `✅ User paired with: ${ctx.partner.name}` :
            "❌ User not paired - voice calling disabled");
    } catch (error) {
        console.log("❌ Error checking couple status:", error.message);
    }

    // 3. Check voice call initialization
    console.log("\n3️⃣ Checking voice call initialization...");
    if (window.VoiceCall) {
        const state = VoiceCall.getState();
        results.voiceCallInit = state === 'idle';
        console.log(results.voiceCallInit ?
            "✅ Voice calling initialized (idle state)" :
            `❌ Unexpected voice call state: ${state}`);
    }

    // 4. Check UI elements
    console.log("\n4️⃣ Checking UI elements...");
    const requiredElements = [
        'chatVoiceControls', 'callBtn', 'incomingCallControls',
        'activeCallControls', 'callingState', 'remoteAudio'
    ];

    const missingElements = requiredElements.filter(id => !document.getElementById(id));
    results.uiElements = missingElements.length === 0;

    if (results.uiElements) {
        console.log("✅ All UI elements present");
    } else {
        console.log("❌ Missing UI elements:", missingElements);
    }

    // 5. Check event listeners
    console.log("\n5️⃣ Checking event listeners...");
    const callBtn = document.getElementById('callBtn');
    results.eventListeners = !!(callBtn && callBtn.onclick !== null);
    console.log(results.eventListeners ? "✅ Event listeners attached" : "❌ Event listeners missing");

    // 6. Test microphone access (optional)
    console.log("\n6️⃣ Testing microphone access...");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        results.microphoneAccess = true;
        console.log("✅ Microphone access granted");

        // Clean up test stream
        stream.getTracks().forEach(track => track.stop());
    } catch (error) {
        console.log(`⚠️ Microphone access: ${error.name === 'NotAllowedError' ? 'Denied by user' : error.message}`);
    }

    // Summary
    console.log("\n=== 📊 INTEGRATION TEST SUMMARY ===");
    const passed = Object.values(results).filter(Boolean).length;
    const total = Object.keys(results).length - 1; // Exclude optional microphone test

    console.log(`✅ Passed: ${passed}/${total} core tests`);

    if (results.microphoneAccess) {
        console.log("✅ Microphone access: Available");
    } else {
        console.log("⚠️ Microphone access: Needs user permission");
    }

    const ready = results.scriptsLoaded && results.userPaired && results.voiceCallInit && results.uiElements;

    if (ready) {
        console.log("🎉 Voice calling is READY! Click the call button to test.");
    } else {
        console.log("❌ Voice calling is NOT ready. Check the issues above.");
    }

    return results;
}

// =============================================================
//  MANUAL TESTING GUIDE
// =============================================================

/**
 * Print manual testing instructions
 */
function showTestingGuide() {
    console.log(`
=== 📋 VOICE CALL TESTING GUIDE ===

🔧 SETUP:
1. Ensure you have TWO users paired together
2. Open chat.html in TWO different browsers/devices
3. Both users should see call button in chat topbar

📞 BASIC CALL FLOW:
1. User A clicks call button
   → Should see "Calling..." state
   → User B should see incoming call notification

2. User B clicks "Accept"
   → Both users should be "In call"
   → Both should see mute and end call buttons
   → Should hear each other's audio

3. Test mute functionality:
   → Click mute button
   → Should show "muted" state
   → Partner should not hear audio

4. End call testing:
   → Either user clicks "End Call"
   → Both should return to idle state

🧪 EDGE CASES TO TEST:
- Call rejection (User B clicks "Decline")
- Call timeout (don't answer for 30 seconds)
- Both users call simultaneously
- Browser refresh during call
- Microphone permission denied
- Network disconnection

🐛 DEBUGGING:
- Open browser console to see logs
- Check for "[voice]" prefixed messages
- Use testVoiceCallIntegration() function
- Verify Supabase Realtime is working

💡 EXPECTED BEHAVIORS:
- Call button only shows when paired
- Clean state transitions (idle → calling → in_call)
- Audio should play automatically on answer
- UI updates in real-time for both users
- Proper cleanup on call end/page reload
    `);
}

// =============================================================
//  DEBUG UTILITIES
// =============================================================

/**
 * Debug voice call state
 */
function debugVoiceCall() {
    if (!window.VoiceCall) {
        console.log("❌ VoiceCall not available");
        return;
    }

    console.log("🔍 Voice Call Debug Info:");
    console.log("- State:", VoiceCall.getState());
    console.log("- Muted:", VoiceCall.isMuted());

    // Check current UI state
    const visibleControls = [];
    ['callBtn', 'incomingCallControls', 'activeCallControls', 'callingState'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.style.display !== 'none') {
            visibleControls.push(id);
        }
    });
    console.log("- Visible controls:", visibleControls);

    // Check partner info
    const partnerName = document.getElementById('partnerName')?.textContent;
    const chatStatus = document.getElementById('chatStatus')?.textContent;
    console.log("- Partner:", partnerName);
    console.log("- Chat status:", chatStatus);
}

/**
 * Simulate call events for testing
 */
function simulateCallEvent(eventType) {
    if (!window.VoiceCall) {
        console.log("❌ VoiceCall not available");
        return;
    }

    console.log(`🧪 Simulating call event: ${eventType}`);

    switch (eventType) {
        case 'incoming':
            // Simulate incoming call
            window._pendingCallOffer = { test: true };
            if (VoiceCall._updateCallUI) VoiceCall._updateCallUI();
            break;

        case 'reset':
            // Reset to idle state
            if (VoiceCall._endCall) VoiceCall._endCall('test');
            break;

        default:
            console.log("Available events: 'incoming', 'reset'");
    }
}

// =============================================================
//  AUTO-INITIALIZE TESTING
// =============================================================

// Run basic test when page loads (if in chat page)
if (window.location.pathname.includes('chat.html')) {
    // Wait for everything to load
    setTimeout(() => {
        console.log("🔊 Voice Call Integration loaded in chat.html");
        console.log("💡 Run testVoiceCallIntegration() to verify setup");
        console.log("📋 Run showTestingGuide() for testing instructions");
        console.log("🔍 Run debugVoiceCall() to check current state");
    }, 2000);
}

// Export testing functions
window.VoiceCallTest = {
    test: testVoiceCallIntegration,
    guide: showTestingGuide,
    debug: debugVoiceCall,
    simulate: simulateCallEvent
};