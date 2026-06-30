/**
 * Storage Controller for Cerebral Aim Trainer
 * Manages localStorage for scores, settings, and calibration history.
 */

const STORAGE_KEYS = {
    HISTORY: 'cerebral_aim_history',
    PROFILE: 'cerebral_aim_profile'
};

const StorageController = {
    // Save settings profile
    saveProfile(dpi, multiplier, trainerMultiplier) {
        const profile = { 
            dpi: parseInt(dpi) || 12000, 
            multiplier: parseFloat(multiplier) || 50,
            trainerMultiplier: parseFloat(trainerMultiplier) || 1.0
        };
        localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
        return profile;
    },

    // Load settings profile
    loadProfile() {
        const defaultProfile = { dpi: 12000, multiplier: 50, trainerMultiplier: 1.0 };
        const stored = localStorage.getItem(STORAGE_KEYS.PROFILE);
        if (stored) {
            try {
                return { ...defaultProfile, ...JSON.parse(stored) };
            } catch (e) {
                console.error("Failed to parse settings profile", e);
            }
        }
        return defaultProfile;
    },

    // Save a new score entry
    saveRunEntry(entry) {
        const history = this.loadHistory();
        
        // Add timestamp if not exists
        if (!entry.date) {
            entry.date = new Date().toLocaleString('de-DE');
        }
        
        history.unshift(entry); // Newest first
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
        return history;
    },

    // Load entire history list
    loadHistory() {
        const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error("Failed to parse run history", e);
            }
        }
        return [];
    },

    // Clear history
    clearHistory() {
        localStorage.removeItem(STORAGE_KEYS.HISTORY);
    }
};
