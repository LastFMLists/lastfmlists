// Entry point. Imports every module for its side effects and owns the
// top-level flows that span them.

import { fetchTopAlbums, fetchTopArtists, fetchTopTracks } from './api/lastfm.js';
import { LOAD_ALL_DETAILS_TOOLTIP, LOAD_DETAILS_TOOLTIP, debugLogDataset } from './config.js';
import { filterTracks } from './data/filters.js';
import {
    buildHistoryContextMaps,
    fetchListeningHistory,
    fetchRecentTracksSince,
    renderLoadingPreview,
    renderSavedDataPreview
} from './data/history.js';
import { getUserData, mergeData, saveUserData, topListsFromSavedData } from './data/storage.js';
import { loadingDiv } from './dom.js';
import { initGames } from './games/index.js';
import { state } from './state.js';
import { ensureRaceDateDefaults, updateRaceControlsVisibility } from './ui/charts.js';
import './ui/export.js';
import {
    initializeEquationControls,
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

	if (submitButton) submitButton.disabled = true;
	setAppLoadedState(username);

	// Whether this load came from storage, and how much the sync actually added.
	let syncedFromStorage = false;
	let newScrobbleCount = 0;

	// Try to load saved data for the username from IndexedDB
	let savedData = await getUserData(username).catch(err => {
		console.error("Error retrieving saved data", err);
		return null;
	});

    try {
        if (savedData) {
            // Saved data exists – retrieve the saved tracks, artists, and albums.
            let { allTracks: savedAllTracks, artistsData: savedArtistsData, albumsData: savedAlbumsData, tracksData: savedTracksData } = savedData.data;
    
            // Restore the saved dataset into shared state
            state.artistsData = savedArtistsData || [];
            state.albumsData = savedAlbumsData || [];
            state.tracksData = savedTracksData || [];

            // If the saved dataset already contains detailed metadata, unlock the
            // gated filters/sorts so the user doesn't have to re-download it.
            if (datasetHasExtendedMetadata()) {
                state.extendedDataLoaded = true;
                updateExtendedDataUI();
            }

            // Find the latest track date in the saved allTracks.
            let latestTimestamp = 0;
            savedAllTracks.forEach(track => {
                const ts = parseInt(track.Date);
                if (ts > latestTimestamp) latestTimestamp = ts;
            });
    
            // Show the saved lists while the sync runs, so the page isn't blank.
            renderSavedDataPreview(savedAllTracks);

            // Fetch recent tracks - The function now handles its own progress messages
            const newTracks = await fetchRecentTracksSince(username, latestTimestamp);
            syncedFromStorage = true;
            newScrobbleCount = newTracks.length;

            // Merge new tracks with the saved tracks, keeping chronological order.
            state.allTracks = newTracks.concat(savedAllTracks);

        } else {
            // No saved data exists, fetch all history (with a live preview as pages arrive).
            state.allTracks = await fetchListeningHistory(username, renderLoadingPreview);
        }
    } catch (loadError) {
        // A bad username or an unreachable API used to leave the user staring at
        // an empty app with the failure only in the console.
        console.error("Load failed:", loadError);
        clearAppLoadedState();
        showLoadError(loadError && loadError.message ? loadError.message : "Something went wrong while loading your data.");
        if (submitButton) submitButton.disabled = false;
        return;
    }
    if (submitButton) submitButton.disabled = false;
    
    state.allTracks = state.allTracks.filter(track => {
        if (!track.Date) {
            console.warn("Skipping track due to missing date:", track);
            return false;
        }
        return true;
    });

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
    // API pages and two full passes over the history on every revisit.
    const nothingNew = syncedFromStorage
        && newScrobbleCount === 0
        && state.artistsData.length > 0
        && state.albumsData.length > 0
        && state.tracksData.length > 0;

    if (nothingNew) {
        loadingDiv.innerHTML = "<p>No new scrobbles. Using your saved lists.</p>";
        const saved = topListsFromSavedData();
        state.topArtists = saved.artists;
        state.topAlbums = saved.albums;
        state.topTracks = saved.tracks;
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

        state.allTracks.forEach(item => {
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

	// ✅ Update UI
	filterTracks();
    displayEntities();
	updateActiveFilters();

});

document.getElementById("save-data").addEventListener("click", async () => {
    const username = document.getElementById("username").value.trim();
    const dataToSave = {
      allTracks: state.allTracks,
      artistsData: state.artistsData,
      albumsData: state.albumsData,
      tracksData: state.tracksData
    };
    try {
      await saveUserData(username, dataToSave);
      alert("Data saved to browser successfully!");
    } catch (err) {
      console.error("Error saving data", err);
      alert("Failed to save data.");
    }
  });

document.addEventListener("DOMContentLoaded", () => {
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
});
