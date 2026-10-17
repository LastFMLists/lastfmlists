// The list settings and the username live in the address bar, so a link
// opens the same list for anyone: ?user=name&type=artist&sort=consecutive-days
//
// Every control has a short key below. Links are shared, so the keys must
// never change; a renamed control keeps its old key. Settings at their
// default value are left out, and race and chart settings only appear in the
// display modes that use them. In comparison mode the right list's settings
// get an "r." prefix.

import { trackEvent } from '../analytics.js';
import { GLOBAL_BASE_SETTING_IDS } from '../config.js';
import { filterTracks, getManagedFilterElements } from '../data/filters.js';
import { applySerializedControlValue, serializeControlValue } from '../dom.js';
import { state } from '../state.js';
import { updateRaceControlsVisibility } from './charts.js';
import {
    isComparisonEnabled,
    notifyFilterControlsChanged,
    syncActiveFiltersFromControls,
    syncEntitySortingSelectors,
    updateActiveFilters,
    updateComparisonInteractionState
} from './filters-panel.js';
import { displayEntities } from './lists.js';
import { getActiveView, setActiveView } from './shell.js';

const ENTITY_PREFIXES = { artist: "a", album: "al", track: "t" };
const ENTITY_FIELDS = {
    "name": "name", "initial": "init", "includes": "inc", "excludes": "exc",
    "name-length-min": "len.min", "name-length-max": "len.max",
    "word-count-min": "words.min", "word-count-max": "words.max",
    "scrobble-count-min": "plays.min", "scrobble-count-max": "plays.max",
    "rank-min": "rank.min", "rank-max": "rank.max",
    "track-count-min": "tracks.min", "track-count-max": "tracks.max",
    "days-since-last-min": "since.min", "days-since-last-max": "since.max",
    "first-scrobble-years": "first",
    "listeners-min": "listeners.min", "listeners-max": "listeners.max",
    "global-scrobbles-min": "global.min", "global-scrobbles-max": "global.max",
    "tags": "tags", "duration-min": "dur.min", "duration-max": "dur.max"
};

const KEYS = new Map([
    ["entity-type", "type"], ["sorting-basis", "sort"], ["x-value", "x"],
    ["display-mode", "mode"], ["chart-axis", "axis"], ["chart-scale", "scale"],
    ["race-start-date", "race.from"], ["race-end-date", "race.to"],
    ["race-frequency", "race.step"], ["race-speed-ms", "race.speed"],
    ["list-length", "len"], ["unfiltered-stats", "unf"], ["max-per-artist", "per.artist"],
    ["last-n-days", "days"], ["date-range-start", "from"], ["date-range-end", "to"],
    ["year", "year"], ["month", "month"], ["day-of-month", "dom"], ["weekday", "wd"],
    ["time-of-day-start", "time.from"], ["time-of-day-end", "time.to"],
    ["session-starter-only", "session"], ["day-starter-only", "daystart"],
    ["day-starter-gap-hours", "gap"], ["scrobble-order-from", "pos.from"], ["scrobble-order-to", "pos.to"],
    ["equations", "eq"],
    ...Object.entries(ENTITY_PREFIXES).flatMap(([entity, prefix]) =>
        Object.entries(ENTITY_FIELDS).map(([field, key]) => [`${entity}-${field}`, `${prefix}.${key}`]))
]);
const IDS = new Map([...KEYS].map(([id, key]) => [key, id]));

const DEFAULTS = {
    "entity-type": "track", "sorting-basis": "scrobbles", "display-mode": "list",
    "chart-axis": "horizontal", "chart-scale": "linear", "race-speed-ms": "260"
};
const CHART_IDS = new Set(["chart-axis", "chart-scale"]);
const RACE_IDS = new Set(["race-start-date", "race-end-date", "race-frequency", "race-speed-ms"]);

const keyFor = (id) => KEYS.get(id) || id;
const idFor = (key) => IDS.get(key) || (document.getElementById(key) ? key : null);

// Steps can be separated by semicolons or line breaks; one semicolon reads
// better in a link.
const compactEquations = (text) => (text || "").trim().replace(/\s*[;\n]+\s*/g, ";");

function keep(id, value, mode) {
    if (value === undefined || value === null || String(value).trim() === "") return false;
    if (DEFAULTS[id] === String(value)) return false;
    if (CHART_IDS.has(id) && mode === "list") return false;
    if (RACE_IDS.has(id) && mode !== "bar-race") return false;
    return true;
}

// ---- Settings on screen -> query string ----

function sideSettings(values, mode, prefix, pairs) {
    Object.entries(values).forEach(([id, value]) => {
        if (id === "comparison-edit-target" || GLOBAL_BASE_SETTING_IDS.has(id)) return;
        const text = id === "equations" ? compactEquations(value) : value;
        if (keep(id, text, mode)) pairs.push([prefix + keyFor(id), text]);
    });
}

function currentPairs() {
    const pairs = [];
    if (state.loadedUsername) pairs.push(["user", state.loadedUsername]);
    if (getActiveView() !== "lists") return pairs;

    const mode = document.getElementById("display-mode")?.value || "list";
    GLOBAL_BASE_SETTING_IDS.forEach(id => {
        const value = serializeControlValue(document.getElementById(id));
        if (keep(id, value, mode)) pairs.push([keyFor(id), value]);
    });

    if (isComparisonEnabled()) {
        pairs.push(["cmp", "1"]);
        sideSettings(state.comparisonFilterStates.left || {}, mode, "", pairs);
        const right = { ...(state.comparisonFilterStates.right || {}) };
        right.equations = document.getElementById("equations-right")?.value || right.equations || "";
        sideSettings(right, mode, "r.", pairs);
    } else {
        const values = {};
        getManagedFilterElements().forEach(element => { values[element.id] = serializeControlValue(element); });
        values.equations = document.getElementById("equations")?.value || "";
        sideSettings(values, mode, "", pairs);
    }
    return pairs;
}

// Commas, colons, slashes and semicolons stay readable; everything else is escaped.
function encode(value) {
    return encodeURIComponent(value).replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%2F/g, "/").replace(/%3B/g, ";").replace(/%20/g, "+");
}

export function syncUrl() {
    if (!state.loadedUsername || state.historyLoad) return;
    const query = currentPairs().map(([key, value]) => `${key}=${encode(String(value))}`).join("&");
    const next = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) {
        // Same history entry and state: entity pages keep theirs.
        history.replaceState(history.state, "", next);
    }
}

// ---- Query string -> settings, applied after the history has loaded ----

let pending = null;

function readQuery() {
    const params = new URLSearchParams(location.search);
    const user = (params.get("user") || "").trim().slice(0, 64);
    const settings = { comparison: params.get("cmp") === "1", left: {}, right: {}, globals: {} };
    let any = false;
    params.forEach((value, key) => {
        if (key === "user" || key === "cmp") return;
        const right = key.startsWith("r.");
        const id = idFor(right ? key.slice(2) : key);
        if (!id) return;
        any = true;
        if (GLOBAL_BASE_SETTING_IDS.has(id)) settings.globals[id] = value;
        else (right ? settings.right : settings.left)[id] = value;
    });
    return { user, settings: any ? settings : null };
}

// Called once the page is ready. A link with a username loads it straight
// away; settings wait for the history, from that link or the visitor's own.
export function startFromUrl() {
    const { user, settings } = readQuery();
    pending = settings;
    if (settings) trackEvent("link/settings", "Opened a link with list settings");
    if (!user) return;
    trackEvent("link/user", "Opened a link with a username");
    const input = document.getElementById("username");
    const form = document.getElementById("username-form");
    if (!input || !form) return;
    input.value = user;
    form.requestSubmit();
}

export function takePendingSettings() {
    const settings = pending;
    pending = null;
    return settings;
}

function setControl(id, value) {
    applySerializedControlValue(document.getElementById(id), value ?? "");
}

export function applySettings(settings) {
    if (getActiveView() !== "lists") setActiveView("lists");

    getManagedFilterElements().forEach(element => applySerializedControlValue(element, ""));
    ["equations", "equations-right"].forEach(id => setControl(id, ""));
    GLOBAL_BASE_SETTING_IDS.forEach(id => {
        if (id in settings.globals) setControl(id, settings.globals[id]);
        else if (id === "display-mode" || id === "chart-axis" || id === "chart-scale") setControl(id, DEFAULTS[id]);
        else if (id === "list-length" || id === "unfiltered-stats") setControl(id, "");
    });

    const { equations: leftEquations = "", ...left } = settings.left;
    Object.entries(left).forEach(([id, value]) => setControl(id, value));
    setControl("equations", leftEquations);

    const comparisonButton = document.getElementById("comparison-toggle");
    const editTarget = document.getElementById("comparison-edit-target");
    if (editTarget) editTarget.value = "left";
    if (settings.comparison) {
        const { equations: rightEquations = "", ...right } = settings.right;
        state.comparisonFilterStates = {
            left: { ...settings.left, equations: leftEquations },
            right: { ...right, equations: rightEquations }
        };
        state.comparisonStateInitialized = true;
        setControl("equations-right", rightEquations);
        if (comparisonButton) {
            comparisonButton.dataset.active = "true";
            comparisonButton.textContent = "Comparison: On";
        }
    } else {
        state.comparisonFilterStates = { left: {}, right: {} };
        state.comparisonStateInitialized = false;
        if (comparisonButton) {
            comparisonButton.dataset.active = "false";
            comparisonButton.textContent = "Comparison: Off";
        }
    }

    syncActiveFiltersFromControls();
    updateComparisonInteractionState();
    syncEntitySortingSelectors();
    updateRaceControlsVisibility();
    notifyFilterControlsChanged();
    filterTracks();
    displayEntities();
    updateActiveFilters();
}

// The address bar follows the list on screen and the tab you're on.
document.addEventListener("list:rendered", syncUrl);
document.addEventListener("view:changed", syncUrl);
