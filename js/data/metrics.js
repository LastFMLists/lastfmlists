// The ranking metrics behind every sorting mode: streaks, listening time,
// first/fastest to N, rolling windows and per-period maxima.

import { state, trackAverageListeningCache, unfilteredStatsCache } from '../state.js';
import {
    getLocalDayIndex,
    getPeriodInfo,
    getWeekIdentifier,
    getWeekNumber,
    isNextPeriod
} from '../time.js';

/**
 * Computes a mapping from a group key to its global ranking and total scrobble count,
 * based on allTracks (the unfiltered list). The group key is defined differently depending
 * on the entityType.
 * @param {string} entityType - "track", "album", or "artist".
 * @returns {Object} - Mapping: { groupKey: { rank, count } }
 */
export function computeUnfilteredStats(entityType) {
    const cacheEntry = unfilteredStatsCache[entityType];
    if (
        cacheEntry &&
        cacheEntry.source === state.allTracks &&
        cacheEntry.length === state.allTracks.length &&
        cacheEntry.mapping
    ) {
        return cacheEntry.mapping;
    }

    const groups = {};
    if (entityType === 'track') {
        state.allTracks.forEach(track => {
            const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    } else if (entityType === 'album') {
        state.allTracks.forEach(track => {
            const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    } else if (entityType === 'artist') {
        state.allTracks.forEach(track => {
            const key = track.Artist.toLowerCase();
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    }
    // Convert to array and sort descending by count.
    const groupArray = Object.entries(groups).map(([key, data]) => ({ key, count: data.count }));
    groupArray.sort((a, b) => b.count - a.count);
    // Now assign ranking (1-indexed)
    const mapping = {};
    groupArray.forEach((item, index) => {
        mapping[item.key] = { rank: index + 1, count: item.count };
    });

    if (cacheEntry) {
        cacheEntry.source = state.allTracks;
        cacheEntry.length = state.allTracks.length;
        cacheEntry.mapping = mapping;
    }

    return mapping;
}

/**
 * Calculate the number of separate periods (day/week/month) an entity (track/album/artist) has been scrobbled.
 * @param {Array} tracks - Array of track objects.
 * @param {string} period - The period to calculate ('day', 'week', 'month').
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with counts of separate periods.
 */
export function calculateSeparateScrobbles(tracks, period, entityType = 'track') {
    console.log(`Calculating separate scrobbles for period: ${period}, entityType: ${entityType}`);
    
    // Grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`; // Group by Artist & Track
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;   // Group by Album & Artist
        } else if (entityType === 'artist') {
            return track.Artist;                       // Group by Artist only
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    const groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: new Set()
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }
        if (track.Date) {
            const timestamp = parseInt(track.Date);
            if (!isNaN(timestamp)) {
                const date = new Date(timestamp); // Date is in ms already
                let periodKey;
                switch (period) {
                    case 'day':
                        periodKey = date.toISOString().split('T')[0];
                        break;
                    case 'week':
                        periodKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
                        break;
                    case 'month':
                        periodKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
                        break;
                    default:
                        periodKey = date.toISOString().split('T')[0];
                }
                if (!acc[key].dates.has(periodKey)) {
                    acc[key].count++;
                    acc[key].dates.add(periodKey);
                }
            }
        }
        return acc;
    }, {});

    console.log('Separate scrobbles groups:', groups);
    return Object.values(groups);
}

export function calculateConsecutiveScrobbles(tracks, entityType = 'track') {
    const sortedTracks = [...tracks].sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));

    const groupKeyFunc = (track) => {
        if (entityType === 'track') return `${track.Artist} - ${track.Track}`;
        if (entityType === 'album') return `${track.Album}||${track.Artist}`;
        if (entityType === 'artist') return track.Artist;
        return `${track.Artist} - ${track.Track}`;
    };

    const groups = {};
    let previousKey = null;
    let previousOrder = null;

    for (const track of sortedTracks) {
        const key = groupKeyFunc(track);

        if (!groups[key]) {
            groups[key] = {
                maxConsecutive: 0,
                currentConsecutive: 0,
                startTime: null,
                endTime: null,
                currentStartTime: null
            };
            if (entityType === 'track') {
                groups[key].Artist = track.Artist;
                groups[key].Track = track.Track;
            } else if (entityType === 'album') {
                groups[key].name = track.Album;
                groups[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                groups[key].name = track.Artist;
            }
        }

        const currentOrder = track.order;
        const isConsecutive = previousKey === key && currentOrder === previousOrder + 1;

        if (!isConsecutive) {
            groups[key].currentConsecutive = 1;
            groups[key].currentStartTime = track.Date;
        } else {
            groups[key].currentConsecutive += 1;
        }

        if (groups[key].currentConsecutive > groups[key].maxConsecutive) {
            groups[key].maxConsecutive = groups[key].currentConsecutive;
            groups[key].startTime = groups[key].currentStartTime;
            groups[key].endTime = track.Date;
        }

        previousKey = key;
        previousOrder = currentOrder;
    }

    return Object.values(groups);
}

export function calculateConsecutivePeriods(tracks, period, entityType = 'track') {
	const sortedTracks = [...tracks].sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));

	const groupKeyFunc = (track) => {
		if (entityType === 'track') return `${track.Artist} - ${track.Track}`;
		if (entityType === 'album') return `${track.Album}||${track.Artist}`;
		if (entityType === 'artist') return track.Artist;
		return `${track.Artist} - ${track.Track}`;
	};

    const getPeriodKey = (timestamp) => {
        const date = new Date(timestamp);
        switch (period) {
            case 'week':
                return getWeekIdentifier(date);
            case 'month':
                return date.getFullYear() * 12 + date.getMonth();
            case 'day':
            default:
                return getLocalDayIndex(timestamp);
        }
    };

	const results = {};
    const states = {};

    for (const track of sortedTracks) {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) continue;

        const key = groupKeyFunc(track);
        const periodKey = getPeriodKey(timestamp);

        if (!states[key]) {
            states[key] = {
                lastPeriod: null,
                currentConsecutive: 0,
                maxConsecutive: 0,
                currentStartTime: null,
                currentEndTime: null,
                bestStartTime: null,
                bestEndTime: null,
                sample: track
            };
        }

        const streak = states[key];

        if (streak.lastPeriod === periodKey) {
            continue;
        }

        if (streak.lastPeriod !== null && isNextPeriod(streak.lastPeriod, periodKey, period)) {
            streak.currentConsecutive += 1;
            streak.currentEndTime = timestamp;
        } else {
            if (streak.currentConsecutive > streak.maxConsecutive) {
                streak.maxConsecutive = streak.currentConsecutive;
                streak.bestStartTime = streak.currentStartTime;
                streak.bestEndTime = streak.currentEndTime;
            }
            streak.currentConsecutive = 1;
            streak.currentStartTime = timestamp;
            streak.currentEndTime = timestamp;
        }

        streak.lastPeriod = periodKey;
    }

    Object.keys(states).forEach((key) => {
        const streak = states[key];

        if (streak.currentConsecutive > streak.maxConsecutive) {
            streak.maxConsecutive = streak.currentConsecutive;
            streak.bestStartTime = streak.currentStartTime;
            streak.bestEndTime = streak.currentEndTime;
        }

        results[key] = {
            maxConsecutive: streak.maxConsecutive,
            startTime: streak.bestStartTime,
            endTime: streak.bestEndTime,
        };

		if (entityType === 'track') {
			results[key].Artist = streak.sample.Artist;
			results[key].Track = streak.sample.Track;
		} else if (entityType === 'album') {
			results[key].name = streak.sample.Album;
			results[key].artist = streak.sample.Artist;
		} else if (entityType === 'artist') {
			results[key].name = streak.sample.Artist;
		}
    });

	return Object.values(results);
}

export function calculateListeningPercentage(tracks, entityType = 'track') {
    console.log(`Calculating listening percentage for entityType: ${entityType}`);

    // Grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`; // Group by Artist & Track
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;   // Group by Album & Artist
        } else if (entityType === 'artist') {
            return track.Artist;                       // Group by Artist only
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    // To track processed entities and avoid duplication in calculations
    const processedEntities = new Set();

    const groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (processedEntities.has(key)) {
            return acc; // Skip processing if the entity has already been processed
        }
        processedEntities.add(key);

        if (!acc[key]) {
            acc[key] = {
                listeningPercentage: 0,
                scrobbles: 0,
                playcount: 0
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        // Get the playcount and user scrobbles from the data maps for album/artist/track
        let scrobbles = 0;
        let playcount = 0;

        // Assuming trackDataMap, albumDataMap, and artistDataMap are available and contain playcount and user_scrobbles
        if (entityType === 'track') {
            scrobbles = state.trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.user_scrobbles || 0;
            playcount = state.trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.playcount || 0;
        } else if (entityType === 'album') {
            scrobbles = state.albumDataMap[`${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`]?.user_scrobbles || 0;
            playcount = state.albumDataMap[`${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`]?.playcount || 0;
        } else if (entityType === 'artist') {
            scrobbles = state.artistDataMap[track.Artist.toLowerCase()]?.user_scrobbles || 0;
            playcount = state.artistDataMap[track.Artist.toLowerCase()]?.playcount || 0;
        }

        // Calculate listening percentage and update the group's data
        if (playcount > 0) {
            const listeningPercentage = (scrobbles / playcount) * 100;
            acc[key].listeningPercentage = listeningPercentage;
        }

        acc[key].scrobbles += scrobbles;
        acc[key].playcount += playcount;

        return acc;
    }, {});

    // Convert the grouped data into an array for returning
    const result = Object.values(groups);

    // Sort by listening percentage in descending order
    result.sort((a, b) => b.listeningPercentage - a.listeningPercentage);

    console.log('Listening percentage groups:', result);
    return result;
}

/**
 * Calculate listening duration for each entity (track/album/artist).
 * @param {Array} filteredData - Array of track objects after filtering.
 * @param {string} entityType - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with listening durations.
 */
export function calculateListeningDuration(filteredData, entityType = 'track') {
    console.log(`Calculating listening duration for entityType: ${entityType}`);

    // Step 1: Group tracks by Artist + Track
    const trackGroups = {};

    filteredData.forEach(track => {
        const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
        
        if (!trackGroups[key]) {
            trackGroups[key] = { ...track, count: 0, albumCounts: {}, duration: 0 };
        }
        trackGroups[key].count++;

        // Count album occurrences to get the most common album for the track
        const albumName = track.Album;
        if (!trackGroups[key].albumCounts[albumName]) {
            trackGroups[key].albumCounts[albumName] = 0;
        }
        trackGroups[key].albumCounts[albumName]++;

        // Get the duration of the track from trackDataMap
        trackGroups[key].duration = state.trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.duration || 0;
    });

    // Convert the grouped data into an array
    filteredData = Object.values(trackGroups);

    // Step 2: If entityType is 'track', return the listening duration for tracks
    if (entityType === 'track') {
        return filteredData.map(track => {
            return {
                ...track,
                listeningDuration: track.duration * track.count
            };
        }).sort((a, b) => b.listeningDuration - a.listeningDuration); // Sort by listeningDuration
    }

    // Step 3: Aggregate by artist or album
    const aggregatedData = filteredData.reduce((acc, track) => {
        const entityKey = entityType === 'album' ? track.Album : track.Artist; // Use Album for album-type, Artist otherwise
    
        // Ensure that the key is consistent and add artist for albums
        if (!acc[entityKey]) {
            acc[entityKey] = { 
                listeningDuration: 0, 
                name: entityKey, 
                artist: entityType === 'album' ? track.Artist : null // Only add artist for albums
            };
        }
    
        // Add the track's listening duration to the entity's total listening duration
        acc[entityKey].listeningDuration += track.duration * track.count;
    
        return acc;
    }, {});

    // Convert aggregated data into an array and sort by listeningDuration
    const sortedAggregatedData = Object.values(aggregatedData).sort((a, b) => b.listeningDuration - a.listeningDuration);

    console.log('Aggregated listening durations:', sortedAggregatedData);
    return sortedAggregatedData;
}

export function calculateAverageListeningTime(tracks, entityType = 'track', minScrobbles = 1) {
    const threshold = Math.max(1, parseInt(minScrobbles, 10) || 1);

    const groups = tracks.reduce((acc, track) => {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return acc;

        let key;
        if (entityType === 'track') {
            key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (!acc[key]) {
                acc[key] = { ...track, count: 0, timestampSum: 0, albumCounts: {} };
            }
            acc[key].count += 1;
            acc[key].timestampSum += timestamp;
            const albumName = track.Album;
            if (!acc[key].albumCounts[albumName]) {
                acc[key].albumCounts[albumName] = 0;
            }
            acc[key].albumCounts[albumName] += 1;
            return acc;
        }

        if (entityType === 'album') {
            key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
            if (!acc[key]) {
                acc[key] = { name: track.Album, artist: track.Artist, count: 0, timestampSum: 0 };
            }
            acc[key].count += 1;
            acc[key].timestampSum += timestamp;
            return acc;
        }

        key = track.Artist.toLowerCase();
        if (!acc[key]) {
            acc[key] = { name: track.Artist, count: 0, timestampSum: 0 };
        }
        acc[key].count += 1;
        acc[key].timestampSum += timestamp;
        return acc;
    }, {});

    return Object.values(groups)
        .filter(entity => entity.count >= threshold)
        .map(entity => ({
            ...entity,
            averageListeningTimestamp: Math.floor(entity.timestampSum / entity.count)
        }));
}

/**
 * Calculate the first instance an entity (track/album/artist) reaches X scrobbles.
 * @param {Array} tracks - Array of track objects.
 * @param {number} x - The scrobble milestone.
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with date reached and time needed.
 */
export function calculateFirstToXScrobbles(tracks, x, entityType = 'track') {
    console.log(`Calculating first to ${x} scrobbles for entityType: ${entityType}`);

    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`;
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;
        } else if (entityType === 'artist') {
            return track.Artist;
        }
        return `${track.Artist} - ${track.Track}`;
    };

    let groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: []
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        const timestamp = parseInt(track.Date);
        if (!isNaN(timestamp)) {
            acc[key].dates.push(timestamp);
            acc[key].count++;

            if (acc[key].count === x) {
                acc[key].dateReached = timestamp;
                acc[key].timeNeeded = timestamp - tracks[0].Date;
            }
        }
        return acc;
    }, {});

    console.log('First to X scrobbles groups:', groups);
    return Object.values(groups).filter(item => item.count >= x);
}

/**
 * Calculate the fastest time an entity (track/album/artist) reaches X scrobbles.
 * @param {Array} tracks - Array of track objects.
 * @param {number} x - The scrobble milestone.
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with time needed, first scrobble, and date reached.
 */
export function calculateFastestToXScrobbles(tracks, x, entityType = 'track') {
    console.log(`Calculating fastest to ${x} scrobbles for entityType: ${entityType}`);

    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`;
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;
        } else if (entityType === 'artist') {
            return track.Artist;
        }
        return `${track.Artist} - ${track.Track}`;
    };

    let groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: []
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        const timestamp = parseInt(track.Date);
        if (!isNaN(timestamp)) {
            acc[key].dates.push(timestamp);
            acc[key].count++;

            if (acc[key].count === x) {
                acc[key].firstScrobble = acc[key].dates[0];
                acc[key].dateReached = timestamp;
                acc[key].timeNeeded = timestamp - acc[key].firstScrobble;
            }
        }
        return acc;
    }, {});

    console.log('Fastest to X scrobbles groups:', groups);
    return Object.values(groups)
        .filter(item => item.count >= x)
}

function getEntityKeyAndSample(track, entityType) {
    if (entityType === 'track') {
        return {
            key: `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`,
            sample: { Artist: track.Artist, Track: track.Track }
        };
    }
    if (entityType === 'album') {
        return {
            key: `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`,
            sample: { name: track.Album, artist: track.Artist }
        };
    }
    return {
        key: track.Artist.toLowerCase(),
        sample: { name: track.Artist }
    };
}

export function calculateMaxScrobblesInSinglePeriod(tracks, period, entityType = 'track') {
    const periodCounts = {};
    const entityBest = {};

    tracks.forEach(track => {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return;

        const { key: entityKey, sample } = getEntityKeyAndSample(track, entityType);
        const periodInfo = getPeriodInfo(new Date(timestamp), period);
        const countKey = `${entityKey}@@${periodInfo.key}`;

        periodCounts[countKey] = (periodCounts[countKey] || 0) + 1;
        const currentCount = periodCounts[countKey];

        if (!entityBest[entityKey] || currentCount > entityBest[entityKey].count) {
            entityBest[entityKey] = {
                ...sample,
                count: currentCount,
                periodLabel: periodInfo.label
            };
        }
    });

    return Object.values(entityBest);
}

export function calculateMaxScrobblesInRollingWindow(tracks, windowHours, entityType = 'track') {
    const windowMs = windowHours * 60 * 60 * 1000;
    const grouped = {};

    tracks.forEach(track => {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return;

        const { key: entityKey, sample } = getEntityKeyAndSample(track, entityType);
        if (!grouped[entityKey]) {
            grouped[entityKey] = {
                ...sample,
                timestamps: []
            };
        }
        grouped[entityKey].timestamps.push(timestamp);
    });

    const results = [];
    Object.values(grouped).forEach(entity => {
        const timestamps = entity.timestamps.sort((a, b) => a - b);
        let left = 0;
        let bestCount = 0;
        let bestStart = null;
        let bestEnd = null;

        for (let right = 0; right < timestamps.length; right++) {
            while (timestamps[right] - timestamps[left] > windowMs) {
                left++;
            }
            const currentCount = right - left + 1;
            if (currentCount > bestCount) {
                bestCount = currentCount;
                bestStart = timestamps[left];
                bestEnd = timestamps[right];
            }
        }

        results.push({
            ...entity,
            count: bestCount,
            windowStart: bestStart,
            windowEnd: bestEnd,
            windowHours
        });
    });

    return results;
}

export function isRollingWindowSortingBasis(sortingBasis) {
    return typeof sortingBasis === "string"
        && (sortingBasis === "max-rolling-24h" || sortingBasis === "max-rolling-168h" || sortingBasis === "max-rolling-xh");
}

export function getRollingWindowHoursForSortingBasis(sortingBasis, xValue) {
    if (sortingBasis === "max-rolling-24h") return 24;
    if (sortingBasis === "max-rolling-168h") return 168;
    if (sortingBasis === "max-rolling-xh") return Math.max(1, parseInt(xValue, 10) || 1);
    return null;
}

export function isSortingBasisUsingXValue(sortingBasis) {
    return [
        "first-n-scrobbles",
        "fastest-n-scrobbles",
        "oldest-average-listening-time",
        "newest-average-listening-time",
        "max-rolling-xh"
    ].includes((sortingBasis || "").toString());
}

export function getTrackAverageListeningMap(minScrobbles = 1) {
    const threshold = Math.max(1, parseInt(minScrobbles, 10) || 1);
    if (
        trackAverageListeningCache.source === state.allTracks &&
        trackAverageListeningCache.length === state.allTracks.length &&
        trackAverageListeningCache.minScrobbles === threshold &&
        trackAverageListeningCache.mapping
    ) {
        return trackAverageListeningCache.mapping;
    }

    const grouped = {};
    state.allTracks.forEach(track => {
        const key = `${track.Track?.toLowerCase() || ""}||${track.Artist?.toLowerCase() || ""}`;
        if (!key || key === "||") return;

        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return;

        if (!grouped[key]) {
            grouped[key] = { count: 0, timestampSum: 0 };
        }
        grouped[key].count += 1;
        grouped[key].timestampSum += timestamp;
    });

    const mapping = {};
    Object.entries(grouped).forEach(([key, value]) => {
        if (value.count >= threshold) {
            mapping[key] = Math.floor(value.timestampSum / value.count);
        }
    });

    trackAverageListeningCache.source = state.allTracks;
    trackAverageListeningCache.length = state.allTracks.length;
    trackAverageListeningCache.minScrobbles = threshold;
    trackAverageListeningCache.mapping = mapping;

    return mapping;
}
