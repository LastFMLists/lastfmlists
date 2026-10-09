// Numbers behind an entity page: counts and ranks for one artist, album or
// track across the whole loaded history, regardless of the filters on the
// list that opened the page.
//
// Every rank here has to equal the entity's position in the list its row
// links to. The lists group scrobbles in history order and sort with a
// stable sort, so a tie keeps whoever was played first in that period. The
// helpers below count the same way: a Map keeps first-appearance order, and
// rankInCounts walks it with that tie rule.

import { state } from '../state.js';
import { formatDuration } from '../time.js';
import { buildEntitiesFromTracks } from './filters.js';

export const ENTITY_NOUNS = {
    track: { one: "track", many: "tracks" },
    album: { one: "album", many: "albums" },
    artist: { one: "artist", many: "artists" }
};

// Same grouping keys as buildEntitiesFromTracks("scrobbles").
export function scrobbleKey(type, scrobble) {
    const artist = (scrobble.Artist || "").toLowerCase();
    if (type === "artist") return artist;
    if (type === "album") return `${(scrobble.Album || "").toLowerCase()}||${artist}`;
    return `${artist} - ${(scrobble.Track || "").toLowerCase()}`;
}

export function entityKey(type, name, artist) {
    if (type === "artist") return (name || "").toLowerCase();
    if (type === "album") return `${(name || "").toLowerCase()}||${(artist || "").toLowerCase()}`;
    return `${(artist || "").toLowerCase()} - ${(name || "").toLowerCase()}`;
}

// The key of a row produced by buildEntitiesFromTracks, whatever the sort.
export function resultEntityKey(type, entity) {
    if (type === "track") return entityKey("track", entity.Track, entity.Artist);
    return entityKey(type, entity.name, entity.artist);
}

function countByKey(scrobbles, type) {
    const counts = new Map();
    for (const scrobble of scrobbles) {
        const key = scrobbleKey(type, scrobble);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

// { count, rank, entries } for one key in a first-appearance-ordered Map.
// Zero plays has no rank.
export function rankInCounts(counts, key) {
    const entries = counts ? counts.size : 0;
    const count = counts ? counts.get(key) || 0 : 0;
    if (!count) return { count: 0, rank: null, entries };
    let rank = 1;
    let seenSelf = false;
    for (const [otherKey, otherCount] of counts) {
        if (otherKey === key) { seenSelf = true; continue; }
        if (otherCount > count || (!seenSelf && otherCount === count)) rank++;
    }
    return { count, rank, entries };
}

// ---- Caches tied to one loaded history ----

let cacheSource = null;
let cacheLength = -1;
let caches = null;

function getCaches() {
    const tracks = state.allTracks || [];
    if (caches && cacheSource === tracks && cacheLength === tracks.length) return caches;
    cacheSource = tracks;
    cacheLength = tracks.length;
    caches = { library: {}, periods: {}, sorts: new Map() };
    return caches;
}

export function libraryCounts(type) {
    const store = getCaches().library;
    if (!store[type]) store[type] = countByKey(state.allTracks, type);
    return store[type];
}

function pad(number) {
    return String(number).padStart(2, "0");
}

export function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function mondayOf(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
}

// One pass over the history, counting every entity per year, per month and
// per Monday-to-Sunday week in the local calendar.
function periodIndex(type) {
    const store = getCaches().periods;
    if (store[type]) return store[type];
    const years = new Map();
    const months = new Map();
    const weeks = new Map();
    const bump = (outer, bucket, key) => {
        let inner = outer.get(bucket);
        if (!inner) { inner = new Map(); outer.set(bucket, inner); }
        inner.set(key, (inner.get(key) || 0) + 1);
    };
    let lastDayStamp = null;
    let lastWeekKey = null;
    for (const scrobble of state.allTracks) {
        const date = new Date(Number(scrobble.Date));
        const key = scrobbleKey(type, scrobble);
        const year = date.getFullYear();
        bump(years, year, key);
        bump(months, `${year}-${pad(date.getMonth() + 1)}`, key);
        // Plays arrive in time order, so the week only needs working out once per day.
        const dayStamp = year * 400 + date.getMonth() * 32 + date.getDate();
        if (dayStamp !== lastDayStamp) {
            lastDayStamp = dayStamp;
            lastWeekKey = isoDate(mondayOf(date));
        }
        bump(weeks, lastWeekKey, key);
    }
    store[type] = { years, months, weeks };
    return store[type];
}

export function historyBounds() {
    const tracks = state.allTracks;
    if (!tracks.length) return null;
    return { first: Number(tracks[0].Date), last: Number(tracks[tracks.length - 1].Date) };
}

// ---- Queries a ranking row opens. Shape is what openListQuery expects. ----

function listQuery(type, filters = {}, sortingBasis = "scrobbles", xValue = "") {
    return { entityType: type, sortingBasis, xValue: xValue === "" ? "" : String(xValue), filters };
}

function rankedLink(label, result, query, extra = {}) {
    return { label, count: result.count, rank: result.rank, entries: result.entries, query, ...extra };
}

// ---- The page's sections ----

function scanCounts(type, predicate) {
    const counts = new Map();
    for (const scrobble of state.allTracks) {
        if (!predicate(scrobble)) continue;
        const key = scrobbleKey(type, scrobble);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function titleOf(type, scrobble) {
    if (type === "artist") return scrobble.Artist || "";
    if (type === "album") return scrobble.Album || "";
    return scrobble.Track || "";
}

export function overview(entity) {
    const { type, key } = entity;
    let first = null, last = null;
    const albumCounts = new Map();
    for (const scrobble of state.allTracks) {
        if (scrobbleKey(type, scrobble) !== key) continue;
        const time = Number(scrobble.Date);
        if (first === null) first = time;
        last = time;
        if (type === "track" && scrobble.Album && scrobble.Album !== "Unknown") {
            albumCounts.set(scrobble.Album, (albumCounts.get(scrobble.Album) || 0) + 1);
        }
    }
    let topAlbum = null, topAlbumCount = 0;
    albumCounts.forEach((count, album) => {
        if (count > topAlbumCount) { topAlbum = album; topAlbumCount = count; }
    });
    const library = rankInCounts(libraryCounts(type), key);
    return {
        first,
        last,
        topAlbum,
        library: rankedLink("Your whole library", library, listQuery(type))
    };
}

export function artistRank(entity) {
    if (entity.type === "artist") return null;
    const artist = entity.artist.toLowerCase();
    const result = rankInCounts(scanCounts(entity.type, s => s.Artist.toLowerCase() === artist), entity.key);
    return rankedLink(`Among ${entity.artist}'s ${ENTITY_NOUNS[entity.type].many}`, result,
        listQuery(entity.type, { "artist-name": entity.artist }));
}

// Matches the "<type>-initial" filter: the first UTF-16 character, compared
// without case. "The" is not skipped.
export function initialRank(entity) {
    const initial = (entity.name || "").charAt(0);
    if (!initial) return null;
    const lower = initial.toLowerCase();
    const result = rankInCounts(scanCounts(entity.type, s => (titleOf(entity.type, s).charAt(0) || "").toLowerCase() === lower), entity.key);
    return rankedLink(`Names starting with “${initial.toUpperCase()}”`, result,
        listQuery(entity.type, { [`${entity.type}-initial`]: initial }));
}

// Matches the name-length filters, which count characters including spaces.
export function nameLengthRank(entity) {
    const length = (entity.name || "").length;
    const result = rankInCounts(scanCounts(entity.type, s => titleOf(entity.type, s).length === length), entity.key);
    return rankedLink(`Names with ${length} characters`, result,
        listQuery(entity.type, {
            [`${entity.type}-name-length-min`]: String(length),
            [`${entity.type}-name-length-max`]: String(length)
        }));
}

export const RECENT_DAY_WINDOWS = [7, 30, 90, 365];

export function recentRanks(entity) {
    const now = Date.now();
    return RECENT_DAY_WINDOWS.map(days => {
        const result = rankInCounts(scanCounts(entity.type, s => now - Number(s.Date) <= days * 86400000), entity.key);
        return rankedLink(`Last ${days} days`, result, listQuery(entity.type, { "last-n-days": String(days) }));
    });
}

export function yearRanks(entity) {
    const bounds = historyBounds();
    if (!bounds) return [];
    const { years } = periodIndex(entity.type);
    const firstYear = new Date(bounds.first).getFullYear();
    const lastYear = new Date(bounds.last).getFullYear();
    const links = [];
    for (let year = firstYear; year <= lastYear; year++) {
        links.push(rankedLink(String(year), rankInCounts(years.get(year), entity.key),
            listQuery(entity.type, { year: String(year) }), { year, highlightLabel: `In ${year}` }));
    }
    return links;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

export function monthName(index) {
    return MONTH_NAMES[index];
}

export function monthRanks(entity, year) {
    const { months } = periodIndex(entity.type);
    const links = [];
    for (let month = 1; month <= 12; month++) {
        links.push(rankedLink(`${MONTH_NAMES[month - 1]} ${year}`,
            rankInCounts(months.get(`${year}-${pad(month)}`), entity.key),
            listQuery(entity.type, { year: String(year), month: String(month) }),
            { year, month, highlightLabel: `In ${MONTH_NAMES[month - 1]} ${year}` }));
    }
    return links;
}

export function allMonthRanks(entity) {
    return yearRanks(entity).flatMap(link => monthRanks(entity, link.year));
}

function shortDate(date) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function weekRanks(entity) {
    const bounds = historyBounds();
    if (!bounds) return [];
    const { weeks } = periodIndex(entity.type);
    const links = [];
    const week = mondayOf(new Date(bounds.first));
    const end = mondayOf(new Date(bounds.last));
    while (week <= end) {
        const sunday = new Date(week.getFullYear(), week.getMonth(), week.getDate() + 6);
        const start = isoDate(week);
        const stop = isoDate(sunday);
        links.push(rankedLink(`${shortDate(week)} to ${shortDate(sunday)}`,
            rankInCounts(weeks.get(start), entity.key),
            listQuery(entity.type, { "date-range-start": start, "date-range-end": stop }),
            { startYear: week.getFullYear(), endYear: sunday.getFullYear(), highlightLabel: `In the week of ${shortDate(week)}` }));
        week.setDate(week.getDate() + 7);
    }
    return links;
}

// ---- Rankings by the other sorting modes ----

export const STREAK_SORTS = ["consecutive-scrobbles", "consecutive-days", "consecutive-weeks", "consecutive-months"];
export const MILESTONE_SORTS = ["first-n-scrobbles", "fastest-n-scrobbles"];
const METADATA_SORTS = ["time-spent-listening", "highest-listening-percentage"];
export const OTHER_SORTS = [
    "separate-days", "separate-weeks", "separate-months",
    "max-single-day", "max-single-week", "max-single-month",
    "max-rolling-24h", "max-rolling-168h", "max-rolling-xh",
    "oldest-average-listening-time", "newest-average-listening-time",
    ...METADATA_SORTS
];
// X for the sorts that take one, apart from the milestones.
const DEFAULT_SORT_X = 10;

const SORT_LABELS = {
    "separate-days": "Different days played",
    "separate-weeks": "Different weeks played",
    "separate-months": "Different months played",
    "consecutive-scrobbles": "Longest run of plays in a row",
    "consecutive-days": "Longest streak of days",
    "consecutive-weeks": "Longest streak of weeks",
    "consecutive-months": "Longest streak of months",
    "first-n-scrobbles": "First to X plays",
    "fastest-n-scrobbles": "Fastest to X plays",
    "oldest-average-listening-time": "Oldest average play date (X+ plays)",
    "newest-average-listening-time": "Newest average play date (X+ plays)",
    "max-single-day": "Most plays in one day",
    "max-single-week": "Most plays in one week",
    "max-single-month": "Most plays in one month",
    "max-rolling-xh": "Most plays within X hours",
    "max-rolling-24h": "Most plays within 24 hours",
    "max-rolling-168h": "Most plays within 168 hours",
    "time-spent-listening": "Time spent listening",
    "highest-listening-percentage": "Share of all Last.fm plays"
};

function formatDay(timestamp) {
    if (!timestamp) return "";
    return shortDate(new Date(Number(timestamp)));
}

// A short value for a ranking row, in the units of its sort.
export function sortMetricText(sort, entity, x) {
    switch (sort) {
        case "separate-days": return `${entity.count} days`;
        case "separate-weeks": return `${entity.count} weeks`;
        case "separate-months": return `${entity.count} months`;
        case "consecutive-scrobbles": return `${entity.maxConsecutive} in a row`;
        case "consecutive-days": return `${entity.maxConsecutive} days`;
        case "consecutive-weeks": return `${entity.maxConsecutive} weeks`;
        case "consecutive-months": return `${entity.maxConsecutive} months`;
        case "max-single-day":
        case "max-single-week":
        case "max-single-month": return `${entity.count} plays (${entity.periodLabel})`;
        case "max-rolling-xh":
        case "max-rolling-24h":
        case "max-rolling-168h": return `${entity.count} plays`;
        case "first-n-scrobbles": return `reached ${x} on ${formatDay(entity.dateReached)}`;
        case "fastest-n-scrobbles": return formatDuration(entity.timeNeeded) || "under a minute";
        case "oldest-average-listening-time":
        case "newest-average-listening-time": return formatDay(entity.averageListeningTimestamp);
        case "time-spent-listening": return formatDuration(entity.listeningDuration);
        case "highest-listening-percentage": return `${(entity.listeningPercentage || 0).toFixed(2)}%`;
        default: return `${entity.count} plays`;
    }
}

export function sortLabel(sort, x) {
    return (SORT_LABELS[sort] || sort).replace("X", String(x));
}

export function sortUsesX(sort) {
    return MILESTONE_SORTS.includes(sort) || sort === "max-rolling-xh"
        || sort === "oldest-average-listening-time" || sort === "newest-average-listening-time";
}

// The whole library ranked by one sort, as key -> { rank, entity }. Cached,
// so the second entity page that needs a sort gets it for free.
function sortIndex(type, sort, x) {
    const cacheKey = `${type}|${sort}|${x}`;
    const store = getCaches().sorts;
    if (store.has(cacheKey)) return store.get(cacheKey);
    const entities = buildEntitiesFromTracks(state.allTracks, type, sort, x);
    const positions = new Map();
    entities.forEach((entity, index) => {
        const key = resultEntityKey(type, entity);
        if (!positions.has(key)) positions.set(key, { rank: index + 1, entity });
    });
    const index = { positions, size: entities.length };
    store.set(cacheKey, index);
    return index;
}

export function hasCachedSort(type, sort, x) {
    return getCaches().sorts.has(`${type}|${sort}|${x}`);
}

// One ranking link for a sort, or null when the entity is not in that list
// (a milestone it has not reached, or metadata it lacks).
export function sortRank(entity, sort, x = sortUsesX(sort) ? DEFAULT_SORT_X : "") {
    if (METADATA_SORTS.includes(sort) && !state.extendedDataLoaded) return null;
    const index = sortIndex(entity.type, sort, x);
    const hit = index.positions.get(entity.key);
    if (!hit) return null;
    if (sort === "time-spent-listening" && !(hit.entity.listeningDuration > 0)) return null;
    if (sort === "highest-listening-percentage" && !(hit.entity.listeningPercentage > 0)) return null;
    return {
        label: sortLabel(sort, x),
        count: null,
        metric: sortMetricText(sort, hit.entity, x),
        rank: hit.rank,
        entries: index.size,
        sort,
        query: listQuery(entity.type, {}, sort, x)
    };
}

export function defaultSortX(sort) {
    return sortUsesX(sort) ? DEFAULT_SORT_X : "";
}

// First/Fastest to X use 100 plays once at least ten tracks have reached
// 100, and 50 before that. Counted over the whole library on every page.
export function defaultMilestone() {
    let qualified = 0;
    for (const count of libraryCounts("track").values()) {
        if (count >= 100 && ++qualified >= 10) return 100;
    }
    return 50;
}

// ---- Highlights ----

function better(a, b) {
    if (!b) return a;
    if ((a.rank ?? Infinity) !== (b.rank ?? Infinity)) return (a.rank ?? Infinity) < (b.rank ?? Infinity) ? a : b;
    if (a.entries !== b.entries) return a.entries > b.entries ? a : b;
    return (a.count || 0) >= (b.count || 0) ? a : b;
}

function bestOf(links) {
    return links.reduce((best, link) => better(link, best), null);
}

// The #1 period with the most plays, labelled with how many other periods
// were also #1. Several nearby #1 weeks would otherwise fill every slot.
function summarizeFirsts(links, unit) {
    const firsts = links.filter(link => link.rank === 1);
    if (!firsts.length) return null;
    const best = firsts.reduce((a, b) => ((b.count || 0) > (a.count || 0) ? b : a));
    if (firsts.length === 1) return best;
    const more = firsts.length - 1;
    return { ...best, highlightLabel: `${best.highlightLabel || best.label}, and ${more} more ${more === 1 ? unit.one : unit.many}` };
}

// At most three: one year, one streak, one month or week, then another sort
// if there is room. Name-letter and name-length lists never count, because a
// rare first letter makes a #1 that means nothing.
export function pickHighlights({ years, months, weeks, streaks, others }) {
    const topTen = link => link && link.rank !== null && link.rank <= 10;
    const annual = bestOf(years.filter(topTen));
    const streak = bestOf(streaks.filter(topTen));
    const shortPeriod = bestOf([
        ...months.filter(link => topTen(link) && link.rank >= 2),
        summarizeFirsts(months, { one: "month", many: "months" }),
        summarizeFirsts(weeks, { one: "week", many: "weeks" })
    ].filter(Boolean));
    const other = bestOf(others.filter(topTen));
    return [annual, streak, shortPeriod, other].filter(Boolean).slice(0, 3);
}

// Plays per bucket for the listening graph.
export function listeningSeries(entity, start, end, requested) {
    const dayMs = 86400000;
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = Math.round((endDate - startDate) / dayMs) + 1;
    const yearLater = new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate() - 1);
    const dailyAllowed = endDate <= yearLater;
    const automatic = days <= 90 ? "day" : days <= 730 ? "week" : days <= 7300 ? "month" : "year";
    const resolution = requested === "auto" || (requested === "day" && !dailyAllowed) ? automatic : requested;

    const bucketStart = (date) => {
        if (resolution === "week") return mondayOf(date);
        if (resolution === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
        if (resolution === "year") return new Date(date.getFullYear(), 0, 1);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    };
    const nextBucket = (date) => {
        if (resolution === "week") return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
        if (resolution === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
        if (resolution === "year") return new Date(date.getFullYear() + 1, 0, 1);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    };

    const bars = [];
    const indexByStart = new Map();
    for (let cursor = bucketStart(startDate); cursor <= endDate; cursor = nextBucket(cursor)) {
        const after = nextBucket(cursor);
        const lastDay = new Date(after.getFullYear(), after.getMonth(), after.getDate() - 1);
        indexByStart.set(cursor.getTime(), bars.length);
        bars.push({
            start: cursor < startDate ? startDate : cursor,
            end: lastDay > endDate ? endDate : lastDay,
            count: 0
        });
    }
    const lowest = startDate.getTime();
    const highest = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1).getTime();
    for (const scrobble of state.allTracks) {
        const time = Number(scrobble.Date);
        if (time < lowest || time >= highest) continue;
        if (scrobbleKey(entity.type, scrobble) !== entity.key) continue;
        const index = indexByStart.get(bucketStart(new Date(time)).getTime());
        if (index !== undefined) bars[index].count++;
    }
    return { resolution, bars, dailyAllowed };
}
