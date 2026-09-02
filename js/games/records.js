// Best scores and play counts, persisted per browser.

const GAMES_STORAGE_KEY = "lastfmlists_games_v1";
export const gamesRecords = {
    hlBest: { artist: 0, album: 0, track: 0 },
    ftlBest: 0,
    ftlPlayed: 0,
    ordBest: 0,
    ordPlayed: 0
};

export function loadGamesRecords() {
    try {
        const raw = JSON.parse(localStorage.getItem(GAMES_STORAGE_KEY));
        if (raw && typeof raw === "object") {
            const hlBest = { ...gamesRecords.hlBest, ...(raw.hlBest || {}) };
            Object.assign(gamesRecords, raw, { hlBest });
        }
    } catch (e) {
        // ignore malformed/blocked storage
    }
}

export function saveGamesRecords() {
    try {
        localStorage.setItem(GAMES_STORAGE_KEY, JSON.stringify(gamesRecords));
    } catch (e) {
        // storage may be unavailable (private mode); records just won't persist
    }
}
