// Tuning constants, API credentials and the UI copy that has to stay in
// sync with index.html.

export const SCROBBLE_SORT_ASC = "earliest-to-latest";
export const SCROBBLE_SORT_DESC = "latest-to-earliest";
export const DB_NAME = 'lastfmDataDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'userData';
export const API_KEY = "edbd779d54b373b8710af5c346148ae3";

// --- History fetching / performance tuning ---
// Aspirational page size for user.getRecentTracks. Last.fm reliably serves 200
// per page with extended=1; larger values MAY be honoured (fewer requests) but
// are not guaranteed. The fetch logic never trusts this blindly: it derives the
// real page count from the number of tracks the server actually returns and
// falls back to HISTORY_PAGE_SIZE_SAFE if a large-limit request comes back
// empty/invalid, so raising this can only ever speed things up, never lose data.
export const HISTORY_PAGE_SIZE_LARGE = 1000;
export const HISTORY_PAGE_SIZE_SAFE = 200;

// How many history pages to fetch in parallel. This caps in-flight requests;
// the token bucket below caps the request rate. It is lowered automatically
// when the API starts returning 429s.
export const HISTORY_FETCH_CONCURRENCY = 5;
export const MIN_FETCH_CONCURRENCY = 1;

// Last.fm's documented limit is 5 requests per originating IP per second,
// AVERAGED over a 5-minute period. Averaged means the compliant budget for any
// 5-minute window is ~1500 requests, not a hard 5-per-second tick, so a burst
// is fine as long as the average holds. This token bucket models exactly that:
// it starts full, each request spends a token, and tokens refill at 5/s. Until
// the bucket runs dry, requests fire with no artificial delay (with 1000-track
// pages that one-shots libraries up to ~1M scrobbles); after that, everything
// settles to the sustainable 5/s rate. Requests originate from each visitor's
// own browser, so this budget is per-user. A 429 empties the bucket on top of
// the usual backoff. Shrink RATE_BURST_CAPACITY if stray 429s show up in the wild.
export const RATE_REFILL_PER_SECOND = 5;
export const RATE_BURST_CAPACITY = 1000;

// Tooltips for the two metadata-loading buttons, kept in sync with index.html.
export const LOAD_DETAILS_TOOLTIP = "Load extended data for your top artists, albums and tracks. That means Last.fm metadata like track length, genre/country tags, and global listeners/playcount. It unlocks the duration, tags and global-stats filters plus the “Time spent listening” and “Percentage of global scrobbles” sorts. Enough for most stats and much faster than “Load All Details”.";
export const LOAD_ALL_DETAILS_TOOLTIP = "Same extended metadata (track length, tags, global listeners/playcount) but for EVERY song you've ever scrobbled, not just your top ones. Unlocks the duration, tags and global-stats filters and the “Time spent listening” / “Percentage of global scrobbles” sorts for your whole library. This makes thousands of requests and can take a very long time.";

// Dumping allTracks / artistsData to the console keeps every object alive in
// devtools and stalls the tab on big libraries. Set localStorage
// "lastfmlists-debug" to "1" to get the old dumps back.
const DEBUG_DATA_LOGS = (() => {
    try {
        return localStorage.getItem("lastfmlists-debug") === "1";
    } catch (e) {
        return false;
    }
})();

export function debugLogDataset(label, value) {
    if (DEBUG_DATA_LOGS) console.log(label, value);
}

export const DISPLAY_MODE_LIST = "list";
export const DISPLAY_MODE_BAR_CHART = "bar-chart";
export const DISPLAY_MODE_BAR_RACE = "bar-race";
export const GLOBAL_BASE_SETTING_IDS = new Set([
    "display-mode",
    "list-length",
    "unfiltered-stats",
    "chart-axis",
    "chart-scale",
    "race-start-date",
    "race-end-date",
    "race-frequency",
    "race-speed-ms"
]);

// Message shown when hovering a control that needs extended metadata.
export const EXTENDED_LOCKED_MSG = "🔒 Needs extended data. Click “Load Details” (or “Load All Details”) at the top first. It uses Last.fm metadata (track length, tags, global listeners/playcount) that isn't downloaded with your basic history.";

export const EXPORT_MAX_ROWS_PER_COLUMN = 100;
