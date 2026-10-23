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
    currentEntityCaps,
    entityCapsFrom,
    filterTracks,
    makeCapCounter,
    normalizeEntitySorting,
    resolveDisplayEntities,
    undatedTracksFor
} from '../data/filters.js';
import { createArtworkElement } from '../data/artwork.js';
import { computeUnfilteredStats, getDefaultXValue, isRollingWindowSortingBasis } from '../data/metrics.js';
import { escapeHTML, getListLengthLimit } from '../dom.js';
import { state } from '../state.js';
import { formatDuration } from '../time.js';
import {
    createRaceView,
    destroyVisualizationState,
    ensureRaceDateDefaults,
    hasRaceSettingsReady,
    insertRacePlaybackToolbar,
    renderBarChartEntities,
    renderBarRaceComparison,
    renderBarRaceSingle
} from './charts.js';
import { getComparisonEditTarget, isComparisonEnabled, updateActiveFilters } from './filters-panel.js';

// A list row: rank, cover, title with its artist and album underneath, and
// the number the list is ranked by on the right. Clicking it opens the
// entity's own page (see ui/entity-page.js), so the row carries the entity's
// identity.
function fillEntityRow(row, type, identity, { rank = null, text, metric = null }) {
    row.classList.add("entity-row");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.dataset.entityType = type;
    row.dataset.name = identity.name || "";
    row.dataset.artist = identity.artist || "";
    if (identity.album) row.dataset.album = identity.album;
    row.title = `Show stats for ${identity.name}`;

    const parts = [];
    if (rank !== null) {
        const rankEl = document.createElement("span");
        rankEl.className = "row-rank";
        rankEl.textContent = rank;
        parts.push(rankEl);
    }
    parts.push(createArtworkElement(type, identity.name, identity.artist, identity.album));
    const textEl = document.createElement("div");
    textEl.className = "entity-row-text";
    textEl.innerHTML = text;
    parts.push(textEl);
    if (metric) {
        const metricEl = document.createElement("div");
        metricEl.className = "row-metric";
        metricEl.innerHTML = metric;
        parts.push(metricEl);
    }
    row.append(...parts);
}

// Title, then "artist · album", then any detail lines (already escaped).
// Phones put the artist and the album on lines of their own (see style.css).
function rowText(title, subtitleParts, details = [], extra = "") {
    const subtitle = subtitleParts.filter(Boolean)
        .map(part => `<span class="row-sub-part">${escapeHTML(part)}</span>`)
        .join(`<span class="row-sub-sep" aria-hidden="true"> · </span>`);
    return `<span class="row-head"><strong class="row-title">${escapeHTML(title)}</strong>${extra}</span>`
        + (subtitle ? `<span class="row-sub">${subtitle}</span>` : "")
        + details.map(line => `<span class="row-details">${line}</span>`).join("");
}

function rowMetric(metric) {
    if (!metric || metric.value === null || metric.value === undefined || metric.value === "") return null;
    return `<strong>${escapeHTML(String(metric.value))}</strong>`
        + (metric.unit ? `<small>${escapeHTML(metric.unit)}</small>` : "");
}

function unfilteredNote(info) {
    return info ? ` <small class="row-unfiltered" title="Rank and scrobbles without filters">${escapeHTML(info)}</small>` : "";
}

function displayTopTracks(tracks, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = getListLengthLimit();
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("track");
    }
    const fragment = document.createDocumentFragment();
    
    tracks.slice(0, listLength).forEach((track, index) => {
        const trackDiv = document.createElement("div");
        trackDiv.classList.add("track");
        const rowInfo = getRowInfo(sortingBasis, track);

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
                unfilteredInfo = `(#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        fillEntityRow(trackDiv, "track", { name: track.Track, artist: track.Artist, album: albumDisplay || null }, {
            rank: index + 1,
            text: rowText(track.Track, [track.Artist, albumDisplay], rowInfo.details, unfilteredNote(unfilteredInfo)),
            metric: rowMetric(rowInfo)
        });
        fragment.appendChild(trackDiv);
    });
    resultsDiv.appendChild(fragment);
}

function displayTopAlbums(albums, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = getListLengthLimit();
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("album");
    }
    const fragment = document.createDocumentFragment();

    albums.slice(0, listLength).forEach((album, index) => {
        const albumDiv = document.createElement("div");
        albumDiv.classList.add("album");
        const rowInfo = getRowInfo(sortingBasis, album);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${album.name.toLowerCase()}||${album.artist.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = `(#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        fillEntityRow(albumDiv, "album", { name: album.name, artist: album.artist }, {
            rank: index + 1,
            text: rowText(album.name, [album.artist], rowInfo.details, unfilteredNote(unfilteredInfo)),
            metric: rowMetric(rowInfo)
        });
        fragment.appendChild(albumDiv);
    });
    resultsDiv.appendChild(fragment);
}

function displayTopArtists(artists, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = getListLengthLimit();
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("artist");
    }
    const fragment = document.createDocumentFragment();

    artists.slice(0, listLength).forEach((artist, index) => {
        const artistDiv = document.createElement("div");
        artistDiv.classList.add("artist");
        const rowInfo = getRowInfo(sortingBasis, artist);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = artist.name.toLowerCase();
            if (unfilteredMapping[key]) {
                unfilteredInfo = `(#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        fillEntityRow(artistDiv, "artist", { name: artist.name, artist: artist.name }, {
            rank: index + 1,
            text: rowText(artist.name, [], rowInfo.details, unfilteredNote(unfilteredInfo)),
            metric: rowMetric(rowInfo)
        });
        fragment.appendChild(artistDiv);
    });
    resultsDiv.appendChild(fragment);
}

// What a row shows for the list's sort: the value it is ranked by (shown on
// the right) with its unit, and detail lines such as dates (under the title,
// already escaped). Lists with equation steps show the steps' values as
// detail lines instead.
function getRowInfo(sortingBasis, entity) {
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
            const fieldValue = entity.equationPipelineShowValues && fieldName in entity.equationPipelineShowValues
                ? entity.equationPipelineShowValues[fieldName]
                : getEquationFieldValue(entity, fieldName);
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

        return { value: null, unit: "", details: lines };
    }

    const plural = (count, one, many) => (Number(count) === 1 ? one : many);
    const isoDate = timestamp => timestamp ? new Date(parseInt(timestamp, 10)).toISOString().split('T')[0] : 'N/A';
    // A date wraps as a whole, never at its hyphens.
    const unbroken = text => `<span class="nowrap">${escapeHTML(text)}</span>`;
    const periodNames = { "separate-days": ["day", "days"], "separate-weeks": ["week", "weeks"], "separate-months": ["month", "months"] };

    if (periodNames[sortingBasis]) {
        const [one, many] = periodNames[sortingBasis];
        return { value: entity.count, unit: plural(entity.count, one, many), details: [] };
    } else if (sortingBasis === 'max-single-day' || sortingBasis === 'max-single-week' || sortingBasis === 'max-single-month') {
        const period = sortingBasis.replace('max-single-', '');
        const label = period.charAt(0).toUpperCase() + period.slice(1);
        return { value: entity.count, unit: `in one ${period}`, details: [`${label}: ${escapeHTML(entity.periodLabel)}`] };
    } else if (isRollingWindowSortingBasis(sortingBasis)) {
        const start = entity.windowStart ? new Date(entity.windowStart).toLocaleString() : 'N/A';
        const end = entity.windowEnd ? new Date(entity.windowEnd).toLocaleString() : 'N/A';
        return { value: entity.count, unit: `in ${entity.windowHours} hours`, details: [`From ${escapeHTML(start)} to ${escapeHTML(end)}`] };
    } else if (sortingBasis.startsWith('consecutive-')) {
        const period = sortingBasis.replace('consecutive-', '');
        const unit = `${Number(entity.maxConsecutive) === 1 ? period.replace(/s$/, '') : period} in a row`;
        return { value: entity.maxConsecutive, unit, details: [`${unbroken(isoDate(entity.startTime))} to ${unbroken(isoDate(entity.endTime))}`] };
    } else if (sortingBasis === 'highest-listening-percentage') {
        return {
            value: `${entity.listeningPercentage.toFixed(2)}%`,
            unit: "of its global scrobbles",
            details: [`${escapeHTML(entity.scrobbles)} of ${escapeHTML(entity.playcount)} scrobbles on Last.fm`]
        };
    } else if (sortingBasis === 'time-spent-listening') {
        return { value: formatDuration(entity.listeningDuration), unit: "listening", details: [] };
    } else if (sortingBasis === 'first-n-scrobbles') {
        return { value: isoDate(entity.dateReached), unit: "reached", details: [`First scrobble: ${isoDate(entity.dates?.[0])}`] };
    } else if (sortingBasis === 'fastest-n-scrobbles') {
        return {
            value: formatDuration(entity.timeNeeded),
            unit: "to reach",
            details: [`${unbroken(isoDate(entity.firstScrobble))} to ${unbroken(isoDate(entity.dateReached))}`]
        };
    } else if (sortingBasis === 'oldest-average-listening-time' || sortingBasis === 'newest-average-listening-time') {
        return {
            value: isoDate(entity.averageListeningTimestamp),
            unit: "average play",
            details: [`${escapeHTML(entity.count)} ${plural(entity.count, "scrobble", "scrobbles")}`]
        };
    }
    return { value: entity.count, unit: plural(entity.count, "scrobble", "scrobbles"), details: [] };
}

function renderEntitiesToContainer(entities, entityType, targetDiv, sortingBasis, caps) {
    // The rank column is as wide as the longest rank in this list.
    const lastRank = Math.min(entities.length, getListLengthLimit());
    targetDiv.style.setProperty("--rank-width", `${String(Math.max(lastRank, 1)).length + 0.5}ch`);
    if (entityType === "track") {
        displayTopTracks(entities, targetDiv, sortingBasis);
    } else if (entityType === "album") {
        displayTopAlbums(entities, targetDiv, sortingBasis);
    } else if (entityType === "artist") {
        displayTopArtists(entities, targetDiv, sortingBasis);
    } else if (entityType === "scrobble") {
        displayScrobbles(entities, targetDiv, sortingBasis === SCROBBLE_SORT_DESC ? "desc" : "asc", caps);
    }
}

export function getSelectedDisplayMode() {
    const mode = (document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST).toLowerCase();
    if ([DISPLAY_MODE_LIST, DISPLAY_MODE_BAR_CHART, DISPLAY_MODE_BAR_RACE].includes(mode)) {
        return mode;
    }
    return DISPLAY_MODE_LIST;
}

// The two sides sit side by side when each gets this much room (the same
// widths as .comparison-lists and .comparison-charts in style.css, plus the
// 1rem gap between them). Charts need more room than lists for their labels.
const MIN_COMPARISON_WIDTH = { lists: 300, charts: 340 };
const COMPARISON_GAP = 16;

function comparisonFitsSideBySide(layout) {
    const min = layout.classList.contains("comparison-charts") ? MIN_COMPARISON_WIDTH.charts : MIN_COMPARISON_WIDTH.lists;
    return layout.clientWidth >= 2 * min + COMPARISON_GAP;
}

// Too narrow for both: show one side at a time, with a Left / Right switch.
// Opens on the side the filter panel is editing, so applying a change to the
// right side shows the right side.
let comparisonSideShown = "left";

function addComparisonSwitch(layout, noun) {
    const group = document.createElement("div");
    group.className = "comparison-switch";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${noun.charAt(0).toUpperCase()}${noun.slice(1)} to show`);
    group.innerHTML = `<button type="button" data-side="left">Left ${noun}</button><button type="button" data-side="right">Right ${noun}</button>`;
    group.addEventListener("click", event => {
        const button = event.target.closest("[data-side]");
        if (!button) return;
        comparisonSideShown = button.dataset.side;
        showComparisonSide(layout);
    });
    layout.prepend(group);
}

function showComparisonSide(layout) {
    const columns = layout.querySelectorAll(".comparison-column");
    columns.forEach((column, index) => {
        column.classList.toggle("is-other-side", (index === 0 ? "left" : "right") !== comparisonSideShown);
    });
    layout.querySelectorAll(".comparison-switch [data-side]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.side === comparisonSideShown));
    });
}

// Side by side or one at a time, by the room there is. Returns null while
// the comparison is hidden (it is laid out again once it shows).
function updateComparisonLayout(layout) {
    if (!layout || !layout.clientWidth) return null;
    const sideBySide = comparisonFitsSideBySide(layout);
    layout.classList.toggle("is-one-at-a-time", !sideBySide);
    return sideBySide;
}

// Side by side, row n of the left list and row n of the right list get the
// same height so they line up. One at a time, each keeps its own heights.
function equalizeComparisonRowHeights(leftContainer, rightContainer) {
    if (!leftContainer || !rightContainer) return;
    const sideBySide = updateComparisonLayout(leftContainer.closest(".comparison-results"));
    if (sideBySide === null) return;

    const leftRows = Array.from(leftContainer.children);
    const rightRows = Array.from(rightContainer.children);
    [...leftRows, ...rightRows].forEach(row => {
        row.style.boxSizing = "border-box";
        row.style.height = "";
    });
    if (!sideBySide) return;

    const maxRows = Math.max(leftRows.length, rightRows.length);
    const heights = [];
    for (let index = 0; index < maxRows; index++) {
        heights.push(Math.max(leftRows[index]?.offsetHeight || 0, rightRows[index]?.offsetHeight || 0));
    }
    heights.forEach((height, index) => {
        if (leftRows[index]) leftRows[index].style.height = `${height}px`;
        if (rightRows[index]) rightRows[index].style.height = `${height}px`;
    });
}

// The layout (and the row heights of lists) depends on the width, so it is
// worked out again when the width changes: a resized window, a turned phone,
// the filter panel opening or closing, or a comparison rendered while
// hidden behind an entity page.
let comparisonResizeObserver = null;

function setUpComparison(layout, kind, leftContainer, rightContainer) {
    layout.classList.add(kind === "lists" ? "comparison-lists" : "comparison-charts");
    comparisonSideShown = getComparisonEditTarget();
    addComparisonSwitch(layout, kind === "lists" ? "list" : "chart");
    showComparisonSide(layout);
    const refresh = kind === "lists"
        ? () => equalizeComparisonRowHeights(leftContainer, rightContainer)
        : () => updateComparisonLayout(layout);
    refresh();

    comparisonResizeObserver?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = layout.offsetWidth;
    comparisonResizeObserver = new ResizeObserver(() => {
        const width = layout.offsetWidth;
        if (width === lastWidth) return;
        lastWidth = width;
        refresh();
    });
    comparisonResizeObserver.observe(layout);
}

export function displayEntities() {
    destroyVisualizationState();
    comparisonResizeObserver?.disconnect();
    ensureRaceDateDefaults();
    // The address bar follows the list on screen (ui/url-state.js).
    document.dispatchEvent(new CustomEvent("list:rendered"));

    const initialEntityType = document.getElementById("entity-type").value;
    const initialSortingBasis = document.getElementById("sorting-basis").value;
    const normalizedMain = normalizeEntitySorting(initialEntityType, initialSortingBasis);
    const entityType = normalizedMain.entityType;
    const sortingBasis = normalizedMain.sortingBasis;
    const selectedDisplayMode = getSelectedDisplayMode();
    const supportsVisualization = entityType !== "scrobble";
    const effectiveDisplayMode = supportsVisualization ? selectedDisplayMode : DISPLAY_MODE_LIST;
    // Only the plain bar chart needs Chart.js; the race draws its own canvas.
    const renderMode = (effectiveDisplayMode === DISPLAY_MODE_BAR_CHART && typeof Chart === "undefined")
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

    const caps = currentEntityCaps();
    const xValue = parseInt(document.getElementById("x-value").value) || getDefaultXValue(sortingBasis);
    const comparisonButtonActive = isComparisonEnabled();

    const leftState = state.comparisonFilterStates.left || {};
    const rightState = state.comparisonFilterStates.right || {};

    const equationsLeft = comparisonButtonActive
        ? ((leftState.equations || "").trim())
        : ((document.getElementById("equations")?.value || "").trim());
    const equationsRight = comparisonButtonActive
        ? ((document.getElementById("equations-right")?.value || rightState.equations || "").trim())
        : "";

    // A list with equation steps starts from the whole history: the steps
    // are its filters, and the other menus are paused for it (the panel and
    // the filter chips say so). Without steps, the menus filter as usual.
    // Scrobbles with no date join at the end when the list doesn't use time.
    const sideBase = (equations, sideState) => {
        const filters = comparisonButtonActive ? convertStateToFilterArray(sideState) : state.activeFilters;
        const sorting = comparisonButtonActive
            ? normalizeEntitySorting((sideState["entity-type"] || entityType || "track").toLowerCase(), sideState["sorting-basis"] || sortingBasis)
            : { entityType, sortingBasis };
        const dated = equations ? state.allTracks : filterTracks(filters, state.allTracks);
        const undated = undatedTracksFor({ filters, equations, ...sorting });
        return undated.length ? dated.concat(undated) : dated;
    };
    const leftTracksBase = sideBase(equationsLeft, leftState);
    const rightTracksBase = comparisonButtonActive ? sideBase(equationsRight, rightState) : leftTracksBase;

    const leftXValue = parseInt(leftState["x-value"], 10) || getDefaultXValue(leftState["sorting-basis"] || sortingBasis);
    const rightXValue = parseInt(rightState["x-value"], 10) || getDefaultXValue(rightState["sorting-basis"] || sortingBasis);
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
        const leftCaps = entityCapsFrom(leftState);
        const rightCaps = entityCapsFrom(rightState);

        const leftEntities = resolveDisplayEntities(leftPipeline, leftEntityType, leftSortingBasis, leftXValue, leftCaps);
        const rightEntities = resolveDisplayEntities(rightPipeline, rightEntityType, rightSortingBasis, rightXValue, rightCaps);
        offerGraph(leftEntityType, leftSortingBasis, leftXValue, leftPipeline.tracks, leftEntities);

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

        // A scrobble list can't be charted, so a side with one keeps both
        // sides as lists, whichever side the panel is editing.
        const sidesChartable = leftEntityType !== "scrobble" && rightEntityType !== "scrobble";
        const comparisonMode = sidesChartable ? renderMode : DISPLAY_MODE_LIST;
        if (comparisonMode === DISPLAY_MODE_BAR_CHART) {
            setUpComparison(comparisonLayout, "charts", leftList, rightList);
            renderBarChartEntities(leftEntities, leftEntityType, leftSortingBasis, leftList);
            renderBarChartEntities(rightEntities, rightEntityType, rightSortingBasis, rightList);
        } else if (comparisonMode === DISPLAY_MODE_BAR_RACE) {
            if (raceCanRender) {
                const raceView = createRaceView(resultsDiv);
                raceView.charts.appendChild(comparisonLayout);
                setUpComparison(comparisonLayout, "charts", leftList, rightList);
                insertRacePlaybackToolbar(raceView.controls);
                renderBarRaceComparison(
                    leftPipeline.tracks,
                    rightPipeline.tracks,
                    leftEntityType,
                    rightEntityType,
                    leftSortingBasis,
                    rightSortingBasis,
                    leftXValue,
                    rightXValue,
                    leftCaps,
                    rightCaps,
                    leftList,
                    rightList
                );
            } else {
                setUpComparison(comparisonLayout, "charts", leftList, rightList);
                renderBarChartEntities(leftEntities, leftEntityType, leftSortingBasis, leftList);
                renderBarChartEntities(rightEntities, rightEntityType, rightSortingBasis, rightList);
            }
        } else {
            renderEntitiesToContainer(leftEntities, leftEntityType, leftList, leftSortingBasis, leftCaps);
            renderEntitiesToContainer(rightEntities, rightEntityType, rightList, rightSortingBasis, rightCaps);
            setUpComparison(comparisonLayout, "lists", leftList, rightList);
        }

        state.lastRenderedListState = {
            isComparison: true,
            current: { entities: leftEntities, entityType: leftEntityType },
            left: { entities: leftEntities, entityType: leftEntityType },
            right: { entities: rightEntities, entityType: rightEntityType }
        };

        const resultsHeader = document.querySelector("#results-section h2");
        if (comparisonMode === DISPLAY_MODE_BAR_CHART) {
            resultsHeader.textContent = "Comparison Bar Charts";
        } else if (comparisonMode === DISPLAY_MODE_BAR_RACE) {
            resultsHeader.textContent = raceCanRender
                ? "Comparison Bar Chart Race"
                : "Comparison Bar Charts (Race settings pending or Apply Filters required)";
        } else {
            resultsHeader.textContent = "Comparison Results";
        }

        state.filteredData = leftEntities;
        updateActiveFilters();
        announceRenderedList(leftEntities.length + rightEntities.length, {
            comparison: true,
            entityType: leftEntityType,
            renderMode: raceCanRender ? comparisonMode : DISPLAY_MODE_BAR_CHART
        });
        return;
    }

    const singleEntities = resolveDisplayEntities(leftPipeline, entityType, sortingBasis, xValue, caps);
    state.filteredData = singleEntities;
    offerGraph(entityType, sortingBasis, xValue, leftPipeline.tracks, singleEntities);
    const resultsTarget = document.getElementById("results");

    if (renderMode === DISPLAY_MODE_BAR_CHART) {
        renderBarChartEntities(singleEntities, entityType, sortingBasis, resultsTarget);
    } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
        if (raceCanRender) {
            resultsTarget.innerHTML = "";
            const raceView = createRaceView(resultsTarget);
            insertRacePlaybackToolbar(raceView.controls);
            renderBarRaceSingle(leftPipeline.tracks, entityType, raceView.charts, sortingBasis);
        } else {
            renderBarChartEntities(singleEntities, entityType, sortingBasis, resultsTarget);
        }
    } else {
        renderEntitiesToContainer(singleEntities, entityType, resultsTarget, sortingBasis, caps);
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
    announceRenderedList(singleEntities.length, {
        comparison: false,
        entityType,
        sortingBasis,
        renderMode: raceCanRender ? renderMode : DISPLAY_MODE_BAR_CHART
    });
}

// Lets other parts of the page react to a new list, such as the support
// banner counting how many different lists were viewed and the usage counts
// in analytics.js.
function announceRenderedList(count, listInfo) {
    document.dispatchEvent(new CustomEvent("lists:rendered", { detail: { count, ...listInfo } }));
}

// "Graph" opens the list on screen in the graph builder: its top
// items, ranked the same way, counted over the plays the list uses.
function offerGraph(entityType, sortingBasis, xValue, tracks, entities) {
    const graphable = entityType !== "scrobble" && entities.length > 0;
    const plural = { track: "Tracks", album: "Albums", artist: "Artists" }[entityType];
    const sortLabel = document.querySelector(`#sorting-basis option[value="${sortingBasis}"]`)?.textContent.trim().toLowerCase() || sortingBasis;
    state.graphableList = graphable
        ? { entityType, sortingBasis, xValue, tracks, entities: entities.slice(0, 10), title: `${plural} by ${sortLabel}` }
        : null;
    const button = document.getElementById("graph-this-list");
    if (button) button.hidden = !graphable;
}

function displayScrobbles(scrobbles, targetDiv = null, order = "asc", caps = currentEntityCaps()) {
    const resultsDiv = targetDiv || document.getElementById("results");
    const admit = makeCapCounter("scrobble", caps);
    const listLength = getListLengthLimit();
    let tracks = [...scrobbles];
    resultsDiv.innerHTML = "";
    const fragment = document.createDocumentFragment();

    tracks.sort((a, b) => {
        const aDate = parseInt(a.Date, 10) || 0;
        const bDate = parseInt(b.Date, 10) || 0;
        return order === "desc" ? bDate - aDate : aDate - bDate;
    });

    // Apply the caps BEFORE trimming to the list length, otherwise a capped
    // artist eats slots and the list comes back shorter than requested.
    const visible = [];
    for (const track of tracks) {
        if (visible.length >= listLength) break;
        if (admit(track)) visible.push(track);
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

        fillEntityRow(trackDiv, "track", { name: track.Track, artist, album: track.Album }, {
            text: rowText(track.Track, [artist, track.Album || "Unknown"]),
            metric: rowMetric({ value: formattedDate.slice(0, 10), unit: formattedDate.slice(11) })
        });

        fragment.appendChild(trackDiv);
    });
    resultsDiv.appendChild(fragment);
}

// Mark the row for one entity and bring it into view, so a list opened from
// an entity page shows where that entity sits.
export function highlightEntityRow({ type, name, artist }) {
    const results = document.getElementById("results");
    if (!results) return;
    const lower = value => (value || "").toLowerCase();
    const row = Array.from(results.querySelectorAll(".entity-row")).find(candidate =>
        candidate.dataset.entityType === type
        && lower(candidate.dataset.name) === lower(name)
        && (type === "artist" || lower(candidate.dataset.artist) === lower(artist)));
    if (!row) return;
    row.classList.add("is-highlighted");
    requestAnimationFrame(() => row.scrollIntoView({ block: "center", behavior: "smooth" }));
}
