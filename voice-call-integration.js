// =============================================================
//  INTEGRATION EXAMPLE: Adding Voice Calling to Chat.html
//
//  This shows how to integrate voice calling into existing pages
//  Copy the relevant parts to your target pages
// =============================================================

// 1. Add script imports (in <head> section of HTML):
/*
<script src="js/voice-call.js"></script>
<script src="js/voice-call-ui.js"></script>
*/

// 2. Add HTML UI (copy voice-call-ui.html content into your page)

// 3. Initialize voice calling (in your page's DOMContentLoaded):

document.addEventListener("DOMContentLoaded", async () => {
    const page = window.location.pathname.split("/").pop();
    if (page !== "chat.html") return; // Replace with your page

    // Existing auth + couple guard
    const ctx = await requireCouple();
    if (!ctx) return;

    // Initialize existing page functionality first
    await _initChatPage(ctx.user, ctx.partner); // Your existing init

    // Initialize voice calling
    const voiceEnabled = await VoiceCall.init();
    if (voiceEnabled) {
        VoiceCallUI.init();
        setupVoiceCallListeners();

        console.log("[chat] Voice calling enabled");
        VoiceCallUI.showNotification("Voice calling is ready!", "success");
    } else {
        console.warn("[chat] Voice calling disabled - user not paired");

        // Hide voice call section if user not paired
        const voiceSection = document.getElementById('voiceCallSection');
        if (voiceSection) voiceSection.style.display = 'none';
    }

    // Your existing code continues...
});

// 4. Optional: Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (!VoiceCall) return;

    const state = VoiceCall.getState();

    // Space bar to answer incoming calls
    if (e.code === 'Space' && state === 'incoming') {
        e.preventDefault();
        const acceptBtn = document.getElementById('acceptCallBtn');
        if (acceptBtn) acceptBtn.click();
    }

    // Escape to end/reject calls
    if (e.code === 'Escape' && state !== 'idle') {
        e.preventDefault();
        if (state === 'incoming') {
            const rejectBtn = document.getElementById('rejectCallBtn');
            if (rejectBtn) rejectBtn.click();
        } else {
            const endBtn = document.getElementById('endCallBtn');
            if (endBtn) endBtn.click();
        }
    }

    // Ctrl+M to toggle mute during calls
    if (e.ctrlKey && e.code === 'KeyM' && state === 'in_call') {
        e.preventDefault();
        VoiceCall.toggleMute();
    }
});

// 5. Optional: Integration with existing chat features
function onNewMessage(message) {
    // Your existing message handling

    // Mute call notifications during active calls
    const callState = VoiceCall ? VoiceCall.getState() : 'idle';
    if (callState === 'in_call') {
        // Reduce notification volume or disable sounds during calls
        console.log("[chat] New message during call - silent notification");
        return;
    }

    // Normal message notification
    showMessageNotification(message);
}

// =============================================================
//  EXAMPLE: Add to existing chat.html structure
// =============================================================

/*
Add this HTML section to chat.html right after the chat header:

<section class="chat-section">
    <!-- Existing chat header -->
    <header class="chat__header">
        <!-- Your existing chat header content -->
    </header>

    <!-- ADD THIS: Voice calling section -->
    <!-- Insert the content from voice-call-ui.html here -->

    <!-- Existing chat messages -->
    <div class="chat__messages" id="chatMessages">
        <!-- Your existing chat messages -->
    </div>

    <!-- Existing message input -->
    <form class="chat__input-form" id="chatForm">
        <!-- Your existing input form -->
    </form>
</section>
*/

// =============================================================
//  EXAMPLE: Dashboard.html Integration
// =============================================================

/*
For dashboard.html, add voice calling as a widget:

<div class="dashboard-grid">
    <!-- Existing dashboard widgets -->

    <!-- ADD THIS: Voice call widget -->
    <div class="dashboard-card voice-call-widget">
        <h3 class="card__title">
            <span class="card__icon">📞</span>
            Voice Call
        </h3>

        <!-- Insert voice-call-ui.html content here -->

    </div>

    <!-- Other dashboard widgets -->
</div>

Additional CSS for dashboard integration:

.voice-call-widget {
    grid-column: span 2; /* Take up more space on the grid */
}

.voice-call-widget .voice-call-section {
    background: transparent; /* Inherit from dashboard card */
    border: none;
    padding: 0;
}
*/

// =============================================================
//  TROUBLESHOOTING & TESTING
// =============================================================

// Test voice calling functionality
async function testVoiceCall() {
    console.log("=== Voice Call Test ===");

    // Check if voice calling is initialized
    if (!window.VoiceCall) {
        console.error("❌ VoiceCall not loaded");
        return false;
    }

    // Check current state
    const state = VoiceCall.getState();
    console.log("📞 Current call state:", state);

    // Check if user is paired
    try {
        const ctx = await requireCouple();
        if (ctx) {
            console.log("✅ User is paired with:", ctx.partner.name);
        } else {
            console.log("❌ User is not paired");
            return false;
        }
    } catch (error) {
        console.error("❌ Error checking couple status:", error.message);
        return false;
    }

    // Check microphone access
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("✅ Microphone access granted");

        // Clean up test stream
        stream.getTracks().forEach(track => track.stop());

    } catch (error) {
        console.error("❌ Microphone access denied:", error.message);
        return false;
    }

    // Check Supabase connection
    try {
        const { data } = await supabaseClient.from('profiles').select('id').limit(1);
        console.log("✅ Supabase connection working");
    } catch (error) {
        console.error("❌ Supabase connection failed:", error.message);
        return false;
    }

    console.log("✅ All voice call tests passed!");
    return true;
}

// Add to browser console for testing
window.testVoiceCall = testVoiceCall;

// =============================================================
//  COMMON ISSUES & SOLUTIONS
// =============================================================

/*
COMMON ISSUES:

1. "Microphone access denied"
   - User denied permission
   - Solution: Ask user to reload and grant permission
   - Show clear instructions in your UI

2. "Cannot read property 'getState' of undefined"
   - VoiceCall not initialized
   - Solution: Ensure VoiceCall.init() is called first
   - Check requireCouple() succeeds

3. "STUN/TURN server failed"
   - Network/firewall blocking WebRTC
   - Solution: This is expected limitation without TURN server
   - Show fallback message to users

4. "Call not connecting"
   - Both users behind restrictive NAT
   - Solution: One user may need to be on different network
   - Consider adding TURN server for production

5. "Audio not heard"
   - Browser autoplay policy
   - Solution: User interaction required before playing audio
   - The accept/call button provides required interaction

6. "Call UI not updating"
   - Event listeners not set up
   - Solution: Call setupVoiceCallListeners() after VoiceCall.init()
   - Ensure UI elements exist in DOM

DEBUGGING TIPS:

- Open browser dev tools
- Check console for errors
- Use testVoiceCall() function
- Verify Supabase Realtime is working
- Test with two users in different browsers/devices
*/