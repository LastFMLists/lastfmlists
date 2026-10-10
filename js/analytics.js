// Anonymous usage counts for lastfmlists.goatcounter.com. Only the names of
// the features used are sent: which list type, game, page or export. Usernames,
// filter values, artist, album and track names and scrobbles stay in the
// browser. GoatCounter itself adds the country, browser, screen size and
// referrer of each visit, without cookies.

import { readCurrentFilterInputState } from './data/filters.js';

// count.js loads async and may be blocked, so events wait here until it is
// ready. The cap keeps a blocked script from growing the queue all visit.
const pending = [];
const MAX_PENDING = 50;
// A list counts once it has been on screen this long, the same delay the
// support banner uses, so clicking through settings counts only the last one.
const LIST_VIEW_DELAY_MS = 1500;

function flush() {
    const counter = window.goatcounter;
    if (!counter || typeof counter.count !== "function") return;
    while (pending.length) {
        try {
            counter.count(pending.shift());
        } catch (e) {
            // A failed count must never break the page.
        }
    }
}

document.getElementById("goatcounter-script")?.addEventListener("load", flush);

export function trackEvent(path, title = path) {
    if (pending.length >= MAX_PENDING) return;
    pending.push({ path, title, event: true });
    flush();
}

// Some paths, like each filter, are worth counting once per visit rather
// than on every list.
const sentOnce = new Set();
export function trackEventOnce(path, title) {
    if (sentOnce.has(path)) return;
    sentOnce.add(path);
    trackEvent(path, title);
}

function optionLabel(selectId, value) {
    const option = document.querySelector(`#${selectId} option[value="${value}"]`);
    return option ? option.textContent.trim() : value;
}

// Rough library size, so the dashboard shows who uses the site without
// sending an exact scrobble count.
export function libraryBucket(count) {
    if (count < 10000) return "under-10k";
    if (count < 50000) return "10k-50k";
    if (count < 100000) return "50k-100k";
    if (count < 250000) return "100k-250k";
    if (count < 500000) return "250k-500k";
    return "500k-plus";
}

// ---- Lists ----

const MODE_PREFIX = { "list": "list", "bar-chart": "chart", "bar-race": "race" };
// These sit with the filters but pick the list type, which the list's own
// path already records.
const LIST_TYPE_IDS = new Set(["entity-type", "sorting-basis", "x-value"]);
let listTimer = null;
let lastListPath = null;

document.addEventListener("lists:rendered", (event) => {
    clearTimeout(listTimer);
    const detail = event.detail || {};
    if (!detail.count || !detail.entityType) return;
    listTimer = setTimeout(() => {
        if (document.body.classList.contains("view-entity")) return;
        const prefix = MODE_PREFIX[detail.renderMode] || "list";
        let path, title;
        if (detail.comparison) {
            path = `compare/${prefix}`;
            title = `Comparison (${optionLabel("display-mode", detail.renderMode)})`;
        } else {
            path = `${prefix}/${detail.entityType}/${detail.sortingBasis}`;
            title = `${optionLabel("entity-type", detail.entityType)} by ${optionLabel("sorting-basis", detail.sortingBasis).toLowerCase()} (${optionLabel("display-mode", detail.renderMode).toLowerCase()})`;
        }
        // Changing a filter on the same list type is not a new list type.
        if (path !== lastListPath) {
            lastListPath = path;
            trackEvent(path, title);
        }
        Object.entries(readCurrentFilterInputState()).forEach(([id, value]) => {
            if (LIST_TYPE_IDS.has(id)) return;
            if ((value ?? "").toString().trim() !== "") trackEventOnce(`filter/${id}`, `Filter used: ${id}`);
        });
        if ((document.getElementById("equations")?.value || "").trim()) {
            trackEventOnce("filter/equations", "Filter used: equations");
        }
    }, LIST_VIEW_DELAY_MS);
});

// ---- Buttons ----

// Clicks are counted where they land, so the modules behind these buttons
// need no changes. Disabled buttons fire no clicks, so these count real use.
const BUTTON_EVENTS = {
    "load-detailed-data": ["details/top", "Load Details"],
    "load-all-details": ["details/all", "Load All Details"],
    "save-data": ["save-data", "Save Data"],
    "confirm-export-grid": ["export/grid", "Export grid"],
    "tab-games": ["view/games", "Games tab opened"],
    "ftl-start": ["game/fill-the-list", "Fill the List started"]
};

document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.id === "confirm-export-image") {
        const race = document.getElementById("display-mode")?.value === "bar-race";
        trackEvent(race ? "export/gif" : "export/image", race ? "Export race GIF" : "Export image");
    } else if (BUTTON_EVENTS[target.id]) {
        trackEvent(...BUTTON_EVENTS[target.id]);
    } else if (target.matches(".hl-type")) {
        trackEvent(`game/higher-or-lower/${target.dataset.type}`, `Higher or Lower: ${target.dataset.type}`);
    } else if (target.matches(".ord-type")) {
        trackEvent(`game/put-them-in-order/${target.dataset.type}`, `Put Them In Order: ${target.dataset.type}`);
    }
});
