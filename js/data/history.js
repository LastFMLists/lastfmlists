// Downloading a listening history and the extended per-entity metadata,
// including the live preview shown while pages arrive.

import {
    fetchAllAlbumDetails,
    fetchAllArtistDetails,
    fetchAllTrackDetails,
    getLastfmErrorMessage,
    mapRecentTrack
} from '../api/lastfm.js';
import {
    fetchJsonWithRetry,
    getFetchConcurrency,
    resetFetchThrottle
} from '../api/rate-limit.js';
import {
    API_KEY,
    HISTORY_PAGE_SIZE_LARGE,
    HISTORY_PAGE_SIZE_SAFE,
    debugLogDataset
} from '../config.js';
import { escapeHTML, loadingDiv, mapWithConcurrency } from '../dom.js';
import { state } from '../state.js';
import { getLocalDayKeyFromTimestamp } from '../time.js';
import { displayEntities } from '../ui/lists.js';
import { updateExtendedDataUI } from '../ui/shell.js';
import { filterTracks } from './filters.js';
import { mergeData } from './storage.js';

export function buildHistoryContextMaps() {
    state.previousScrobbleTimestampByOrder = {};
    state.isFirstScrobbleOfDayByOrder = {};

    let previousTimestamp = null;
    let previousDayKey = null;

    for (let index = 0; index < state.allTracks.length; index++) {
        const track = state.allTracks[index];
        const order = track.order ?? index + 1;
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) continue;

        state.previousScrobbleTimestampByOrder[order] = previousTimestamp;

        const dayKey = getLocalDayKeyFromTimestamp(timestamp);
        state.isFirstScrobbleOfDayByOrder[order] = dayKey !== previousDayKey;

        previousTimestamp = timestamp;
        previousDayKey = dayKey;
    }
}

async function loadDetailedMetadata(loadAll = false) {
    const selectCandidates = (all) => {
        const selectedArtists = all
            ? state.topArtists.slice()
            : (() => {
                const preferred = state.topArtists.filter(artist => artist.playcount > 100);
                return preferred.length < state.artistLimit ? state.topArtists.slice(0, state.artistLimit) : preferred;
            })();

        const selectedAlbums = all
            ? state.topAlbums.slice()
            : (() => {
                const preferred = state.topAlbums.filter(album => album.playcount > 10);
                return preferred.length < state.albumLimit ? state.topAlbums.slice(0, state.albumLimit) : preferred;
            })();

        const selectedTracks = all
            ? state.topTracks.slice()
            : (() => {
                const preferred = state.topTracks.filter(track => track.playcount > 5);
                return preferred.length < state.trackLimit ? state.topTracks.slice(0, state.trackLimit) : preferred;
            })();

        return { selectedArtists, selectedAlbums, selectedTracks };
    };

    const { selectedArtists, selectedAlbums, selectedTracks } = selectCandidates(loadAll);

    const confirmMsg = loadAll
        ? `Load ALL details downloads metadata for every single song you've ever listened to. This WILL take hours.\n\nThis run will request ${selectedArtists.length} artist metadata entries, ${selectedAlbums.length} album metadata entries, and ${selectedTracks.length} track metadata entries.\n\nDo you want to continue?`
        : `Load Details will download ${selectedArtists.length} artist metadata entries, ${selectedAlbums.length} album metadata entries, and ${selectedTracks.length} track metadata entries.\n\nThis is enough for most stats. Use \"Load ALL Details\" if you want metadata for everything you've ever listened to.\n\nDo you want to continue?`;
    if (!confirm(confirmMsg)) return;

    const username = document.getElementById("username").value.trim();
    if (!username) return;

    const activeArtistLimit = loadAll ? Infinity : state.artistLimit;
    const activeAlbumLimit = loadAll ? Infinity : state.albumLimit;
    const activeTrackLimit = loadAll ? Infinity : state.trackLimit;

    const fetchedArtists = await fetchAllArtistDetails(selectedArtists, activeArtistLimit);
    console.log("Fetched artist details:", fetchedArtists);

    const fetchedAlbums = await fetchAllAlbumDetails(selectedAlbums, activeAlbumLimit);
    console.log("Fetched album details:", fetchedAlbums);

    const fetchedTracks = await fetchAllTrackDetails(selectedTracks, activeTrackLimit);
    console.log("Fetched track details:", fetchedTracks);

	// Process fetched data and format it before merging
	const newArtistsData = fetchedArtists.map(artist => ({
        ...artist,
        name: artist.name,
        listeners: parseInt(artist.listeners, 10) || 0,
        playcount: parseInt(artist.playcount, 10) || 0,
        tags: artist.tags || []
    }));
    
    const newAlbumsData = fetchedAlbums.map(album => ({
        ...album,
        name: album.name,
        artist: album.artist,
        listeners: parseInt(album.listeners, 10) || 0,
        playcount: parseInt(album.playcount, 10) || 0,
    }));
    
    const newTracksData = fetchedTracks.map(track => ({
        ...track,
        name: track.name,
        artist: track.artist?.name || track.artist,
        duration: parseInt(track.duration, 10) || 0,
        listeners: parseInt(track.listeners, 10) || 0,
        playcount: parseInt(track.playcount, 10) || 0
    }));

	// Merge the new data into existing global arrays while keeping firstscrobble, user_scrobbles, and rank
    state.artistsData = mergeData(state.artistsData, newArtistsData, item => item.name.trim().toLowerCase());
    state.albumsData = mergeData(state.albumsData, newAlbumsData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    state.tracksData = mergeData(state.tracksData, newTracksData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);

	debugLogDataset("Merged artistsData:", state.artistsData);
	debugLogDataset("Merged albumsData:", state.albumsData);
	debugLogDataset("Merged tracksData:", state.tracksData);

	// Detailed metadata is now available: unlock the gated filters/sorts.
	state.extendedDataLoaded = true;
	updateExtendedDataUI();

	// Update display, filters, etc.
	loadingDiv.innerHTML = ""; // Clear loading message
	filterTracks();
    displayEntities();
}

const loadDetailedButton = document.getElementById("load-detailed-data");
if (loadDetailedButton) {
    loadDetailedButton.addEventListener("click", async () => {
        await loadDetailedMetadata(false);
    });
}

const loadAllDetailsButton = document.getElementById("load-all-details");
if (loadAllDetailsButton) {
    loadAllDetailsButton.addEventListener("click", async () => {
        await loadDetailedMetadata(true);
    });
}

// Lightweight live preview shown while history is still downloading, so the
// user sees lists forming instead of a frozen "loading" message. This is a raw
// scrobble-count tally only; the full filter/sort pipeline runs once loading
// finishes and replaces this.
// Tally a set of scrobbles by artist and by track, in the shape the preview
// renderer expects.
function tallyScrobbles(tracks) {
    const artistTally = new Map();
    const trackTally = new Map();
    for (const t of tracks) {
        if (!t || !t.Artist) continue;
        artistTally.set(t.Artist, (artistTally.get(t.Artist) || 0) + 1);
        const trackKey = `${t.Track}||||${t.Artist}`;
        trackTally.set(trackKey, (trackTally.get(trackKey) || 0) + 1);
    }
    return { artistTally, trackTally };
}

// Returning users already have their whole history on disk, so show them their
// lists straight away instead of an empty page while the sync runs. The real,
// filtered lists replace this once the new scrobbles are merged in.
export function renderSavedDataPreview(savedTracks) {
    if (!Array.isArray(savedTracks) || savedTracks.length === 0) return;
    const { artistTally, trackTally } = tallyScrobbles(savedTracks);
    renderLoadingPreview({
        artistTally,
        trackTally,
        headingText: label => `Your top ${label} · ${savedTracks.length.toLocaleString()} saved scrobbles`,
        noteText: "From your saved data, ranked by scrobble count. Checking Last.fm for new scrobbles; your filters apply once that finishes.",
        countLabel: "Scrobbles"
    });
}

export function renderLoadingPreview({ artistTally, trackTally, headingText, noteText, countLabel }) {
    const results = document.getElementById("results");
    if (!results) return;

    const entityTypeEl = document.getElementById("entity-type");
    const entityType = entityTypeEl ? entityTypeEl.value : "track";
    const listLength = parseInt(document.getElementById("list-length")?.value, 10) || 10;

    const useArtists = entityType === "artist";
    const heading = document.querySelector("#results-section h2");
    if (heading) heading.textContent = headingText(useArtists ? "artists" : "tracks");

    let entries;
    if (useArtists) {
        entries = Array.from(artistTally.entries())
            .map(([artist, count]) => ({ title: `<strong>${escapeHTML(artist)}</strong>`, count }));
    } else {
        entries = Array.from(trackTally.entries())
            .map(([key, count]) => {
                const sep = key.indexOf("||||");
                const track = sep >= 0 ? key.slice(0, sep) : key;
                const artist = sep >= 0 ? key.slice(sep + 4) : "";
                return { title: `<strong>${escapeHTML(track)}</strong> by ${escapeHTML(artist)}`, count };
            });
    }

    entries.sort((a, b) => b.count - a.count);
    const top = entries.slice(0, listLength);

    const fragment = document.createDocumentFragment();

    const banner = document.createElement("div");
    banner.className = "loading-preview-banner";
    banner.textContent = noteText;
    fragment.appendChild(banner);

    top.forEach((entry, index) => {
        const row = document.createElement("div");
        row.classList.add(useArtists ? "artist" : "track");
        row.innerHTML = `<strong>${index + 1}.</strong> ${entry.title}<br>${countLabel}: ${entry.count.toLocaleString()}`;
        fragment.appendChild(row);
    });

    results.innerHTML = "";
    results.appendChild(fragment);
}

export async function fetchListeningHistory(username, onPreview = null) {
    // Reset adaptive throttling for a fresh load.
    resetFetchThrottle();

    const buildUrl = (limit, page) =>
        `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json&extended=1&limit=${limit}&autocorrect=0&page=${page}`;

    // Try a large page size first; if the API rejects it (empty/invalid page 1),
    // transparently fall back to the known-good size. Either way the real page
    // count is derived below from what the server actually returns, so a
    // silently capped limit can never drop scrobbles. The probe uses a single
    // quick retry so a rejected large limit falls back fast.
    let pageSize = HISTORY_PAGE_SIZE_LARGE;
    let firstData = await fetchJsonWithRetry(buildUrl(pageSize, 1), 1);
    if (!firstData || !firstData.recenttracks || !Array.isArray(firstData.recenttracks.track) || firstData.recenttracks.track.length === 0) {
        console.warn(`Large page size (${pageSize}) returned no usable data; falling back to ${HISTORY_PAGE_SIZE_SAFE}.`);
        pageSize = HISTORY_PAGE_SIZE_SAFE;
        firstData = await fetchJsonWithRetry(buildUrl(pageSize, 1));
    }

    const apiError = getLastfmErrorMessage(firstData);
    if (apiError) throw new Error(apiError);

    if (!firstData || !firstData.recenttracks || !Array.isArray(firstData.recenttracks.track)) {
        throw new Error("Couldn't reach Last.fm. Check your connection and try again.");
    }

    if (firstData.recenttracks.track.length === 0) {
        throw new Error("That account has no scrobbles yet, so there's nothing to build a list from.");
    }

    const attr = firstData.recenttracks["@attr"] || {};
    const totalScrobbles = parseInt(attr.total, 10) || 0;

    const firstPageTracks = firstData.recenttracks.track.map(mapRecentTrack);
    // "Now playing" tracks have no date and don't count toward pagination.
    const datedOnFirstPage = firstPageTracks.filter(t => t.Date !== null).length || firstPageTracks.length;
    // Derive page count from the server's ACTUAL per-page size, not the requested
    // limit, so it stays correct whether the limit was honoured or capped.
    const effectivePageSize = Math.max(1, datedOnFirstPage);
    const totalPages = totalScrobbles > 0
        ? Math.max(1, Math.ceil(totalScrobbles / effectivePageSize))
        : (parseInt(attr.totalPages, 10) || 1);

    console.log(`History fetch: ${totalScrobbles} scrobbles, page size ${effectivePageSize}, ${totalPages} pages, concurrency ${getFetchConcurrency()}.`);

    const lastfmData = [...firstPageTracks];

    // Running tally that powers the live "building your lists" preview.
    const artistTally = new Map();
    const trackTally = new Map();
    const addToTally = (tracks) => {
        for (const t of tracks) {
            if (!t.Artist) continue;
            artistTally.set(t.Artist, (artistTally.get(t.Artist) || 0) + 1);
            const trackKey = `${t.Track}||||${t.Artist}`;
            trackTally.set(trackKey, (trackTally.get(trackKey) || 0) + 1);
        }
    };
    addToTally(firstPageTracks);

    let pagesLoaded = 1;
    let lastPreviewAt = 0;
    const emitPreview = (force = false) => {
        if (typeof onPreview !== "function") return;
        const now = Date.now();
        if (!force && now - lastPreviewAt < 400) return; // throttle DOM work
        lastPreviewAt = now;
        onPreview({
            artistTally,
            trackTally,
            headingText: label => `Building your top ${label}… ${lastfmData.length.toLocaleString()} scrobbles (page ${pagesLoaded}/${totalPages})`,
            noteText: "Live preview, still loading. Ranked by scrobble count, and your filters apply once loading finishes.",
            countLabel: "Scrobbles so far"
        });
    };

    loadingDiv.innerHTML = `<p>Loading data... Page 1 of ${totalPages}</p>`;
    emitPreview(true);

    if (totalPages > 1) {
        const pageNumbers = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
        await mapWithConcurrency(pageNumbers, async (page) => {
            const data = await fetchJsonWithRetry(buildUrl(pageSize, page));
            if (data && data.recenttracks && Array.isArray(data.recenttracks.track)) {
                const pageTracks = data.recenttracks.track.map(mapRecentTrack);
                lastfmData.push(...pageTracks);
                addToTally(pageTracks);
            } else {
                console.warn(`Skipping page ${page} after multiple failed attempts.`);
            }
            pagesLoaded += 1;
            loadingDiv.innerHTML = `<p>Loading data... Page ${pagesLoaded} of ${totalPages} (${lastfmData.length.toLocaleString()} scrobbles)</p>`;
            emitPreview();
        }, getFetchConcurrency());
    }

    emitPreview(true);
    console.log(`Fetch complete. Total tracks: ${lastfmData.length}`);
    return lastfmData;
}

export async function fetchRecentTracksSince(username, latestTimestamp) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json&extended=1&limit=200&autocorrect=0`;
    let newTracks = [];
    let page = 1;
    let totalPages = 1;
    let keepFetching = true;

    while (keepFetching && page <= totalPages) {
        const data = await fetchJsonWithRetry(`${baseUrl}&page=${page}`);

        const syncError = getLastfmErrorMessage(data);
        if (syncError && page === 1) throw new Error(syncError);

        if (!data || !data.recenttracks || !Array.isArray(data.recenttracks.track)) {
            if (page === 1) {
                throw new Error("Couldn't reach Last.fm to sync new scrobbles. Check your connection and try again.");
            }
            console.error(`Sync Error: No tracks found on page ${page}.`);
            break;
        }

        if (page === 1 && data.recenttracks['@attr'] && data.recenttracks['@attr'].totalPages) {
            totalPages = parseInt(data.recenttracks['@attr'].totalPages, 10);
            console.log(`Syncing started. Total pages to check: ${totalPages}`);
        }

        // ADDED LOGS FOR SYNC
        console.log(`Syncing: Processing page ${page}/${totalPages}...`);
        loadingDiv.innerHTML = `<p>Fetching recent tracks... Page ${page} of ${totalPages}</p>`;

        for (const track of data.recenttracks.track) {
            if (!track.date || !track.date.uts) continue;
            const ts = parseInt(track.date.uts, 10) * 1000;

            if (ts > latestTimestamp) {
                newTracks.push({
                    Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
                    Album: track.album?.["#text"] || "Unknown",
                    Track: track.name || "Unknown",
                    Date: ts
                });
            } else {
                keepFetching = false;
                break;
            }
        }

        if (page % 10 === 0) await new Promise(resolve => setTimeout(resolve, 100));
        page++;
    }

    console.log(`Sync complete. Found ${newTracks.length} new tracks.`);
    return newTracks;
}
