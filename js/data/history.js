// Downloading a listening history and the extended per-entity metadata,
// including the live preview shown while pages arrive.

import {
    fetchAlbumDetails,
    fetchArtistDetails,
    fetchTrackDetails,
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
import { escapeHTML, getListLengthLimit, loadingDiv, mapWithConcurrency } from '../dom.js';
import { state } from '../state.js';
import { getLocalDayKeyFromTimestamp } from '../time.js';
import { displayEntities } from '../ui/lists.js';
import { finishLoadNotice, setLoadProgress, startLoadNotice } from '../ui/load-notice.js';
import { updateExtendedDataUI } from '../ui/shell.js';
import { filterTracks } from './filters.js';

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

// Whether an entry already has its Last.fm details. Saves made before the
// detailsLoaded marker existed are recognised by the listener count.
function hasDetails(entry) {
    return Boolean(entry) && (entry.detailsLoaded === true || typeof entry.listeners === "number");
}

// Load Details covers everything played often (over 100 plays for an artist,
// 10 for an album, 5 for a track) and never less than the top 250 artists,
// 500 albums and 1,000 tracks. Load All Details covers every top-list entry.
function selectDetailCandidates(all) {
    const pick = (list, minPlays, atLeast) => {
        if (all) return list.slice();
        const playedOften = list.filter(entry => (parseInt(entry.user_scrobbles, 10) || 0) > minPlays);
        return playedOften.length < atLeast ? list.slice(0, atLeast) : playedOften;
    };
    return {
        artists: pick(state.topArtists, 100, state.artistLimit),
        albums: pick(state.topAlbums, 10, state.albumLimit),
        tracks: pick(state.topTracks, 5, state.trackLimit)
    };
}

// One job per artist, album and track. Each result is written into the
// dataset as soon as it arrives, so Save Data keeps what has loaded and the
// next run only fetches the rest.
function buildDetailJobs(candidates) {
    const kinds = [
        {
            label: "artists",
            list: candidates.artists,
            data: () => state.artistsData,
            key: entry => entry.name.trim().toLowerCase(),
            mapKey: entry => entry.name.toLowerCase(),
            map: () => state.artistDataMap,
            base: entry => ({ name: entry.name }),
            fetch: entry => fetchArtistDetails(entry.name)
        },
        {
            label: "albums",
            list: candidates.albums,
            data: () => state.albumsData,
            key: entry => `${entry.name.trim().toLowerCase()}_${entry.artist.trim().toLowerCase()}`,
            mapKey: entry => `${entry.name.toLowerCase()}||${entry.artist.toLowerCase()}`,
            map: () => state.albumDataMap,
            base: entry => ({ name: entry.name, artist: entry.artist }),
            fetch: entry => fetchAlbumDetails(entry.name, entry.artist)
        },
        {
            label: "tracks",
            list: candidates.tracks,
            data: () => state.tracksData,
            key: entry => `${entry.name.trim().toLowerCase()}_${entry.artist.trim().toLowerCase()}`,
            mapKey: entry => `${entry.name.toLowerCase()}||${entry.artist.toLowerCase()}`,
            map: () => state.trackDataMap,
            base: entry => ({ name: entry.name, artist: entry.artist }),
            fetch: entry => fetchTrackDetails(entry.name, entry.artist)
        }
    ];

    const jobs = [];
    for (const kind of kinds) {
        const index = new Map(kind.data().map(entry => [kind.key(entry), entry]));
        for (const candidate of kind.list) {
            const key = kind.key(candidate);
            jobs.push({ kind, candidate, key, index, done: hasDetails(index.get(key)) });
        }
    }
    return jobs;
}

function storeDetails(job, result) {
    const { kind, candidate, key, index } = job;
    let entry = index.get(key);
    if (!entry) {
        entry = kind.base(candidate);
        kind.data().push(entry);
        index.set(key, entry);
        kind.map()[kind.mapKey(candidate)] = entry;
    }
    if (result.found) {
        const { found, ...details } = result;
        Object.assign(entry, details);
    }
    // Marked even when Last.fm doesn't know the item, so it isn't asked again.
    entry.detailsLoaded = true;
}

let detailsLoading = false;

async function loadDetailedMetadata(loadAll = false) {
    if (detailsLoading) return;

    const allJobs = buildDetailJobs(selectDetailCandidates(loadAll));
    let jobs = allJobs.filter(job => !job.done);
    // "12 artists, 3 albums and 1 track", leaving out kinds with none.
    const countByKind = (list) => {
        const parts = [["artist", "artists"], ["album", "albums"], ["track", "tracks"]]
            .map(([one, many]) => {
                const count = list.filter(job => job.kind.label === many).length;
                return count ? `${count.toLocaleString()} ${count === 1 ? one : many}` : null;
            })
            .filter(Boolean);
        return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join("");
    };

    let confirmMsg;
    if (jobs.length === 0) {
        // Everything already has details: offer to download them again, since
        // listener and play counts on Last.fm keep changing.
        confirmMsg = `Details are already downloaded for all ${countByKind(allJobs)}. Download them again to update the listener and play counts?`;
        jobs = allJobs;
    } else {
        const skipped = allJobs.length - jobs.length;
        const skippedNote = skipped
            ? ` ${skipped.toLocaleString()} more already have details from an earlier run and are skipped.`
            : "";
        confirmMsg = loadAll
            ? `Load All Details downloads metadata for every artist, album and track you have scrobbled: ${countByKind(jobs)}.${skippedNote} This can take hours. Click Save Data if you have to stop, and the next run continues from there.\n\nContinue?`
            : `Load Details downloads metadata for ${countByKind(jobs)}: everything you play often, and at least your top 250 artists, 500 albums and 1,000 tracks.${skippedNote} This is enough for most statistics. Use "Load All Details" for metadata on everything you have scrobbled.\n\nContinue?`;
    }
    if (!confirm(confirmMsg)) return;

    const buttons = ["load-detailed-data", "load-all-details"].map(id => document.getElementById(id)).filter(Boolean);
    detailsLoading = true;
    buttons.forEach(button => { button.disabled = true; });
    startLoadNotice();

    let finished = 0;
    let failed = 0;
    // At most one repaint per 250 ms; an update inside that window is painted
    // when it ends, so a pause in the requests never leaves a stale count.
    let paintTimer = null;
    const paint = () => {
        paintTimer = null;
        loadingDiv.innerHTML = `<p>Loading details... ${finished.toLocaleString()} of ${jobs.length.toLocaleString()}</p>`;
        setLoadProgress(finished / jobs.length);
    };
    const paintProgress = (force = false) => {
        if (force) {
            clearTimeout(paintTimer);
            paint();
        } else if (paintTimer === null) {
            paintTimer = setTimeout(paint, 250);
        }
    };

    try {
        paintProgress(true);
        await mapWithConcurrency(jobs, async (job) => {
            const result = await job.kind.fetch(job.candidate);
            if (result) storeDetails(job, result);
            else failed += 1;
            finished += 1;
            paintProgress();
        }, 4);
    } finally {
        clearTimeout(paintTimer);
        detailsLoading = false;
        buttons.forEach(button => { button.disabled = false; });
    }

    debugLogDataset("Merged artistsData:", state.artistsData);
    debugLogDataset("Merged albumsData:", state.albumsData);
    debugLogDataset("Merged tracksData:", state.tracksData);

    // Detailed metadata is now available: unlock the gated filters/sorts.
    state.extendedDataLoaded = true;
    updateExtendedDataUI();
    finishLoadNotice("Your details are loaded.");

    // Items that failed have no marker, so the next run picks them up.
    loadingDiv.innerHTML = failed
        ? `<p class="load-incomplete">Details for ${failed.toLocaleString()} ${failed === 1 ? "item" : "items"} couldn't be downloaded. Click Save Data, then load details again later to fetch just those.</p>`
        : "";
    filterTracks();
    displayEntities();
    // Explore shows boxes that need details once they are there.
    document.dispatchEvent(new CustomEvent("data:changed"));
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
    const listLength = getListLengthLimit();

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
    const top = entries.slice(0, Math.min(listLength, 100));

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

// ---- Downloading the history ----
//
// A load walks user.getRecentTracks page by page over a fixed range. `to` is
// pinned just past the newest scrobble that existed when the walk began, so
// scrobbles made while it runs can't shift the pages. That keeps the page
// numbers valid after a refresh too, which is what lets a half-finished load
// be saved and continued later. A range is:
//   from        newest scrobble already covered (seconds), or null for a whole history
//   anchor      newest scrobble in the range (seconds); requests use to = anchor + 1
//   limit       the page size requested
//   total       scrobbles Last.fm counted in the range when the walk began
//   totalPages  derived from total and the page size the server actually used
//   done        page numbers fully downloaded

function recentTracksUrl(username, { limit, page, from = null, to = null }) {
    let url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json&extended=1&limit=${limit}&autocorrect=0&page=${page}`;
    if (from !== null) url += `&from=${from}`;
    if (to !== null) url += `&to=${to}`;
    return url;
}

// The scrobbles in a response, or null if the request failed. Last.fm sends a
// lone scrobble as an object rather than a one-item array.
function recentTrackList(data) {
    if (!data || !data.recenttracks) return null;
    const list = data.recenttracks.track;
    if (Array.isArray(list)) return list;
    return list ? [list] : [];
}

// The scrobbles on a page that belong to the range. "Now playing" has no date,
// and Last.fm may or may not count `from` itself as inside the range, so
// anything at or before it is dropped here.
function rangeTracks(list, from) {
    const fromMs = from === null ? -Infinity : from * 1000;
    return list
        .filter(track => track && track.date && track.date.uts)
        .map(mapRecentTrack)
        .filter(track => track.Date > fromMs);
}

function serializeRange(range) {
    return { ...range, done: [...range.done].sort((a, b) => a - b) };
}

// Newest scrobble on the account (seconds), or null if it has none.
async function fetchNewestScrobbleTime(username) {
    const data = await fetchJsonWithRetry(recentTracksUrl(username, { limit: 10, page: 1 }));
    const apiError = getLastfmErrorMessage(data);
    if (apiError) throw new Error(apiError);
    const list = recentTrackList(data);
    if (!list) throw new Error("Couldn't reach Last.fm. Check your connection and try again.");
    const newest = list.find(track => track && track.date && track.date.uts);
    return newest ? parseInt(newest.date.uts, 10) : null;
}

async function openRange(username, from, anchor) {
    const to = anchor + 1;
    // Try a large page size first and fall back to the known-good one if the
    // API rejects it. The page count comes from what the server actually
    // returns, so a silently capped limit can't drop scrobbles either way.
    let limit = HISTORY_PAGE_SIZE_LARGE;
    let data = await fetchJsonWithRetry(recentTracksUrl(username, { limit, page: 1, from, to }), 1);
    if (!recentTrackList(data)?.length) {
        limit = HISTORY_PAGE_SIZE_SAFE;
        data = await fetchJsonWithRetry(recentTracksUrl(username, { limit, page: 1, from, to }));
    }

    const apiError = getLastfmErrorMessage(data);
    if (apiError) throw new Error(apiError);
    const list = recentTrackList(data);
    if (!list) throw new Error("Couldn't reach Last.fm. Check your connection and try again.");

    const total = parseInt(data.recenttracks["@attr"]?.total, 10) || 0;
    const servedPageSize = Math.max(1, list.filter(track => track && track.date && track.date.uts).length);
    const totalPages = total > 0 ? Math.max(1, Math.ceil(total / servedPageSize)) : 1;
    console.log(`History range: ${total} scrobbles, page size ${servedPageSize}, ${totalPages} pages.`);

    return {
        range: { from, anchor, limit, total, totalPages, done: new Set([1]) },
        firstPage: rangeTracks(list, from)
    };
}

// A saved range can only be continued if Last.fm still counts the same
// scrobbles in it. A deleted or back-dated scrobble would move every later
// page, so a changed total means starting the range again.
async function rangeStillMatches(username, range) {
    const data = await fetchJsonWithRetry(recentTracksUrl(username, {
        limit: range.limit, page: 1, from: range.from, to: range.anchor + 1
    }));
    const apiError = getLastfmErrorMessage(data);
    if (apiError) throw new Error(apiError);
    if (!recentTrackList(data)) throw new Error("Couldn't reach Last.fm. Check your connection and try again.");
    return (parseInt(data.recenttracks["@attr"]?.total, 10) || 0) === range.total;
}

// Downloads every page of the range not yet in `pages`. Pages that fail are
// tried once more at the end; returns whether every page arrived.
async function walkRange(username, range, pages, onPage) {
    const missingPages = () => {
        const missing = [];
        for (let page = 1; page <= range.totalPages; page++) {
            if (!range.done.has(page)) missing.push(page);
        }
        return missing;
    };

    const fetchPage = async (page) => {
        const data = await fetchJsonWithRetry(recentTracksUrl(username, {
            limit: range.limit, page, from: range.from, to: range.anchor + 1
        }));
        const list = recentTrackList(data);
        // Only the last page may come back empty; an empty page in the middle
        // is a failed request.
        if (!list || (list.length === 0 && page < range.totalPages)) {
            console.warn(`Page ${page} of ${range.totalPages} failed; it will be tried again.`);
            return;
        }
        const tracks = rangeTracks(list, range.from);
        pages.set(page, tracks);
        range.done.add(page);
        onPage(tracks);
    };

    await mapWithConcurrency(missingPages(), fetchPage, getFetchConcurrency());
    for (const page of missingPages()) {
        await fetchPage(page);
    }
    return missingPages().length === 0;
}

// Downloads everything the saved data doesn't have yet: the whole history for
// a new user, the missing pages of a load that was saved part-way, and what
// was scrobbled since. While it runs, state.historyLoad.snapshot() returns
// what has fully arrived, for Save Data. `progress` in the result is set when
// some pages still couldn't be downloaded; `missing` counts their scrobbles.
export async function loadHistory(username, saved, onPreview = null) {
    resetFetchThrottle();

    const savedTracks = Array.isArray(saved?.allTracks) ? saved.allTracks.filter(track => track && track.Date) : [];
    let base = savedTracks;
    let range = null;
    let from = null;
    if (saved?.historyProgress) {
        range = { ...saved.historyProgress, done: new Set(saved.historyProgress.done) };
        from = range.from;
    } else if (savedTracks.length) {
        let newest = 0;
        for (const track of savedTracks) {
            const ts = parseInt(track.Date, 10);
            if (ts > newest) newest = ts;
        }
        from = Math.floor(newest / 1000);
    }

    const pages = new Map();
    let fetchedAnything = false;
    state.historyLoad = {
        username,
        phase: "history",
        snapshot: () => ({
            allTracks: base.concat(...pages.values()),
            historyProgress: range ? serializeRange(range) : null
        })
    };

    loadingDiv.innerHTML = savedTracks.length ? `<p>Checking for new scrobbles...</p>` : `<p>Loading data...</p>`;
    const newest = await fetchNewestScrobbleTime(username);
    if (newest === null && !base.length) {
        throw new Error("That account has no scrobbles yet, so there's nothing to build a list from.");
    }

    if (range) {
        loadingDiv.innerHTML = `<p>Continuing your saved load...</p>`;
        if (await rangeStillMatches(username, range)) {
            fetchedAnything = true;
        } else {
            console.warn("The saved part of the history changed on Last.fm since it was saved; loading that part again.");
            base = range.from === null ? [] : base.filter(track => parseInt(track.Date, 10) <= range.from * 1000);
            range = null;
            fetchedAnything = true;
        }
    }

    // A whole history being built shows its top lists as pages arrive; a
    // sync shows the saved lists, which are almost complete already.
    const buildingWholeHistory = from === null;
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
    let scrobbleCount = base.length;
    let lastPreviewAt = 0;
    const emitPreview = (force = false) => {
        if (!buildingWholeHistory || typeof onPreview !== "function" || !range) return;
        const now = Date.now();
        if (!force && now - lastPreviewAt < 400) return; // throttle DOM work
        lastPreviewAt = now;
        onPreview({
            artistTally,
            trackTally,
            headingText: label => `Building your top ${label}… ${scrobbleCount.toLocaleString()} scrobbles (page ${range.done.size}/${range.totalPages})`,
            noteText: "Live preview, still loading. Ranked by scrobble count, and your filters apply once loading finishes.",
            countLabel: "Scrobbles so far"
        });
    };
    const showPageProgress = () => {
        loadingDiv.innerHTML = buildingWholeHistory
            ? `<p>Loading data... Page ${range.done.size} of ${range.totalPages} (${scrobbleCount.toLocaleString()} scrobbles)</p>`
            : `<p>Fetching new scrobbles... page ${range.done.size} of ${range.totalPages}</p>`;
        setLoadProgress(range.done.size / range.totalPages);
    };

    if (buildingWholeHistory) addToTally(base);
    else renderSavedDataPreview(base);

    let complete = true;
    while (true) {
        if (!range) {
            if (newest === null || (from !== null && newest <= from)) break;
            const opened = await openRange(username, from, newest);
            range = opened.range;
            pages.set(1, opened.firstPage);
            addToTally(opened.firstPage);
            scrobbleCount += opened.firstPage.length;
            fetchedAnything = true;
        }
        showPageProgress();
        emitPreview(true);

        complete = await walkRange(username, range, pages, (pageTracks) => {
            addToTally(pageTracks);
            scrobbleCount += pageTracks.length;
            showPageProgress();
            emitPreview();
        });
        if (!complete) break;

        // This range is done; anything scrobbled after it (a saved load that
        // is being continued days later) goes into the next one.
        base = base.concat(...pages.values());
        pages.clear();
        from = range.anchor;
        range = null;
    }

    emitPreview(true);
    // The top lists and rankings still have to be built, so drop the percentage
    // rather than sit at 100% while that runs.
    setLoadProgress(null);

    const { allTracks: tracks } = state.historyLoad.snapshot();
    let missing = 0;
    if (!complete) {
        const fromMs = range.from === null ? -Infinity : range.from * 1000;
        const inRange = tracks.reduce((count, track) => count + (parseInt(track.Date, 10) > fromMs ? 1 : 0), 0);
        missing = Math.max(0, range.total - inRange);
    }
    console.log(`History loaded: ${tracks.length} scrobbles${complete ? "" : `, about ${missing} still missing`}.`);
    return {
        tracks,
        progress: complete ? null : serializeRange(range),
        missing,
        changed: fetchedAnything
    };
}
