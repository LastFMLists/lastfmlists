// Saving and restoring a user's dataset in IndexedDB, plus CSV import.

import { fetchTopAlbums, fetchTopArtists, fetchTopTracks } from '../api/lastfm.js';
import {
    DB_NAME,
    DB_VERSION,
    LOAD_ALL_DETAILS_TOOLTIP,
    LOAD_DETAILS_TOOLTIP,
    STORE_NAME,
    debugLogDataset
} from '../config.js';
import { loadingDiv } from '../dom.js';
import { state } from '../state.js';
import { ensureRaceDateDefaults } from '../ui/charts.js';
import { updateActiveFilters } from '../ui/filters-panel.js';
import { displayEntities } from '../ui/lists.js';
import { enableGamesTab, setAppLoadedState } from '../ui/shell.js';
import { filterTracks } from './filters.js';
import { buildHistoryContextMaps } from './history.js';

// Helper function to merge new data into an existing array by matching a key
export function mergeData(existingArray = [], newData, keyFn) {
    if (!Array.isArray(existingArray)) {
        existingArray = [];
    }

    const existingMap = new Map(
        existingArray.map(item => [keyFn(item), item])
    );

    newData.forEach(newItem => {
        const key = keyFn(newItem);
        const existingItem = existingMap.get(key);

        if (existingItem) {
            // Preserve existing properties and add new ones
            Object.entries(newItem).forEach(([prop, value]) => {
                if (value !== undefined && value !== null) {
                    existingItem[prop] = value;
                }
            });
        } else {
            existingArray.push(newItem);
        }
    });

    return existingArray;
}

function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (event) => {
        console.error('IndexedDB open error', event);
        reject(event);
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'username' });
        }
      };
    });
}

function sanitizeForIndexedDb(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
        return value;
    }

    if (valueType === 'function' || valueType === 'symbol') {
        return undefined;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Array.isArray(value)) {
        return value
            .map(item => sanitizeForIndexedDb(item, seen))
            .filter(item => item !== undefined);
    }

    if (value instanceof Set) {
        return Array.from(value)
            .map(item => sanitizeForIndexedDb(item, seen))
            .filter(item => item !== undefined);
    }

    if (value instanceof Map) {
        const mapped = {};
        value.forEach((entryValue, entryKey) => {
            const key = String(entryKey);
            const safeEntryValue = sanitizeForIndexedDb(entryValue, seen);
            if (safeEntryValue !== undefined) {
                mapped[key] = safeEntryValue;
            }
        });
        return mapped;
    }

    if (valueType === 'object') {
        if (seen.has(value)) {
            return undefined;
        }
        seen.add(value);

        const result = {};
        Object.keys(value).forEach(key => {
            const safeValue = sanitizeForIndexedDb(value[key], seen);
            if (safeValue !== undefined) {
                result[key] = safeValue;
            }
        });
        return result;
    }

    return undefined;
}

function normalizeUsernameKey(username) {
    return (username || "").toString().trim().toLowerCase();
}

export function saveUserData(username, data) {
    if (!data || Object.keys(data).length === 0) {
        return Promise.reject(new Error('Cannot save empty data'));
    }

    const normalizedUsername = normalizeUsernameKey(username);
    if (!normalizedUsername) {
        return Promise.reject(new Error('Cannot save data without a username'));
    }

    const safeData = sanitizeForIndexedDb(data);

    return openDatabase().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ username: normalizedUsername, data: safeData, timestamp: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event);
        });
    });
}

export function getUserData(username) {
    const normalizedUsername = normalizeUsernameKey(username);
    if (!normalizedUsername) {
        return Promise.resolve(null);
    }

    return openDatabase().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(normalizedUsername);

        request.onsuccess = (event) => {
            const directMatch = event.target.result;
            if (directMatch) {
                resolve(directMatch);
                return;
            }

            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const allEntries = Array.isArray(getAllRequest.result) ? getAllRequest.result : [];
                const legacyMatch = allEntries.find(entry => normalizeUsernameKey(entry?.username) === normalizedUsername) || null;

                if (!legacyMatch) {
                    resolve(null);
                    return;
                }

                const migratedEntry = {
                    ...legacyMatch,
                    username: normalizedUsername,
                    timestamp: legacyMatch.timestamp || Date.now()
                };

                const migrateRequest = store.put(migratedEntry);
                migrateRequest.onsuccess = () => {
                    if (legacyMatch.username !== normalizedUsername) {
                        store.delete(legacyMatch.username);
                    }
                    resolve(migratedEntry);
                };
                migrateRequest.onerror = (migrationError) => reject(migrationError);
            };
            getAllRequest.onerror = (getAllError) => reject(getAllError);
        };

        request.onerror = (event) => reject(event);
      });
    });
}

// Load CSV file
const csvFileInput = document.getElementById('csv-file');
if (csvFileInput) csvFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;

        // ✅ Parse the CSV (including extracting username)
        state.allTracks = parseCSV(csvData);

        // ✅ Try extracting the username if missing
        if (!state.allTracks.username) {
            console.warn("Username missing from parsed data, checking CSV manually...");
            const firstLine = csvData.split("\n")[0]; // Get the first line
            console.log("CSV First Line:", firstLine);

            const match = firstLine.match(/Date#(.*)/);
            if (match && match[1]) {
                state.allTracks.username = match[1].trim();
                console.log("Extracted username from CSV:", state.allTracks.username);
            } else {
                console.error("Failed to extract Last.fm username from CSV.");
                return;
            }
        }

        // ✅ Ensure a username exists after parsing
        if (!state.allTracks.username) {
            console.error("Failed to extract Last.fm username from CSV.");
            return;
        }
        const username = state.allTracks.username;
        console.log("Detected Last.fm username:", username);

        // ✅ Initialize tracking objects
        // Was an implicit global; declared properly so it stays local (and so
        // this file can run in strict mode).
        const raw_data = [];
        const firstScrobbles = { artists: {}, albums: {}, tracks: {} };
        const lastScrobbles = { artists: {}, albums: {}, tracks: {} };
        const artistTrackSets = Object.create(null);
        const albumTrackSets = Object.create(null);

        // ✅ Iterate over allTracks to determine first scrobbles and track counts
        state.allTracks.forEach(track => {
            if (!track.artist || !track.track || !track.date) {
                console.warn("Skipping track due to missing data:", track);
                return;
            }

            const artistKey = track.artist.trim().toLowerCase();
            const albumKey = track.album?.trim() ? `${track.album.trim().toLowerCase()}_${artistKey}` : null;
            const trackKey = `${track.track.trim().toLowerCase()}_${artistKey}`;
            const uts = parseInt(track.date, 10); // Already in milliseconds

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

            if (!artistTrackSets[artistKey]) artistTrackSets[artistKey] = new Set();
            if (!albumTrackSets[albumKey]) albumTrackSets[albumKey] = new Set();
            
            artistTrackSets[artistKey].add(trackKey);
            albumTrackSets[albumKey].add(trackKey);

            // Add to raw_data
            raw_data.push({
                Artist: track.artist,
                Album: track.album,
                Track: track.track,
                Date: uts
            });
        });

        // ✅ Sort by Date (oldest first) and assign order
        raw_data.sort((a, b) => a.Date - b.Date);
        raw_data.forEach((track, index) => {
            track.order = index + 1;
        });

        state.allTracks = raw_data; // Update allTracks with sorted data
        buildHistoryContextMaps();
        ensureRaceDateDefaults(true);

        // ✅ Fetch top stats using the extracted username (independent → concurrent)
        const [topArtists, topAlbums, topTracks] = await Promise.all([
            fetchTopArtists(username),
            fetchTopAlbums(username),
            fetchTopTracks(username)
        ]);

        // ✅ Ensure first scrobbles are properly retrieved
        debugLogDataset("First Scrobbles Data:", firstScrobbles);

        // ✅ Update data arrays with correct first scrobbles
        state.artistsData = topArtists.map((artist, index) => {
            if (!artist.name) return null; // Prevent undefined objects

            const artistKey = artist.name.trim().toLowerCase();
            return {
                name: artist.name,
                rank: index + 1,
                firstscrobble: firstScrobbles.artists?.[artistKey] ?? null,
                lastscrobble: lastScrobbles.artists?.[artistKey] ?? null,
                user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0,
                track_count: artistTrackSets[artistKey] ? artistTrackSets[artistKey].size : 0,
            };
        }).filter(Boolean);

        state.albumsData = topAlbums.map((album, index) => {
            if (!album.name || !album.artist) return null;

            const albumKey = `${album.name.trim().toLowerCase()}_${album.artist.trim().toLowerCase()}`;
            return {
                name: album.name,
                artist: album.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.albums?.[albumKey] ?? null,
                lastscrobble: lastScrobbles.albums?.[albumKey] ?? null,
                user_scrobbles: parseInt(album.user_scrobbles, 10) || 0,
                track_count: albumTrackSets[albumKey] ? albumTrackSets[albumKey].size : 0,
            };
        }).filter(Boolean);

        state.tracksData = topTracks.map((track, index) => {
            if (!track.name || !track.artist) return null;

            const trackKey = `${track.name.trim().toLowerCase()}_${track.artist.trim().toLowerCase()}`;
            return {
                name: track.name,
                artist: track.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.tracks?.[trackKey] ?? null,
                lastscrobble: lastScrobbles.tracks?.[trackKey] ?? null,
                user_scrobbles: parseInt(track.user_scrobbles, 10) || 0,
            };
        }).filter(Boolean);

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

        setAppLoadedState(username);
        enableGamesTab();

        debugLogDataset("Final allTracks:", state.allTracks);
        debugLogDataset("Updated artistsData:", state.artistsData);
        debugLogDataset("Updated albumsData:", state.albumsData);
        debugLogDataset("Updated tracksData:", state.tracksData);

        loadingDiv.innerHTML = ""; // Clear loading message

        // ✅ Update UI
        filterTracks();
        displayEntities();
        updateActiveFilters();
    };
    reader.readAsText(file);
});

// Parse CSV data
function parseCSV(data) {
    const lines = data.trim().split('\n');
    const headers = lines[0].split(';').map(header => header.trim().toLowerCase());

    // Find the date header and rename it to 'date'
    const dateHeader = headers.find(header => header.startsWith('date#'));
    const renamedHeaders = headers.map(header => (header === dateHeader ? 'date' : header));

    return lines.slice(1).map(line => {
        const values = line.match(/(".*?"|[^;]+)(?=;|$)/g)
            .map(val => val.replace(/"/g, '').trim());

        const track = renamedHeaders.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});

        if (track.date) {
            const timestamp = parseInt(track.date);
            if (!isNaN(timestamp)) {
                track.date = timestamp
            }
        }

        return track;
    });
}
