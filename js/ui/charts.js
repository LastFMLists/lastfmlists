// Bar charts and the animated bar race, including playback controls and
// the theme-aware colours both share.

import {
    DISPLAY_MODE_BAR_CHART,
    DISPLAY_MODE_BAR_RACE,
    SCROBBLE_SORT_ASC,
    SCROBBLE_SORT_DESC
} from '../config.js';
import { applyTracksPerEntityFilter, buildEntitiesFromTracks } from '../data/filters.js';
import { isRollingWindowSortingBasis } from '../data/metrics.js';
import { getListLengthLimit } from '../dom.js';
import { state } from '../state.js';
import { formatDateInputValue, formatDuration, getWeekNumber } from '../time.js';
import { displayEntities, getSelectedDisplayMode } from './lists.js';

export function applyColorsToChartInstances(colors) {
    state.chartInstances.forEach(chart => {
        if (chart.data.datasets && chart.data.datasets[0]) {
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

function stopRacePlayback() {
    if (state.racePlaybackTimerId !== null) {
        clearInterval(state.racePlaybackTimerId);
        state.racePlaybackTimerId = null;
    }
}

function getRacePlaybackSpeedFromInput() {
    return Math.max(50, parseInt(document.getElementById("race-speed-ms")?.value, 10) || state.racePlaybackSpeedMs || 260);
}

function syncRacePlaybackSpeedFromInput() {
    state.racePlaybackSpeedMs = getRacePlaybackSpeedFromInput();
    if (state.raceSpeedReadoutElement) {
        state.raceSpeedReadoutElement.textContent = `${state.racePlaybackSpeedMs}ms/frame`;
    }
}

function startRacePlayback() {
    if (!state.activeRaceState || state.activeRaceState.totalFrames <= 1 || typeof state.activeRaceState.updateFrame !== "function") {
        return;
    }

    stopRacePlayback();
    syncRacePlaybackSpeedFromInput();
    state.racePlaybackTimerId = setInterval(() => {
        if (!state.activeRaceState || typeof state.activeRaceState.updateFrame !== "function") {
            stopRacePlayback();
            return;
        }

        const nextIndex = state.activeRaceState.frameIndex + 1;
        if (nextIndex >= state.activeRaceState.totalFrames) {
            stopRacePlayback();
            return;
        }

        state.activeRaceState.updateFrame(nextIndex);
    }, state.racePlaybackSpeedMs);
}

function jumpToRaceFrame(target) {
    if (!state.activeRaceState || typeof state.activeRaceState.updateFrame !== "function") return;
    if (target === "first") {
        state.activeRaceState.updateFrame(0);
        return;
    }
    if (target === "last") {
        state.activeRaceState.updateFrame(Math.max(0, state.activeRaceState.totalFrames - 1));
    }
}

function adjustRacePlaybackSpeed(multiplier) {
    const current = getRacePlaybackSpeedFromInput();
    const next = Math.max(50, Math.min(5000, Math.round(current * multiplier)));
    const speedInput = document.getElementById("race-speed-ms");
    if (speedInput) {
        speedInput.value = String(next);
    }
    syncRacePlaybackSpeedFromInput();

    if (state.racePlaybackTimerId !== null) {
        const currentFrame = state.activeRaceState?.frameIndex || 0;
        stopRacePlayback();
        if (state.activeRaceState) {
            state.activeRaceState.updateFrame(currentFrame);
            state.racePlaybackTimerId = setInterval(() => {
                if (!state.activeRaceState || typeof state.activeRaceState.updateFrame !== "function") {
                    stopRacePlayback();
                    return;
                }
                const nextIndex = state.activeRaceState.frameIndex + 1;
                if (nextIndex >= state.activeRaceState.totalFrames) {
                    stopRacePlayback();
                    return;
                }
                state.activeRaceState.updateFrame(nextIndex);
            }, state.racePlaybackSpeedMs);
        }
    }
}

export function insertRacePlaybackToolbar(targetDiv) {
    if (!targetDiv) return;

    const toolbar = document.createElement("div");
    toolbar.className = "race-playback-toolbar";
    state.raceSpeedReadoutElement = null;

    const buttonConfigs = [
        { label: "⏮", title: "First frame", onClick: () => jumpToRaceFrame("first") },
        { label: "▶", title: "Play", onClick: () => startRacePlayback() },
        { label: "⏸", title: "Pause", onClick: () => stopRacePlayback() },
        { label: "⏭", title: "Last frame", onClick: () => jumpToRaceFrame("last") },
        { label: "⏪", title: "Slower", onClick: () => adjustRacePlaybackSpeed(1.25) },
        { label: "⏩", title: "Faster", onClick: () => adjustRacePlaybackSpeed(0.8) }
    ];

    buttonConfigs.forEach(config => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = config.label;
        button.title = config.title;
        button.setAttribute("aria-label", config.title);
        button.addEventListener("click", config.onClick);
        toolbar.appendChild(button);
    });

    const speedReadout = document.createElement("span");
    speedReadout.className = "race-speed-readout";
    speedReadout.textContent = `${getRacePlaybackSpeedFromInput()}ms/frame`;
    toolbar.appendChild(speedReadout);
    state.raceSpeedReadoutElement = speedReadout;

    targetDiv.appendChild(toolbar);
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
    state.activeRaceState = null;
}

function getSelectedChartOrientation() {
    const orientation = (document.getElementById("chart-axis")?.value || "horizontal").toLowerCase();
    return orientation === "vertical" ? "vertical" : "horizontal";
}

function getSelectedChartScale() {
    const scale = (document.getElementById("chart-scale")?.value || "linear").toLowerCase();
    return scale === "logarithmic" ? "logarithmic" : "linear";
}

function getEntityLabel(entity, entityType) {
    if (!entity) return "Unknown";
    if (entityType === "track") {
        return `${entity.Artist || "Unknown Artist"} - ${entity.Track || "Unknown Track"}`;
    }
    if (entityType === "album") {
        return `${entity.artist || "Unknown Artist"} - ${entity.name || "Unknown Album"}`;
    }
    if (entityType === "artist") {
        return entity.name || "Unknown Artist";
    }
    const scrobbleDate = entity.Date ? new Date(parseInt(entity.Date, 10)).toLocaleString() : "Unknown time";
    return `${entity.Artist || "Unknown Artist"} - ${entity.Track || "Unknown Track"} (${scrobbleDate})`;
}

function getEntityMetricValue(entity, sortingBasis) {
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
                        color: chartColors.text,
                        callback: function (_tickValue, tickIndex) {
                            const fullLabel = this?.chart?.data?.labels?.[tickIndex];
                            return wrapChartLabel(fullLabel, 25);
                        }
                    }
                }
            }
        }
    });

    state.chartInstances.push(chart);
    return chart;
}

export function renderBarChartEntities(entities, entityType, sortingBasis, targetDiv) {
    const listLength = Math.min(getListLengthLimit(), 100);
    const chartRows = (entities || []).slice(0, listLength);
    targetDiv.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";
    
    const minBarThickness = 30;
    const requiredHeight = Math.max(400, chartRows.length * minBarThickness);
    wrapper.style.height = requiredHeight + "px";

    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    targetDiv.appendChild(wrapper);

    const labels = chartRows.map(entity => getEntityLabel(entity, entityType));
    const values = chartRows.map(entity => getEntityMetricValue(entity, sortingBasis));
    createBarChartInCanvas(canvas, labels, values, sortingBasis, "");
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
        const month = String(date.getMonth() + 1).padStart(2, "0");
        return `${date.getFullYear()}-${month}`;
    }
    if (frequency === "week") {
        const week = String(getWeekNumber(date)).padStart(2, "0");
        return `${date.getFullYear()}-W${week}`;
    }
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function getRaceEntityKeyAndLabel(track, entityType) {
    if (entityType === "album") {
        return {
            key: `${(track.Album || "").toLowerCase()}||${(track.Artist || "").toLowerCase()}`,
            label: `${track.Album || "Unknown Album"} – ${track.Artist || "Unknown Artist"}`
        };
    }
    if (entityType === "artist") {
        return {
            key: (track.Artist || "").toLowerCase(),
            label: track.Artist || "Unknown Artist"
        };
    }
    return {
        key: `${(track.Track || "").toLowerCase()}||${(track.Artist || "").toLowerCase()}`,
        label: `${track.Track || "Unknown Track"} – ${track.Artist || "Unknown Artist"}`
    };
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

function buildBarRaceFramesFromTracks(tracks, entityType, sortingBasis, xValue, maxPerArtist, timeline, frequency, endTimestamp) {
    const listLength = Math.min(getListLengthLimit(), 100);
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

        let entities = buildEntitiesFromTracks(cumulativeTracks, entityType, sortingBasis, xValue);
        if (entityType === "track") {
            entities = applyTracksPerEntityFilter(entities, maxPerArtist);
        }

        const chartRows = entities.slice(0, listLength);

        frames.push({
            periodStart,
            periodLabel: formatRacePeriodLabel(periodStart, frequency),
            labels: chartRows.map(entity => getEntityLabel(entity, entityType)),
            values: chartRows.map(entity => getEntityMetricValue(entity, sortingBasis))
        });
    });

    if (!frames.length) {
        frames.push({
            periodStart: timeline[0] || Date.now(),
            periodLabel: timeline[0] ? formatRacePeriodLabel(timeline[0], frequency) : "N/A",
            labels: [],
            values: []
        });
    }

    return frames;
}

function updateChartScaleForFrame(chart, sortingBasis) {
    if (!chart?.options?.scales) return;

    const orientation = chart.options.indexAxis === "x" ? "vertical" : "horizontal";
    const valueAxisKey = orientation === "vertical" ? "y" : "x";
    const valueAxis = chart.options.scales[valueAxisKey];
    if (!valueAxis) return;

    const dataValues = Array.isArray(chart.data?.datasets?.[0]?.data)
        ? chart.data.datasets[0].data.map(value => Number(value)).filter(Number.isFinite)
        : [];

    if (dataValues.length === 0) {
        valueAxis.min = undefined;
        valueAxis.max = undefined;
        return;
    }

    if (isDateMetricSorting(sortingBasis)) {
        const minValue = Math.min(...dataValues);
        const maxValue = Math.max(...dataValues);
        const datePadding = Math.max(24 * 60 * 60 * 1000, Math.round((maxValue - minValue) * 0.03));
        valueAxis.min = minValue - datePadding;
        valueAxis.max = maxValue + datePadding;
        valueAxis.beginAtZero = false;
        return;
    }

    valueAxis.min = undefined;
    valueAxis.max = undefined;
}

function applyRaceFrameToChart(chart, frame, labelElement, sortingBasis) {
    if (!chart || !frame) return;
    
    chart.data.labels = frame.labels;
    chart.data.datasets[0].data = frame.values;
    updateChartScaleForFrame(chart, sortingBasis);
    
    const wrapper = chart.canvas.parentNode;
    if (wrapper && wrapper.classList.contains("chart-wrapper")) {
        const minBarThickness = 30;
        const requiredHeight = Math.max(400, frame.labels.length * minBarThickness);
        wrapper.style.height = requiredHeight + "px";
    }

    chart.update();
    if (labelElement) {
        labelElement.textContent = `Period: ${frame.periodLabel}`;
    }
}

function mountRaceChart(targetDiv, titleText, initialFrame, sortingBasis) {
    targetDiv.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";

    const minBarThickness = 30;
    const requiredHeight = Math.max(400, (initialFrame?.labels?.length || 0) * minBarThickness);
    wrapper.style.height = requiredHeight + "px";

    const frameLabel = document.createElement("div");
    frameLabel.className = "race-frame-label";
    frameLabel.textContent = initialFrame ? `Period: ${initialFrame.periodLabel}` : "Period: N/A";
    wrapper.appendChild(frameLabel);

    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    targetDiv.appendChild(wrapper);

    const chart = createBarChartInCanvas(canvas, initialFrame?.labels || [], initialFrame?.values || [], sortingBasis, titleText || "");

    return { chart, frameLabel };
}

export function renderBarRaceSingle(tracks, entityType, targetDiv, sortingBasis) {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    const xValue = parseInt(document.getElementById("x-value")?.value, 10) || 1;
    const maxPerArtist = parseInt(document.getElementById("max-per-artist")?.value, 10) || Infinity;
    const bounds = resolveRaceTimeBounds([tracks]);
    const timeline = buildRaceTimeline(bounds.start, bounds.end, frequency);
    const frames = buildBarRaceFramesFromTracks(tracks, entityType, sortingBasis, xValue, maxPerArtist, timeline, frequency, bounds.end);
    const initialFrame = frames[0] || {
        periodLabel: "N/A",
        labels: [],
        values: []
    };
    const mounted = mountRaceChart(targetDiv, `Bar Chart Race (${sortingBasis})`, initialFrame, sortingBasis);

    state.activeRaceState = {
        mode: "single",
        frameIndex: 0,
        totalFrames: frames.length,
        updateFrame: (frameIndex) => {
            const safeIndex = Math.max(0, Math.min(frames.length - 1, frameIndex));
            state.activeRaceState.frameIndex = safeIndex;
            applyRaceFrameToChart(mounted.chart, frames[safeIndex], mounted.frameLabel, sortingBasis);
        }
    };

    state.activeRaceState.updateFrame(0);
    if (state.raceRenderArmed) {
        startRacePlayback();
    }
}

export function renderBarRaceComparison(leftTracks, rightTracks, leftEntityType, rightEntityType, leftSortingBasis, rightSortingBasis, leftXValue, rightXValue, leftMaxPerArtist, rightMaxPerArtist, leftTargetDiv, rightTargetDiv) {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    const bounds = resolveRaceTimeBounds([leftTracks, rightTracks]);
    const timeline = buildRaceTimeline(bounds.start, bounds.end, frequency);
    const leftFrames = buildBarRaceFramesFromTracks(leftTracks, leftEntityType, leftSortingBasis, leftXValue, leftMaxPerArtist, timeline, frequency, bounds.end);
    const rightFrames = buildBarRaceFramesFromTracks(rightTracks, rightEntityType, rightSortingBasis, rightXValue, rightMaxPerArtist, timeline, frequency, bounds.end);

    const leftInitial = leftFrames[0] || {
        periodLabel: "N/A",
        labels: [],
        values: []
    };
    const rightInitial = rightFrames[0] || {
        periodLabel: "N/A",
        labels: [],
        values: []
    };

    const leftMounted = mountRaceChart(leftTargetDiv, `Left (${leftSortingBasis})`, leftInitial, leftSortingBasis);
    const rightMounted = mountRaceChart(rightTargetDiv, `Right (${rightSortingBasis})`, rightInitial, rightSortingBasis);

    const totalFrames = Math.max(leftFrames.length, rightFrames.length);
    state.activeRaceState = {
        mode: "comparison",
        frameIndex: 0,
        totalFrames,
        updateFrame: (frameIndex) => {
            const safeIndex = Math.max(0, Math.min(totalFrames - 1, frameIndex));
            state.activeRaceState.frameIndex = safeIndex;

            const leftFrame = leftFrames[Math.min(safeIndex, leftFrames.length - 1)] || leftInitial;
            const rightFrame = rightFrames[Math.min(safeIndex, rightFrames.length - 1)] || rightInitial;

            applyRaceFrameToChart(leftMounted.chart, leftFrame, leftMounted.frameLabel, leftSortingBasis);
            applyRaceFrameToChart(rightMounted.chart, rightFrame, rightMounted.frameLabel, rightSortingBasis);
        }
    };

    state.activeRaceState.updateFrame(0);
    if (state.raceRenderArmed) {
        startRacePlayback();
    }
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

const raceSpeedInput = document.getElementById("race-speed-ms");
if (raceSpeedInput) {
    raceSpeedInput.addEventListener("change", () => {
        syncRacePlaybackSpeedFromInput();
        if (state.racePlaybackTimerId !== null) {
            const currentFrame = state.activeRaceState?.frameIndex || 0;
            stopRacePlayback();
            if (state.activeRaceState) {
                state.activeRaceState.updateFrame(currentFrame);
                state.racePlaybackTimerId = setInterval(() => {
                    if (!state.activeRaceState || typeof state.activeRaceState.updateFrame !== "function") {
                        stopRacePlayback();
                        return;
                    }
                    const nextIndex = state.activeRaceState.frameIndex + 1;
                    if (nextIndex >= state.activeRaceState.totalFrames) {
                        stopRacePlayback();
                        return;
                    }
                    state.activeRaceState.updateFrame(nextIndex);
                }, state.racePlaybackSpeedMs);
            }
        }
    });
}
