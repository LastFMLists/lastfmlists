// Entry point. Imports every module for its side effects and owns the
// top-level flows that span them.

import { durationBucket, libraryBucket, trackEvent } from './analytics.js';
import { fetchTopAlbums, fetchTopArtists, fetchTopTracks } from './api/lastfm.js';
import { LOAD_ALL_DETAILS_TOOLTIP, LOAD_DETAILS_TOOLTIP, debugLogDataset } from './config.js';
import { filterTracks } from './data/filters.js';
import {
    buildHistoryContextMaps,
    loadHistory,
    renderLoadingPreview
} from './data/history.js';
import { getUserData, mergeData, saveUserData, topListsFromSavedData } from './data/storage.js';
import { loadingDiv } from './dom.js';
import { initGames } from './games/index.js';
import { state } from './state.js';
import { hasKnownDate } from './time.js';
import { ensureRaceDateDefaults, updateRaceControlsVisibility } from './ui/charts.js';
import './ui/entity-page.js';
import './ui/equation-editor.js';
import './ui/explore.js';
import './ui/graphs.js';
import { openGraphFromLink } from './ui/graphs.js';
import { applySettings, startFromUrl, takePendingGraph, takePendingSettings } from './ui/url-state.js';
import './ui/export.js';
import { initFilterControls } from './ui/filter-controls.js';
import { failLoadNotice, finishLoadNotice, startLoadNotice } from './ui/load-notice.js';
import './ui/support-banner.js';
import {
    initializeEquationControls,
    resetFilterControls,
    syncActiveFiltersFromControls,
    updateActiveFilters,
    updateComparisonInteractionState
} from './ui/filters-panel.js';
import { displayEntities } from './ui/lists.js';
import {
    clearAppLoadedState,
    clearLoadError,
    datasetHasExtendedMetadata,
    enableGamesTab,
    setAppLoadedState,
    rememberedView,
    replacingViewHistory,
    setActiveView,
    setListControlsLocked,
    showLoadError,
    updateExtendedDataUI
} from './ui/shell.js';

// Event listener for form submission (data load)
document.getElementById("username-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	const username = document.getElementById("username").value.trim();
	const submitButton = document.getElementById("load-data");

	clearLoadError();
	if (!username) return;
	// Starts minus finished loads and errors shows how many people give up
	// while their history is loading.
	const loadStartedAt = performance.now();
	trackEvent("load/start", "Load started");
	startLoadNotice();
	// Browsers slow down hidden tabs, so loads that were left in the
	// background are counted apart from the ones someone watched.
	let switchedAway = document.visibilityState === "hidden";
	const noteSwitchedAway = () => {
		if (document.visibilityState === "hidden") switchedAway = true;
	};
	document.addEventListener("visibilitychange", noteSwitchedAway);

	if (submitButton) submitButton.disabled = true;
	setAppLoadedState(username);
	state.loadedUsername = username;
	setListControlsLocked(true);

	// Try to load saved data for the username from IndexedDB
	let savedData = await getUserData(username).catch(err => {
		console.error("Error retrieving saved data", err);
		return null;
	});
	const saved = savedData?.data || null;

	// Covers from an earlier save, so the sync below only adds new ones.
	state.albumArt = { ...(saved?.albumArt || {}) };

    let history;
    try {
        if (saved) {
            // Restore the saved lists; they are rebuilt below if anything changed.
            state.artistsData = saved.artistsData || [];
            state.albumsData = saved.albumsData || [];
            state.tracksData = saved.tracksData || [];

            // If the saved dataset already contains detailed metadata, unlock the
            // gated filters/sorts so the user doesn't have to re-download it.
            if (datasetHasExtendedMetadata()) {
                state.extendedDataLoaded = true;
                updateExtendedDataUI();
            }
            if (saved.historyProgress) trackEvent("load/resumed", "Continued a saved load");
        }

        // Downloads whatever the saved data is missing, or the whole history.
        history = await loadHistory(username, saved, renderLoadingPreview);
    } catch (loadError) {
        // A bad username or an unreachable API used to leave the user staring at
        // an empty app with the failure only in the console.
        console.error("Load failed:", loadError);
        state.historyLoad = null;
        setListControlsLocked(false);
        clearAppLoadedState();
        trackEvent("load/error", "Load failed");
        document.removeEventListener("visibilitychange", noteSwitchedAway);
        const loadErrorMessage = loadError && loadError.message ? loadError.message : "Something went wrong while loading your data.";
        failLoadNotice(loadErrorMessage);
        showLoadError(loadErrorMessage);
        if (submitButton) submitButton.disabled = false;
        return;
    }
    if (submitButton) submitButton.disabled = false;

    // From here Save Data stores the full history, marked to rebuild its lists.
    state.historyLoad.phase = "finishing";
    state.historyProgress = history.progress;
    const syncedFromStorage = Boolean(saved);

    // Scrobbles Last.fm has no date for are kept apart, so nothing that reads
    // dates sees them and allTracks stays in time order.
    state.allTracks = history.tracks.filter(hasKnownDate);
    state.undatedTracks = history.tracks.filter(track => !hasKnownDate(track));
    // Older saves numbered them as the first scrobbles; they have no place in the order.
    state.undatedTracks.forEach(track => { delete track.order; });
    if (state.undatedTracks.length) {
        console.log(`${state.undatedTracks.length} scrobbles have no date; lists that use time leave them out.`);
    }

    // Sort allTracks by date (assuming track.Date is a timestamp in milliseconds as a string)
    state.allTracks.sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));

    // Assign an order key (index + 1) to each track
    state.allTracks = state.allTracks.map((track, index) => {
        track.order = index + 1;
        return track;
    });

    buildHistoryContextMaps();
    ensureRaceDateDefaults(true);

    // With no new scrobbles there is nothing to recompute: the saved dataset
    // already holds every ranking, first/last date and per-entity count this
    // block would rebuild, and Last.fm's top lists are derived from the user's
    // own plays, so they cannot have moved either. Skipping it saves hundreds of
    // API pages and two full passes over the history on every revisit. Lists
    // saved before their load finished are always rebuilt.
    const nothingNew = syncedFromStorage
        && !history.changed
        && !saved.listsNeedRebuild
        && state.artistsData.length > 0
        && state.albumsData.length > 0
        && state.tracksData.length > 0;

    if (nothingNew) {
        loadingDiv.innerHTML = "<p>No new scrobbles. Using your saved lists.</p>";
        const savedLists = topListsFromSavedData();
        state.topArtists = savedLists.artists;
        state.topAlbums = savedLists.albums;
        state.topTracks = savedLists.tracks;
    } else {
    	// ✅ ALWAYS re-fetch the top stats to update rankings and counts!
    	// These three are independent, so fetch them concurrently.
    	[state.topArtists, state.topAlbums, state.topTracks] = await Promise.all([
    		fetchTopArtists(username),
    		fetchTopAlbums(username),
    		fetchTopTracks(username)
    	]);

        // Reset track counts in artistsData and albumsData
        const artistTrackSets = Object.create(null);
        const albumTrackSets = Object.create(null);

        state.allTracks.concat(state.undatedTracks).forEach(item => {
            const artistKey = item.Artist.trim().toLowerCase();
            const albumKey = `${item.Album.trim().toLowerCase()}||${item.Artist.trim().toLowerCase()}`;
            const trackKey = item.Track.trim().toLowerCase();

            if (!artistTrackSets[artistKey]) artistTrackSets[artistKey] = new Set();
            if (!albumTrackSets[albumKey]) albumTrackSets[albumKey] = new Set();

            artistTrackSets[artistKey].add(trackKey);
            albumTrackSets[albumKey].add(trackKey);
        });

    	// Objects to track earliest scrobbles
    	const firstScrobbles = { artists: {}, albums: {}, tracks: {} };
        const lastScrobbles = { artists: {}, albums: {}, tracks: {} };
        loadingDiv.innerHTML = "<p>Processing first/last scrobbles...</p>";

    	// Iterate over allTracks to determine first scrobbles
    	state.allTracks.forEach(track => {
    		if (!track.Artist || !track.Track || !track.Date) {
    			console.warn("Skipping track due to missing data:", track);
    			return;
    		}

    		const artistKey = track.Artist.trim().toLowerCase();
    		const albumKey = track.Album?.trim() ? `${track.Album.trim().toLowerCase()}||${artistKey}` : null;
    		const trackKey = `${track.Track.trim().toLowerCase()}_${artistKey}`;
    		const uts = parseInt(track.Date, 10); // Already in milliseconds

    		if (!firstScrobbles.artists[artistKey] || uts < firstScrobbles.artists[artistKey]) {
    			firstScrobbles.artists[artistKey] = uts;
    		}
    		if (albumKey && (!firstScrobbles.albums[albumKey] || uts < firstScrobbles.albums[albumKey])) {
    			firstScrobbles.albums[albumKey] = uts;
    		}
    		if (!firstScrobbles.tracks[trackKey] || uts < firstScrobbles.tracks[trackKey]) {
    			firstScrobbles.tracks[trackKey] = uts;
    		}

            if (!lastScrobbles.artists[artistKey] || uts > lastScrobbles.artists[artistKey]) {
                lastScrobbles.artists[artistKey] = uts;
            }
        
            // For albums: if we haven't stored a value yet, or if this track's uts is later than the stored one, update it.
            if (albumKey && (!lastScrobbles.albums[albumKey] || uts > lastScrobbles.albums[albumKey])) {
                lastScrobbles.albums[albumKey] = uts;
            }
        
            // For tracks: if we haven't stored a value yet, or if this track's uts is later than the stored one, update it.
            if (!lastScrobbles.tracks[trackKey] || uts > lastScrobbles.tracks[trackKey]) {
                lastScrobbles.tracks[trackKey] = uts;
            }
    	});

    	// ✅ Update data arrays with correct first scrobbles
        const newArtistsData = state.topArtists.map((artist, index) => {
            const key = artist.name.trim().toLowerCase();
            return {
                name: artist.name,
                rank: index + 1, // Overwrite rank from the new fetch
                firstscrobble: firstScrobbles.artists?.[key] ?? null,
                lastscrobble: lastScrobbles.artists?.[key] ?? null,
                user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0,
                track_count: artistTrackSets[key] ? artistTrackSets[key].size : 0
            };
        });
    
        // Create newAlbumsData with track counts
        const newAlbumsData = state.topAlbums.map((album, index) => {
            const key = `${album.name.trim().toLowerCase()}||${album.artist.trim().toLowerCase()}`;
            return {
                name: album.name,
                artist: album.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.albums?.[key] ?? null,
                lastscrobble: lastScrobbles.albums?.[key] ?? null,
                user_scrobbles: parseInt(album.user_scrobbles, 10) || 0,
                track_count: albumTrackSets[key] ? albumTrackSets[key].size : 0
            };
        });
    
        const newTracksData = state.topTracks.map((track, index) => {
            const key = `${track.name.trim().toLowerCase()}_${track.artist.trim().toLowerCase()}`;
            return {
                name: track.name,
                artist: track.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.tracks?.[key] ?? null,
                lastscrobble: lastScrobbles.tracks?.[key] ?? null,
                user_scrobbles: parseInt(track.user_scrobbles, 10) || 0
            };
        });
    
        loadingDiv.innerHTML = "<p>Merging data...</p>";

        // Merge new data into the existing arrays (only updating the keys specified)
        state.artistsData = mergeData(state.artistsData, newArtistsData, item => item.name.trim().toLowerCase());
        state.albumsData = mergeData(state.albumsData, newAlbumsData, 
            item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
        state.tracksData = mergeData(state.tracksData, newTracksData, 
            item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    
        debugLogDataset("Merged artistsData:", state.artistsData);
    	debugLogDataset("Merged albumsData:", state.albumsData);
    	debugLogDataset("Merged tracksData:", state.tracksData);
    }

    loadingDiv.innerHTML = "<p>Mapping artists...</p>";

    state.artistDataMap = state.artistsData.reduce((map, artist) => {
        map[artist.name.toLowerCase()] = artist;
        return map;
    }, {});

    loadingDiv.innerHTML = "<p>Mapping albums...</p>";
    
    state.albumDataMap = state.albumsData.reduce((map, album) => {
        map[`${album.name.toLowerCase()}||${album.artist.toLowerCase()}`] = album;
        return map;
    }, {});

    loadingDiv.innerHTML = "<p>Mapping tracks...</p>";
    
    state.trackDataMap = state.tracksData.reduce((map, track) => {
        map[`${track.name.toLowerCase()}||${track.artist.toLowerCase()}`] = track;
        return map;
    }, {});

	// ✅ Enable "Load Detailed Data" button
	const loadDetailedBtn = document.getElementById("load-detailed-data");
    const loadAllDetailsBtn = document.getElementById("load-all-details");
    if (loadDetailedBtn) {
        loadDetailedBtn.disabled = false;
        loadDetailedBtn.title = LOAD_DETAILS_TOOLTIP;
    }
    if (loadAllDetailsBtn) {
        loadAllDetailsBtn.disabled = false;
        loadAllDetailsBtn.title = LOAD_ALL_DETAILS_TOOLTIP;
    }

	debugLogDataset("Final allTracks:", state.allTracks);
	loadingDiv.innerHTML = ""; // Clear loading message

    setAppLoadedState(username);
    enableGamesTab();
    trackEvent(syncedFromStorage ? "load/saved" : "load/fresh",
        syncedFromStorage ? "Loaded from saved data" : "Loaded from Last.fm");
    const bucket = libraryBucket(state.allTracks.length);
    trackEvent(`library/${bucket}`, `Library size: ${bucket} scrobbles`);
    // Load time depends mostly on library size, so the two go in one path.
    document.removeEventListener("visibilitychange", noteSwitchedAway);
    const loadKind = (syncedFromStorage ? "saved" : "fresh") + (switchedAway ? "-away" : "");
    const loadTime = durationBucket((performance.now() - loadStartedAt) / 1000);
    trackEvent(`load-time/${loadKind}/${bucket}/${loadTime}`,
        `Load time (${loadKind}, ${bucket} scrobbles): ${loadTime}`);

	// ✅ Update UI
	syncActiveFiltersFromControls();
	filterTracks();
    displayEntities();
	updateActiveFilters();
	finishLoadNotice();

    state.historyLoad = null;
    setListControlsLocked(false);
    // A link's list settings open that list, and a graph link opens its
    // graph (after its list, when it graphs a list's plays). Otherwise the
    // first visit lands on Explore and later ones on the tab used last.
    const linkSettings = takePendingSettings();
    const linkGraph = takePendingGraph();
    replacingViewHistory(() => {
        if (linkSettings) applySettings(linkSettings);
        if (linkGraph) openGraphFromLink(linkGraph);
        else if (!linkSettings) setActiveView(rememberedView() || "explore");
    });
    if (history.progress) {
        // Some pages never arrived. The lists work, but say what's missing and
        // how to fill the gap: a saved copy remembers the missing pages.
        trackEvent("load/incomplete", "Load finished with pages missing");
        loadingDiv.innerHTML = `<p class="load-incomplete">About ${history.missing.toLocaleString()} scrobbles couldn't be downloaded, so these lists are missing them. Click Save Data, then load the same username again later to fetch the rest.</p>`;
    }
});

document.getElementById("save-data").addEventListener("click", async () => {
    const load = state.historyLoad;
    const username = load?.username || state.loadedUsername || document.getElementById("username").value.trim();

    // While scrobbles are still downloading, only the pages that have fully
    // arrived are saved, with a note of the ones still missing, so the next
    // load of this username fetches just those.
    let allTracks = state.allTracks.concat(state.undatedTracks);
    let historyProgress = state.historyProgress;
    if (load && load.phase === "history") {
        ({ allTracks, historyProgress } = load.snapshot());
    }
    if (!allTracks.length) {
        alert("There's nothing to save yet. Wait until some of your history has loaded.");
        return;
    }

    const dataToSave = {
      allTracks,
      artistsData: state.artistsData,
      albumsData: state.albumsData,
      tracksData: state.tracksData,
      albumArt: state.albumArt,
      historyProgress,
      // Lists saved before their load finished don't match its scrobbles yet.
      listsNeedRebuild: Boolean(load)
    };
    try {
      await saveUserData(username, dataToSave);
      alert(historyProgress
        ? `Saved ${allTracks.length.toLocaleString()} scrobbles in this browser. Load the same username again to continue where this load stopped.`
        : "Your data is saved in this browser.");
    } catch (err) {
      console.error("Error saving data", err);
      alert("Your data could not be saved in this browser.");
    }
  });

document.addEventListener("DOMContentLoaded", () => {
    // A refresh starts with clean filters, whatever the browser restored.
    resetFilterControls();
    initFilterControls();
    initializeEquationControls();
    ensureRaceDateDefaults();
    updateRaceControlsVisibility();
    updateComparisonInteractionState();
    updateExtendedDataUI(); // Start with metadata-only controls locked.
    initGames();

    document.querySelectorAll(".dropdown-button").forEach(button => {
        button.addEventListener("click", (event) => {
            event.stopPropagation(); // Prevent immediate closing when clicking the button
            let dropdownContent = button.nextElementSibling;

            // Close other dropdowns before opening the current one
            document.querySelectorAll(".dropdown-content").forEach(menu => {
                if (menu !== dropdownContent) menu.style.display = "none";
            });

            // Toggle the clicked dropdown
            dropdownContent.style.display = dropdownContent.style.display === "block" ? "none" : "block";
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener("click", () => {
        document.querySelectorAll(".dropdown-content").forEach(menu => {
            menu.style.display = "none";
        });
    });

    // A link with a username loads it; its list settings apply after loading.
    startFromUrl();
});
