// Bar charts and the animated bar race, including playback controls and
// the theme-aware colours both share.

import {
    DISPLAY_MODE_BAR_CHART,
    DISPLAY_MODE_BAR_RACE,
    SCROBBLE_SORT_ASC,
    SCROBBLE_SORT_DESC
} from '../config.js';
import { applyEntityCaps, buildEntitiesFromTracks, currentEntityCaps } from '../data/filters.js';
import { getDefaultXValue, isRollingWindowSortingBasis } from '../data/metrics.js';
import { getListLengthLimit } from '../dom.js';
import { state } from '../state.js';
import { formatDateInputValue, formatDuration } from '../time.js';
import { assignColors, createColorLegend, setShownNames } from './artist-colors.js';
import { createRaceChart } from './bar-race.js';
import { displayEntities, getSelectedDisplayMode } from './lists.js';

export function applyColorsToChartInstances(colors) {
    state.chartInstances.forEach(chart => {
        if (chart.$recolor) {
            // Bars colored by artist pick their own colors for the theme.
            chart.$recolor();
        } else if (chart.data.datasets && chart.data.datasets[0]) {
            chart.data.datasets[0].backgroundColor = colors.accentFill;
            chart.data.datasets[0].borderColor = colors.accent;
        }
        
        if (chart.options.plugins && chart.options.plugins.title) {
            chart.options.plugins.title.color = colors.text;
        }
        
        if (chart.options.scales) {
            Object.keys(chart.options.scales).forEach(axisKey => {
                if (chart.options.scales[axisKey].ticks) {
                    chart.options.scales[axisKey].ticks.color = colors.text;
                }
            });
        }
        
        chart.update("none");
    });
    state.activeRaceState?.redraw?.();
}

export function updateRaceControlsVisibility() {
    const chartControls = document.getElementById("chart-controls");
    const raceControls = document.getElementById("race-controls");
    const mode = getSelectedDisplayMode();
    const isChartMode = mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE;
    const isRaceMode = mode === DISPLAY_MODE_BAR_RACE;

    if (chartControls) {
        chartControls.style.display = isChartMode ? "block" : "none";
        chartControls.setAttribute("aria-hidden", isChartMode ? "false" : "true");
    }

    if (raceControls) {
        raceControls.style.display = isRaceMode ? "block" : "none";
        raceControls.setAttribute("aria-hidden", isRaceMode ? "false" : "true");
    }
}

// Playback moves a fractional position through the steps on every animation
// frame, so bars glide between steps instead of jumping once per step.
export function stopRacePlayback() {
    if (state.racePlaybackTimerId !== null) {
        cancelAnimationFrame(state.racePlaybackTimerId);
        state.racePlaybackTimerId = null;
    }
    syncRaceToolbar();
}

function getRacePlaybackSpeedFromInput() {
    return Math.max(50, parseInt(document.getElementById("race-speed-ms")?.value, 10) || state.racePlaybackSpeedMs || 260);
}

function raceStepName() {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    return frequency === "month" ? "month" : frequency === "week" ? "week" : "day";
}

function syncRacePlaybackSpeedFromInput() {
    state.racePlaybackSpeedMs = getRacePlaybackSpeedFromInput();
    if (state.raceSpeedReadoutElement) {
        const seconds = state.racePlaybackSpeedMs / 1000;
        state.raceSpeedReadoutElement.textContent = `${+seconds.toFixed(2)}s per ${raceStepName()}`;
    }
}

function syncRaceToolbar() {
    const toolbar = state.raceToolbar;
    const race = state.activeRaceState;
    if (!toolbar) return;
    const playing = state.racePlaybackTimerId !== null;
    toolbar.play.innerHTML = playing ? '<i class="fas fa-pause" aria-hidden="true"></i>' : '<i class="fas fa-play" aria-hidden="true"></i>';
    toolbar.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    toolbar.play.title = playing ? "Pause" : "Play";
    if (race) {
        toolbar.scrubber.max = String(Math.max(0, race.totalFrames - 1));
        toolbar.scrubber.value = String(race.position);
        toolbar.scrubber.disabled = race.totalFrames <= 1;
    }
}

function startRacePlayback() {
    const race = state.activeRaceState;
    if (!race || race.totalFrames <= 1 || typeof race.drawAt !== "function") return;

    stopRacePlayback();
    syncRacePlaybackSpeedFromInput();
    if (race.position >= race.totalFrames - 1) race.drawAt(0);

    let last = null;
    const tick = (now) => {
        const current = state.activeRaceState;
        if (!current || current !== race) {
            state.racePlaybackTimerId = null;
            return;
        }
        // Cap the step after a hidden tab or a slow frame, so the race
        // picks up where it was instead of skipping ahead.
        const elapsed = last === null ? 0 : Math.min(100, now - last);
        last = now;
        const next = Math.min(race.totalFrames - 1, race.position + elapsed / state.racePlaybackSpeedMs);
        race.drawAt(next);
        if (next >= race.totalFrames - 1) {
            state.racePlaybackTimerId = null;
            syncRaceToolbar();
            return;
        }
        state.racePlaybackTimerId = requestAnimationFrame(tick);
    };
    state.racePlaybackTimerId = requestAnimationFrame(tick);
    syncRaceToolbar();
}

function toggleRacePlayback() {
    if (state.racePlaybackTimerId !== null) stopRacePlayback();
    else startRacePlayback();
}

function jumpToRaceFrame(target) {
    const race = state.activeRaceState;
    if (!race || typeof race.drawAt !== "function") return;
    stopRacePlayback();
    race.drawAt(target === "first" ? 0 : Math.max(0, race.totalFrames - 1));
}

function adjustRacePlaybackSpeed(multiplier) {
    const current = getRacePlaybackSpeedFromInput();
    const next = Math.max(50, Math.min(5000, Math.round(current * multiplier / 10) * 10));
    const speedInput = document.getElementById("race-speed-ms");
    if (speedInput) {
        speedInput.value = String(next);
    }
    syncRacePlaybackSpeedFromInput();
}

function toolbarButton(icon, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
}

export function insertRacePlaybackToolbar(targetDiv) {
    if (!targetDiv) return;

    const toolbar = document.createElement("div");
    toolbar.className = "race-playback-toolbar";

    const transport = document.createElement("div");
    transport.className = "race-transport";
    const play = toolbarButton("fa-play", "Play", toggleRacePlayback);
    play.classList.add("race-play");
    transport.append(
        toolbarButton("fa-backward-step", "Back to the start", () => jumpToRaceFrame("first")),
        play,
        toolbarButton("fa-forward-step", "Skip to the end", () => jumpToRaceFrame("last"))
    );

    const scrubber = document.createElement("input");
    scrubber.type = "range";
    scrubber.className = "race-scrubber";
    scrubber.min = "0";
    scrubber.max = "0";
    scrubber.step = "any";
    scrubber.value = "0";
    scrubber.setAttribute("aria-label", "Race position");
    scrubber.addEventListener("input", () => {
        const race = state.activeRaceState;
        if (!race) return;
        if (state.racePlaybackTimerId !== null) stopRacePlayback();
        race.drawAt(parseFloat(scrubber.value) || 0);
    });

    const speed = document.createElement("div");
    speed.className = "race-speed";
    const readout = document.createElement("span");
    readout.className = "race-speed-readout";
    speed.append(
        toolbarButton("fa-minus", "Slower", () => adjustRacePlaybackSpeed(1.25)),
        readout,
        toolbarButton("fa-plus", "Faster", () => adjustRacePlaybackSpeed(0.8))
    );

    toolbar.append(transport, scrubber, speed);
    targetDiv.prepend(toolbar);

    state.raceSpeedReadoutElement = readout;
    state.raceToolbar = { play, scrubber };
    syncRacePlaybackSpeedFromInput();
    syncRaceToolbar();
}

export function destroyVisualizationState() {
    stopRacePlayback();
    state.chartInstances.forEach(chart => {
        try {
            chart.destroy();
        } catch {
            // Ignore stale chart instance errors
        }
    });
    state.chartInstances = [];
    (state.activeRaceState?.charts || []).forEach(chart => chart.destroy());
    shownArtists.clear();
    setShownNames([]);
    state.activeRaceState = null;
    state.raceToolbar = null;
}

function getSelectedChartOrientation() {
    const orientation = (document.getElementById("chart-axis")?.value || "horizontal").toLowerCase();
    return orientation === "vertical" ? "vertical" : "horizontal";
}

function getSelectedChartScale() {
    const scale = (document.getElementById("chart-scale")?.value || "linear").toLowerCase();
    return scale === "logarithmic" ? "logarithmic" : "linear";
}

const shorten = (text, length = 34) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

// Tracks and albums get two short lines, the title and then the artist, so
// labels stay readable without wrapping into each other.
function getEntityLabel(entity, entityType) {
    if (!entity) return "Unknown";
    if (entityType === "track") {
        return [shorten(entity.Track || "Unknown Track"), shorten(entity.Artist || "Unknown Artist")];
    }
    if (entityType === "album") {
        return [shorten(entity.name || "Unknown Album"), shorten(entity.artist || "Unknown Artist")];
    }
    if (entityType === "artist") {
        return entity.name || "Unknown Artist";
    }
    const scrobbleDate = entity.Date ? new Date(parseInt(entity.Date, 10)).toLocaleString() : "Unknown time";
    return `${entity.Artist || "Unknown Artist"} - ${entity.Track || "Unknown Track"} (${scrobbleDate})`;
}

export function getEntityMetricValue(entity, sortingBasis) {
    if (!entity) return 0;

    if (["scrobbles", "separate-days", "separate-weeks", "separate-months", "max-single-day", "max-single-week", "max-single-month"].includes(sortingBasis)
        || isRollingWindowSortingBasis(sortingBasis)) {
        return Number(entity.count || 0);
    }

    if (["consecutive-scrobbles", "consecutive-days", "consecutive-weeks", "consecutive-months"].includes(sortingBasis)) {
        return Number(entity.maxConsecutive || 0);
    }

    if (sortingBasis === "highest-listening-percentage") {
        return Number(entity.listeningPercentage || 0);
    }

    if (sortingBasis === "time-spent-listening") {
        return Number(entity.listeningDuration || 0);
    }

    if (sortingBasis === "first-n-scrobbles") {
        return Number(entity.dateReached || 0);
    }

    if (sortingBasis === "fastest-n-scrobbles") {
        return Number(entity.timeNeeded || 0);
    }

    if (sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") {
        return Number(entity.averageListeningTimestamp || 0);
    }

    if (sortingBasis === SCROBBLE_SORT_ASC || sortingBasis === SCROBBLE_SORT_DESC) {
        return Number(entity.Date || 0);
    }

    return Number(entity.count || 0);
}

function getChartMetricLabel(sortingBasis) {
    if (sortingBasis === "highest-listening-percentage") return "Percentage";
    if (sortingBasis === "time-spent-listening") return "Listening Time";
    if (sortingBasis === "first-n-scrobbles") return "Date Reached";
    if (sortingBasis === "fastest-n-scrobbles") return "Time Needed";
    if (sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") return "Average Listening Date";
    if (isRollingWindowSortingBasis(sortingBasis)) return "Scrobbles";
    return "Value";
}

function wrapChartLabel(label, maxLineLength = 25) {
    const text = (label ?? "").toString();
    if (text.length <= maxLineLength) return text;

    const lines = [];
    let currentLine = "";
    const words = text.split(" ");
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        
        if (currentLine.length + word.length + 1 <= maxLineLength) {
            currentLine += (currentLine.length === 0 ? "" : " ") + word;
        } else {
            if (currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = "";
            }
            
            if (word.length > maxLineLength) {
                let chunkedWord = word;
                while (chunkedWord.length > maxLineLength) {
                    lines.push(chunkedWord.slice(0, maxLineLength));
                    chunkedWord = chunkedWord.slice(maxLineLength);
                }
                currentLine = chunkedWord;
            } else {
                currentLine = word;
            }
        }
    }
    
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    
    return lines;
}

function formatMetricTickValue(value, sortingBasis) {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return "0";

    if (sortingBasis === "time-spent-listening" || sortingBasis === "fastest-n-scrobbles") {
        return formatDuration(numericValue) || "0 minutes";
    }

    if (sortingBasis === "first-n-scrobbles" || sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") {
        if (numericValue <= 0) return "";
        return new Date(numericValue).toISOString().slice(0, 10);
    }

    if (sortingBasis === "highest-listening-percentage") {
        return `${numericValue.toFixed(1)}%`;
    }

    return String(Math.round(numericValue));
}

function formatMetricTooltipValue(value, sortingBasis) {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return "0";

    if (sortingBasis === "time-spent-listening" || sortingBasis === "fastest-n-scrobbles") {
        return formatDuration(numericValue) || "0 minutes";
    }

    if (sortingBasis === "first-n-scrobbles" || sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") {
        if (numericValue <= 0) return "N/A";
        return new Date(numericValue).toISOString().slice(0, 10);
    }

    if (sortingBasis === "highest-listening-percentage") {
        return `${numericValue.toFixed(2)}%`;
    }

    return String(Math.round(numericValue));
}

function parseHexToRgba(colorValue, alpha) {
    const color = (colorValue || "").trim();
    if (!color.startsWith("#")) {
        return color || `rgba(216, 144, 109, ${alpha})`;
    }

    const hex = color.slice(1);
    if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    return color;
}

export function getChartThemeColors() {
    const bodyStyles = getComputedStyle(document.body);
    const rootStyles = getComputedStyle(document.documentElement);

    // Try body first, then root, then fallback
    const accent = bodyStyles.getPropertyValue("--primary-accent-color").trim() 
                || rootStyles.getPropertyValue("--primary-accent-color").trim() 
                || "#D8906D";
                
    const text = bodyStyles.getPropertyValue("--primary-text-color").trim() 
              || rootStyles.getPropertyValue("--primary-text-color").trim() 
              || "#3B2F24";

    return {
        accent,
        accentFill: parseHexToRgba(accent, 0.75),
        text
    };
}

function isDateMetricSorting(sortingBasis) {
    return sortingBasis === "first-n-scrobbles"
        || sortingBasis === "oldest-average-listening-time"
        || sortingBasis === "newest-average-listening-time";
}

function createBarChartInCanvas(canvas, labels, values, sortingBasis, chartTitle = "") {
    if (!canvas || typeof Chart === "undefined") return null;

    const orientation = getSelectedChartOrientation();
    const chartScale = getSelectedChartScale();
    const dateMetric = isDateMetricSorting(sortingBasis);
    const resolvedScale = dateMetric && chartScale === "logarithmic" ? "linear" : chartScale;
    const indexAxis = orientation === "vertical" ? "x" : "y";
    const valueAxisKey = orientation === "vertical" ? "y" : "x";
    const labelAxisKey = orientation === "vertical" ? "x" : "y";
    const chartColors = getChartThemeColors();
    const dataValues = resolvedScale === "logarithmic"
        ? (values || []).map(value => Math.max(1, Number(value) || 0))
        : values;

    const numericValues = (dataValues || []).map(value => Number(value)).filter(value => Number.isFinite(value));
    const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
    const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
    const datePadding = dateMetric ? Math.max(24 * 60 * 60 * 1000, Math.round((maxValue - minValue) * 0.03)) : 0;

    const playbackSpeed = typeof getRacePlaybackSpeedFromInput === "function" ? getRacePlaybackSpeedFromInput() : 260;

    const chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: getChartMetricLabel(sortingBasis),
                data: dataValues,
                backgroundColor: chartColors.accentFill,
                borderColor: chartColors.accent,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis,
            animation: {
                duration: dateMetric ? 0 : Math.max(100, playbackSpeed * 0.8),
                easing: "linear"
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: Boolean(chartTitle),
                    text: chartTitle,
                    color: chartColors.text
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const datasetLabel = context.dataset?.label || "Value";
                            return `${datasetLabel}: ${formatMetricTooltipValue(context.parsed?.[valueAxisKey], sortingBasis)}`;
                        }
                    }
                }
            },
            scales: {
                [valueAxisKey]: {
                    beginAtZero: !dateMetric,
                    type: resolvedScale,
                    min: dateMetric ? (minValue - datePadding) : undefined,
                    max: dateMetric ? (maxValue + datePadding) : undefined,
                    ticks: {
                        color: chartColors.text,
                        callback: (tickValue) => formatMetricTickValue(tickValue, sortingBasis)
                    }
                },
                [labelAxisKey]: {
                    ticks: {
                        // Every bar keeps its label; the chart is made tall
                        // enough for them instead.
                        autoSkip: false,
                        color: chartColors.text,
                        callback: function (_tickValue, tickIndex) {
                            const fullLabel = this?.chart?.data?.labels?.[tickIndex];
                            return Array.isArray(fullLabel) ? fullLabel : wrapChartLabel(fullLabel, 25);
                        }
                    }
                }
            }
        }
    });

    state.chartInstances.push(chart);
    return chart;
}

// The artists on screen in every chart, for the colors a shared link carries.
const shownArtists = new Set();

function showArtists(keys) {
    keys.forEach(key => shownArtists.add(key));
    setShownNames(shownArtists);
}

function entityArtist(entity, entityType) {
    if (entityType === "album") return entity.artist || "";
    if (entityType === "artist") return entity.name || "";
    return entity.Artist || "";
}

export function renderBarChartEntities(entities, entityType, sortingBasis, targetDiv) {
    const listLength = Math.min(getListLengthLimit(), 100);
    const chartRows = (entities || []).slice(0, listLength);
    targetDiv.innerHTML = "";

    // Bars are colored by artist, like the race: the artists with the most
    // bars get the starting colors unless you picked your own.
    const barCounts = new Map();
    const artistNames = new Map();
    const barArtists = chartRows.map(entity => {
        const name = entityArtist(entity, entityType);
        const key = name.toLowerCase();
        if (!artistNames.has(key)) artistNames.set(key, name);
        barCounts.set(key, (barCounts.get(key) || 0) + 1);
        return key;
    });
    const order = [...barCounts.keys()].sort((a, b) => barCounts.get(b) - barCounts.get(a));
    const legend = createColorLegend({
        otherLabel: entityType === "artist" ? "Everyone else" : "Other artists",
        known: order.map(key => [key, artistNames.get(key)])
    });
    targetDiv.appendChild(legend.el);
    showArtists(order);

    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";
    
    // Room for a two-line label per bar.
    const rowHeight = getSelectedChartOrientation() === "vertical" ? 30 : 40;
    wrapper.style.height = Math.max(400, chartRows.length * rowHeight) + "px";

    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    targetDiv.appendChild(wrapper);

    const labels = chartRows.map(entity => getEntityLabel(entity, entityType));
    const values = chartRows.map(entity => getEntityMetricValue(entity, sortingBasis));
    const chart = createBarChartInCanvas(canvas, labels, values, sortingBasis, "");
    if (!chart) return;
    chart.$recolor = () => {
        const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const colors = assignColors(order, artistNames, theme);
        const dataset = chart.data.datasets[0];
        dataset.backgroundColor = barArtists.map(key => colors.assigned.get(key) || colors.other);
        dataset.borderWidth = 0;
        dataset.borderRadius = 4;
        dataset.borderSkipped = "start";
        dataset.maxBarThickness = 24;
        legend.sync(colors, theme);
        chart.update("none");
    };
    chart.$recolor();
}

function getRacePeriodStartTimestamp(timestamp, frequency) {
    const date = new Date(timestamp);
    if (frequency === "month") {
        return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    }
    if (frequency === "week") {
        const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const weekday = weekStart.getDay();
        const offset = (weekday + 6) % 7;
        weekStart.setDate(weekStart.getDate() - offset);
        weekStart.setHours(0, 0, 0, 0);
        return weekStart.getTime();
    }
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    dayStart.setHours(0, 0, 0, 0);
    return dayStart.getTime();
}

function formatRacePeriodLabel(periodStart, frequency) {
    const date = new Date(periodStart);
    if (frequency === "month") {
        return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return frequency === "week" ? `Week of ${day}` : day;
}

function parseRaceBoundaryDate(dateValue, isEndBoundary) {
    if (!dateValue) return null;
    const date = new Date(`${dateValue}T00:00:00`);
    if (isNaN(date.getTime())) return null;
    if (isEndBoundary) {
        date.setHours(23, 59, 59, 999);
    }
    return date.getTime();
}

function resolveRaceTimeBounds(trackGroups) {
    const startInput = document.getElementById("race-start-date")?.value || "";
    const endInput = document.getElementById("race-end-date")?.value || "";
    let start = parseRaceBoundaryDate(startInput, false);
    let end = parseRaceBoundaryDate(endInput, true);

    if (start !== null && end !== null && start > end) {
        const swap = start;
        start = end;
        end = swap;
    }

    if (start !== null && end !== null) {
        return { start, end };
    }

    let minTimestamp = Number.POSITIVE_INFINITY;
    let maxTimestamp = Number.NEGATIVE_INFINITY;

    (trackGroups || []).forEach(group => {
        (group || []).forEach(track => {
            const timestamp = parseInt(track.Date, 10);
            if (isNaN(timestamp)) return;
            if (timestamp < minTimestamp) minTimestamp = timestamp;
            if (timestamp > maxTimestamp) maxTimestamp = timestamp;
        });
    });

    if (!isFinite(minTimestamp) || !isFinite(maxTimestamp)) {
        const now = Date.now();
        return { start: now, end: now };
    }

    return {
        start: start ?? minTimestamp,
        end: end ?? maxTimestamp
    };
}

export function hasRaceSettingsReady() {
    const startInput = (document.getElementById("race-start-date")?.value || "").trim();
    const endInput = (document.getElementById("race-end-date")?.value || "").trim();
    const frequencyInput = (document.getElementById("race-frequency")?.value || "").trim();
    return Boolean(startInput && endInput && frequencyInput);
}

function getFirstScrobbleTimestamp() {
    let earliestTimestamp = Number.POSITIVE_INFINITY;
    (state.allTracks || []).forEach(track => {
        const timestamp = parseInt(track?.Date, 10);
        if (!isNaN(timestamp) && timestamp < earliestTimestamp) {
            earliestTimestamp = timestamp;
        }
    });
    return Number.isFinite(earliestTimestamp) ? earliestTimestamp : null;
}

export function ensureRaceDateDefaults(force = false) {
    const raceStartInput = document.getElementById("race-start-date");
    const raceEndInput = document.getElementById("race-end-date");
    if (!raceStartInput || !raceEndInput) return;

    const firstScrobbleTimestamp = getFirstScrobbleTimestamp();
    const startDefault = formatDateInputValue(firstScrobbleTimestamp || Date.now());
    const endDefault = formatDateInputValue(Date.now());

    if (force || !raceStartInput.value) {
        raceStartInput.value = startDefault;
    }
    if (force || !raceEndInput.value) {
        raceEndInput.value = endDefault;
    }
}

function buildRaceTimeline(startTimestamp, endTimestamp, frequency) {
    const safeStart = getRacePeriodStartTimestamp(startTimestamp, frequency);
    const safeEnd = getRacePeriodStartTimestamp(endTimestamp, frequency);
    const timeline = [];

    let cursor = new Date(safeStart);
    const end = new Date(safeEnd);

    while (cursor.getTime() <= end.getTime()) {
        timeline.push(cursor.getTime());
        if (frequency === "month") {
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        } else if (frequency === "week") {
            cursor = new Date(cursor.getTime() + (7 * 24 * 60 * 60 * 1000));
        } else {
            cursor = new Date(cursor.getTime() + (24 * 60 * 60 * 1000));
        }
    }

    return timeline;
}

// How many bars a race shows: the list length, up to 20, since a race with
// more bars than that is too small to read.
const RACE_MAX_BARS = 20;
// Rows kept below the visible bars, so a bar that climbs into view slides
// up from under the chart instead of appearing out of nowhere.
const RACE_SPARE_ROWS = 3;

function getRaceSlots() {
    return Math.max(1, Math.min(getListLengthLimit(), RACE_MAX_BARS));
}

function getRaceRow(entity, entityType) {
    if (entityType === "track") {
        const name = entity.Track || "Unknown track";
        const artist = entity.Artist || "Unknown artist";
        return { key: `${name.toLowerCase()}||${artist.toLowerCase()}`, name, artist };
    }
    if (entityType === "album") {
        const name = entity.name || "Unknown album";
        const artist = entity.artist || "Unknown artist";
        return { key: `${name.toLowerCase()}||${artist.toLowerCase()}`, name, artist };
    }
    const name = entity.name || "Unknown artist";
    return { key: name.toLowerCase(), name, artist: "" };
}

function getRaceTitle(entityType, sortingBasis) {
    const option = document.querySelector(`#sorting-basis option[value="${sortingBasis}"]`);
    const plural = { track: "Tracks", album: "Albums", artist: "Artists" }[entityType] || "Results";
    return option ? `${plural} by ${option.textContent.trim().toLowerCase()}` : plural;
}

function buildBarRaceFramesFromTracks(tracks, entityType, sortingBasis, xValue, caps, timeline, frequency, endTimestamp) {
    const rowCount = getRaceSlots() + RACE_SPARE_ROWS;
    const frames = [];
    const sortedTracks = [...(tracks || [])]
        .filter(track => {
            const timestamp = parseInt(track.Date, 10);
            return !isNaN(timestamp) && timestamp <= endTimestamp;
        })
        .sort((a, b) => (parseInt(a.Date, 10) || 0) - (parseInt(b.Date, 10) || 0));

    let pointer = 0;
    const cumulativeTracks = [];

    timeline.forEach(periodStart => {
        while (pointer < sortedTracks.length) {
            const candidate = sortedTracks[pointer];
            const timestamp = parseInt(candidate.Date, 10);
            const candidatePeriodStart = getRacePeriodStartTimestamp(timestamp, frequency);
            if (candidatePeriodStart > periodStart) break;
            cumulativeTracks.push(candidate);
            pointer += 1;
        }

        const entities = applyEntityCaps(buildEntitiesFromTracks(cumulativeTracks, entityType, sortingBasis, xValue), entityType, caps);

        frames.push({
            label: formatRacePeriodLabel(periodStart, frequency),
            total: cumulativeTracks.length,
            rows: entities.slice(0, rowCount).map(entity => ({
                ...getRaceRow(entity, entityType),
                value: getEntityMetricValue(entity, sortingBasis)
            }))
        });
    });

    if (!frames.length) {
        frames.push({
            label: timeline[0] ? formatRacePeriodLabel(timeline[0], frequency) : "No dates",
            total: 0,
            rows: []
        });
    }

    return frames;
}

function mountRace(targetDiv, frames, entityType, sortingBasis) {
    targetDiv.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "race-wrapper";
    targetDiv.appendChild(wrapper);
    return createRaceChart(wrapper, frames, {
        slots: getRaceSlots(),
        sortingBasis,
        entityType,
        title: getRaceTitle(entityType, sortingBasis)
    });
}

// One race state for the toolbar, the GIF export and theme changes, whether
// one chart or two side by side are running.
function setActiveRace(mode, charts, totalFrames) {
    const race = {
        mode,
        charts,
        totalFrames,
        position: 0,
        frameIndex: 0,
        drawAt(position) {
            race.position = Math.max(0, Math.min(totalFrames - 1, position));
            race.frameIndex = Math.round(race.position);
            charts.forEach(chart => chart.draw(race.position));
            syncRaceToolbar();
        },
        updateFrame(frameIndex) {
            race.drawAt(frameIndex);
        },
        redraw() {
            race.drawAt(race.position);
        }
    };
    state.activeRaceState = race;
    showArtists(charts.flatMap(chart => chart.artists));
    race.drawAt(0);
    if (state.raceRenderArmed) {
        startRacePlayback();
    }
}

export function renderBarRaceSingle(tracks, entityType, targetDiv, sortingBasis) {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    const xValue = parseInt(document.getElementById("x-value")?.value, 10) || getDefaultXValue(sortingBasis);
    const caps = currentEntityCaps();
    const bounds = resolveRaceTimeBounds([tracks]);
    const timeline = buildRaceTimeline(bounds.start, bounds.end, frequency);
    const frames = buildBarRaceFramesFromTracks(tracks, entityType, sortingBasis, xValue, caps, timeline, frequency, bounds.end);
    const chart = mountRace(targetDiv, frames, entityType, sortingBasis);
    setActiveRace("single", [chart], frames.length);
}

export function renderBarRaceComparison(leftTracks, rightTracks, leftEntityType, rightEntityType, leftSortingBasis, rightSortingBasis, leftXValue, rightXValue, leftCaps, rightCaps, leftTargetDiv, rightTargetDiv) {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    const bounds = resolveRaceTimeBounds([leftTracks, rightTracks]);
    const timeline = buildRaceTimeline(bounds.start, bounds.end, frequency);
    const leftFrames = buildBarRaceFramesFromTracks(leftTracks, leftEntityType, leftSortingBasis, leftXValue, leftCaps, timeline, frequency, bounds.end);
    const rightFrames = buildBarRaceFramesFromTracks(rightTracks, rightEntityType, rightSortingBasis, rightXValue, rightCaps, timeline, frequency, bounds.end);

    const left = mountRace(leftTargetDiv, leftFrames, leftEntityType, leftSortingBasis);
    const right = mountRace(rightTargetDiv, rightFrames, rightEntityType, rightSortingBasis);
    setActiveRace("comparison", [left, right], Math.max(leftFrames.length, rightFrames.length));
}

const displayModeSelect = document.getElementById("display-mode");
if (displayModeSelect) {
    displayModeSelect.addEventListener("change", () => {
        updateRaceControlsVisibility();
        if (getSelectedDisplayMode() !== DISPLAY_MODE_BAR_RACE) {
            state.raceRenderArmed = false;
        }
        displayEntities();
    });
}

["chart-axis", "chart-scale"].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    control.addEventListener("change", () => {
        const mode = getSelectedDisplayMode();
        if (mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE) {
            displayEntities();
        }
    });
});

["race-start-date", "race-end-date", "race-frequency"].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    control.addEventListener("change", () => {
        state.raceRenderArmed = false;
        if (getSelectedDisplayMode() === DISPLAY_MODE_BAR_RACE) {
            displayEntities();
        }
    });
});

// A picked or reset color repaints the race where it is, playing or paused,
// and recolors bar charts, without rebuilding either.
document.addEventListener("artist-colors:changed", () => {
    state.activeRaceState?.redraw();
    state.chartInstances.forEach(chart => chart.$recolor?.());
});

const raceSpeedInput = document.getElementById("race-speed-ms");
if (raceSpeedInput) {
    raceSpeedInput.addEventListener("change", syncRacePlaybackSpeedFromInput);
}
