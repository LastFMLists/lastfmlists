// Mutable state shared across modules. Everything here is derived from the
// history the user loaded; modules read these fields directly and write back
// through the same object, so an update is visible everywhere at once.
export const state = {
    // Loaded scrobble history
    allTracks: [],
    // Scrobbles Last.fm has no date for (Date is null). They are kept out of
    // allTracks, which is in time order, and only join lists that count plays
    // without looking at time (see undatedTracksFor in data/filters.js).
    undatedTracks: [],
    lastfmData: [],
    filteredData: [],

    // Last.fm top-list snapshots taken alongside the history, plus lookup maps
    artistsData: [],  // [{ name, listeners, playcount, debutYear }]
    albumsData: [],   // [{ title, artist, releaseDate, playcount }]
    tracksData: [],   // [{ title, album, listeners, playcount }]
    artistDataMap: {},
    albumDataMap: {},
    trackDataMap: {},
    topArtists: [],
    topAlbums: [],
    topTracks: [],

    // The account the lists on screen belong to
    loadedUsername: null,

    // The history load in progress, if any: { username, phase, snapshot() }.
    // phase is "history" while scrobbles download and "finishing" while the
    // lists are built; snapshot() returns what has fully arrived so far.
    historyLoad: null,
    // Set when a load finished with pages it couldn't download: the range and
    // pages still missing, so a saved copy can be completed later.
    historyProgress: null,

    // Album cover URLs keyed "album||artist" (lowercase). "" marks an album
    // Last.fm has no cover for. Saved with the rest of the dataset.
    albumArt: {},

    // Per-scrobble context, keyed by scrobble order (see buildHistoryContextMaps)
    previousScrobbleTimestampByOrder: {},
    isFirstScrobbleOfDayByOrder: {},

    // True once any detailed Last.fm metadata (durations, tags, global stats) has
    // been loaded. Metadata-only filters and sorts stay disabled until it is.
    extendedDataLoaded: false,

    // How deep the Last.fm top-list fetches go
    artistLimit: 250,
    albumLimit: 500,
    trackLimit: 1000,

    // Filter panel and comparison mode
    activeFilters: [],
    comparisonFilterStates: { left: {}, right: {} },
    comparisonStateInitialized: false,
    lastEquationInsertTargetId: "equations",
    lastRenderedListState: {
        isComparison: false,
        current: { entities: [], entityType: "track" },
        left: { entities: [], entityType: "track" },
        right: { entities: [], entityType: "track" }
    },

    // Charts and the bar race
    chartInstances: [],
    activeRaceState: null,
    racePlaybackTimerId: null,
    raceRenderArmed: false,
    racePlaybackSpeedMs: 260,
    raceSpeedReadoutElement: null,
    raceToolbar: null,
    graphableList: null,
    raceBuilding: false,
};
export const unfilteredStatsCache = {
    track: { source: null, length: 0, mapping: null },
    album: { source: null, length: 0, mapping: null },
    artist: { source: null, length: 0, mapping: null }
};
export const trackAverageListeningCache = {
    source: null,
    length: 0,
    minScrobbles: null,
    mapping: null
};
export const albumCoverCache = new Map();
