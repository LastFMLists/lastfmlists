// The graph builder: artists, albums and tracks plotted over time. Each line
// is a value (plays, days played, longest streak, any sort from the Lists
// tab) or a rank (the place it would have in that list), counted either
// within each period or from the start up to it. Presets cover the common
// graphs; every setting can be changed. A list can be opened here too, to
// see how its top changed over time with the list's own filters.

import { trackEvent } from '../analytics.js';
import { buildEntitiesFromTracks } from '../data/filters.js';
import { getDefaultXValue, isSortingBasisUsingXValue } from '../data/metrics.js';
import { state } from '../state.js';
import { clearCustomColor, colorLinkPairs, customColor, setCustomColor, suggestColor } from './artist-colors.js';
import { openColorPicker } from './color-picker.js';
import { formatRaceValue } from './bar-race.js';
import { getEntityMetricValue } from './charts.js';
import { getActiveView, setActiveView } from './shell.js';

const section = document.getElementById("graphs-section");

const MAX_SERIES = 8;
const MAX_POINTS = 1000;
// Rank graphs rebuild the whole list for every point; past this many play
// visits they take too long, and a longer period is the better choice.
const MAX_RANK_WORK = 60_000_000;

const SCROBBLE_ORDER_SORTS = new Set(["earliest-to-latest", "latest-to-earliest"]);
const DATE_SORTS = new Set(["first-n-scrobbles", "oldest-average-listening-time", "newest-average-listening-time"]);
// Sorts where no plays means 0 rather than "nothing to show".
const ZERO_WHEN_EMPTY = new Set([
    "scrobbles", "separate-days", "separate-weeks", "separate-months",
    "consecutive-scrobbles", "consecutive-days", "consecutive-weeks", "consecutive-months",
    "max-single-day", "max-single-week", "max-single-month",
    "max-rolling-xh", "max-rolling-24h", "max-rolling-168h",
    "time-spent-listening", "highest-listening-percentage"
]);
const NEEDS_DETAILS = new Set(["time-spent-listening", "highest-listening-percentage"]);

const PRESETS = [
    { id: "monthly-plays", label: "Plays per month", metric: "scrobbles", show: "value", scope: "period", period: "month" },
    { id: "total-plays", label: "Total plays over time", metric: "scrobbles", show: "value", scope: "cumulative", period: "month" },
    { id: "alltime-rank", label: "All-time rank over the years", metric: "scrobbles", show: "rank", scope: "cumulative", period: "year" },
    { id: "yearly-rank", label: "Rank in each year", metric: "scrobbles", show: "rank", scope: "period", period: "year" },
    { id: "monthly-streak", label: "Longest streak each month", metric: "consecutive-days", show: "value", scope: "period", period: "month" },
    { id: "weekly-days", label: "Days played each week", metric: "separate-days", show: "value", scope: "period", period: "week" }
];

const TYPE_NAMES = { artist: "Artist", album: "Album", track: "Track" };

const graph = {
    series: [],
    metric: "scrobbles",
    x: "",
    show: "value",
    scope: "cumulative",
    period: "month",
    scale: "linear",
    // How far down a rank graph goes; lines below it run off the bottom.
    // "auto" goes just deep enough for the lines, at most to 100.
    rankLimit: "auto",
    // "zoom": the dates only pick the stretch shown. "count": plays outside
    // them are left out of the numbers too.
    dateMode: "zoom",
    from: "",
    to: "",
    // Plays from a list opened here, with its filters already applied.
    source: null
};

// ---- Names and keys ----

function seriesKey(type, name, artist) {
    const base = (name || "").toLowerCase();
    return type === "artist" ? `artist:${base}` : `${type}:${base}||${(artist || "").toLowerCase()}`;
}

function entityIdentity(entity, type) {
    if (type === "track") return { type, name: entity.Track || "", artist: entity.Artist || "" };
    if (type === "album") return { type, name: entity.name || "", artist: entity.artist || "" };
    return { type, name: entity.name || "", artist: entity.name || "" };
}

function makeSeries(identity) {
    const { type, name, artist } = identity;
    const label = type === "artist" ? name : `${name} — ${artist}`;
    return { type, name, artist, label, key: seriesKey(type, name, artist) };
}

const entityKey = (entity, type) => {
    const identity = entityIdentity(entity, type);
    return seriesKey(type, identity.name, identity.artist);
};

function playMatcher(series) {
    const name = series.name.toLowerCase();
    const artist = series.artist.toLowerCase();
    if (series.type === "artist") return (play) => (play.Artist || "").toLowerCase() === name;
    if (series.type === "album") return (play) => (play.Album || "").toLowerCase() === name && (play.Artist || "").toLowerCase() === artist;
    return (play) => (play.Track || "").toLowerCase() === name && (play.Artist || "").toLowerCase() === artist;
}

// Your top items of each type, for the name suggestions and "Add my top 5".
const topCache = new Map();
function topEntities(type) {
    if (!topCache.has(type)) {
        topCache.set(type, buildEntitiesFromTracks(state.allTracks || [], type, "scrobbles", 1).slice(0, 3000).map(entity => makeSeries(entityIdentity(entity, type))));
    }
    return topCache.get(type);
}

// ---- Periods ----

function periodStart(timestamp, period) {
    const date = new Date(timestamp);
    if (period === "year") return new Date(date.getFullYear(), 0, 1).getTime();
    if (period === "month") return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (period === "week") day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    return day.getTime();
}

function nextPeriod(start, period) {
    const date = new Date(start);
    if (period === "year") return new Date(date.getFullYear() + 1, 0, 1).getTime();
    if (period === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (period === "week" ? 7 : 1)).getTime();
}

function periodLabel(start, period, short = false) {
    const date = new Date(start);
    if (period === "year") return String(date.getFullYear());
    if (period === "month") return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return period === "week" && !short ? `Week of ${day}` : day;
}

// A period that gives a readable number of points for the span of plays.
function autoPeriod(plays) {
    if (!plays.length) return "month";
    const span = (Number(plays[plays.length - 1].Date) - Number(plays[0].Date)) / 86400000;
    if (span <= 120) return "day";
    if (span <= 730) return "week";
    return "month";
}

function parseDay(value, endOfDay) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return date.getTime();
}

// The plays the graph counts, oldest first: the whole history, or a list's
// plays. The dates never filter these; they only pick the stretch shown.
let sortedCache = { from: null, plays: [] };
function sourcePlays() {
    const from = graph.source ? graph.source.tracks : state.allTracks || [];
    if (sortedCache.from !== from) {
        sortedCache = {
            from,
            plays: from.filter(play => Number.isFinite(Number(play.Date))).sort((a, b) => Number(a.Date) - Number(b.Date))
        };
    }
    return sortedCache.plays;
}

// The first play at or after a time, so counts within a period can start
// there while totals still include everything before.
function firstIndexFrom(plays, time) {
    let low = 0;
    let high = plays.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (Number(plays[mid].Date) < time) low = mid + 1;
        else high = mid;
    }
    return low;
}

// ---- Working out the lines ----

let generation = 0;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

// Returns { labels, values: [series][point] } or { error }.
async function computeLines(onProgress) {
    const run = ++generation;
    // Lines added or removed while this runs start a new run; this one
    // keeps to the lines it started with.
    const lines = [...graph.series];
    // In zoom mode the dates only choose the stretch of time on screen and
    // the numbers count every play: a total on the first day shown includes
    // the years before it. In count mode plays outside the dates are left
    // out first, so totals start at 0 and ranks are within the dates.
    const shownFrom = parseDay(graph.from, false);
    const shownUntil = parseDay(graph.to, true);
    const all = sourcePlays();
    const plays = graph.dateMode === "count" && (shownFrom !== null || shownUntil !== null)
        ? all.filter(play => {
            const time = Number(play.Date);
            return (shownFrom === null || time >= shownFrom) && (shownUntil === null || time <= shownUntil);
        })
        : all;
    if (!plays.length) return { error: graph.dateMode === "count" ? "There are no plays between these dates." : "There are no plays to count." };
    const first = shownFrom ?? Number(plays[0].Date);
    const last = shownUntil ?? Number(plays[plays.length - 1].Date);
    if (first > last) return { error: "Show from is after Show until." };
    const timeline = [];
    for (let start = periodStart(first, graph.period); start <= last; start = nextPeriod(start, graph.period)) {
        timeline.push(start);
        if (timeline.length > MAX_POINTS) {
            return { error: `That makes more than ${MAX_POINTS.toLocaleString()} points. Pick a longer period or a shorter date range.` };
        }
    }
    const metric = graph.metric;
    const x = parseInt(graph.x, 10) || getDefaultXValue(metric);
    const cumulative = graph.scope === "cumulative";
    const values = lines.map(() => new Array(timeline.length).fill(null));
    const empty = ZERO_WHEN_EMPTY.has(metric) && graph.show === "value" ? 0 : null;
    let lastPause = performance.now();
    const breathe = async (done) => {
        if (performance.now() - lastPause < 40) return true;
        onProgress(done);
        await pause();
        lastPause = performance.now();
        return run === generation;
    };

    if (graph.show === "rank") {
        const work = cumulative ? (plays.length * timeline.length) / 2 : plays.length;
        if (work > MAX_RANK_WORK) {
            return { error: "Ranking every point takes too long for this many plays. Pick a longer period or a shorter date range." };
        }
        const types = [...new Set(lines.map(series => series.type))];
        let pointer = firstIndexFrom(plays, timeline[0]);
        let periodFrom = pointer;
        for (let index = 0; index < timeline.length; index++) {
            const end = nextPeriod(timeline[index], graph.period);
            while (pointer < plays.length && Number(plays[pointer].Date) < end) pointer++;
            const subset = cumulative ? plays.slice(0, pointer) : plays.slice(periodFrom, pointer);
            periodFrom = pointer;
            if (subset.length) {
                types.forEach(type => {
                    const ranks = new Map();
                    buildEntitiesFromTracks(subset, type, metric, x).forEach((entity, position) => {
                        const key = entityKey(entity, type);
                        if (!ranks.has(key)) ranks.set(key, position + 1);
                    });
                    lines.forEach((series, seriesIndex) => {
                        if (series.type === type) values[seriesIndex][index] = ranks.get(series.key) ?? null;
                    });
                });
            }
            if (!(await breathe(index / timeline.length))) return null;
        }
    } else {
        for (let seriesIndex = 0; seriesIndex < lines.length; seriesIndex++) {
            const series = lines[seriesIndex];
            const own = plays.filter(playMatcher(series));
            let pointer = firstIndexFrom(own, timeline[0]);
            let periodFrom = pointer;
            let previous = { size: -1, value: null };
            for (let index = 0; index < timeline.length; index++) {
                const end = nextPeriod(timeline[index], graph.period);
                while (pointer < own.length && Number(own[pointer].Date) < end) pointer++;
                const subset = cumulative ? own.slice(0, pointer) : own.slice(periodFrom, pointer);
                periodFrom = pointer;
                if (!subset.length) {
                    values[seriesIndex][index] = empty;
                } else if (cumulative && subset.length === previous.size) {
                    values[seriesIndex][index] = previous.value;
                } else {
                    const entity = buildEntitiesFromTracks(subset, series.type, metric, x)[0];
                    const value = entity ? getEntityMetricValue(entity, metric) : null;
                    values[seriesIndex][index] = value ?? empty;
                    previous = { size: subset.length, value: values[seriesIndex][index] };
                }
                if (!(await breathe((seriesIndex + index / timeline.length) / lines.length))) return null;
            }
        }
    }
    if (run !== generation) return null;
    return {
        keys: lines.map(series => series.key).join("\n"),
        labels: timeline.map(start => periodLabel(start, graph.period)),
        ticks: timeline.map(start => periodLabel(start, graph.period, true)),
        values
    };
}

// ---- Drawing ----

function themeName() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Picked colors first, then starting colors that don't look like any color
// already on the graph.
function seriesColors() {
    const theme = themeName();
    const picked = graph.series.map(series => customColor(series.label));
    const taken = picked.filter(Boolean);
    return picked.map(color => {
        if (color) return color;
        const next = suggestColor(taken, theme);
        taken.push(next);
        return next;
    });
}

function formatValue(value) {
    if (value === null || value === undefined) return "none";
    if (graph.show === "rank") return `#${value}`;
    return formatRaceValue(value, graph.metric);
}

let chart = null;
let lastResult = null;

// Picked colors go straight onto the lines, without redrawing the graph.
function recolorChart() {
    if (!chart) return;
    const colors = seriesColors();
    chart.data.datasets.forEach((dataset, index) => {
        dataset.borderColor = colors[index];
        dataset.backgroundColor = colors[index];
    });
    chart.update("none");
}

// Whether the last result still belongs to the lines on screen; while a
// newer run works, a redraw would pair old values with new names.
function resultMatches() {
    return Boolean(lastResult) && lastResult.keys === graph.series.map(series => series.key).join("\n");
}

function drawChart() {
    const canvas = document.getElementById("graph-canvas");
    if (!canvas || !resultMatches() || typeof Chart === "undefined") return;
    const { labels, values } = lastResult;
    const colors = seriesColors();
    const rank = graph.show === "rank";
    const log = graph.scale === "logarithmic";
    const many = labels.length > 60;
    const text = cssVar("--secondary-text-color", "#6C5A4B");
    const hairline = cssVar("--border-color", "#E5CEB4");
    const datasets = graph.series.map((series, index) => {
        const data = values[index].map(value => (log && !(value > 0) ? null : value));
        // Lone points between gaps still get a dot, or they would vanish.
        const radius = data.map((value, point) => {
            if (value === null) return 0;
            const lonely = (point === 0 || data[point - 1] === null) && (point === data.length - 1 || data[point + 1] === null);
            return lonely || !many ? 2.5 : 0;
        });
        return {
            label: series.label,
            data,
            borderColor: colors[index],
            backgroundColor: colors[index],
            borderWidth: 2,
            pointRadius: radius,
            pointHoverRadius: 4,
            spanGaps: false,
            tension: 0,
            // Room past the edges so a line along #1 (or 0) isn't cut in
            // half. Rank lines still run off the bottom when they drop out.
            clip: rank ? { left: 6, top: 6, right: 6, bottom: 0 } : 6
        };
    });

    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    // Best first at the point under the mouse, not in the
                    // order the lines were added.
                    filter: (item) => item.parsed.y !== null && Number.isFinite(item.parsed.y),
                    itemSort: (a, b) => (rank ? a.parsed.y - b.parsed.y : b.parsed.y - a.parsed.y),
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatValue(context.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: text,
                        maxRotation: 0,
                        autoSkip: true,
                        autoSkipPadding: 18,
                        callback: (value, index) => lastResult.ticks[index] ?? ""
                    }
                },
                y: {
                    type: log ? "logarithmic" : "linear",
                    reverse: rank,
                    min: rank ? 1 : (log ? undefined : 0),
                    max: rank ? shownRankLimit() : undefined,
                    grid: { color: hairline },
                    border: { display: false },
                    ticks: {
                        color: text,
                        precision: rank ? 0 : undefined,
                        callback: (value) => {
                            if (rank) return Number.isInteger(value) ? `#${value}` : "";
                            if (log && !/^[125]/.test(String(value))) return "";
                            return formatRaceValue(Number(value), graph.metric);
                        }
                    }
                }
            }
        }
    });
    canvas.setAttribute("aria-label", describe());
}

function describe() {
    const metric = metricLabel(graph.metric).toLowerCase();
    const what = graph.show === "rank" ? `Rank by ${metric}` : metricLabel(graph.metric);
    const scope = graph.scope === "cumulative" ? "up to each" : "in each";
    return `${what}, ${scope} ${graph.period}: ${graph.series.map(series => series.label).join(", ")}`;
}

// ---- Controls ----

function metricOptions() {
    return [...document.querySelectorAll("#sorting-basis option")]
        .filter(option => !SCROBBLE_ORDER_SORTS.has(option.value))
        .map(option => ({ value: option.value, label: option.textContent.trim() }));
}

function metricLabel(value) {
    return metricOptions().find(option => option.value === value)?.label || value;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// The controls are rebuilt on every change, so each has a key and focus
// goes back to the same control afterwards; keyboard users don't get
// thrown back to the top of the page.
function focusedKey() {
    const active = document.activeElement;
    return active && section.contains(active) ? active.dataset.focus || null : null;
}

function restoreFocus(key) {
    if (!key) return;
    section.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}

function segmented(name, options, current, onChange) {
    const group = el("div", "graph-segmented");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", name);
    options.forEach(([value, label, disabled]) => {
        const button = el("button", "graph-chip", label);
        button.type = "button";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(value === current));
        button.classList.toggle("is-active", value === current);
        button.disabled = Boolean(disabled);
        button.dataset.focus = `${name}:${value}`;
        button.addEventListener("click", () => onChange(value));
        group.appendChild(button);
    });
    return group;
}

function field(labelText, control) {
    const wrapper = el("label", "graph-field");
    wrapper.append(el("span", "graph-field-label", labelText), control);
    return wrapper;
}

function update(changes, { preset = null } = {}) {
    Object.assign(graph, changes);
    if (DATE_SORTS.has(graph.metric)) graph.show = "rank";
    if (preset) trackEvent(`graphs/preset/${preset}`, `Graphs: ${preset}`);
    renderControls();
    refresh();
}

let addType = "artist";
let adding = false;
let customizing = false;
let swatches = [];

// New colors go onto the chips in place, so the picker stays open while a
// color is dragged.
function recolorSeries() {
    const colors = seriesColors();
    swatches.forEach((swatch, index) => {
        swatch.style.background = colors[index];
    });
}

// Your top items of a type over the plays and measure the graph uses, so
// on a graph of a list it is that list's top 5.
function topFive(type) {
    const x = parseInt(graph.x, 10) || getDefaultXValue(graph.metric);
    const plays = sourcePlays();
    if (!graph.source && graph.metric === "scrobbles") return topEntities(type).slice(0, 5);
    return buildEntitiesFromTracks(plays, type, graph.metric, x).slice(0, 5).map(entity => makeSeries(entityIdentity(entity, type)));
}

function renderSeries(focus = focusedKey()) {
    buildSeries();
    restoreFocus(focus);
}

function buildSeries() {
    const box = section.querySelector(".graph-series");
    box.innerHTML = "";
    const colors = seriesColors();
    swatches = [];
    graph.series.forEach((series, index) => {
        const chip = el("span", "graph-series-chip");
        const swatch = el("button", "race-swatch");
        swatch.type = "button";
        swatch.style.background = colors[index];
        swatch.title = `Change the color for ${series.label}`;
        swatch.setAttribute("aria-label", `Color for ${series.label}`);
        swatch.setAttribute("aria-haspopup", "dialog");
        swatch.setAttribute("aria-expanded", "false");
        swatch.dataset.focus = `swatch:${series.key}`;
        swatch.addEventListener("click", () => {
            const custom = Boolean(customColor(series.label));
            openColorPicker(swatch, seriesColors()[graph.series.indexOf(series)], color => setCustomColor(series.label, color), {
                title: `Color for ${series.label}`,
                reset: custom ? { label: "Automatic", run: () => clearCustomColor(series.label) } : null
            });
        });
        swatches.push(swatch);
        const text = el("span", "graph-series-text");
        text.appendChild(el("span", "graph-series-name", series.name));
        if (series.type !== "artist") text.appendChild(el("span", "graph-series-kind", `${TYPE_NAMES[series.type]} by ${series.artist}`));
        const remove = el("button", "race-legend-reset", "×");
        remove.type = "button";
        remove.title = "Remove";
        remove.setAttribute("aria-label", `Remove ${series.label}`);
        remove.dataset.focus = `remove:${series.key}`;
        remove.addEventListener("click", () => {
            // Focus moves on to the next line's ×, or to Add after the last.
            const next = graph.series[index + 1] || graph.series[index - 1];
            graph.series.splice(index, 1);
            renderSeries(next ? `remove:${next.key}` : "add-open");
            refresh();
        });
        chip.append(swatch, text, remove);
        box.appendChild(chip);
    });

    if (!adding && graph.series.length) {
        if (graph.series.length < MAX_SERIES) {
            const open = el("button", "graph-chip graph-add-open");
            open.type = "button";
            open.dataset.focus = "add-open";
            open.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> Add';
            open.addEventListener("click", () => {
                adding = true;
                renderSeries();
                section.querySelector(".graph-add input")?.focus();
            });
            box.appendChild(open);
        }
        return;
    }

    const form = el("form", "graph-add");
    const typeSelect = document.createElement("select");
    typeSelect.dataset.focus = "add-type";
    typeSelect.setAttribute("aria-label", "What to add");
    Object.entries(TYPE_NAMES).forEach(([value, label]) => {
        const option = el("option", "", `${label}s`);
        option.value = value;
        option.selected = value === addType;
        typeSelect.appendChild(option);
    });
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `${TYPE_NAMES[addType]} name`;
    input.setAttribute("aria-label", input.placeholder);
    input.setAttribute("list", "graph-names");
    input.dataset.focus = "add-input";
    input.autocomplete = "off";
    const options = document.createElement("datalist");
    options.id = "graph-names";
    topEntities(addType).forEach(series => options.appendChild(Object.assign(document.createElement("option"), { value: series.label })));
    const add = el("button", "graph-chip", "Add");
    add.type = "submit";
    const top = el("button", "graph-chip", `My top 5 ${TYPE_NAMES[addType].toLowerCase()}s`);
    top.type = "button";
    top.dataset.focus = "add-top";
    top.title = graph.source ? "Replace the lines with the top 5 of your list" : "Replace the lines with your top 5";
    const done = el("button", "graph-chip", "Done");
    done.type = "button";
    const note = el("span", "graph-note");
    note.setAttribute("role", "status");
    form.append(typeSelect, input, options, add, top);
    if (graph.series.length) form.appendChild(done);
    form.appendChild(note);
    box.appendChild(form);

    typeSelect.addEventListener("change", () => {
        addType = typeSelect.value;
        renderSeries("add-type");
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const typed = input.value.trim().toLowerCase();
        if (!typed) return;
        const found = topEntities(addType).find(series => series.label.toLowerCase() === typed || series.name.toLowerCase() === typed);
        if (!found) {
            note.textContent = `Couldn't find that ${addType} in your history.`;
            return;
        }
        if (graph.series.some(existing => existing.key === found.key)) {
            note.textContent = "That one is already on the graph.";
            return;
        }
        graph.series.push(found);
        adding = graph.series.length < MAX_SERIES;
        renderSeries();
        refresh();
        section.querySelector(".graph-add input")?.focus();
    });
    top.addEventListener("click", () => {
        graph.series = topFive(addType);
        adding = false;
        renderSeries("add-open");
        refresh();
    });
    done.addEventListener("click", () => {
        adding = false;
        renderSeries("add-open");
    });
}

function renderSource() {
    const box = section.querySelector(".graph-source");
    box.hidden = !graph.source;
    box.innerHTML = "";
    if (!graph.source) return;
    box.append(el("span", "", `Counting only the plays in your list: ${graph.source.label}`));
    const clear = el("button", "graph-chip", "Use all plays");
    clear.type = "button";
    clear.addEventListener("click", () => {
        graph.source = null;
        renderSource();
        refresh();
    });
    box.appendChild(clear);
}

function currentPreset() {
    return PRESETS.find(preset => ["metric", "show", "scope", "period"].every(key => graph[key] === preset[key])) || null;
}

// Below the graph: the kind of graph and the period, which is what most
// people change. Everything else waits behind Customize.
function renderControls() {
    const focus = focusedKey();
    buildControls();
    restoreFocus(focus);
}

function buildControls() {
    const main = section.querySelector(".graph-main-settings");
    main.innerHTML = "";

    const kind = document.createElement("select");
    kind.dataset.focus = "graph-kind";
    const active = currentPreset();
    PRESETS.forEach(preset => {
        const option = el("option", "", preset.label);
        option.value = preset.id;
        option.selected = active === preset;
        kind.appendChild(option);
    });
    if (!active) {
        const custom = el("option", "", "Custom graph");
        custom.value = "";
        custom.selected = true;
        custom.disabled = true;
        kind.appendChild(custom);
    }
    kind.addEventListener("change", () => {
        const preset = PRESETS.find(item => item.id === kind.value);
        if (preset) update({ metric: preset.metric, show: preset.show, scope: preset.scope, period: preset.period, x: "" }, { preset: preset.id });
    });
    main.appendChild(field("Graph", kind));

    main.appendChild(field("Period", segmented("Period", [
        ["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]
    ], graph.period, value => update({ period: value }))));

    const toggle = el("button", "graph-chip graph-customize");
    toggle.type = "button";
    toggle.dataset.focus = "customize";
    toggle.setAttribute("aria-expanded", String(customizing));
    toggle.innerHTML = `<i class="fas fa-sliders" aria-hidden="true"></i> Customize`;
    toggle.addEventListener("click", () => {
        customizing = !customizing;
        renderControls();
    });
    main.appendChild(toggle);

    const box = section.querySelector(".graph-controls");
    box.hidden = !customizing;
    box.innerHTML = "";
    if (!customizing) return;

    const metric = document.createElement("select");
    metric.dataset.focus = "measure";
    metricOptions().forEach(({ value, label }) => {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === graph.metric;
        option.disabled = NEEDS_DETAILS.has(value) && !state.extendedDataLoaded;
        metric.appendChild(option);
    });
    metric.addEventListener("change", () => update({ metric: metric.value, x: "" }));
    box.appendChild(field("Measure", metric));

    if (isSortingBasisUsingXValue(graph.metric)) {
        const x = document.createElement("input");
        x.type = "number";
        x.min = "1";
        x.dataset.focus = "x";
        x.value = graph.x || String(getDefaultXValue(graph.metric));
        x.addEventListener("change", () => update({ x: x.value }));
        box.appendChild(field("X", x));
    }

    box.appendChild(field("Show", segmented("Show", [
        ["value", "Value", DATE_SORTS.has(graph.metric)],
        ["rank", "Rank"]
    ], graph.show, value => update({ show: value }))));

    box.appendChild(field("Count", segmented("Count", [
        ["period", "In each period"],
        ["cumulative", "Up to each period"]
    ], graph.scope, value => update({ scope: value }))));

    if (graph.show === "rank") {
        box.appendChild(field("Ranks shown", segmented("Ranks shown", [
            ["auto", "Auto"], [10, "Top 10"], [25, "Top 25"], [50, "Top 50"], [100, "Top 100"], [0, "All"]
        ], graph.rankLimit, value => {
            graph.rankLimit = value;
            renderControls();
            drawChart();
            announce();
        })));
    }

    box.appendChild(field("Scale", segmented("Scale", [
        ["linear", "Linear"], ["logarithmic", "Log"]
    ], graph.scale, value => update({ scale: value }))));

    // Typing a date fires a change for every digit of the year (year 2,
    // then 20, then 202), so only a cleared box or a full year counts.
    const dateInput = (key) => {
        const input = document.createElement("input");
        input.type = "date";
        input.value = graph[key];
        input.dataset.focus = key;
        input.addEventListener("change", () => {
            const year = parseInt(input.value.slice(0, 4), 10);
            if (input.value === "" || year >= 1900) update({ [key]: input.value });
        });
        return input;
    };
    const from = dateInput("from");
    const to = dateInput("to");
    const counting = graph.dateMode === "count";
    box.append(field(counting ? "Count from" : "Show from", from), field(counting ? "Count until" : "Show until", to));
    box.appendChild(field("Dates", segmented("Dates", [
        ["zoom", "Zoom only"], ["count", "Count only these dates"]
    ], graph.dateMode, value => update({ dateMode: value }))));
    const everything = graph.source ? "all of your list's plays" : "your whole history";
    box.appendChild(el("p", "graph-note graph-dates-note", counting
        ? "Plays outside these dates are left out of the numbers, so totals start at 0 on the first date and ranks only compare plays between the dates."
        : `The dates only choose what part of the graph you see. The numbers still count ${everything}, so a total on the first day shown includes everything before it.`));
}

// Back to the starting graph: your top 5 artists' total plays.
function resetGraph() {
    Object.assign(graph, {
        series: topEntities("artist").slice(0, 5),
        metric: "scrobbles",
        x: "",
        show: "value",
        scope: "cumulative",
        period: "month",
        scale: "linear",
        rankLimit: "auto",
        dateMode: "zoom",
        from: "",
        to: "",
        source: null
    });
    adding = false;
    addType = "artist";
    renderSeries();
    renderSource();
    renderControls();
    refresh();
}

// ---- Running it ----

const status = () => section.querySelector(".graph-status");

// Lets the address bar follow the graph on screen.
function announce() {
    document.dispatchEvent(new CustomEvent("graph:changed"));
}

async function refresh() {
    if (getActiveView() !== "graphs") {
        dirty = true;
        return;
    }
    dirty = false;
    announce();
    if (!graph.series.length) {
        generation += 1;
        lastResult = null;
        if (chart) chart.destroy();
        chart = null;
        status().textContent = "Add an artist, album or track to start.";
        return;
    }
    status().textContent = "Working it out…";
    const result = await computeLines(done => {
        status().textContent = `Working it out… ${Math.round(done * 100)}%`;
    });
    if (!result) return;
    if (result.error) {
        lastResult = null;
        if (chart) chart.destroy();
        chart = null;
        status().textContent = result.error;
        return;
    }
    lastResult = result;
    status().textContent = "";
    fitRankLimit();
    drawChart();
}

const RANK_STEPS = [10, 25, 50, 100];

function shownRankLimit() {
    if (graph.rankLimit !== "auto") return graph.rankLimit || undefined;
    const worst = Math.max(...lastResult.values.flat().filter(value => value !== null));
    return RANK_STEPS.find(limit => limit >= worst) || 100;
}

// When every line sits below the ranks shown, the graph would be empty, so
// it goes down far enough to show the best of them.
function fitRankLimit() {
    if (graph.show !== "rank" || !graph.rankLimit || graph.rankLimit === "auto") return;
    const best = Math.min(...lastResult.values.flat().filter(value => value !== null));
    if (!Number.isFinite(best) || best <= graph.rankLimit) return;
    graph.rankLimit = RANK_STEPS.find(limit => limit >= best) || 0;
    renderControls();
    announce();
}

let dirty = true;
let built = false;

function build() {
    if (built) return;
    built = true;
    if (!graph.series.length) graph.series = topEntities("artist").slice(0, 5);
    renderSeries();
    renderSource();
    renderControls();
}

function showGraphs() {
    build();
    // Also picks up a theme change made on another tab.
    if (dirty) refresh();
    else drawChart();
}

// A list from the Lists tab: its top items, ranked the way the list ranks
// them, over the list's own plays.
function openFromList() {
    const list = state.graphableList;
    if (!list || !list.entities.length) return;
    graph.series = list.entities.slice(0, 5).map(entity => makeSeries(entityIdentity(entity, list.entityType)));
    graph.metric = SCROBBLE_ORDER_SORTS.has(list.sortingBasis) ? "scrobbles" : list.sortingBasis;
    graph.x = list.xValue && isSortingBasisUsingXValue(graph.metric) ? String(list.xValue) : "";
    graph.show = "rank";
    graph.scope = "cumulative";
    graph.scale = "linear";
    graph.rankLimit = "auto";
    graph.source = { label: list.title, tracks: list.tracks };
    sortedCache = { from: null, plays: [] };
    graph.period = autoPeriod(sourcePlays());
    graph.dateMode = "zoom";
    graph.from = "";
    graph.to = "";
    built = true;
    renderSeries();
    renderSource();
    renderControls();
    dirty = true;
    setActiveView("graphs");
}

// An artist, album or track page: that one item's all-time rank over the
// years (or months, for a shorter history). The page already shows its
// plays over time, so the rank is what the graph adds.
function openEntity({ type, name, artist }) {
    graph.series = [makeSeries({ type, name, artist: type === "artist" ? name : artist })];
    graph.metric = "scrobbles";
    graph.x = "";
    graph.show = "rank";
    graph.scope = "cumulative";
    graph.scale = "linear";
    graph.source = null;
    const plays = sourcePlays();
    const years = plays.length ? (Number(plays[plays.length - 1].Date) - Number(plays[0].Date)) / (365.25 * 86400000) : 0;
    graph.period = years > 3 ? "year" : years > 0.5 ? "month" : "week";
    graph.rankLimit = "auto";
    graph.dateMode = "zoom";
    graph.from = "";
    graph.to = "";
    built = true;
    renderSeries();
    renderSource();
    renderControls();
    dirty = true;
    trackEvent(`graphs/entity/${type}`, `Graphs: opened from a ${type} page`);
    setActiveView("graphs");
}

// ---- Links ----
//
// view=graphs, then one g.line per line in order (a:Name, al:Album|Artist,
// t:Track|Artist) and only the settings that differ from the defaults. A
// graph of a list's plays adds g.plays=list, and the list's own settings
// come along so the visitor gets the same plays.

const LINE_PREFIXES = { artist: "a", album: "al", track: "t" };
const PREFIX_TYPES = { a: "artist", al: "album", t: "track" };
// A | inside a name would look like the one between title and artist.
const escapeBar = (text) => text.replace(/%/g, "%25").replace(/\|/g, "%7C");
const unescapeBar = (text) => text.replace(/%7C/gi, "|").replace(/%25/g, "%");

const RANK_LIMITS = { 10: "10", 25: "25", 50: "50", 100: "100", 0: "all" };

export function graphLinkPairs(listPairs) {
    const pairs = [["view", "graphs"]];
    graph.series.forEach(series => {
        pairs.push(["g.line", `${LINE_PREFIXES[series.type]}:${series.type === "artist" ? series.name : `${escapeBar(series.name)}|${escapeBar(series.artist)}`}`]);
    });
    if (graph.metric !== "scrobbles") pairs.push(["g.measure", graph.metric]);
    if (graph.x) pairs.push(["g.x", graph.x]);
    if (graph.show === "rank") pairs.push(["g.show", "rank"]);
    if (graph.show === "rank" && graph.rankLimit in RANK_LIMITS) pairs.push(["g.ranks", RANK_LIMITS[graph.rankLimit]]);
    if (graph.scope === "period") pairs.push(["g.count", "each"]);
    if (graph.period !== "month") pairs.push(["g.period", graph.period]);
    if (graph.scale === "logarithmic") pairs.push(["g.scale", "log"]);
    if (graph.from) pairs.push(["g.from", graph.from]);
    if (graph.dateMode === "count" && (graph.from || graph.to)) pairs.push(["g.dates", "count"]);
    if (graph.to) pairs.push(["g.to", graph.to]);
    if (graph.source) {
        // The list as it was when the graph was opened, even if the Lists
        // tab has changed since.
        if (!graph.source.pairs) graph.source.pairs = listPairs();
        pairs.push(["g.plays", "list"], ...graph.source.pairs);
    }
    pairs.push(...colorLinkPairs(graph.series.map(series => series.label.toLowerCase())));
    return pairs;
}

// Opens the graph a link describes, once the visitor's history is loaded.
// With g.plays=list the link's list has just been applied, so its plays
// are the ones on the Lists tab.
export function openGraphFromLink(params) {
    graph.series = params.getAll("g.line").map(value => {
        const split = value.indexOf(":");
        const type = PREFIX_TYPES[value.slice(0, split)];
        if (split < 1 || !type) return null;
        const rest = value.slice(split + 1);
        if (type === "artist") return makeSeries({ type, name: rest, artist: rest });
        const bar = rest.indexOf("|");
        if (bar < 0) return null;
        return makeSeries({ type, name: unescapeBar(rest.slice(0, bar)), artist: unescapeBar(rest.slice(bar + 1)) });
    }).filter(Boolean).slice(0, MAX_SERIES);
    // A link with no lines starts from the visitor's own top 5 artists.
    if (!graph.series.length) graph.series = topEntities("artist").slice(0, 5);
    const measure = params.get("g.measure");
    graph.metric = measure && metricOptions().some(option => option.value === measure) ? measure : "scrobbles";
    graph.x = params.get("g.x") || "";
    graph.show = params.get("g.show") === "rank" || DATE_SORTS.has(graph.metric) ? "rank" : "value";
    const ranks = params.get("g.ranks");
    graph.rankLimit = ranks === "all" ? 0 : RANK_STEPS.includes(Number(ranks)) ? Number(ranks) : "auto";
    graph.scope = params.get("g.count") === "each" ? "period" : "cumulative";
    graph.period = ["day", "week", "year"].includes(params.get("g.period")) ? params.get("g.period") : "month";
    graph.scale = params.get("g.scale") === "log" ? "logarithmic" : "linear";
    graph.dateMode = params.get("g.dates") === "count" ? "count" : "zoom";
    graph.from = params.get("g.from") || "";
    graph.to = params.get("g.to") || "";
    const list = params.get("g.plays") === "list" ? state.graphableList : null;
    graph.source = list ? { label: list.title, tracks: list.tracks } : null;
    sortedCache = { from: null, plays: [] };
    built = true;
    renderSeries();
    renderSource();
    renderControls();
    dirty = true;
    trackEvent("link/graph", "Opened a graph link");
    setActiveView("graphs");
}

// ---- Download ----

function downloadPng() {
    const canvas = document.getElementById("graph-canvas");
    if (!canvas || !chart || !resultMatches()) return;
    trackEvent("graphs/download", "Graphs: downloaded a PNG");
    const ratio = canvas.width / canvas.clientWidth;
    const pad = 16 * ratio;
    const colors = seriesColors();
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `600 ${12 * ratio}px ${font}`;
    // The legend, wrapped to the chart's width.
    const rows = [[]];
    let lineWidth = 0;
    graph.series.forEach((series, index) => {
        const width = 18 * ratio + probe.measureText(series.label).width + 18 * ratio;
        if (lineWidth + width > canvas.width && rows[rows.length - 1].length) {
            rows.push([]);
            lineWidth = 0;
        }
        rows[rows.length - 1].push({ x: lineWidth, label: series.label, color: colors[index] });
        lineWidth += width;
    });
    const titleHeight = 24 * ratio;
    const legendHeight = rows.length * 20 * ratio;
    const footer = 22 * ratio;
    const out = document.createElement("canvas");
    out.width = canvas.width + pad * 2;
    out.height = canvas.height + titleHeight + legendHeight + footer + pad * 2;
    const ctx = out.getContext("2d");
    ctx.fillStyle = cssVar("--background-color", "#FFFCF8");
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = cssVar("--primary-text-color", "#3B2F24");
    ctx.font = `700 ${15 * ratio}px ${font}`;
    ctx.fillText(describe().split(":")[0], pad, pad + 16 * ratio);
    ctx.font = `600 ${12 * ratio}px ${font}`;
    rows.forEach((row, rowIndex) => {
        const y = pad + titleHeight + rowIndex * 20 * ratio + 10 * ratio;
        row.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.fillRect(pad + item.x, y - 6 * ratio, 12 * ratio, 12 * ratio);
            ctx.fillStyle = cssVar("--secondary-text-color", "#6C5A4B");
            ctx.fillText(item.label, pad + item.x + 18 * ratio, y + 4 * ratio);
        });
    });
    ctx.drawImage(canvas, pad, pad + titleHeight + legendHeight);
    ctx.fillStyle = cssVar("--secondary-text-color", "#6C5A4B");
    ctx.font = `500 ${11 * ratio}px ${font}`;
    ctx.textAlign = "right";
    ctx.fillText("created with lastfmlists.com", out.width - pad, out.height - pad / 2);
    const link = document.createElement("a");
    link.download = `lastfmlists-graph-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
}

// ---- Wiring ----

if (section) {
    document.getElementById("tab-graphs")?.addEventListener("click", (event) => {
        if (!event.currentTarget.disabled && getActiveView() !== "graphs") setActiveView("graphs");
    });
    document.getElementById("graph-this-list")?.addEventListener("click", openFromList);
    section.querySelector(".graph-reset")?.addEventListener("click", resetGraph);
    section.querySelector(".graph-download")?.addEventListener("click", downloadPng);
    document.addEventListener("graphs:open-entity", (event) => openEntity(event.detail));
    document.addEventListener("view:changed", (event) => {
        if (event.detail.view === "graphs") showGraphs();
    });
    document.addEventListener("data:changed", () => {
        topCache.clear();
        sortedCache = { from: null, plays: [] };
        dirty = true;
        if (getActiveView() === "graphs") refresh();
    });
    document.addEventListener("artist-colors:changed", () => {
        if (!built) return;
        recolorSeries();
        recolorChart();
    });
    document.getElementById("theme-toggle")?.addEventListener("click", () => setTimeout(() => {
        if (built && getActiveView() === "graphs") {
            recolorSeries();
            drawChart();
        }
    }, 0));
}
