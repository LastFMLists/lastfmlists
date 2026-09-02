// Turning the filter panel into a filtered track list, and that list into
// ranked entities.

import { GLOBAL_BASE_SETTING_IDS, SCROBBLE_SORT_ASC, SCROBBLE_SORT_DESC } from '../config.js';
import {
    applySerializedControlValue,
    parseSerializedNumberList,
    serializeControlValue
} from '../dom.js';
import { state } from '../state.js';
import { isWithinTimeRange } from '../time.js';
import {
    calculateAverageListeningTime,
    calculateConsecutivePeriods,
    calculateConsecutiveScrobbles,
    calculateFastestToXScrobbles,
    calculateFirstToXScrobbles,
    calculateListeningDuration,
    calculateListeningPercentage,
    calculateMaxScrobblesInRollingWindow,
    calculateMaxScrobblesInSinglePeriod,
    calculateSeparateScrobbles,
    getRollingWindowHoursForSortingBasis,
    isRollingWindowSortingBasis
} from './metrics.js';

function normalizeText(str) {
    // Lowercase, trim, and remove hyphens for a more forgiving comparison.
    return str.trim().toLowerCase().replace(/-/g, '');
}

  
  /**
   * Returns true if the propertyValue (a string) contains the tokens specified
   * in filterInput according to the following logic:
   * - If filterInput is empty, returns true.
   * - If filterInput contains semicolons, each semicolon-separated group must have at least one token (after splitting by commas) that is found within propertyValue.
   * - If filterInput does not contain semicolons, returns true if any of the comma-separated tokens are found.
   */
  
function matchFilter(filterInput, propertyValue) {
    // Ensure propertyValue is a string (convert arrays to a single string)
    const normalizedProp = Array.isArray(propertyValue) 
        ? propertyValue.map(normalizeText).join(" ")  // Convert array to a single string
        : normalizeText(propertyValue);

    const input = filterInput.trim().toLowerCase();
    if (!input) return true; // empty filter passes

    if (input.indexOf(';') !== -1) {
        // Split into groups (AND logic across groups)
        const groups = input.split(';').map(group =>
            group.split(',').map(tag => normalizeText(tag)).filter(tag => tag !== '')
        );
        // For each group, at least one token must be found in the property.
        return groups.every(group => group.some(token => normalizedProp.includes(token)));
    } else {
        // Comma-separated tokens: OR logic
        const tokens = input.split(',').map(token => normalizeText(token)).filter(token => token !== '');
        return tokens.some(token => normalizedProp.includes(token));
    }
}

  
  /**
   * For excludes, we simply invert the result of matchFilter.
   */
function matchExclude(filterInput, propertyValue) {
    return !matchFilter(filterInput, propertyValue);
}

export function getManagedFilterElements() {
    return Array.from(document.querySelectorAll("#filters-section .filters input, #filters-section .filters select, #filters-section .filters textarea"))
    .filter(element => element.id && element.id !== "comparison-edit-target" && element.id !== "equations" && element.id !== "equations-right" && !GLOBAL_BASE_SETTING_IDS.has(element.id));
}

export function readCurrentFilterInputState() {
    const snapshot = {};
    getManagedFilterElements().forEach(element => {
        const value = serializeControlValue(element);
        snapshot[element.id] = value;
    });
    return snapshot;
}

export function applyFilterInputState(savedState) {
    const safeState = savedState || {};
    getManagedFilterElements().forEach(element => {
        const value = safeState[element.id] ?? "";
        applySerializedControlValue(element, value);
    });

    const leftEquationsInput = document.getElementById("equations");
    if (leftEquationsInput) {
        leftEquationsInput.value = (state.comparisonFilterStates.left?.equations ?? "").toString();
    }

    const rightEquationsInput = document.getElementById("equations-right");
    if (rightEquationsInput) {
        rightEquationsInput.value = (state.comparisonFilterStates.right?.equations ?? "").toString();
    }
}

export function convertStateToFilterArray(savedState) {
    return Object.entries(savedState || {})
        .filter(([, value]) => (value ?? "").toString().trim() !== "")
        .map(([id, value]) => ({ id, value: value.toString() }));
}

export function applyTracksPerEntityFilter(tracks, maxArtist) {

    // To track how many tracks we have included from each album and artist
    let artistCount = {};

    // Result list for the filtered tracks
    let filteredTracks = [];

    // Loop through the sorted tracks
    for (let track of tracks) {
        let artist = track.Artist;

        // Check if we've already added a track from this album or artist
        if (maxArtist && artistCount[artist] >= maxArtist) {
            continue; // Skip if the album or artist has reached its limit
        }

        // Add the track to the result list
        filteredTracks.push(track);

        // Increment the counts for the album and artist
        artistCount[artist] = (artistCount[artist] || 0) + 1;
    }

    return filteredTracks;
}

export function filterTracks(filtersOverride = null, sourceTracks = null) {
    const tracksSource = sourceTracks || state.allTracks;
    if (!tracksSource) return [];

    const filterFunctions = {

        // Filters based on name or title

        "artist-initial": (item, value) => item.Artist[0].toLowerCase() === value.toLowerCase(),
        "album-initial": (item, value) => item.Album[0].toLowerCase() === value.toLowerCase(),
        "track-initial": (item, value) => item.Track[0].toLowerCase() === value.toLowerCase(),

        "artist-name": (item, value) => item.Artist.toLowerCase() === value.toLowerCase(),
        "album-name": (item, value) => item.Album.toLowerCase() === value.toLowerCase(),
        "track-name": (item, value) => item.Track.toLowerCase() === value.toLowerCase(),

        "artist-includes": (item, value) => matchFilter(value, item.Artist),
        "artist-excludes": (item, value) => matchExclude(value, item.Artist),
        "album-includes": (item, value) => matchFilter(value, item.Album),
        "album-excludes": (item, value) => matchExclude(value, item.Album),
        "track-includes": (item, value) => matchFilter(value, item.Track),
        "track-excludes": (item, value) => matchExclude(value, item.Track),

        "artist-name-length-min": (item, value) => item.Artist.length >= parseInt(value, 10),
        "artist-name-length-max": (item, value) => item.Artist.length <= parseInt(value, 10),
        "album-name-length-min": (item, value) => item.Album.length >= parseInt(value, 10),
        "album-name-length-max": (item, value) => item.Album.length <= parseInt(value, 10),
        "track-name-length-min": (item, value) => item.Track.length >= parseInt(value, 10),
        "track-name-length-max": (item, value) => item.Track.length <= parseInt(value, 10),
       
        "artist-word-count-min": (item, value) => item.Artist.split(/\s+/).length >= parseInt(value, 10),
        "artist-word-count-max": (item, value) => item.Artist.split(/\s+/).length <= parseInt(value, 10),
        "album-word-count-min": (item, value) => item.Album.split(/\s+/).length >= parseInt(value, 10),
        "album-word-count-max": (item, value) => item.Album.split(/\s+/).length <= parseInt(value, 10),
        "track-word-count-min": (item, value) => item.Track.split(/\s+/).length >= parseInt(value, 10),
        "track-word-count-max": (item, value) => item.Track.split(/\s+/).length <= parseInt(value, 10),

        // Filters based on user data

        "artist-scrobble-count-min": (item, value) => 
            state.artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles >= parseInt(value, 10),
        "artist-scrobble-count-max": (item, value) =>
            state.artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles <= parseInt(value, 10),
        "album-scrobble-count-min": (item, value) =>
            state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles >= parseInt(value, 10),
        "album-scrobble-count-max": (item, value) =>
            state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles <= parseInt(value, 10),
        "track-scrobble-count-min": (item, value) =>
            state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles >= parseInt(value, 10),
        "track-scrobble-count-max": (item, value) =>
            state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles <= parseInt(value, 10),
        
        "artist-rank-min": (item, value) => 
            state.artistDataMap[item.Artist.toLowerCase()]?.rank >= parseInt(value, 10),

        "artist-rank-max": (item, value) => 
            state.artistDataMap[item.Artist.toLowerCase()]?.rank <= parseInt(value, 10),

        "album-rank-min": (item, value) => 
            state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank >= parseInt(value, 10),

        "album-rank-max": (item, value) => 
            state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank <= parseInt(value, 10),

        "track-rank-min": (item, value) => 
            state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank >= parseInt(value, 10),

        "track-rank-max": (item, value) => 
            state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank <= parseInt(value, 10),

        "artist-track-count-min": (item, value) => 
            state.artistDataMap[item.Artist.toLowerCase()]?.track_count >= parseInt(value, 10),

        "artist-track-count-max": (item, value) => 
            state.artistDataMap[item.Artist.toLowerCase()]?.track_count <= parseInt(value, 10),

        "album-track-count-min": (item, value) => 
            state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count >= parseInt(value, 10),

        "album-track-count-max": (item, value) => 
            state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count <= parseInt(value, 10),

        "artist-first-scrobble-years": (item, value) => {
            const firstYear = state.artistDataMap[item.Artist.toLowerCase()]?.firstscrobble 
                ? new Date(parseInt(state.artistDataMap[item.Artist.toLowerCase()].firstscrobble, 10)).getFullYear() 
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "album-first-scrobble-years": (item, value) => {
            const firstYear = state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble
                ? new Date(parseInt(state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`].firstscrobble, 10)).getFullYear()
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "track-first-scrobble-years": (item, value) => {
            const firstYear = state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble
                ? new Date(parseInt(state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`].firstscrobble, 10)).getFullYear()
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "artist-days-since-last-min": (item, value) => {
            // Look up the artist's last scrobble timestamp from artistDataMap
            const lastScrobble = state.artistDataMap[item.Artist.toLowerCase()]?.lastscrobble;
            if (!lastScrobble) return false;
            // Calculate days since last scrobble
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince >= parseInt(value, 10);
        },
        "artist-days-since-last-max": (item, value) => {
            const lastScrobble = state.artistDataMap[item.Artist.toLowerCase()]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince <= parseInt(value, 10);
        },
        "album-days-since-last-min": (item, value) => {
            // Construct the album key: "album||artist"
            const albumKey = `${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = state.albumDataMap[albumKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince >= parseInt(value, 10);
        },
        "album-days-since-last-max": (item, value) => {
            const albumKey = `${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = state.albumDataMap[albumKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince <= parseInt(value, 10);
        },
        "track-days-since-last-min": (item, value) => {
            // Construct the track key: "track||artist"
            const trackKey = `${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = state.trackDataMap[trackKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince >= parseInt(value, 10);
        },
        "track-days-since-last-max": (item, value) => {
            const trackKey = `${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = state.trackDataMap[trackKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince <= parseInt(value, 10);
        },

        // Filters based on detailed data

        "artist-listeners-min": (item, value) => state.artistDataMap[item.Artist.toLowerCase()]?.listeners >= parseInt(value, 10),
        "artist-listeners-max": (item, value) => state.artistDataMap[item.Artist.toLowerCase()]?.listeners <= parseInt(value, 10),
        "artist-global-scrobbles-min": (item, value) => state.artistDataMap[item.Artist.toLowerCase()]?.playcount >= parseInt(value, 10),
        "artist-global-scrobbles-max": (item, value) => state.artistDataMap[item.Artist.toLowerCase()]?.playcount <= parseInt(value, 10),
    
        "album-listeners-min": (item, value) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners >= parseInt(value, 10),
        "album-listeners-max": (item, value) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners <= parseInt(value, 10),
        "album-global-scrobbles-min": (item, value) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount >= parseInt(value, 10),
        "album-global-scrobbles-max": (item, value) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount <= parseInt(value, 10),
    
        "track-listeners-min": (item, value) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners >= parseInt(value, 10),
        "track-listeners-max": (item, value) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners <= parseInt(value, 10),
        "track-global-scrobbles-min": (item, value) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount >= parseInt(value, 10),
        "track-global-scrobbles-max": (item, value) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount <= parseInt(value, 10),
    
        "track-duration-min": (item, value) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration / 1000 >= parseInt(value, 10),
        "track-duration-max": (item, value) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration / 1000 <= parseInt(value, 10),

        "artist-tags": (item, value) => {
            const detailedArtist = state.artistDataMap[item.Artist.toLowerCase()];
            if (!detailedArtist) return false;  // or true if you want to ignore missing details
            return matchFilter(value, detailedArtist.tags || []);
            },

        // Time-based filters

        "year": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedYears = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            const date = new Date(parseInt(item.Date, 10));
            return selectedYears.length === 0 || selectedYears.includes(date.getFullYear());
        },
    
        "month": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedMonths = parseSerializedNumberList(value);
            const month = new Date(parseInt(item.Date, 10)).getMonth() + 1;
            return selectedMonths.length === 0 || selectedMonths.includes(month);
        },
    
        "day-of-month": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedDays = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            const day = new Date(parseInt(item.Date, 10)).getDate();
            return selectedDays.length === 0 || selectedDays.includes(day);
        },
    
        "weekday": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedWeekdays = parseSerializedNumberList(value);
            const weekday = new Date(parseInt(item.Date, 10)).getDay();
            return selectedWeekdays.length === 0 || selectedWeekdays.includes(weekday);
        },

        "time-of-day-start": (item, value) => {
            const endValue = document.getElementById("time-of-day-end")?.value || "";
            return isWithinTimeRange(item.Date, value, endValue);
        },

        "time-of-day-end": (item, value) => {
            const startValue = document.getElementById("time-of-day-start")?.value || "";
            return isWithinTimeRange(item.Date, startValue, value);
        },

        "session-starter-only": (item, value) => {
            if (value !== "use-gap") return true;
            const previousTimestamp = state.previousScrobbleTimestampByOrder[item.order];
            if (previousTimestamp === null || previousTimestamp === undefined) return true;
            const configuredGap = parseFloat(document.getElementById("day-starter-gap-hours")?.value);
            const gapHours = isNaN(configuredGap) ? 6 : configuredGap;
            const minGapMs = gapHours * 60 * 60 * 1000;
            return parseInt(item.Date, 10) - previousTimestamp >= minGapMs;
        },

        "day-starter-only": (item, value) => {
            if (!value) return true;

            const isDayStarter = state.isFirstScrobbleOfDayByOrder[item.order] === true;
            const previousTimestamp = state.previousScrobbleTimestampByOrder[item.order];
            const configuredGap = parseFloat(document.getElementById("day-starter-gap-hours")?.value);
            const gapHours = isNaN(configuredGap) ? 6 : configuredGap;
            const minGapMs = gapHours * 60 * 60 * 1000;
            const hasLongGap = previousTimestamp === null || previousTimestamp === undefined
                ? true
                : (parseInt(item.Date, 10) - previousTimestamp >= minGapMs);

            if (value === "first-day-literal") {
                return isDayStarter;
            }

            if (value === "first-day-smart") {
                return isDayStarter && hasLongGap;
            }

            return true;
        },

        "last-n-days": (item, value) => {
            const now = Date.now();
            return now - parseInt(item.Date) <= value * 86400000;
        },

        "date-range-start": (item, value) => {
            const startTime = new Date(value).getTime();
            return item.Date >= startTime;
        },
        "date-range-end": (item, value) => {
            const endTime = new Date(value).getTime() + 86400000; // Include the whole day
            return item.Date < endTime;
        },

        "scrobble-order-from": (item, value) => item.order >= parseInt(value, 10),
        "scrobble-order-to": (item, value) => item.order <= parseInt(value, 10)
    };

    const effectiveFilters = Array.isArray(filtersOverride) ? filtersOverride : state.activeFilters;

    const activePredicates = effectiveFilters
        .filter(filter => filterFunctions[filter.id])
        .map(filter => ({
            predicate: filterFunctions[filter.id],
            value: filter.value
        }));

    if (activePredicates.length === 0) {
        if (!filtersOverride && !sourceTracks) {
            state.filteredData = tracksSource;
        }
        return [...tracksSource];
    }

    const result = tracksSource.filter((item) => {
        for (let i = 0; i < activePredicates.length; i++) {
            const { predicate, value } = activePredicates[i];
            if (!predicate(item, value)) {
                return false;
            }
        }
        return true;
    });

    if (!filtersOverride && !sourceTracks) {
        state.filteredData = result;
    }

    return result;
}

export function buildEntitiesFromTracks(sourceTracks, entityType, sortingBasis, xValue) {
    let entities = [...sourceTracks];

    if (entityType === 'scrobble') {
        entities.sort((a, b) => {
            const aDate = parseInt(a.Date, 10) || 0;
            const bDate = parseInt(b.Date, 10) || 0;
            if (sortingBasis === SCROBBLE_SORT_DESC) {
                return bDate - aDate;
            }
            return aDate - bDate;
        });
        return entities;
    }

    if (sortingBasis === 'scrobbles') {
        if (entityType === 'track') {
            const trackGroups = {};
            entities.forEach(track => {
                const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
                if (!trackGroups[key]) {
                    trackGroups[key] = { ...track, count: 0, albumCounts: {} };
                }
                trackGroups[key].count++;
                const albumName = track.Album;
                if (!trackGroups[key].albumCounts[albumName]) {
                    trackGroups[key].albumCounts[albumName] = 0;
                }
                trackGroups[key].albumCounts[albumName]++;
            });
            entities = Object.values(trackGroups);
        } else if (entityType === 'album') {
            const albumGroups = {};
            entities.forEach(track => {
                const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
                if (!albumGroups[key]) {
                    albumGroups[key] = { name: track.Album, artist: track.Artist, count: 0, tracks: [] };
                }
                albumGroups[key].count++;
                albumGroups[key].tracks.push(track);
            });
            entities = Object.values(albumGroups);
        } else if (entityType === 'artist') {
            const artistGroups = {};
            entities.forEach(track => {
                const key = track.Artist.toLowerCase();
                if (!artistGroups[key]) {
                    artistGroups[key] = { name: track.Artist, count: 0, tracks: [] };
                }
                artistGroups[key].count++;
                artistGroups[key].tracks.push(track);
            });
            entities = Object.values(artistGroups);
        }
        entities.sort((a, b) => (b.count || 0) - (a.count || 0));
    } else if (sortingBasis === 'separate-days') {
        entities = calculateSeparateScrobbles(entities, 'day', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'separate-weeks') {
        entities = calculateSeparateScrobbles(entities, 'week', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'separate-months') {
        entities = calculateSeparateScrobbles(entities, 'month', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'max-single-day') {
        entities = calculateMaxScrobblesInSinglePeriod(entities, 'day', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'max-single-week') {
        entities = calculateMaxScrobblesInSinglePeriod(entities, 'week', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'max-single-month') {
        entities = calculateMaxScrobblesInSinglePeriod(entities, 'month', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (isRollingWindowSortingBasis(sortingBasis)) {
        const rollingWindowHours = getRollingWindowHoursForSortingBasis(sortingBasis, xValue);
        entities = calculateMaxScrobblesInRollingWindow(entities, rollingWindowHours || 24, entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'consecutive-scrobbles') {
        entities = calculateConsecutiveScrobbles(entities, entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-days') {
        entities = calculateConsecutivePeriods(entities, 'day', entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-weeks') {
        entities = calculateConsecutivePeriods(entities, 'week', entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-months') {
        entities = calculateConsecutivePeriods(entities, 'month', entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'highest-listening-percentage') {
        entities = calculateListeningPercentage(entities, entityType);
        entities.sort((a, b) => b.listeningPercentage - a.listeningPercentage);
    } else if (sortingBasis === 'time-spent-listening') {
        entities = calculateListeningDuration(entities, entityType);
        entities.sort((a, b) => b.listeningDuration - a.listeningDuration);
    } else if (sortingBasis === "first-n-scrobbles") {
        entities = calculateFirstToXScrobbles(entities, xValue, entityType);
        entities.sort((a, b) => (a.dateReached || 0) - (b.dateReached || 0));
    } else if (sortingBasis === "fastest-n-scrobbles") {
        entities = calculateFastestToXScrobbles(entities, xValue, entityType);
        entities.sort((a, b) => a.timeNeeded - b.timeNeeded);
    } else if (sortingBasis === "oldest-average-listening-time") {
        entities = calculateAverageListeningTime(entities, entityType, xValue);
        entities.sort((a, b) => a.averageListeningTimestamp - b.averageListeningTimestamp);
    } else if (sortingBasis === "newest-average-listening-time") {
        entities = calculateAverageListeningTime(entities, entityType, xValue);
        entities.sort((a, b) => b.averageListeningTimestamp - a.averageListeningTimestamp);
    }

    return entities;
}

export function normalizeEntitySorting(entityType, sortingBasis) {
    let normalizedEntityType = (entityType || "track").toLowerCase();
    let normalizedSortingBasis = sortingBasis || "scrobbles";

    const isScrobbleSort = normalizedSortingBasis === SCROBBLE_SORT_ASC || normalizedSortingBasis === SCROBBLE_SORT_DESC;

    if (normalizedEntityType !== "scrobble" && isScrobbleSort) {
        normalizedSortingBasis = "scrobbles";
    }

    if (normalizedEntityType === "scrobble" && !isScrobbleSort) {
        normalizedSortingBasis = SCROBBLE_SORT_ASC;
    }

    return {
        entityType: normalizedEntityType,
        sortingBasis: normalizedSortingBasis
    };
}

function dedupeOrderedTrackEntities(tracks) {
    const entitiesByKey = new Map();

    tracks.forEach(track => {
        const key = `${track.Artist?.toLowerCase() || ""} - ${track.Track?.toLowerCase() || ""}`;
        if (!key || key === " - ") return;

        if (!entitiesByKey.has(key)) {
            entitiesByKey.set(key, {
                ...track,
                count: 0,
                albumCounts: {}
            });
        }

        const entity = entitiesByKey.get(key);
        entity.count += 1;
        const albumName = track.Album || "Unknown";
        entity.albumCounts[albumName] = (entity.albumCounts[albumName] || 0) + 1;
    });

    return Array.from(entitiesByKey.values());
}

export function resolveDisplayEntities(pipelineResult, entityType, sortingBasis, xValue, maxPerArtist) {
    let entities;
    if (pipelineResult.hasOrderingStep && entityType === "track") {
        const dedupedOrderedTracks = dedupeOrderedTrackEntities(pipelineResult.tracks);
        entities = applyTracksPerEntityFilter(dedupedOrderedTracks, maxPerArtist);
    } else {
        entities = buildEntitiesFromTracks(pipelineResult.tracks, entityType, sortingBasis, xValue);
        if (entityType === "track") {
            entities = applyTracksPerEntityFilter(entities, maxPerArtist);
        }
    }

    return entities;
}
