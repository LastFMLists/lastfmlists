// The Explore tab: ready-made lists grouped by theme. Each box is an ordinary
// list query, the shape openListQuery takes, so "Open in Lists" shows the
// same list with every filter in place, ready to change.
//
// Boxes are worked out one at a time after the tab opens, so a big history
// never freezes the page, and kept until the history or its details change.

import { trackEvent } from '../analytics.js';
import { createArtworkElement } from '../data/artwork.js';
import { defaultMilestone, sortMetricText } from '../data/entity-stats.js';
import { applyTracksPerEntityFilter, buildEntitiesFromTracks, filterTracks } from '../data/filters.js';
import { getDefaultXValue } from '../data/metrics.js';
import { escapeHTML } from '../dom.js';
import { state } from '../state.js';
import { openEntityPage } from './entity-page.js';
import { openListQuery } from './filters-panel.js';
import { getActiveView, setActiveView } from './shell.js';

const ROWS_SHOWN = 5;
const ROWS_EXPANDED = 15;
const OPEN_LIST_LENGTH = 100;

function box(id, title, note, entityType, sortingBasis = "scrobbles", { x = "", filters = {}, needsDetails = false } = {}) {
    return { id, title, note, needsDetails, query: { entityType, sortingBasis, xValue: x === "" ? "" : String(x), filters } };
}

// The sections, in page order. `year` is the year picked in Your year.
function sections(year, milestone) {
    const inYear = { year: String(year) };
    return [
        {
            id: "highlights",
            title: "Highlights",
            boxes: [
                box("top-artists", "Top artists", "Your most played artists of all time.", "artist"),
                box("top-albums", "Top albums", "Your most played albums of all time.", "album"),
                box("top-tracks", "Top tracks", "Your most played tracks of all time.", "track"),
                box("recent-artists", "Last 30 days: artists", "Who you've been listening to lately.", "artist", "scrobbles", { filters: { "last-n-days": "30" } }),
                box("recent-albums", "Last 30 days: albums", "The albums on rotation right now.", "album", "scrobbles", { filters: { "last-n-days": "30" } }),
                box("recent-tracks", "Last 30 days: tracks", "Your songs of the month.", "track", "scrobbles", { filters: { "last-n-days": "30" } })
            ]
        },
        {
            id: "year",
            title: "Your year",
            yearPicker: true,
            boxes: [
                box("year-artists", `Top artists of ${year}`, `Your most played artists in ${year}.`, "artist", "scrobbles", { filters: inYear }),
                box("year-albums", `Top albums of ${year}`, `Your most played albums in ${year}.`, "album", "scrobbles", { filters: inYear }),
                box("year-tracks", `Top tracks of ${year}`, `Your most played tracks in ${year}.`, "track", "scrobbles", { filters: inYear }),
                box("year-new-artists", `New in ${year}`, `Artists you first played in ${year}, by plays that year.`, "artist", "scrobbles", { filters: { ...inYear, "artist-first-scrobble-years": String(year) } }),
                box("year-best-days", `Biggest days of ${year}`, "The most plays a track got in a single day.", "track", "max-single-day", { filters: inYear }),
                box("year-streaks", `Streaks of ${year}`, "Artists played the most days in a row.", "artist", "consecutive-days", { filters: inYear })
            ]
        },
        {
            id: "streaks",
            title: "Streaks",
            boxes: [
                box("streak-artist-days", "Artists, days in a row", "The longest daily streaks.", "artist", "consecutive-days"),
                box("streak-track-days", "Tracks, days in a row", "Songs you played every day, the longest.", "track", "consecutive-days"),
                box("streak-track-plays", "Tracks on repeat", "The most plays in a row, nothing in between.", "track", "consecutive-scrobbles"),
                box("streak-artist-plays", "Artist binges", "The most plays in a row by one artist.", "artist", "consecutive-scrobbles"),
                box("streak-album-weeks", "Albums, weeks in a row", "Albums you kept coming back to every week.", "album", "consecutive-weeks"),
                box("streak-artist-months", "Artists, months in a row", "The artists that stuck around the longest.", "artist", "consecutive-months")
            ]
        },
        {
            id: "records",
            title: "Records and milestones",
            boxes: [
                box("record-track-day", "Biggest days", "The most plays a track got in a single day.", "track", "max-single-day"),
                box("record-artist-24h", "Biggest 24 hours", "The most plays an artist got within 24 hours.", "artist", "max-rolling-24h"),
                box("record-album-week", "Biggest weeks", "The most plays an album got in a single week.", "album", "max-single-week"),
                box("milestone-first-artists", `First to ${milestone} plays`, `The first artists to reach ${milestone} plays.`, "artist", "first-n-scrobbles", { x: milestone }),
                box("milestone-fastest-tracks", `Fastest to ${milestone} plays`, `Tracks that reached ${milestone} plays the quickest.`, "track", "fastest-n-scrobbles", { x: milestone }),
                box("milestone-fastest-albums", `Albums fastest to ${milestone}`, `Albums that reached ${milestone} plays the quickest.`, "album", "fastest-n-scrobbles", { x: milestone })
            ]
        },
        {
            id: "habits",
            title: "When you listen",
            boxes: [
                box("habit-night", "Late at night", "Tracks played between 23:00 and 04:00.", "track", "scrobbles", { filters: { "time-of-day-start": "23:00", "time-of-day-end": "04:00" } }),
                box("habit-morning", "In the morning", "Tracks played between 06:00 and 10:00.", "track", "scrobbles", { filters: { "time-of-day-start": "06:00", "time-of-day-end": "10:00" } }),
                box("habit-weekend", "On weekends", "Tracks played on Saturdays and Sundays.", "track", "scrobbles", { filters: { weekday: "6,0" } }),
                box("habit-session-start", "Session starters", "What you put on first after a break of 6 hours or more.", "track", "scrobbles", { filters: { "session-starter-only": "use-gap" } }),
                box("habit-day-start", "Day starters", "The first track of the day.", "track", "scrobbles", { filters: { "day-starter-only": "first-day-smart" } }),
                box("habit-most-days", "Always coming back", "Tracks played on the most different days.", "track", "separate-days")
            ]
        },
        {
            id: "rediscover",
            title: "Rediscover",
            boxes: [
                box("old-forgotten", "Forgotten favourites", "Artists you haven't played in over a year.", "artist", "scrobbles", { filters: { "artist-days-since-last-min": "365" } }),
                box("old-favourites", "Oldest favourites", "Artists whose plays are furthest in the past on average (25+ plays).", "artist", "oldest-average-listening-time", { x: 25 }),
                box("new-obsessions", "New obsessions", "Tracks whose plays are the most recent on average (10+ plays).", "track", "newest-average-listening-time", { x: 10 }),
                box("one-song-artists", "One-song artists", "Artists you've only ever played one track by.", "artist", "scrobbles", { filters: { "artist-track-count-max": "1" } }),
                box("first-thousand", "Where it started", "Your top tracks from your first 1,000 scrobbles.", "track", "scrobbles", { filters: { "scrobble-order-from": "1", "scrobble-order-to": "1000" } }),
                box("hidden-gems", "Hidden gems", "Tracks you've played 20+ times that have under 5,000 listeners on Last.fm.", "track", "scrobbles", { filters: { "track-listeners-max": "5000", "track-scrobble-count-min": "20" }, needsDetails: true })
            ]
        }
    ];
}

// ---- Working out a box ----

function computeEntities(query) {
    const filterList = Object.entries(query.filters)
        .filter(([id]) => id !== "max-per-artist")
        .map(([id, value]) => ({ id, value: String(value) }));
    const tracks = filterList.length ? filterTracks(filterList, state.allTracks) : state.allTracks;
    const x = query.xValue === "" ? getDefaultXValue(query.sortingBasis) : Number(query.xValue);
    let entities = buildEntitiesFromTracks(tracks, query.entityType, query.sortingBasis, x);
    if (query.entityType === "track" && query.filters["max-per-artist"]) {
        entities = applyTracksPerEntityFilter(entities, Number(query.filters["max-per-artist"]));
    }
    return entities.slice(0, ROWS_EXPANDED).map(entity => ({
        identity: identityOf(query.entityType, entity),
        metric: boxMetric(query.sortingBasis, entity, x)
    }));
}

// The list's value text, shortened where it would wrap in a narrow box.
function boxMetric(sort, entity, x) {
    if (sort === "first-n-scrobbles" && entity.dateReached) {
        return new Date(Number(entity.dateReached)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }
    if (sort === "fastest-n-scrobbles" && entity.timeNeeded >= 0) {
        const hours = entity.timeNeeded / 3600000;
        if (hours >= 48) return `${Math.round(hours / 24)} days`;
        if (hours >= 1) return `${Math.round(hours)} hours`;
        return `${Math.max(1, Math.round(hours * 60))} minutes`;
    }
    return sortMetricText(sort, entity, x);
}

function identityOf(type, entity) {
    if (type === "artist") return { type, name: entity.name, artist: entity.name };
    if (type === "album") return { type, name: entity.name, artist: entity.artist };
    let album = null;
    let best = 0;
    for (const [name, count] of Object.entries(entity.albumCounts || {})) {
        if (count > best && name && name !== "Unknown") { best = count; album = name; }
    }
    return { type, name: entity.Track, artist: entity.Artist, album };
}

// ---- Page state ----

const sectionElement = document.getElementById("explore-section");
const body = document.getElementById("explore-body");
const jump = sectionElement ? sectionElement.querySelector(".explore-jump") : null;

let year = null;
let stamp = null;
let generation = 0;
const results = new Map();     // box id + year -> rows
const expanded = new Set();    // box ids showing ROWS_EXPANDED
let boxesById = new Map();

// What the boxes were worked out from; a new load or new details redo them.
function currentStamp() {
    return `${state.allTracks.length}|${state.allTracks[0]?.Date}|${state.allTracks.at(-1)?.Date}|${state.extendedDataLoaded}`;
}

function libraryYears() {
    const tracks = state.allTracks;
    if (!tracks.length) return [];
    const first = new Date(Number(tracks[0].Date)).getFullYear();
    const last = new Date(Number(tracks[tracks.length - 1].Date)).getFullYear();
    const years = [];
    for (let y = last; y >= first; y--) years.push(y);
    return years;
}

function resultKey(boxDef) {
    return boxDef.id.startsWith("year-") ? `${boxDef.id}|${year}` : boxDef.id;
}

// ---- Rendering ----

function rowsHTML(boxDef) {
    const rows = results.get(resultKey(boxDef));
    if (!rows) return `<p class="explore-pending">Working it out…</p>`;
    if (!rows.length) return `<p class="explore-empty">Nothing here yet.</p>`;
    const shown = rows.slice(0, expanded.has(boxDef.id) ? ROWS_EXPANDED : ROWS_SHOWN);
    return `<ol class="explore-rows">${shown.map((row, index) => {
        const { identity } = row;
        const byline = identity.type === "artist" ? "" : `<small>${escapeHTML(identity.artist)}</small>`;
        return `<li class="explore-row" tabindex="0" role="button" data-box="${boxDef.id}" data-row="${index}" title="Show stats for ${escapeHTML(identity.name)}">
            <span class="explore-rank">${index + 1}</span>
            <span class="explore-art" data-art="${index}"></span>
            <span class="explore-name"><strong>${escapeHTML(identity.name)}</strong>${byline}</span>
            <span class="explore-metric">${escapeHTML(row.metric)}</span>
        </li>`;
    }).join("")}</ol>`;
}

function paintBox(boxDef) {
    const element = body.querySelector(`.explore-box[data-box="${boxDef.id}"]`);
    if (!element) return;
    const rows = results.get(resultKey(boxDef));
    element.querySelector(".explore-box-title").textContent = boxDef.title;
    element.querySelector(".explore-box-note").textContent = boxDef.note;
    element.querySelector(".explore-box-rows").innerHTML = rowsHTML(boxDef);
    element.querySelectorAll("[data-art]").forEach(holder => {
        const { identity } = rows[Number(holder.dataset.art)];
        holder.replaceWith(createArtworkElement(identity.type, identity.name, identity.artist, identity.album, "explore-art"));
    });
    const more = element.querySelector('[data-action="more"]');
    more.hidden = !rows || rows.length <= ROWS_SHOWN;
    more.textContent = expanded.has(boxDef.id) ? "Show less" : "Show more";
}

function render() {
    const years = libraryYears();
    if (!years.includes(year)) year = years[0];
    const groups = sections(year, defaultMilestone())
        .map(group => ({ ...group, boxes: group.boxes.filter(b => !b.needsDetails || state.extendedDataLoaded) }));
    boxesById = new Map(groups.flatMap(group => group.boxes.map(b => [b.id, b])));

    jump.innerHTML = groups.map(group =>
        `<button type="button" class="explore-chip" data-jump="${group.id}">${escapeHTML(group.title)}</button>`).join("");

    body.innerHTML = groups.map(group => {
        const picker = group.yearPicker && years.length > 1
            ? `<label class="explore-year">Year <select data-role="year">${years.map(y =>
                `<option value="${y}"${y === year ? " selected" : ""}>${y}</option>`).join("")}</select></label>`
            : "";
        return `<section class="explore-group" id="explore-${group.id}">
            <div class="explore-group-head"><h3>${escapeHTML(group.title)}</h3>${picker}</div>
            <div class="explore-grid">${group.boxes.map(b => `<article class="explore-box" data-box="${b.id}">
                <div class="explore-box-head"><h4 class="explore-box-title"></h4><p class="explore-box-note"></p></div>
                <div class="explore-box-rows"></div>
                <div class="explore-box-foot">
                    <button type="button" class="explore-more" data-action="more" hidden>Show more</button>
                    <button type="button" class="explore-open" data-action="open">Open in Lists <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
                </div>
            </article>`).join("")}</div>
        </section>`;
    }).join("");
    boxesById.forEach(paintBox);
    computeMissing();
}

// Works out the boxes without rows, one per tick, in page order. A newer
// render (another year, a new load) stops an older run.
async function computeMissing() {
    const run = ++generation;
    for (const boxDef of boxesById.values()) {
        if (results.has(resultKey(boxDef))) continue;
        await new Promise(resolve => setTimeout(resolve, 0));
        if (run !== generation) return;
        let rows;
        try {
            rows = computeEntities(boxDef.query);
        } catch (error) {
            console.error(`Explore box ${boxDef.id} failed:`, error);
            rows = [];
        }
        results.set(resultKey(boxDef), rows);
        paintBox(boxDef);
    }
}

export function showExplore() {
    if (!sectionElement || !state.allTracks.length) return;
    const now = currentStamp();
    if (now !== stamp) {
        stamp = now;
        results.clear();
        expanded.clear();
        render();
    } else if (!body.children.length) {
        render();
    }
}

// ---- Events ----

// The session panel sticks to the top of the screen, so section jumps stop
// just below it. Its height changes with the screen width.
function trackStickyPanel() {
    const panel = document.getElementById("session-panel");
    if (!panel || typeof ResizeObserver === "undefined") return;
    new ResizeObserver(() => {
        const top = parseFloat(getComputedStyle(panel).top) || 0;
        sectionElement.style.setProperty("--explore-offset", `${panel.offsetHeight + top}px`);
    }).observe(panel);
}

if (sectionElement) {
    trackStickyPanel();

    document.addEventListener("view:changed", (event) => {
        if (event.detail.view === "explore") showExplore();
    });
    document.addEventListener("data:changed", () => {
        if (getActiveView() === "explore") showExplore();
    });

    const exploreTab = document.getElementById("tab-explore");
    if (exploreTab) exploreTab.addEventListener("click", () => {
        if (!exploreTab.disabled && getActiveView() !== "explore") setActiveView("explore");
    });

    const openRow = (row) => {
        const boxDef = boxesById.get(row.dataset.box);
        const rows = boxDef && results.get(resultKey(boxDef));
        const hit = rows && rows[Number(row.dataset.row)];
        if (hit) openEntityPage(hit.identity);
    };

    sectionElement.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-jump]");
        if (chip) {
            document.getElementById(`explore-${chip.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
        const row = event.target.closest(".explore-row");
        if (row) { openRow(row); return; }

        const boxElement = event.target.closest(".explore-box");
        const boxDef = boxElement && boxesById.get(boxElement.dataset.box);
        if (!boxDef) return;
        if (event.target.closest('[data-action="more"]')) {
            if (expanded.has(boxDef.id)) expanded.delete(boxDef.id);
            else expanded.add(boxDef.id);
            paintBox(boxDef);
        } else if (event.target.closest('[data-action="open"]')) {
            trackEvent(`explore/open/${boxDef.id}`, `Explore: opened ${boxDef.id}`);
            openListQuery(boxDef.query, { listLength: OPEN_LIST_LENGTH });
            window.scrollTo({ top: 0 });
        }
    });

    sectionElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const row = event.target.closest(".explore-row");
        if (!row || row !== event.target) return;
        event.preventDefault();
        openRow(row);
    });

    sectionElement.addEventListener("change", (event) => {
        if (event.target.dataset.role !== "year") return;
        year = Number(event.target.value);
        trackEvent("explore/year", "Explore: changed year");
        boxesById.forEach(boxDef => { if (boxDef.id.startsWith("year-")) paintYearBox(boxDef); });
        computeMissing();
    });
}

// Year boxes get new titles and rows; the rest stay as they are.
function paintYearBox(boxDef) {
    const fresh = sections(year, defaultMilestone()).find(group => group.id === "year").boxes.find(b => b.id === boxDef.id);
    if (fresh) boxesById.set(boxDef.id, fresh);
    paintBox(fresh || boxDef);
}
