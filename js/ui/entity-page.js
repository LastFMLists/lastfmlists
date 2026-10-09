// The page for one artist, album or track, opened by clicking its row in a
// list. It shows where the entity ranks across the whole loaded history, and
// every ranking on it opens the list that ranking came from.

import { createArtworkElement } from '../data/artwork.js';
import {
    ENTITY_NOUNS,
    MILESTONE_SORTS,
    OTHER_SORTS,
    STREAK_SORTS,
    allMonthRanks,
    artistRank,
    defaultMilestone,
    defaultSortX,
    entityKey,
    historyBounds,
    initialRank,
    isoDate,
    listeningSeries,
    monthRanks,
    nameLengthRank,
    overview,
    pickHighlights,
    recentRanks,
    sortRank,
    weekRanks,
    yearRanks
} from '../data/entity-stats.js';
import { escapeHTML } from '../dom.js';
import { state } from '../state.js';
import { openListQuery } from './filters-panel.js';

const section = document.getElementById("entity-section");

// Everything about the page on screen. Rebuilt for each entity.
let page = null;

// What was expanded on each page and where it was scrolled, so the browser's
// Back button returns to the page as it was left.
const savedViews = new Map();

function saveView() {
    if (!page || !page.info) return;
    savedViews.set(page.entity.key, {
        showAll: page.showAll,
        openSections: new Set(page.openSections),
        detailYear: page.detailYear,
        milestone: page.milestone,
        timeline: { ...page.timeline },
        scrollY: window.scrollY
    });
}

const TYPE_TITLES = { track: "Track", album: "Album", artist: "Artist" };

function nextFrame() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function formatDate(timestamp) {
    if (!timestamp) return "Unknown";
    return new Date(Number(timestamp)).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function shortDate(date) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function plays(count) {
    return `${(count || 0).toLocaleString()} ${count === 1 ? "play" : "plays"}`;
}

function lastfmUrl(entity) {
    const base = `https://www.last.fm/music/${encodeURIComponent(entity.artist)}`;
    if (entity.type === "album") return `${base}/${encodeURIComponent(entity.name)}`;
    if (entity.type === "track") return `${base}/_/${encodeURIComponent(entity.name)}`;
    return base;
}

function normalizeEntity({ type, name, artist, album }) {
    const safeType = type === "album" || type === "artist" ? type : "track";
    const safeArtist = safeType === "artist" ? name : artist;
    return {
        type: safeType,
        name,
        artist: safeArtist,
        album: album && album !== "Unknown" ? album : null,
        key: entityKey(safeType, name, safeArtist)
    };
}

// ---- Opening and closing, tied to the browser's back button ----

function isOpen() {
    return document.body.classList.contains("view-entity");
}

function hideEntityView() {
    saveView();
    document.body.classList.remove("view-entity");
    if (section) section.hidden = true;
    page = null;
}

// Each entity page is a history entry, so the browser's back button steps
// back through them. `depth` counts the pages since the list.
export function openEntityPage(identity, { push = true } = {}) {
    if (!section || !state.allTracks.length) return;
    const entity = normalizeEntity(identity);
    saveView();
    if (push) {
        const depth = (history.state && history.state.lfmEntity ? history.state.depth || 0 : 0) + 1;
        history.pushState({ lfmEntity: { ...entity }, depth }, "");
    }
    document.body.classList.add("view-entity");
    section.hidden = false;
    const restored = push ? null : savedViews.get(entity.key);
    section.classList.add("is-entering");
    renderPage(entity, restored);
    setTimeout(() => section.classList.remove("is-entering"), 250);
    window.scrollTo({ top: restored ? restored.scrollY : 0 });
}

function backToList() {
    const depth = history.state && history.state.lfmEntity ? history.state.depth || 0 : 0;
    if (depth > 0) {
        history.go(-depth);
    } else {
        hideEntityView();
    }
}

// Leave the page for a list. A new history entry means Back returns here.
function leaveForList() {
    hideEntityView();
    history.pushState({ lfmList: true }, "");
}

window.addEventListener("popstate", (event) => {
    const entity = event.state && event.state.lfmEntity;
    if (entity) openEntityPage(entity, { push: false });
    else if (isOpen()) hideEntityView();
});

function openLink(link, highlight = null) {
    if (!link || !page) return;
    const scoped = Boolean(link.query.filters && link.query.filters["artist-name"]);
    // Enough rows to include the entity's own position, so it can be shown.
    const listLength = link.rank
        ? Math.max(50, Math.ceil((link.rank + 5) / 50) * 50)
        : (scoped ? 0 : 100);
    const target = highlight || page.entity;
    leaveForList();
    openListQuery(link.query, { listLength, highlight: target });
}

// ---- Rendering helpers ----

// Rows are buttons that open their list. Each link is stored in page.links
// and looked up by index when clicked.
function rankRow(link) {
    if (!link) return "";
    const index = page.links.push(link) - 1;
    const value = link.metric || plays(link.count);
    const position = link.rank ? `#${link.rank.toLocaleString()}` : "–";
    const of = link.rank && link.entries ? ` of ${link.entries.toLocaleString()}` : "";
    return `<button type="button" class="rank-link" data-link="${index}" title="Open this list">
        <span class="rank-label">${escapeHTML(link.label)}</span>
        <span class="rank-value">${escapeHTML(value)}</span>
        <span class="rank-position"${link.rank ? "" : ' aria-label="no rank"'}>${position}<small>${of}</small></span>
    </button>`;
}

function rankList(links, emptyText) {
    if (!links.length) return `<p class="entity-empty">${escapeHTML(emptyText)}</p>`;
    return `<div class="rank-list">${links.map(link => rankRow(link)).join("")}</div>`;
}

function detailsBlock(id, title, body, { open = false, note = "" } = {}) {
    return `<details class="entity-details" data-section="${id}"${open || page.openSections.has(id) ? " open" : ""}>
        <summary><span>${escapeHTML(title)}</span>${note ? `<small>${escapeHTML(note)}</small>` : ""}</summary>
        <div class="entity-details-body">${body}</div>
    </details>`;
}

function entityButton(type, name, artist, label) {
    return `<button type="button" class="entity-link" data-open-type="${type}" data-open-name="${escapeHTML(name)}" data-open-artist="${escapeHTML(artist)}">${escapeHTML(label || name)}</button>`;
}

// ---- The page ----

function renderPage(entity, restored = null) {
    const info = overview(entity);
    if (info.first === null) {
        section.innerHTML = `<div class="entity-page">
            <button type="button" class="entity-back" data-action="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Back to list</button>
            <p class="entity-empty">This ${ENTITY_NOUNS[entity.type].one} is not in the loaded history.</p>
        </div>`;
        page = { entity, links: [], openSections: new Set() };
        return;
    }
    if (entity.type === "track" && !entity.album) entity.album = info.topAlbum;

    const bounds = historyBounds();
    page = {
        entity,
        info,
        links: [],
        openSections: new Set(["years"]),
        showAll: false,
        artistRank: artistRank(entity),
        recent: recentRanks(entity),
        years: null,
        months: null,
        weeks: null,
        streaks: null,
        others: null,
        milestone: defaultMilestone(),
        milestoneLinks: null,
        detailYear: new Date(bounds.last).getFullYear(),
        timeline: {
            range: "all",
            resolution: "month",
            from: isoDate(new Date(info.first)),
            until: isoDate(new Date(bounds.last)),
            selected: -1
        },
        generation: Symbol("page")
    };
    if (restored) {
        page.showAll = restored.showAll;
        page.openSections = new Set(restored.openSections);
        page.detailYear = restored.detailYear;
        page.milestone = restored.milestone;
        page.timeline = { ...restored.timeline };
        // The expanded lists fill in a moment later, so scroll again then.
        page.pendingScroll = restored.scrollY;
    }

    paint();
    computeInBackground(page.generation);
}

async function computeInBackground(generation) {
    const entity = page.entity;
    await nextFrame();
    if (!page || page.generation !== generation) return;
    page.years = yearRanks(entity);
    page.months = allMonthRanks(entity);
    page.weeks = weekRanks(entity);
    page.initial = initialRank(entity);
    page.nameLength = nameLengthRank(entity);
    page.milestoneLinks = MILESTONE_SORTS.map(sort => sortRank(entity, sort, page.milestone)).filter(Boolean);
    paint();
    if (page.pendingScroll) {
        window.scrollTo({ top: page.pendingScroll });
        page.pendingScroll = null;
    }

    // The other sorts each walk the whole history, so they run one at a
    // time with a pause between, and the page fills in as they finish.
    const streaks = [];
    for (const sort of STREAK_SORTS) {
        await nextFrame();
        if (!page || page.generation !== generation) return;
        const link = sortRank(entity, sort);
        if (link) streaks.push(link);
    }
    page.streaks = streaks;
    const others = [];
    for (const sort of OTHER_SORTS) {
        await nextFrame();
        if (!page || page.generation !== generation) return;
        const link = sortRank(entity, sort, defaultSortX(sort));
        if (link) others.push(link);
    }
    page.others = others;
    paint();
}

function paint() {
    if (!page || !section) return;
    const { entity, info } = page;
    page.links = [];
    const noun = ENTITY_NOUNS[entity.type];
    const scrollY = window.scrollY;

    const byline = [];
    if (entity.type !== "artist") byline.push(`by ${entityButton("artist", entity.artist, entity.artist)}`);
    if (entity.type === "track" && entity.album) byline.push(`from ${entityButton("album", entity.album, entity.artist)}`);

    const library = info.library;
    const shortcuts = [
        { id: "artist-tracks", label: `All tracks by ${entity.artist}`, icon: "fa-music" },
        { id: "artist-albums", label: `All albums by ${entity.artist}`, icon: "fa-compact-disc" }
    ];
    const albumName = entity.type === "album" ? entity.name : entity.album;
    if (entity.type !== "artist" && albumName) {
        shortcuts.push({ id: "album-tracks", label: `All tracks on ${albumName}`, icon: "fa-list-ol" });
    }

    const bestRecent = page.recent
        .filter(link => link.rank)
        .sort((a, b) => a.rank - b.rank || b.count - a.count)[0];

    const ready = page.years !== null;
    const highlightsReady = ready && page.streaks !== null && page.others !== null;
    const highlights = highlightsReady
        ? pickHighlights({
            years: page.years,
            months: page.months,
            weeks: page.weeks,
            streaks: page.streaks,
            others: page.others
        })
        : [];

    section.innerHTML = `<div class="entity-page">
        <button type="button" class="entity-back" data-action="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Back to list</button>

        <header class="entity-header">
            <div class="entity-header-art"></div>
            <div class="entity-heading">
                <span class="entity-kicker">${TYPE_TITLES[entity.type]}</span>
                <h2>${escapeHTML(entity.name)}</h2>
                ${byline.length ? `<p class="entity-byline">${byline.join(" ")}</p>` : ""}
                <a class="entity-lastfm" href="${escapeHTML(lastfmUrl(entity))}" target="_blank" rel="noopener"><i class="fab fa-lastfm" aria-hidden="true"></i>Open on Last.fm</a>
            </div>
        </header>

        <div class="entity-stats">
            <div class="entity-stat"><span>Scrobbles</span><strong>${library.count.toLocaleString()}</strong></div>
            <button type="button" class="entity-stat" data-link="${page.links.push(library) - 1}" title="Open your top ${noun.many}">
                <span>Library rank</span><strong>#${(library.rank || 0).toLocaleString()}</strong><small>of ${library.entries.toLocaleString()} ${noun.many}</small>
            </button>
            <div class="entity-stat"><span>First played</span><strong>${escapeHTML(formatDate(info.first))}</strong></div>
            <div class="entity-stat"><span>Last played</span><strong>${escapeHTML(formatDate(info.last))}</strong></div>
        </div>

        <div class="entity-shortcuts">
            ${shortcuts.map(item => `<button type="button" class="entity-shortcut" data-shortcut="${item.id}"><i class="fas ${item.icon}" aria-hidden="true"></i>${escapeHTML(item.label)}</button>`).join("")}
        </div>

        <section class="entity-block">
            <h3>Rankings</h3>
            <div class="rank-list">
                ${rankRow(library)}
                ${rankRow(page.artistRank)}
                ${bestRecent ? rankRow(bestRecent) : ""}
            </div>
        </section>

        <section class="entity-block">
            <h3>High placements</h3>
            ${highlightsReady
                ? rankList(highlights.map(link => ({ ...link, label: link.highlightLabel || link.label })),
                    "No top 10 placements in a year, month, week, streak or other ranking yet.")
                : `<p class="entity-empty entity-loading">Checking every ranking…</p>`}
        </section>

        <button type="button" class="entity-toggle-all" data-action="toggle-all" aria-expanded="${page.showAll}">
            <i class="fas ${page.showAll ? "fa-chevron-up" : "fa-list"}" aria-hidden="true"></i>${page.showAll ? "Show fewer lists" : "Show all lists"}
        </button>

        <section class="entity-block">
            <h3>Listening history</h3>
            ${renderTimeline()}
        </section>

        ${page.showAll ? renderAllLists() : ""}

        <p class="entity-footnote">These numbers use all ${state.allTracks.length.toLocaleString()} scrobbles loaded in this browser, whatever filters the list had. Click a ranking to open its list.</p>
    </div>`;

    const artHolder = section.querySelector(".entity-header-art");
    if (artHolder) artHolder.appendChild(createArtworkElement(entity.type, entity.name, entity.artist, entity.album, "entity-art-large"));

    window.scrollTo({ top: scrollY });
}

function renderAllLists() {
    const { entity } = page;
    const noun = ENTITY_NOUNS[entity.type];
    if (page.years === null) return `<p class="entity-empty entity-loading">Counting plays by year, month and week…</p>`;

    const yearOptions = page.years.map(link =>
        `<option value="${link.year}"${link.year === page.detailYear ? " selected" : ""}>${link.year}</option>`).join("");
    const months = monthRanks(entity, page.detailYear).filter(link => link.count > 0);
    const year = page.detailYear;
    const weeks = page.weeks.filter(link => link.count > 0 && (link.startYear === year || link.endYear === year));

    const milestoneBody = `
        <label class="entity-inline-field">Plays to reach
            <input type="number" min="1" step="1" value="${page.milestone}" data-role="milestone">
        </label>
        ${page.milestoneLinks && page.milestoneLinks.length
            ? rankList(page.milestoneLinks, "")
            : `<p class="entity-empty">This ${noun.one} has not reached ${page.milestone} plays, so it has no place in these lists.</p>
               <div class="entity-shortcuts">
                   <button type="button" class="entity-shortcut" data-milestone-open="first-n-scrobbles">Open First to ${page.milestone}</button>
                   <button type="button" class="entity-shortcut" data-milestone-open="fastest-n-scrobbles">Open Fastest to ${page.milestone}</button>
               </div>`}`;

    const pending = `<p class="entity-empty entity-loading">Still calculating…</p>`;
    const others = page.others === null ? null
        : [...page.others, page.initial, page.nameLength].filter(Boolean);

    return `<div class="entity-all">
        ${detailsBlock("recent", "Recent activity", rankList(page.recent.filter(link => link.count > 0), "No plays in the last 365 days."))}
        ${detailsBlock("years", "By year", rankList(page.years.filter(link => link.count > 0), "No plays yet."))}
        <label class="entity-inline-field">Months and weeks of
            <select data-role="detail-year">${yearOptions}</select>
        </label>
        ${detailsBlock("months", `By month in ${year}`, rankList(months, `No plays in ${year}.`))}
        ${detailsBlock("weeks", `By week in ${year}`, rankList(weeks, `No plays in any week of ${year}.`), { note: "Monday to Sunday" })}
        ${detailsBlock("milestones", `Milestones · ${page.milestone} plays`, milestoneBody)}
        ${detailsBlock("streaks", "Streak rankings", page.streaks === null ? pending
            : rankList(page.streaks, `This ${noun.one} has no place in the streak rankings.`))}
        ${detailsBlock("others", "Other rankings", others === null ? pending
            : rankList(others, `This ${noun.one} has no place in the other rankings.`))}
    </div>`;
}

// ---- Listening graph ----

function timelineRange() {
    const bounds = historyBounds();
    const last = new Date(bounds.last);
    const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    const t = page.timeline;
    if (t.range === "year") return { start: new Date(lastDay.getFullYear() - 1, lastDay.getMonth(), lastDay.getDate() + 1), end: lastDay };
    if (t.range === "quarter") return { start: new Date(lastDay.getFullYear(), lastDay.getMonth() - 3, lastDay.getDate() + 1), end: lastDay };
    if (t.range === "custom") {
        const parse = value => {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
            return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
        };
        return { start: parse(t.from), end: parse(t.until) };
    }
    const first = new Date(page.info.first);
    return { start: new Date(first.getFullYear(), first.getMonth(), first.getDate()), end: lastDay };
}

function barQuery(bar, resolution) {
    const type = page.entity.type;
    let filters;
    if (resolution === "year") filters = { year: String(bar.start.getFullYear()) };
    else if (resolution === "month") filters = { year: String(bar.start.getFullYear()), month: String(bar.start.getMonth() + 1) };
    else filters = { "date-range-start": isoDate(bar.start), "date-range-end": isoDate(bar.end) };
    return { entityType: type, sortingBasis: "scrobbles", xValue: "", filters };
}

function barLabel(bar, resolution) {
    if (resolution === "year") return String(bar.start.getFullYear());
    if (resolution === "month") return bar.start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (resolution === "day") return shortDate(bar.start);
    return `${shortDate(bar.start)} to ${shortDate(bar.end)}`;
}

const RESOLUTION_NAMES = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };

function renderTimeline() {
    const t = page.timeline;
    const { start, end } = timelineRange();
    const controls = `<div class="timeline-controls">
        <label>Time range
            <select data-role="tl-range">
                <option value="all"${t.range === "all" ? " selected" : ""}>Since first play</option>
                <option value="year"${t.range === "year" ? " selected" : ""}>Last 12 months</option>
                <option value="quarter"${t.range === "quarter" ? " selected" : ""}>Last 3 months</option>
                <option value="custom"${t.range === "custom" ? " selected" : ""}>Custom dates</option>
            </select>
        </label>
        <label>One bar per
            <select data-role="tl-resolution">
                <option value="auto"${t.resolution === "auto" ? " selected" : ""}>Automatic</option>
                <option value="day"${t.resolution === "day" ? " selected" : ""}>Day</option>
                <option value="week"${t.resolution === "week" ? " selected" : ""}>Week</option>
                <option value="month"${t.resolution === "month" ? " selected" : ""}>Month</option>
                <option value="year"${t.resolution === "year" ? " selected" : ""}>Year</option>
            </select>
        </label>
        ${t.range === "custom" ? `
        <label>From <input type="date" data-role="tl-from" value="${escapeHTML(t.from)}"></label>
        <label>To <input type="date" data-role="tl-until" value="${escapeHTML(t.until)}"></label>` : ""}
    </div>`;

    if (!start || !end) return `${controls}<p class="entity-empty">Pick a start and an end date.</p>`;
    if (end < start) return `${controls}<p class="entity-empty">The end date is before the start date.</p>`;
    if (end.getFullYear() - start.getFullYear() > 200) return `${controls}<p class="entity-empty">Pick a range shorter than 200 years.</p>`;

    const series = listeningSeries(page.entity, start, end, t.resolution);
    page.series = series;
    const bars = series.bars;
    const total = bars.reduce((sum, bar) => sum + bar.count, 0);
    const peak = bars.reduce((max, bar) => Math.max(max, bar.count), 0);
    if (t.selected >= bars.length) t.selected = -1;

    const width = 1000;
    const height = 150;
    const step = width / Math.max(1, bars.length);
    const barWidth = Math.max(step * 0.82, 0.6);
    const rects = bars.map((bar, index) => {
        const barHeight = peak ? (bar.count / peak) * (height - 2) : 0;
        if (!bar.count) return "";
        return `<rect class="timeline-bar${index === t.selected ? " is-selected" : ""}" data-bar="${index}" x="${(index * step).toFixed(2)}" y="${(height - barHeight).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}"><title>${escapeHTML(barLabel(bar, series.resolution))}: ${plays(bar.count)}</title></rect>`;
    }).join("");

    const selectedBar = bars[t.selected];
    const dailyNote = !series.dailyAllowed && t.resolution === "day"
        ? `<p class="timeline-note">One bar per day works for ranges up to a year, so this range uses automatic bars.</p>` : "";

    return `${controls}
        ${dailyNote}
        <p class="timeline-summary">${plays(total)} · ${RESOLUTION_NAMES[series.resolution]} bars · busiest ${series.resolution}: ${plays(peak)}</p>
        <div class="timeline-chart">
            <div class="timeline-axis" aria-hidden="true"><span>${peak}</span><span>${Math.round(peak / 2)}</span><span>0</span></div>
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Plays per ${series.resolution} from ${escapeHTML(shortDate(start))} to ${escapeHTML(shortDate(end))}. Select a bar to see its plays.">
                <line class="timeline-baseline" x1="0" y1="${height}" x2="${width}" y2="${height}"></line>
                ${rects}
            </svg>
        </div>
        <div class="timeline-nav">
            <button type="button" class="timeline-step" data-action="tl-prev" aria-label="Previous period with plays"${total ? "" : " disabled"}><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
            <div class="timeline-selection">
                ${selectedBar
                    ? `<span><strong>${escapeHTML(barLabel(selectedBar, series.resolution))}</strong>: ${plays(selectedBar.count)}</span>
                       <button type="button" class="entity-shortcut" data-action="tl-open"><i class="fas fa-list" aria-hidden="true"></i>Open this period's list</button>`
                    : `<span>${escapeHTML(shortDate(start))} to ${escapeHTML(shortDate(end))}. Select a bar, or use the arrows, to see a period.</span>`}
            </div>
            <button type="button" class="timeline-step" data-action="tl-next" aria-label="Next period with plays"${total ? "" : " disabled"}><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
        </div>`;
}

function stepTimeline(direction) {
    const bars = page.series ? page.series.bars : [];
    const filled = bars.map((bar, index) => (bar.count ? index : -1)).filter(index => index >= 0);
    if (!filled.length) return;
    const current = page.timeline.selected;
    let next;
    if (direction < 0) next = [...filled].reverse().find(index => index < current) ?? filled[filled.length - 1];
    else next = filled.find(index => index > current) ?? filled[0];
    page.timeline.selected = next;
    paint();
}

// ---- Events ----

function shortcutQuery(id) {
    const { entity } = page;
    if (id === "artist-tracks") return { query: { entityType: "track", filters: { "artist-name": entity.artist } } };
    if (id === "artist-albums") {
        return {
            query: { entityType: "album", filters: { "artist-name": entity.artist } },
            highlight: entity.type === "album" ? entity
                : (entity.album ? { type: "album", name: entity.album, artist: entity.artist } : null)
        };
    }
    const album = entity.type === "album" ? entity.name : entity.album;
    return { query: { entityType: "track", filters: { "artist-name": entity.artist, "album-name": album } } };
}

if (section) {
    section.addEventListener("click", (event) => {
        if (!page) return;
        const target = event.target;

        if (target.closest('[data-action="back"]')) { backToList(); return; }

        const linkButton = target.closest("[data-link]");
        if (linkButton) { openLink(page.links[Number(linkButton.dataset.link)]); return; }

        const shortcut = target.closest("[data-shortcut]");
        if (shortcut) {
            const { query, highlight } = shortcutQuery(shortcut.dataset.shortcut);
            const target = highlight || page.entity;
            leaveForList();
            openListQuery({ sortingBasis: "scrobbles", xValue: "", ...query }, { listLength: 0, highlight: target });
            return;
        }

        const milestoneOpen = target.closest("[data-milestone-open]");
        if (milestoneOpen) {
            const query = { entityType: page.entity.type, sortingBasis: milestoneOpen.dataset.milestoneOpen, xValue: String(page.milestone), filters: {} };
            leaveForList();
            openListQuery(query, { listLength: 100 });
            return;
        }

        const entityLink = target.closest("[data-open-type]");
        if (entityLink) {
            openEntityPage({
                type: entityLink.dataset.openType,
                name: entityLink.dataset.openName,
                artist: entityLink.dataset.openArtist
            });
            return;
        }

        if (target.closest('[data-action="toggle-all"]')) {
            page.showAll = !page.showAll;
            paint();
            return;
        }

        const bar = target.closest("[data-bar]");
        if (bar) {
            page.timeline.selected = Number(bar.dataset.bar);
            paint();
            return;
        }
        if (target.closest('[data-action="tl-prev"]')) { stepTimeline(-1); return; }
        if (target.closest('[data-action="tl-next"]')) { stepTimeline(1); return; }
        if (target.closest('[data-action="tl-open"]')) {
            const selected = page.series && page.series.bars[page.timeline.selected];
            if (!selected) return;
            const query = barQuery(selected, page.series.resolution);
            openLink({ query, rank: null, label: "" });
        }
    });

    // Remember which sections are open, so repainting keeps them open.
    section.addEventListener("toggle", (event) => {
        const details = event.target;
        if (!page || !details.dataset || !details.dataset.section) return;
        if (details.open) page.openSections.add(details.dataset.section);
        else page.openSections.delete(details.dataset.section);
    }, true);

    section.addEventListener("change", (event) => {
        if (!page) return;
        const role = event.target.dataset.role;
        const t = page.timeline;
        if (role === "tl-range") { t.range = event.target.value; t.selected = -1; }
        else if (role === "tl-resolution") { t.resolution = event.target.value; t.selected = -1; }
        else if (role === "tl-from") { t.from = event.target.value; t.selected = -1; }
        else if (role === "tl-until") { t.until = event.target.value; t.selected = -1; }
        else if (role === "detail-year") { page.detailYear = Number(event.target.value); }
        else if (role === "milestone") {
            const value = parseInt(event.target.value, 10);
            if (!(value >= 1)) return;
            page.milestone = value;
            page.milestoneLinks = MILESTONE_SORTS.map(sort => sortRank(page.entity, sort, value)).filter(Boolean);
            page.openSections.add("milestones");
        } else {
            return;
        }
        paint();
    });
}

// Rows in the results list open their entity's page.
function rowIdentity(row) {
    return {
        type: row.dataset.entityType,
        name: row.dataset.name,
        artist: row.dataset.artist,
        album: row.dataset.album || null
    };
}

const results = document.getElementById("results");
if (results) {
    results.addEventListener("click", (event) => {
        const row = event.target.closest(".entity-row");
        if (!row || event.target.closest("a")) return;
        openEntityPage(rowIdentity(row));
    });
    results.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const row = event.target.closest(".entity-row");
        if (!row || row !== event.target) return;
        event.preventDefault();
        openEntityPage(rowIdentity(row));
    });
}

// Anything that changes the list closes the page first.
function closeForListChange() {
    if (isOpen()) leaveForList();
}

["apply-filters", "reset-filters", "tab-lists"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.addEventListener("click", closeForListChange);
});

const gamesTab = document.getElementById("tab-games");
if (gamesTab) gamesTab.addEventListener("click", () => { if (isOpen()) hideEntityView(); });

const usernameForm = document.getElementById("username-form");
if (usernameForm) usernameForm.addEventListener("submit", () => { if (isOpen()) hideEntityView(); });
