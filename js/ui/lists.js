// Rendering entities as lists, and the dispatcher that decides whether the
// results area shows a list, a chart or a race.

import {
    DISPLAY_MODE_BAR_CHART,
    DISPLAY_MODE_BAR_RACE,
    DISPLAY_MODE_LIST,
    SCROBBLE_SORT_DESC
} from '../config.js';
import {
    applyEquationPipeline,
    formatEquationFieldLabel,
    getEquationFieldValue
} from '../data/equations.js';
import {
    convertStateToFilterArray,
    filterTracks,
    normalizeEntitySorting,
    resolveDisplayEntities
} from '../data/filters.js';
import { computeUnfilteredStats, isRollingWindowSortingBasis } from '../data/metrics.js';
import { escapeHTML } from '../dom.js';
import { state } from '../state.js';
import { formatDuration } from '../time.js';
import {
    destroyVisualizationState,
    ensureRaceDateDefaults,
    hasRaceSettingsReady,
    insertRacePlaybackToolbar,
    renderBarChartEntities,
    renderBarRaceComparison,
    renderBarRaceSingle
} from './charts.js';
import { isComparisonEnabled, updateActiveFilters } from './filters-panel.js';

function displayTopTracks(tracks, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("track");
    }
    const fragment = document.createDocumentFragment();
    
    tracks.slice(0, listLength).forEach((track, index) => {
        const trackDiv = document.createElement("div");
        trackDiv.classList.add("track");
        let additionalInfo = '';
        additionalInfo = getAdditionalInfo(sortingBasis, track);
        

        // If the track appears on multiple albums, display the album with the highest scrobble count.
        let albumDisplay = '';
        if (track.albumCounts) {
            let maxCount = 0;
            for (const album in track.albumCounts) {
                if (track.albumCounts[album] > maxCount) {
                    maxCount = track.albumCounts[album];
                    albumDisplay = album;
                }
            }
        }

        // If unfiltered stats should be shown, look up the global ranking and count.
        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        trackDiv.innerHTML = `
            <strong>${index + 1}. ${escapeHTML(track.Track)}</strong> by ${escapeHTML(track.Artist)}${unfilteredInfo}
            ${albumDisplay ? `<br>Album: ${escapeHTML(albumDisplay)}` : ''}
            <br>${additionalInfo}
        `;
        fragment.appendChild(trackDiv);
    });
    resultsDiv.appendChild(fragment);
}

function displayTopAlbums(albums, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("album");
    }
    const fragment = document.createDocumentFragment();

    albums.slice(0, listLength).forEach((album, index) => {
        const albumDiv = document.createElement("div");
        albumDiv.classList.add("album");
        let additionalInfo = '';

        additionalInfo = getAdditionalInfo(sortingBasis, album);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${album.name.toLowerCase()}||${album.artist.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        albumDiv.innerHTML = `
            <strong>${index + 1}. ${escapeHTML(album.name)}</strong> by ${escapeHTML(album.artist)}${unfilteredInfo}<br>
            ${additionalInfo}
        `;
        fragment.appendChild(albumDiv);
    });
    resultsDiv.appendChild(fragment);
}

function displayTopArtists(artists, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("artist");
    }
    const fragment = document.createDocumentFragment();

    artists.slice(0, listLength).forEach((artist, index) => {
        const artistDiv = document.createElement("div");
        artistDiv.classList.add("artist");
        let additionalInfo = '';

        additionalInfo = getAdditionalInfo(sortingBasis, artist);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = artist.name.toLowerCase();
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        artistDiv.innerHTML = `
            <strong>${index + 1}. ${escapeHTML(artist.name)}</strong>${unfilteredInfo}<br>
            ${additionalInfo}
        `;
        fragment.appendChild(artistDiv);
    });
    resultsDiv.appendChild(fragment);
}

function getAdditionalInfo(sortingBasis, entity) {
    const hiddenByDefaultEquationDetailFields = new Set(["artist-name", "track-name"]);
    const sortHistory = Array.isArray(entity.equationPipelineSortHistory) ? entity.equationPipelineSortHistory : [];
    const showFields = Array.isArray(entity.equationPipelineShowFields) ? entity.equationPipelineShowFields : [];
    const shownFieldSet = new Set(showFields);

    if (sortHistory.length > 0 || showFields.length > 0 || entity.equationPipelineUniqueField) {
        const lines = [];
        const seenLines = new Set();

        sortHistory.forEach(sortStep => {
            if (hiddenByDefaultEquationDetailFields.has(sortStep.field) && !shownFieldSet.has(sortStep.field)) {
                return;
            }
            const line = `${escapeHTML(formatEquationFieldLabel(sortStep.field))}: ${escapeHTML(sortStep.value)}`;
            if (!seenLines.has(line)) {
                seenLines.add(line);
                lines.push(line);
            }
        });

        showFields.forEach(fieldName => {
            const fieldValue = getEquationFieldValue(entity, fieldName);
            if (fieldValue === null || fieldValue === undefined) return;
            const line = `${escapeHTML(formatEquationFieldLabel(fieldName))}: ${escapeHTML(fieldValue)}`;
            if (!seenLines.has(line)) {
                seenLines.add(line);
                lines.push(line);
            }
        });

        if (entity.equationPipelineUniqueField) {
            if (
                !hiddenByDefaultEquationDetailFields.has(entity.equationPipelineUniqueField)
                || shownFieldSet.has(entity.equationPipelineUniqueField)
            ) {
                const uniqueLine = `${escapeHTML(formatEquationFieldLabel(entity.equationPipelineUniqueField))}: ${escapeHTML(entity.equationPipelineUniqueValue ?? 'N/A')}`;
                if (!seenLines.has(uniqueLine)) {
                    seenLines.add(uniqueLine);
                    lines.push(uniqueLine);
                }
            }
        }

        return lines.join("<br>");
    }

	if (sortingBasis === 'separate-days') {
		return `Different days: ${entity.count}`;
	} else if (sortingBasis === 'separate-weeks') {
		return `Different weeks: ${entity.count}`;
	} else if (sortingBasis === 'separate-months') {
		return `Different months: ${entity.count}`;
    } else if (sortingBasis === 'max-single-day') {
        return `Max scrobbles in a day: ${entity.count}<br>Day: ${escapeHTML(entity.periodLabel)}`;
    } else if (sortingBasis === 'max-single-week') {
        return `Max scrobbles in a week: ${entity.count}<br>Week: ${escapeHTML(entity.periodLabel)}`;
    } else if (sortingBasis === 'max-single-month') {
        return `Max scrobbles in a month: ${entity.count}<br>Month: ${escapeHTML(entity.periodLabel)}`;
    } else if (isRollingWindowSortingBasis(sortingBasis)) {
        const start = entity.windowStart ? new Date(entity.windowStart).toLocaleString() : 'N/A';
        const end = entity.windowEnd ? new Date(entity.windowEnd).toLocaleString() : 'N/A';
        return `Max scrobbles in ${entity.windowHours}h: ${entity.count}<br>Window start: ${start}<br>Window end: ${end}`;
	} else if (sortingBasis.startsWith('consecutive-')) {
		const startDate = entity.startTime ? new Date(parseInt(entity.startTime)).toISOString().split('T')[0] : 'N/A';
		const endDate = entity.endTime ? new Date(parseInt(entity.endTime)).toISOString().split('T')[0] : 'N/A';
		let periodLabel = sortingBasis.replace('consecutive-', '').replace('-', ' ');
		return `Max consecutive ${periodLabel}: ${entity.maxConsecutive}<br>Start: ${startDate}<br>End: ${endDate}`;
	} else if (sortingBasis === 'highest-listening-percentage') {
        return `Listening %: ${entity.listeningPercentage.toFixed(2)}%<br>Scrobbles: ${entity.scrobbles}<br>Playcount: ${entity.playcount}`;
    } else if (sortingBasis === 'time-spent-listening') {
        return `Listening time: ${formatDuration(entity.listeningDuration)}`;
    } else if (sortingBasis === 'first-n-scrobbles') {
        const firstScrobbleDate = entity.dates?.[0] ? new Date(parseInt(entity.dates[0], 10)).toISOString().split('T')[0] : 'N/A';
		const reachedDate = entity.dateReached ? new Date(parseInt(entity.dateReached, 10)).toISOString().split('T')[0] : 'N/A';
        return `First scrobble: ${firstScrobbleDate}<br>Date reached: ${reachedDate}`
    } else if (sortingBasis === 'fastest-n-scrobbles') {
        const startFastest = entity.firstScrobble ? new Date(parseInt(entity.firstScrobble)).toISOString().split('T')[0] : 'N/A';
		const endFastest = entity.dateReached ? new Date(parseInt(entity.dateReached)).toISOString().split('T')[0] : 'N/A';
        return `Time to reach: ${formatDuration(entity.timeNeeded)}<br>First scrobble: ${startFastest}<br>Date reached: ${endFastest} `
    } else if (sortingBasis === 'oldest-average-listening-time' || sortingBasis === 'newest-average-listening-time') {
        const avgDate = entity.averageListeningTimestamp
            ? new Date(parseInt(entity.averageListeningTimestamp, 10)).toISOString().split('T')[0]
            : 'N/A';
        return `Average listening date: ${avgDate}<br>Scrobbles: ${entity.count}`;
    } else {
		return `Scrobbles: ${entity.count}`;
	}
}

function renderEntitiesToContainer(entities, entityType, targetDiv, sortingBasis) {
    if (entityType === "track") {
        displayTopTracks(entities, targetDiv, sortingBasis);
    } else if (entityType === "album") {
        displayTopAlbums(entities, targetDiv, sortingBasis);
    } else if (entityType === "artist") {
        displayTopArtists(entities, targetDiv, sortingBasis);
    } else if (entityType === "scrobble") {
        displayScrobbles(entities, targetDiv, sortingBasis === SCROBBLE_SORT_DESC ? "desc" : "asc");
    }
}

export function getSelectedDisplayMode() {
    const mode = (document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST).toLowerCase();
    if ([DISPLAY_MODE_LIST, DISPLAY_MODE_BAR_CHART, DISPLAY_MODE_BAR_RACE].includes(mode)) {
        return mode;
    }
    return DISPLAY_MODE_LIST;
}

function equalizeComparisonRowHeights(leftContainer, rightContainer) {
    if (!leftContainer || !rightContainer) return;

    const leftRows = Array.from(leftContainer.children);
    const rightRows = Array.from(rightContainer.children);
    const maxRows = Math.max(leftRows.length, rightRows.length);

    for (let index = 0; index < maxRows; index++) {
        const leftRow = leftRows[index] || null;
        const rightRow = rightRows[index] || null;

        if (leftRow) {
            leftRow.style.boxSizing = "border-box";
            leftRow.style.height = "";
        }
        if (rightRow) {
            rightRow.style.boxSizing = "border-box";
            rightRow.style.height = "";
        }

        const leftHeight = leftRow ? leftRow.offsetHeight : 0;
        const rightHeight = rightRow ? rightRow.offsetHeight : 0;
        const targetHeight = Math.max(leftHeight, rightHeight);

        if (leftRow) leftRow.style.height = `${targetHeight}px`;
        if (rightRow) rightRow.style.height = `${targetHeight}px`;
    }
}

export function displayEntities() {
    destroyVisualizationState();
    ensureRaceDateDefaults();

    const initialEntityType = document.getElementById("entity-type").value;
    const initialSortingBasis = document.getElementById("sorting-basis").value;
    const normalizedMain = normalizeEntitySorting(initialEntityType, initialSortingBasis);
    const entityType = normalizedMain.entityType;
    const sortingBasis = normalizedMain.sortingBasis;
    const selectedDisplayMode = getSelectedDisplayMode();
    const supportsVisualization = entityType !== "scrobble";
    const effectiveDisplayMode = supportsVisualization ? selectedDisplayMode : DISPLAY_MODE_LIST;
    const renderMode = (effectiveDisplayMode !== DISPLAY_MODE_LIST && typeof Chart === "undefined")
        ? DISPLAY_MODE_LIST
        : effectiveDisplayMode;
    const raceReady = renderMode !== DISPLAY_MODE_BAR_RACE || hasRaceSettingsReady();
    const raceCanRender = renderMode !== DISPLAY_MODE_BAR_RACE || (raceReady && state.raceRenderArmed);

    if (entityType !== initialEntityType) {
        document.getElementById("entity-type").value = entityType;
    }
    if (sortingBasis !== initialSortingBasis) {
        document.getElementById("sorting-basis").value = sortingBasis;
    }

    const maxPerArtist = parseInt(document.getElementById("max-per-artist").value) || Infinity;
    const xValue = parseInt(document.getElementById("x-value").value) || 1;
    const comparisonButtonActive = isComparisonEnabled();

    const baseTracks = filterTracks(state.activeFilters, state.allTracks);
    const leftState = state.comparisonFilterStates.left || {};
    const rightState = state.comparisonFilterStates.right || {};
    const leftFilters = convertStateToFilterArray(leftState);
    const rightFilters = convertStateToFilterArray(rightState);

    const leftTracksBase = comparisonButtonActive ? filterTracks(leftFilters, state.allTracks) : baseTracks;
    const rightTracksBase = comparisonButtonActive ? filterTracks(rightFilters, state.allTracks) : baseTracks;

    const equationsLeft = comparisonButtonActive
        ? ((leftState.equations || "").trim())
        : ((document.getElementById("equations")?.value || "").trim());
    const equationsRight = comparisonButtonActive
        ? ((document.getElementById("equations-right")?.value || rightState.equations || "").trim())
        : "";

    const leftXValue = parseInt(leftState["x-value"], 10) || xValue;
    const rightXValue = parseInt(rightState["x-value"], 10) || xValue;
    const leftPipeline = applyEquationPipeline(leftTracksBase, equationsLeft, { xValue: leftXValue });
    const comparisonRequested = comparisonButtonActive || equationsRight !== "";

    if (comparisonRequested) {
        const rightPipeline = applyEquationPipeline(rightTracksBase, equationsRight, { xValue: rightXValue });
        const leftNormalized = normalizeEntitySorting((leftState["entity-type"] || entityType || "track").toLowerCase(), leftState["sorting-basis"] || sortingBasis);
        const rightNormalized = normalizeEntitySorting((rightState["entity-type"] || entityType || "track").toLowerCase(), rightState["sorting-basis"] || sortingBasis);
        const leftEntityType = leftNormalized.entityType;
        const rightEntityType = rightNormalized.entityType;
        const leftSortingBasis = leftNormalized.sortingBasis;
        const rightSortingBasis = rightNormalized.sortingBasis;
        const leftMaxPerArtist = parseInt(leftState["max-per-artist"], 10) || maxPerArtist;
        const rightMaxPerArtist = parseInt(rightState["max-per-artist"], 10) || maxPerArtist;

        const leftEntities = resolveDisplayEntities(leftPipeline, leftEntityType, leftSortingBasis, leftXValue, leftMaxPerArtist);
        const rightEntities = resolveDisplayEntities(rightPipeline, rightEntityType, rightSortingBasis, rightXValue, rightMaxPerArtist);

        const resultsDiv = document.getElementById("results");
        resultsDiv.innerHTML = "";

        const comparisonLayout = document.createElement("div");
        comparisonLayout.className = "comparison-results";

        const leftColumn = document.createElement("div");
        leftColumn.className = "comparison-column";
        const leftTitle = document.createElement("h3");
        leftTitle.textContent = "Left";
        const leftList = document.createElement("div");
        leftColumn.appendChild(leftTitle);
        leftColumn.appendChild(leftList);

        const rightColumn = document.createElement("div");
        rightColumn.className = "comparison-column";
        const rightTitle = document.createElement("h3");
        rightTitle.textContent = "Right";
        const rightList = document.createElement("div");
        rightColumn.appendChild(rightTitle);
        rightColumn.appendChild(rightList);

        comparisonLayout.appendChild(leftColumn);
        comparisonLayout.appendChild(rightColumn);
        resultsDiv.appendChild(comparisonLayout);

        if (renderMode === DISPLAY_MODE_BAR_CHART) {
            renderBarChartEntities(leftEntities, leftEntityType, leftSortingBasis, leftList);
            renderBarChartEntities(rightEntities, rightEntityType, rightSortingBasis, rightList);
        } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
            if (raceCanRender) {
                insertRacePlaybackToolbar(resultsDiv);
                renderBarRaceComparison(
                    leftPipeline.tracks,
                    rightPipeline.tracks,
                    leftEntityType,
                    rightEntityType,
                    leftSortingBasis,
                    rightSortingBasis,
                    leftXValue,
                    rightXValue,
                    leftMaxPerArtist,
                    rightMaxPerArtist,
                    leftList,
                    rightList
                );
            } else {
                renderBarChartEntities(leftEntities, leftEntityType, leftSortingBasis, leftList);
                renderBarChartEntities(rightEntities, rightEntityType, rightSortingBasis, rightList);
            }
        } else {
            renderEntitiesToContainer(leftEntities, leftEntityType, leftList, leftSortingBasis);
            renderEntitiesToContainer(rightEntities, rightEntityType, rightList, rightSortingBasis);
            equalizeComparisonRowHeights(leftList, rightList);
        }

        state.lastRenderedListState = {
            isComparison: true,
            current: { entities: leftEntities, entityType: leftEntityType },
            left: { entities: leftEntities, entityType: leftEntityType },
            right: { entities: rightEntities, entityType: rightEntityType }
        };

        const resultsHeader = document.querySelector("#results-section h2");
        if (renderMode === DISPLAY_MODE_BAR_CHART) {
            resultsHeader.textContent = "Comparison Bar Charts";
        } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
            resultsHeader.textContent = raceCanRender
                ? "Comparison Bar Chart Race"
                : "Comparison Bar Charts (Race settings pending or Apply Filters required)";
        } else {
            resultsHeader.textContent = "Comparison Results";
        }

        state.filteredData = leftEntities;
        updateActiveFilters();
        return;
    }

    const singleEntities = resolveDisplayEntities(leftPipeline, entityType, sortingBasis, xValue, maxPerArtist);
    state.filteredData = singleEntities;
    const resultsTarget = document.getElementById("results");

    if (renderMode === DISPLAY_MODE_BAR_CHART) {
        renderBarChartEntities(singleEntities, entityType, sortingBasis, resultsTarget);
    } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
        if (raceCanRender) {
            resultsTarget.innerHTML = "";
            insertRacePlaybackToolbar(resultsTarget);
            const raceChartContainer = document.createElement("div");
            resultsTarget.appendChild(raceChartContainer);
            renderBarRaceSingle(leftPipeline.tracks, entityType, raceChartContainer, sortingBasis);
        } else {
            renderBarChartEntities(singleEntities, entityType, sortingBasis, resultsTarget);
        }
    } else {
        renderEntitiesToContainer(singleEntities, entityType, resultsTarget, sortingBasis);
    }

    state.lastRenderedListState = {
        isComparison: false,
        current: { entities: singleEntities, entityType },
        left: { entities: [], entityType: "track" },
        right: { entities: [], entityType: "track" }
    };

    const resultsHeader = document.querySelector("#results-section h2");
    if (renderMode === DISPLAY_MODE_BAR_CHART) {
        resultsHeader.textContent = "Bar Chart";
    } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
        resultsHeader.textContent = raceCanRender
            ? "Bar Chart Race"
            : "Bar Chart (Race settings pending or Apply Filters required)";
    } else if (leftPipeline.hasOrderingStep && entityType === "track") {
        resultsHeader.textContent = "Equation Results";
    } else if (entityType === "track") {
        resultsHeader.textContent = "Top Tracks";
    } else if (entityType === "album") {
        resultsHeader.textContent = "Top Albums";
    } else if (entityType === "artist") {
        resultsHeader.textContent = "Top Artists";
    } else if (entityType === "scrobble") {
        resultsHeader.textContent = "Scrobbles";
    }

    updateActiveFilters();
}

function displayScrobbles(scrobbles, targetDiv = null, order = "asc") {
    const resultsDiv = targetDiv || document.getElementById("results");
    const maxPerArtist = parseInt(document.getElementById("max-per-artist").value) || Infinity;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    let tracks = [...scrobbles];
    resultsDiv.innerHTML = "";
    const fragment = document.createDocumentFragment();

    tracks.sort((a, b) => {
        const aDate = parseInt(a.Date, 10) || 0;
        const bDate = parseInt(b.Date, 10) || 0;
        return order === "desc" ? bDate - aDate : aDate - bDate;
    });

    // Apply the per-artist cap BEFORE trimming to the list length, otherwise a
    // capped artist eats slots and the list comes back shorter than requested.
    const artistCounts = {};
    const visible = [];
    for (const track of tracks) {
        if (visible.length >= listLength) break;
        const artist = track.Artist;
        if (!artistCounts[artist]) artistCounts[artist] = 0;
        if (artistCounts[artist] >= maxPerArtist) continue;
        artistCounts[artist]++;
        visible.push(track);
    }

    visible.forEach((track) => {
        const artist = track.Artist;
        const trackDiv = document.createElement("div");
        trackDiv.classList.add("track");

        // Format Date to YYYY-MM-DD HH:MM
        const date = new Date(Number(track.Date)); 
        const formattedDate = date.getFullYear() + "-" + 
            String(date.getMonth() + 1).padStart(2, "0") + "-" + 
            String(date.getDate()).padStart(2, "0") + " " + 
            String(date.getHours()).padStart(2, "0") + ":" + 
            String(date.getMinutes()).padStart(2, "0");

        trackDiv.innerHTML = `
            <strong>${escapeHTML(track.Track)}</strong> by ${escapeHTML(artist)}
            <br>Album: ${escapeHTML(track.Album || "Unknown")}
            <br>Scrobbled on: ${formattedDate}
        `;

        fragment.appendChild(trackDiv);
    });
    resultsDiv.appendChild(fragment);
}
