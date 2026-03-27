// Enhanced saveMood function with better error handling and fallbacks

/**
 * Save a mood entry for the current user with enhanced safety.
 * @param {number} score - 1–9
 * @param {string} [note]
 * @returns {Promise<Object>} inserted row
 */
async function saveMoodSafe(score, note = "") {
    const user = await getUser();
    if (!user) throw new Error("Not authenticated.");

    const clamped = Math.max(1, Math.min(9, Math.round(score)));

    // Try to get couple, but handle gracefully if not paired
    let couple;
    try {
        couple = await getCouple();
    } catch (error) {
        console.warn("[mood] Could not fetch couple:", error.message);
    }

    // Prepare insert data with conditional couple_id
    const insertData = {
        user_id: user.id,
        score: clamped,
        note: note.trim() || null,
    };

    // Only add couple_id if couple exists (handles unpaired users)
    if (couple && couple.id) {
        insertData.couple_id = couple.id;
    } else {
        console.warn("[mood] No couple found - saving mood without couple_id");
    }

    const { data, error } = await supabaseClient
        .from("mood_logs")
        .insert(insertData)
        .select()
        .single();

    if (error) {
        // Provide more specific error messages
        if (error.message.includes("couple_id")) {
            throw new Error("Database schema needs migration. Contact support.");
        }
        throw new Error("Failed to save mood: " + error.message);
    }

    return data;
}