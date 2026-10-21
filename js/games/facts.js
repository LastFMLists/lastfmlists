// The facts behind Odd One Out and Common Thread: statistics for the
// most-played artists, albums and tracks, the criteria built on them, and the
// round builders that turn a criterion into a fair statement.

import { state } from '../state.js';
import { getLocalDayKeyFromTimestamp } from '../time.js';
import { ftlFormatDay, ftlShuffle } from './fill-the-list.js';
import { getScrobbleIndex, indexEntities, indexEntitySequences } from './scrobble-index.js';

const DAY = 86400000;
const FACT_MIN_SCROBBLES = 5;
const FACT_POOL_LIMIT = { artist: 250, album: 400, track: 600 };

// Difficulty ramp shared by both games. Over the first 20 wins the pool
// widens from the top 50 items to the top 600, and the floor every item must
// keep from the line shrinks from 1.3x to 1.1x (120 days to 21 for dates).
// The floor is the only hard limit: items are drawn on a curve above it, so
// a round can come out easier than the floor but never harder.
const FACT_RAMP_WINS = 20;
const RATIO_CAP = 2.5;        // no item further than this from the line, so the odd one is never a giveaway
const DATE_CAP_DAYS = 1095;
const RATIO_SPREAD = 1.7;     // each step of this factor past the floor makes an item e^-1 as likely
const DATE_SPREAD_DAYS = 240;

const FACT_COOLDOWN = 5;      // a criterion used in the last five rounds sinks to the back of the queue
const RECENT_MEMORY = 12;     // items shown recently are less likely to come back
const RECENT_WEIGHT = 0.25;
const THREAD_MAX_SHARE = 0.4; // Common Thread's answer must hold for at most this share of the pool

const TYPE_NOUN = { artist: "artists", album: "albums", track: "tracks" };
const COUNT_STEPS = [3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
const DURATION_WORDS = {
    7: "a week", 14: "two weeks", 30: "a month", 60: "two months", 90: "three months",
    180: "six months", 365: "a year", 730: "two years", 1095: "three years"
};

export function factDifficulty(wins) {
    const progress = Math.min(wins / FACT_RAMP_WINS, 1);
    return {
        depth: Math.round(50 + progress * 550),
        floor: 1.3 - progress * 0.2,
        floorDays: Math.round(120 - progress * 99),
        // Common Thread: how many of the four items each wrong statement fails for.
        failing: wins < 5 ? 2 : 1
    };
}

// ---- Statistics ----

let relationsCache = null;
let statsCache = {};

// Call when a game starts, since the history may have changed since the last one.
export function resetFactStats() {
    relationsCache = null;
    statsCache = {};
}

function bump(map, outer, inner) {
    let m = map.get(outer);
    if (!m) { m = new Map(); map.set(outer, m); }
    m.set(inner, (m.get(inner) || 0) + 1);
}

// One pass over the history: which tracks and albums each artist has, which
// tracks each album has, which album each track was played from, and the
// longest back-to-back run of every artist, album and track.
function relations() {
    if (relationsCache) return relationsCache;
    const artistTracks = new Map(), artistAlbums = new Map(), albumTracks = new Map(), trackAlbums = new Map();
    const runs = { artist: new Map(), album: new Map(), track: new Map() };
    const prev = { artist: null, album: null, track: null };
    const len = { artist: 0, album: 0, track: 0 };
    for (const s of state.allTracks) {
        const A = s.Artist && s.Artist !== "Unknown" ? s.Artist.toLowerCase() : null;
        const keys = {
            artist: A,
            album: A && s.Album && s.Album !== "Unknown" ? `${s.Album.toLowerCase()}|||${A}` : null,
            track: A && s.Track && s.Track !== "Unknown" ? `${s.Track.toLowerCase()}|||${A}` : null
        };
        for (const type of ["artist", "album", "track"]) {
            const key = keys[type];
            if (!key) { prev[type] = null; len[type] = 0; continue; }
            len[type] = key === prev[type] ? len[type] + 1 : 1;
            prev[type] = key;
            if (len[type] > (runs[type].get(key) || 0)) runs[type].set(key, len[type]);
        }
        if (!A) continue;
        if (keys.track) bump(artistTracks, A, keys.track);
        if (keys.album) bump(artistAlbums, A, keys.album);
        if (keys.album && keys.track) {
            bump(albumTracks, keys.album, keys.track);
            bump(trackAlbums, keys.track, keys.album);
        }
    }
    relationsCache = { artistTracks, artistAlbums, albumTracks, trackAlbums, runs };
    return relationsCache;
}

function entityKey(type, e) {
    return type === "artist" ? e.name.toLowerCase() : `${e.name.toLowerCase()}|||${e.artist.toLowerCase()}`;
}

function nameLookup(type) {
    const map = new Map();
    for (const e of indexEntities(type)) map.set(entityKey(type, e), e.name);
    return map;
}

// The biggest entry of a count map and the one after it, leaving out skipKey.
function topTwo(map, skipKey = null) {
    let top = null, topCount = 0, second = 0;
    if (!map) return { top, topCount, second };
    for (const [k, c] of map) {
        if (k === skipKey) continue;
        if (c > topCount) { second = topCount; top = k; topCount = c; }
        else if (c > second) second = c;
    }
    return { top, topCount, second };
}

// Where key stands in a count map: its count against the best of the rest,
// and its place (1 for the most played).
function standing(map, key) {
    if (!map || !map.has(key)) return undefined;
    const own = map.get(key);
    const best = topTwo(map, key).topCount;
    if (!best) return undefined;
    let place = 1;
    for (const c of map.values()) if (c > own) place++;
    return { ratio: own / best, place, of: map.size };
}

function buildStats(type) {
    const rel = relations();
    const seq = indexEntitySequences(type);
    const trackNames = nameLookup("track");
    const albumNames = nameLookup("album");
    const ents = indexEntities(type)
        .filter(e => e.count >= FACT_MIN_SCROBBLES)
        .sort((a, b) => b.count - a.count)
        .slice(0, FACT_POOL_LIMIT[type]);

    return ents.map((e, i) => {
        const key = entityKey(type, e);
        const dates = seq.get(key)?.dates || [];
        const years = new Map(), days = new Map();
        let maxDay = 0, gap = 0;
        for (let j = 0; j < dates.length; j++) {
            const d = dates[j];
            const y = new Date(d).getFullYear();
            years.set(y, (years.get(y) || 0) + 1);
            const dk = getLocalDayKeyFromTimestamp(d);
            const c = (days.get(dk) || 0) + 1;
            days.set(dk, c);
            if (c > maxDay) maxDay = c;
            if (j && d - dates[j - 1] > gap) gap = d - dates[j - 1];
        }
        const peak = topTwo(years);
        const st = {
            key, name: e.name, artist: e.artist || null,
            count: e.count, first: e.first, last: e.last, rank: i + 1,
            dates, years, maxDay, days: days.size, gapDays: gap / DAY,
            run: rel.runs[type].get(key) || 1,
            peakYear: peak.top, peakCount: peak.topCount, peakSecond: peak.second
        };
        const artistKey = (st.artist || st.name).toLowerCase();
        if (type === "artist" || type === "album") {
            const tracks = type === "artist" ? rel.artistTracks.get(key) : rel.albumTracks.get(key);
            const tt = topTwo(tracks);
            st.distinct = tracks ? tracks.size : 0;
            st.topTrack = tt.top ? { name: trackNames.get(tt.top), count: tt.topCount, second: tt.second } : null;
        }
        if (type === "artist") {
            const albums = rel.artistAlbums.get(key);
            const ta = topTwo(albums);
            st.albumCount = albums ? albums.size : 0;
            st.topAlbum = ta.top ? { name: albumNames.get(ta.top), count: ta.topCount, second: ta.second } : null;
        }
        if (type === "album") {
            st.vsArtist = standing(rel.artistAlbums.get(artistKey), key);
        }
        if (type === "track") {
            st.vsArtist = standing(rel.artistTracks.get(artistKey), key);
            const albumKey = topTwo(rel.trackAlbums.get(key)).top;
            if (albumKey) {
                const onAlbum = standing(rel.albumTracks.get(albumKey), key);
                if (onAlbum) st.vsAlbum = { ...onAlbum, album: albumNames.get(albumKey), albumKey };
            }
        }
        return st;
    });
}

function factStats(type) {
    if (!statsCache[type]) statsCache[type] = buildStats(type);
    return statsCache[type];
}

export function factPool(type, depth) {
    return factStats(type).slice(0, depth);
}

export function factContext() {
    const years = getScrobbleIndex().years;
    return { years, lastYear: years[years.length - 1], now: Date.now() };
}

// ---- Wording helpers ----

const n = v => v.toLocaleString();
const yearStart = y => new Date(y, 0, 1).getTime();
const duration = d => DURATION_WORDS[d] || `${d} days`;
const share = p => p === 50 ? "half" : (p === 75 ? "three quarters" : `${p}%`);

function formatDays(days) {
    if (days < 1) return "under a day";
    if (days < 45) { const v = Math.round(days); return `${v} day${v === 1 ? "" : "s"}`; }
    if (days < 365) { const v = Math.round(days / 30.44); return `${v} month${v === 1 ? "" : "s"}`; }
    const y = (days / 365.25).toFixed(1).replace(/\.0$/, "");
    return `${y} year${y === "1" ? "" : "s"}`;
}

// "more than N", "fewer than N" and "between N and M" statements over a list
// of round numbers. say(kind, a, b) words each one.
function countStatements(steps, kinds, say) {
    const out = [];
    for (const t of steps) {
        if (kinds.includes("more")) out.push({ lo: t, hi: Infinity, text: say("more", t) });
        if (kinds.includes("less")) out.push({ lo: -Infinity, hi: t, text: say("less", t) });
    }
    if (kinds.includes("between")) {
        for (const a of steps) for (const b of steps) {
            if (b / a >= 1.5 && b / a <= 2) out.push({ lo: a, hi: b, text: say("between", a, b) });
        }
    }
    return out;
}

// Title without release details, for one-word and self-titled checks.
function bareTitle(name) {
    return (name || "").replace(/\s*[([].*$/, "").replace(/\s+-\s+.*$/, "").trim().toLowerCase();
}

function firstLetter(name) {
    const c = (name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : undefined;
}

// A top track or album is only a fair fact when it clearly beats the next one.
const clearTop = (top, tier) => !!top && (!top.second || top.count / top.second >= tier.floor);

// ---- Criteria ----
//
// A number criterion gives each item a value and a list of statements, each a
// range (lo, hi) the value must fall inside. A category criterion gives each
// item a label, and its statements say which label. Statement texts are
// written to follow "Three of these" and "All four".

const FACTS = [
    // Counts
    {
        id: "plays", group: "counts", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        value: st => st.count,
        statements: () => countStatements(COUNT_STEPS, ["more", "less", "between"], (k, a, b) =>
            k === "more" ? `have more than ${n(a)} scrobbles`
                : k === "less" ? `have fewer than ${n(a)} scrobbles`
                    : `have between ${n(a)} and ${n(b)} scrobbles`),
        show: st => `${n(st.count)} scrobbles`
    },
    {
        id: "yearplays", group: "counts", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        params: ctx => ctx.years,
        value: (st, y) => st.years.get(y) || 0,
        statements: y => countStatements(COUNT_STEPS.filter(t => t <= 1000), ["more", "less"], (k, a) =>
            k === "more" ? `have more than ${n(a)} scrobbles in ${y}` : `have fewer than ${n(a)} scrobbles in ${y}`),
        show: (st, y) => `${n(st.years.get(y) || 0)} in ${y}`
    },
    {
        id: "maxday", group: "counts", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        value: st => st.maxDay,
        statements: () => countStatements([3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100], ["more", "less"], (k, a) =>
            k === "more" ? `have been played more than ${a} times in one day` : `have never been played ${a} times in one day`),
        show: st => `${n(st.maxDay)} in one day`
    },
    {
        id: "days", group: "counts", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        value: st => st.days,
        statements: () => countStatements(COUNT_STEPS.filter(t => t <= 3000), ["more", "less", "between"], (k, a, b) =>
            k === "more" ? `were played on more than ${n(a)} different days`
                : k === "less" ? `were played on fewer than ${n(a)} different days`
                    : `were played on between ${n(a)} and ${n(b)} different days`),
        show: st => `${n(st.days)} days`
    },
    {
        id: "run", group: "counts", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        value: st => st.run,
        statements: () => countStatements([3, 5, 10, 15, 20, 25, 30, 40, 50], ["more", "less"], (k, a) =>
            k === "more" ? `have been played more than ${a} times in a row` : `have never been played ${a} times in a row`),
        show: st => `${n(st.run)} in a row`
    },
    {
        id: "distinct", group: "counts", types: ["artist", "album"], kind: "number", scale: "ratio",
        value: st => st.distinct,
        statements: () => countStatements([3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200], ["more", "less"], (k, a) =>
            k === "more" ? `have more than ${a} different tracks scrobbled` : `have fewer than ${a} different tracks scrobbled`),
        show: st => `${n(st.distinct)} tracks`
    },
    {
        id: "toptrackplays", group: "counts", types: ["artist", "album"], kind: "number", scale: "ratio",
        value: st => st.topTrack ? st.topTrack.count : undefined,
        statements: () => countStatements(COUNT_STEPS.filter(t => t <= 2000), ["more", "less", "between"], (k, a, b) =>
            k === "more" ? `have a most played track with more than ${n(a)} scrobbles`
                : k === "less" ? `have a most played track with fewer than ${n(a)} scrobbles`
                    : `have a most played track with between ${n(a)} and ${n(b)} scrobbles`),
        show: st => `top track ${n(st.topTrack.count)}`
    },
    {
        id: "albumcount", group: "counts", types: ["artist"], kind: "number", scale: "ratio",
        value: st => st.albumCount,
        statements: () => countStatements([3, 5, 10, 15, 20, 25, 30], ["more", "less"], (k, a) =>
            k === "more" ? `have more than ${a} different albums scrobbled` : `have fewer than ${a} different albums scrobbled`),
        show: st => `${n(st.albumCount)} albums`
    },
    {
        id: "rank", group: "counts", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        value: st => st.rank,
        statements: (p, ctx, type) => [10, 25, 50, 100, 200, 300].map(t =>
            ({ lo: -Infinity, hi: t + 0.5, text: `are in your top ${t} ${TYPE_NOUN[type]}` })),
        show: st => `#${n(st.rank)}`
    },

    // Dates
    {
        id: "first", group: "dates", types: ["artist", "album", "track"], kind: "number", scale: "days",
        value: st => st.first,
        statements: (p, ctx) => ctx.years.flatMap(y => {
            const out = [{ lo: yearStart(y), hi: yearStart(y + 1), text: `were first played in ${y}` }];
            if (y > ctx.years[0]) {
                out.push({ lo: -Infinity, hi: yearStart(y), text: `were first played before ${y}` });
                out.push({ lo: yearStart(y), hi: Infinity, text: `were first played in ${y} or later` });
            }
            return out;
        }),
        show: st => `first played ${ftlFormatDay(st.first)}`
    },
    {
        id: "last", group: "dates", types: ["artist", "album", "track"], kind: "number", scale: "days",
        value: st => st.last,
        statements: (p, ctx) => {
            const thisYear = new Date(ctx.now).getFullYear();
            // A window statement can't ask for more room than half the window.
            const windows = [30, 90, 180, 365].flatMap(w => [
                { lo: ctx.now - w * DAY, hi: Infinity, maxFloorDays: w / 2, text: `were played in the last ${w} days` },
                { lo: -Infinity, hi: ctx.now - w * DAY, maxFloorDays: w / 2, text: `haven't been played in the last ${w} days` }
            ]);
            const years = ctx.years.filter(y => y < thisYear).flatMap(y => [
                { lo: yearStart(y), hi: yearStart(y + 1), text: `were last played in ${y}` },
                { lo: -Infinity, hi: yearStart(y + 1), text: `haven't been played since ${y}` }
            ]);
            return windows.concat(years);
        },
        show: st => `last played ${ftlFormatDay(st.last)}`
    },
    {
        id: "peakyear", group: "dates", types: ["artist", "album", "track"], kind: "category",
        category: st => st.peakYear,
        clear: (st, p, tier) => !st.peakSecond || st.peakCount / st.peakSecond >= tier.floor,
        say: y => `were played most in ${y}`,
        show: st => `most in ${st.peakYear} (${n(st.peakCount)})`
    },

    // Listening shape
    {
        id: "everyyear", group: "shape", types: ["artist", "album", "track"], kind: "category", only: true,
        params: ctx => ctx.years.filter(y => ctx.lastYear - y >= 2 && ctx.lastYear - y <= 7).map(y => ({ from: y, to: ctx.lastYear })),
        category: (st, p) => {
            for (let y = p.from; y <= p.to; y++) if (!st.years.get(y)) return false;
            return true;
        },
        // A pass needs at least two plays in every one of those years, so one
        // stray play doesn't decide it.
        clear: (st, p, tier, pass) => {
            if (!pass) return true;
            for (let y = p.from; y <= p.to; y++) if ((st.years.get(y) || 0) < 2) return false;
            return true;
        },
        say: (v, p) => `were played in every year since ${p.from}`,
        show: (st, p) => {
            for (let y = p.from; y <= p.to; y++) if (!st.years.get(y)) return `none in ${y}`;
            return `every year since ${p.from}`;
        }
    },
    {
        id: "oneyear", group: "shape", types: ["artist", "album", "track"], kind: "number", scale: "ratio",
        value: st => 100 * st.peakCount / st.count,
        statements: () => countStatements([30, 40, 50, 60, 75, 90], ["more", "less"], (k, a) =>
            k === "more" ? `got more than ${share(a)} of their scrobbles in a single year`
                : `never got ${share(a)} of their scrobbles in a single year`),
        show: st => `${Math.round(100 * st.peakCount / st.count)}% in ${st.peakYear}`
    },
    {
        id: "comeback", group: "shape", types: ["artist", "album", "track"], kind: "number", scale: "ratio", absGap: 0,
        value: st => st.gapDays,
        statements: () => [180, 365, 730, 1095].map(d =>
            ({ lo: d, hi: Infinity, text: `came back after a break of more than ${duration(d)}` })),
        show: st => `longest break ${formatDays(st.gapDays)}`
    },
    {
        id: "daysto", group: "shape", types: ["artist", "album", "track"], kind: "number", scale: "ratio", absGap: 0,
        params: () => [50, 100],
        value: (st, m) => st.dates.length >= m ? (st.dates[m - 1] - st.dates[0]) / DAY : undefined,
        statements: m => countStatements([7, 14, 30, 60, 90, 180, 365, 730], ["more", "less"], (k, a) =>
            k === "less" ? `reached ${m} scrobbles within ${duration(a)} of the first`
                : `took more than ${duration(a)} to reach ${m} scrobbles`),
        show: (st, m) => `${m} in ${formatDays((st.dates[m - 1] - st.dates[0]) / DAY)}`
    },

    // Names that aren't on screen
    {
        id: "toptrackletter", group: "names", types: ["artist", "album"], kind: "category",
        category: st => st.topTrack ? firstLetter(st.topTrack.name) : undefined,
        clear: (st, p, tier) => clearTop(st.topTrack, tier),
        say: c => `have a most played track starting with ${c}`,
        show: st => `top track: ${st.topTrack.name}`
    },
    {
        id: "toptrackoneword", group: "names", types: ["artist", "album"], kind: "category", only: true,
        category: st => st.topTrack ? !/\s/.test(bareTitle(st.topTrack.name)) : undefined,
        clear: (st, p, tier) => clearTop(st.topTrack, tier),
        say: () => `have a most played track with a one-word title`,
        show: st => `top track: ${st.topTrack.name}`
    },
    {
        id: "selftitled", group: "names", types: ["artist"], kind: "category", only: true,
        category: st => st.topAlbum ? bareTitle(st.topAlbum.name) === bareTitle(st.name) : undefined,
        clear: (st, p, tier) => clearTop(st.topAlbum, tier),
        say: () => `have a self-titled album as their most played album`,
        show: st => `top album: ${st.topAlbum.name}`
    },

    // Where an item stands among its artist's or album's other items. The value
    // is its play count against the best of the rest, so above 1 means first.
    // sharedBy names what the item is compared within: two tracks from one
    // album can't both be its #1, so a round never holds two that share it.
    {
        id: "artisttoptrack", group: "relations", types: ["track"], kind: "number", scale: "ratio", absGap: 0, cap: Infinity,
        sharedBy: st => st.artist.toLowerCase(),
        value: st => st.vsArtist?.ratio,
        statements: () => [{ lo: 1, hi: Infinity, text: "are your most played track by their artist" }],
        show: st => `#${st.vsArtist.place} of ${st.vsArtist.of} by ${st.artist}`
    },
    {
        id: "albumtoptrack", group: "relations", types: ["track"], kind: "number", scale: "ratio", absGap: 0, cap: Infinity,
        sharedBy: st => st.vsAlbum?.albumKey,
        value: st => st.vsAlbum?.ratio,
        statements: () => [{ lo: 1, hi: Infinity, text: "are the most played track on their album" }],
        show: st => `#${st.vsAlbum.place} on ${st.vsAlbum.album}`
    },
    {
        id: "artisttopalbum", group: "relations", types: ["album"], kind: "number", scale: "ratio", absGap: 0, cap: Infinity,
        sharedBy: st => st.artist.toLowerCase(),
        value: st => st.vsArtist?.ratio,
        statements: () => [{ lo: 1, hi: Infinity, text: "are your most played album by their artist" }],
        show: st => `#${st.vsArtist.place} of ${st.vsArtist.of} by ${st.artist}`
    }
];

// ---- Judging items against a statement ----

function distance(fact, v, bound) {
    if (fact.scale === "days") return Math.abs(v - bound) / DAY;
    const hi = Math.max(v, bound), lo = Math.max(Math.min(v, bound), 0.5);
    return hi / lo;
}

// Whether an item passes a statement, whether it does so clearly enough to be
// fair at this tier, and how likely it is to be drawn: the further past the
// floor, the less likely. Returns null when the criterion has no value for it.
function judge(stmt, st, tier) {
    const fact = stmt.fact;
    if (fact.kind === "category") {
        const c = fact.category(st, stmt.param);
        if (c === undefined || c === null) return null;
        const pass = c === stmt.value;
        return { pass, clear: fact.clear ? fact.clear(st, stmt.param, tier, pass) : true, weight: 1 };
    }
    const v = fact.value(st, stmt.param);
    if (typeof v !== "number" || Number.isNaN(v)) return null;
    const pass = v > stmt.lo && v < stmt.hi;
    const days = fact.scale === "days";
    let need = days ? Math.min(tier.floorDays, stmt.maxFloorDays ?? Infinity) : tier.floor;
    const cap = days ? DATE_CAP_DAYS : (fact.cap ?? RATIO_CAP);
    let bound, capped = true;
    if (pass) {
        const bounds = [stmt.lo, stmt.hi].filter(isFinite);
        bound = bounds.reduce((best, b) => distance(fact, v, b) < distance(fact, v, best) ? b : best);
        // Inside a range with two ends, the room is shared between them.
        if (bounds.length === 2) {
            need = days ? need / 2 : Math.sqrt(need);
            capped = false;
        }
    } else {
        bound = v <= stmt.lo ? stmt.lo : stmt.hi;
    }
    const near = distance(fact, v, bound);
    const absGap = days ? 0 : (fact.absGap ?? 2);
    const clear = near >= need && (!capped || near <= cap) && Math.abs(v - bound) >= absGap;
    const weight = days
        ? Math.exp(-(near - need) / DATE_SPREAD_DAYS)
        : Math.exp(-Math.log(near / need) / Math.log(RATIO_SPREAD));
    return { pass, clear, weight };
}

function statementsFor(fact, param, ctx, pool, type) {
    if (fact.kind === "category") {
        const values = new Set();
        for (const st of pool) {
            const c = fact.category(st, param);
            if (c !== undefined && c !== null && (fact.only === undefined || c === fact.only)) values.add(c);
        }
        return [...values].map(value => ({ fact, param, value, text: fact.say(value, param, type) }));
    }
    return fact.statements(param, ctx, type).map(s => ({ fact, param, ...s }));
}

export function showFact(stmt, st) {
    return stmt.fact.show(st, stmt.param);
}

export function statementHolds(stmt, st) {
    const fact = stmt.fact;
    if (fact.kind === "category") return fact.category(st, stmt.param) === stmt.value;
    const v = fact.value(st, stmt.param);
    return typeof v === "number" && v > stmt.lo && v < stmt.hi;
}

// ---- Variety ----

export function createFactMemory() {
    return { round: 0, factLastUsed: new Map(), groupLastUsed: new Map(), recent: [], lastSet: "" };
}

// Criteria for the main statement of a round. Anything used in the last few
// rounds goes to the back, and so does the group used in the last round or
// two, so a run doesn't ask about counts three times in a row.
function queuedFacts(type, memory) {
    return FACTS
        .filter(f => f.types.includes(type))
        .map(f => {
            let score = Math.random() * 5;
            const last = memory.factLastUsed.get(f.id);
            const age = last === undefined ? Infinity : memory.round - last;
            if (age < FACT_COOLDOWN) score += (FACT_COOLDOWN - age) * 10;
            const lastGroup = memory.groupLastUsed.get(f.group);
            const groupAge = lastGroup === undefined ? Infinity : memory.round - lastGroup;
            if (groupAge === 1) score += 8;
            else if (groupAge === 2) score += 4;
            return { f, score };
        })
        .sort((a, b) => a.score - b.score)
        .map(x => x.f);
}

function paramsFor(fact, ctx) {
    return fact.params ? ftlShuffle([...fact.params(ctx)]) : [undefined];
}

// Draw n items without replacement, by weight. Recently shown items keep a
// quarter of theirs, so they can still come back in a small library. With
// apart, no two items share its key, nor any key already in taken; the keys
// drawn are added to taken.
function weightedPick(list, n, memory, apart = null, taken = new Set()) {
    let left = list
        .filter(x => !apart || !taken.has(apart(x.st)))
        .map(x => ({ ...x, w: x.j.weight * (memory.recent.includes(x.st.key) ? RECENT_WEIGHT : 1) }));
    const out = [];
    while (out.length < n) {
        if (!left.length) return null;
        const total = left.reduce((s, x) => s + x.w, 0);
        let r = Math.random() * total;
        let i = 0;
        while (i < left.length - 1 && r >= left[i].w) { r -= left[i].w; i++; }
        const [picked] = left.splice(i, 1);
        out.push(picked);
        if (apart) {
            const key = apart(picked.st);
            taken.add(key);
            left = left.filter(x => apart(x.st) !== key);
        }
    }
    return out;
}

// Whether no two items share what the criterion compares them within.
function itemsApart(fact, items) {
    if (!fact.sharedBy) return true;
    return new Set(items.map(fact.sharedBy)).size === items.length;
}

const setSignature = items => items.map(x => x.st.key).sort().join("\n");

function remember(memory, mainFact, items) {
    memory.factLastUsed.set(mainFact.id, memory.round);
    memory.groupLastUsed.set(mainFact.group, memory.round);
    memory.lastSet = setSignature(items);
    for (const x of items) {
        memory.recent = memory.recent.filter(k => k !== x.st.key);
        memory.recent.push(x.st.key);
    }
    while (memory.recent.length > RECENT_MEMORY) memory.recent.shift();
}

function judgedPool(stmt, pool, tier) {
    const out = [];
    for (const st of pool) {
        const j = judge(stmt, st, tier);
        if (j) out.push({ st, j });
    }
    return out;
}

// ---- Odd One Out ----

// Three items that clearly pass a statement and one that clearly fails it.
export function buildOddRound(type, wins, memory, ctx) {
    memory.round++;
    const tier = factDifficulty(wins);
    const pool = factPool(type, tier.depth);
    for (const fact of queuedFacts(type, memory)) {
        for (const param of paramsFor(fact, ctx)) {
            const stmts = ftlShuffle(statementsFor(fact, param, ctx, pool, type)).slice(0, 25);
            for (const stmt of stmts) {
                const judged = judgedPool(stmt, pool, tier).filter(x => x.j.clear);
                const taken = new Set();
                const three = weightedPick(judged.filter(x => x.j.pass), 3, memory, fact.sharedBy, taken);
                const one = three && weightedPick(judged.filter(x => !x.j.pass), 1, memory, fact.sharedBy, taken);
                if (!one) continue;
                const items = [...three, ...one];
                if (setSignature(items) === memory.lastSet) continue;
                remember(memory, fact, items);
                return {
                    stmt,
                    oddKey: one[0].st.key,
                    items: ftlShuffle(items.map(x => x.st))
                };
            }
        }
    }
    return null;
}

// ---- Common Thread ----

// A wrong statement for these four items: one that fails for exactly `failing`
// of them, each clearly, and holds for the rest.
function findDistractor(fact, items, failing, tier, ctx, pool, type) {
    if (!itemsApart(fact, items)) return null;
    for (const param of paramsFor(fact, ctx)) {
        const stmts = ftlShuffle(statementsFor(fact, param, ctx, pool, type));
        for (const stmt of stmts) {
            let fails = 0, ok = true;
            for (const st of items) {
                const j = judge(stmt, st, tier);
                if (!j) { ok = false; break; }
                if (!j.pass) {
                    if (!j.clear) { ok = false; break; }
                    fails++;
                }
            }
            if (ok && fails === failing) return stmt;
        }
    }
    return null;
}

// Three wrong statements from three other criteria. Each pick tries criteria
// from groups not yet in the round first, and the four statements must cover
// at least three groups.
function pickDistractors(type, items, answer, tier, ctx, pool, memory) {
    const candidates = queuedFacts(type, memory).filter(f => f !== answer.fact);
    // Fall back to more failing items, which only makes a round easier.
    for (let failing = tier.failing; failing <= 3; failing++) {
        const chosen = [];
        const groups = new Set([answer.fact.group]);
        const remaining = [...candidates];
        const tryPick = (allowSeenGroup) => {
            for (let i = 0; i < remaining.length; i++) {
                const fact = remaining[i];
                if (!allowSeenGroup && groups.has(fact.group)) continue;
                remaining.splice(i--, 1);
                const stmt = findDistractor(fact, items, failing, tier, ctx, pool, type);
                if (stmt) { chosen.push(stmt); groups.add(fact.group); return true; }
            }
            return false;
        };
        while (chosen.length < 3) {
            // A repeated group is fine only while the open slots can still bring in a third.
            const mustBeNew = 3 - chosen.length <= 3 - groups.size;
            if (!tryPick(false) && (mustBeNew || !tryPick(true))) break;
        }
        if (chosen.length === 3) return chosen;
    }
    return null;
}

// Four items that all clearly pass a statement that holds for few of the
// pool, and three wrong statements that each fail for one or two of them.
export function buildThreadRound(type, wins, memory, ctx) {
    memory.round++;
    const tier = factDifficulty(wins);
    const pool = factPool(type, tier.depth);
    for (const fact of queuedFacts(type, memory)) {
        for (const param of paramsFor(fact, ctx)) {
            const stmts = ftlShuffle(statementsFor(fact, param, ctx, pool, type)).slice(0, 25);
            for (const stmt of stmts) {
                const judged = judgedPool(stmt, pool, tier);
                if (!judged.length || judged.filter(x => x.j.pass).length / judged.length > THREAD_MAX_SHARE) continue;
                const passers = judged.filter(x => x.j.pass && x.j.clear);
                for (let attempt = 0; attempt < 4; attempt++) {
                    const four = weightedPick(passers, 4, memory, fact.sharedBy);
                    if (!four) break;
                    if (setSignature(four) === memory.lastSet) continue;
                    const items = four.map(x => x.st);
                    const wrong = pickDistractors(type, items, stmt, tier, ctx, pool, memory);
                    if (!wrong) continue;
                    remember(memory, fact, four);
                    return {
                        answer: stmt,
                        statements: ftlShuffle([stmt, ...wrong]),
                        items: ftlShuffle(items)
                    };
                }
            }
        }
    }
    return null;
}
