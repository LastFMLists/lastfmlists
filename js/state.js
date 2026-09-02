// Mutable state shared across modules. Everything here is derived from the
// history the user loaded; modules read these fields directly and write back
// through the same object, so an update is visible everywhere at once.
export const state = {
    // Loaded scrobble history
    allTracks: [],
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
