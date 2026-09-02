// Fill the List: name as many of a generated top ten as you can.

import { escapeHTML } from '../dom.js';
import { state } from '../state.js';
import { getLocalDayKeyFromTimestamp } from '../time.js';
import { gamesRecords, saveGamesRecords } from './records.js';
import {
    FTL_MIN_SCROBBLES,
    getScrobbleIndex,
    indexEntities,
    indexEntitySequences,
    rebuildScrobbleIndex,
    toScrobbleTime
} from './scrobble-index.js';

const FTL_MIN_ANSWERS = 10;    // a puzzle needs at least this many valid entries
const FTL_LIST_SIZE = 10;      // you name the top 10
const FTL_SEQUENCE_BUCKET = 10000; // scrobble-sequence window size
const FTL_ENTITY_NOUN = { artist: "artists", album: "albums", track: "tracks" };
export const FTL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Common title words. The meta-filter drops any that don't yield a full list.
const FTL_WORDS = [
    "love", "night", "time", "heart", "home", "dead", "blue", "black", "light", "world",
    "fire", "dream", "day", "girl", "baby", "rain", "sun", "gold", "life", "god",
    "dance", "sky", "moon", "star", "lost", "city", "blood", "cold", "wild", "young",
    "free", "alone", "good", "bad", "high", "red", "white", "king", "run", "eyes",
    "heaven", "hell", "angel", "devil", "boy", "man", "woman", "friend", "money", "party",
    "summer", "winter", "beautiful", "crazy", "sweet", "little", "hard", "soft", "slow", "fast",
    "dark", "shadow", "ghost", "dream", "sleep", "wake", "gone", "stay", "leave", "fall",
    "rise", "burn", "break", "hold", "feel", "know", "want", "need", "song", "music",
    "one", "two", "everything", "nothing", "forever", "tonight", "yesterday", "tomorrow", "again", "away"
];

let ftlState = null;

// Meta-filter: drop entries under FTL_MIN_SCROBBLES, reject if fewer than
// FTL_MIN_ANSWERS remain, otherwise return the top FTL_LIST_SIZE by count.
function ftlFinalize(entities) {
    const valid = entities.filter(e => e.count >= FTL_MIN_SCROBBLES);
    if (valid.length < FTL_MIN_ANSWERS) return null;
    valid.sort((a, b) => b.count - a.count);
    return valid.slice(0, FTL_LIST_SIZE).map(e => ({ name: e.name, artist: e.artist || null, count: e.count }));
}

// Like ftlFinalize but ranks by an arbitrary metric (for streak/first/fastest).
// detailFn(row) produces the text shown on reveal instead of the scrobble total.
function ftlFinalizeBy(rows, ascending, detailFn) {
    if (rows.length < FTL_MIN_ANSWERS) return null;
    rows.sort((a, b) => ascending ? a.metric - b.metric : b.metric - a.metric);
    return rows.slice(0, FTL_LIST_SIZE).map(r => ({
        name: r.name,
        artist: r.artist || null,
        count: r.count,
        detail: detailFn ? detailFn(r) : null
    }));
}

export function ftlFormatDay(ts) {
    const d = new Date(ts);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
function ftlFormatDuration(ms) {
    const days = ms / 86400000;
    if (days < 1) { const h = Math.max(1, Math.round(ms / 3600000)); return `${h} hour${h === 1 ? "" : "s"}`; }
    if (days < 45) { const n = Math.max(1, Math.round(days)); return `${n} day${n === 1 ? "" : "s"}`; }
    if (days < 365) { const n = Math.round(days / 30); return `${n} month${n === 1 ? "" : "s"}`; }
    const y = days / 365;
    return `${y.toFixed(y < 10 ? 1 : 0)} years`;
}

// Scrobble-level ranking; pred receives (date, scrobble).
function ftlRankScrobbles(pred, type) {
    const counts = new Map();
    for (const s of state.allTracks) {
        const d = toScrobbleTime(s.Date);
        if (!d || !pred(d, s)) continue;
        let name, artist = null, key;
        if (type === "artist") {
            name = s.Artist;
            if (!name || name === "Unknown") continue;
            key = name.toLowerCase();
        } else if (type === "album") {
            name = s.Album; artist = s.Artist;
            if (!name || name === "Unknown" || !artist || artist === "Unknown") continue;
            key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
        } else {
            name = s.Track; artist = s.Artist;
            if (!name || name === "Unknown" || !artist || artist === "Unknown") continue;
            key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
        }
        let e = counts.get(key);
        if (!e) { e = { name, artist, count: 0 }; counts.set(key, e); }
        e.count++;
    }
    return ftlFinalize([...counts.values()]);
}

export function ftlRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function ftlSeen(key) { return !!(ftlState && ftlState.seen && ftlState.seen.has(key)); }

// ---- Facet generators: each returns { prompt, answers, key } or null.
// The `key` is the per-session signature; a generator returns null if that exact
// puzzle was already served this session (so nothing repeats until reload).
function ftlGenYear(type) {
    const { years } = getScrobbleIndex();
    if (!years.length) return null;
    const y = ftlRandom(years);
    const key = `year:${type}:${y}`;
    if (ftlSeen(key)) return null;
    const answers = ftlRankScrobbles(d => new Date(d).getFullYear() === y, type);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} of ${y}`, answers, key };
}
function ftlGenMonth(type) {
    const m = Math.floor(Math.random() * 12);
    const key = `month:${type}:${m}`;
    if (ftlSeen(key)) return null;
    const answers = ftlRankScrobbles(d => new Date(d).getMonth() === m, type);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} across every ${FTL_MONTHS[m]}`, answers, key };
}
function ftlGenYearMonth(type) {
    const { years } = getScrobbleIndex();
    if (!years.length) return null;
    const y = ftlRandom(years);
    const m = Math.floor(Math.random() * 12);
    const key = `yearmonth:${type}:${y}-${m}`;
    if (ftlSeen(key)) return null;
    const answers = ftlRankScrobbles(d => { const dt = new Date(d); return dt.getFullYear() === y && dt.getMonth() === m; }, type);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} of ${FTL_MONTHS[m]} ${y}`, answers, key };
}
function ftlGenLastDays(type) {
    const n = ftlRandom([7, 30, 90, 180, 365]);
    const key = `lastdays:${type}:${n}`;
    if (ftlSeen(key)) return null;
    const cutoff = Date.now() - n * 86400000;
    const answers = ftlRankScrobbles(d => d >= cutoff, type);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} of the last ${n} days`, answers, key };
}
function ftlGenInitial(type) {
    const letters = new Set();
    for (const e of indexEntities(type)) {
        const c = (e.name || "").trim()[0];
        if (c && /[a-z0-9]/i.test(c)) letters.add(c.toUpperCase());
    }
    if (!letters.size) return null;
    const L = ftlRandom([...letters]);
    const key = `initial:${type}:${L}`;
    if (ftlSeen(key)) return null;
    const answers = ftlFinalize(indexEntities(type).filter(e => (e.name || "").trim().toUpperCase().startsWith(L)));
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} starting with “${L}”`, answers, key };
}
function ftlGenWord(type) {
    const w = ftlRandom(FTL_WORDS);
    const key = `word:${type}:${w}`;
    if (ftlSeen(key)) return null;
    const re = new RegExp(`\\b${w}`, "i");
    const answers = ftlFinalize(indexEntities(type).filter(e => re.test(e.name || "")));
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} with “${w}” in the name`, answers, key };
}
function ftlGenArtistLength() {
    const len = 3 + Math.floor(Math.random() * 4); // 3–6
    const key = `alen:${len}`;
    if (ftlSeen(key)) return null;
    const answers = ftlFinalize(indexEntities("artist").filter(e => (e.name || "").replace(/\s/g, "").length === len));
    return answers && { prompt: `Top artists whose name is ${len} characters long, not counting spaces`, answers, key };
}
function ftlGenTrackLength() {
    const len = 3 + Math.floor(Math.random() * 7); // 3–9
    const key = `tlen:${len}`;
    if (ftlSeen(key)) return null;
    const answers = ftlFinalize(indexEntities("track").filter(e => (e.name || "").replace(/\s/g, "").length === len));
    return answers && { prompt: `Top tracks whose title is ${len} characters long, not counting spaces`, answers, key };
}
function ftlGenDiscovery(type) {
    const { years } = getScrobbleIndex();
    if (!years.length) return null;
    const y = ftlRandom(years);
    const key = `disc:${type}:${y}`;
    if (ftlSeen(key)) return null;
    const answers = ftlFinalize(indexEntities(type).filter(e => new Date(e.first).getFullYear() === y));
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} you first scrobbled in ${y}`, answers, key };
}
function ftlGenDormant(type) {
    const n = Math.random() < 0.5 ? 30 : 365;
    const key = `dormant:${type}:${n}`;
    if (ftlSeen(key)) return null;
    const cutoff = Date.now() - n * 86400000;
    const label = n === 30 ? "a month" : "a year";
    const answers = ftlFinalize(indexEntities(type).filter(e => e.last < cutoff));
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} you haven't played in over ${label}`, answers, key };
}
function ftlGenOneHit() {
    const key = "onehit";
    if (ftlSeen(key)) return null;
    const answers = ftlFinalize(indexEntities("artist").filter(e => e.trackCount === 1));
    return answers && { prompt: `Top artists you've only scrobbled one track from`, answers, key };
}
function ftlGenByArtist(type) {
    const pool = getScrobbleIndex().byArtistEligible[type] || [];
    if (!pool.length) return null;
    for (let i = 0; i < 8; i++) {
        const a = ftlRandom(pool);
        const key = `byartist:${type}:${a.key}`;
        if (ftlSeen(key)) continue;
        const answers = ftlFinalize(indexEntities(type).filter(e => (e.artist || "").toLowerCase() === a.key));
        if (answers) return { prompt: `Top ${FTL_ENTITY_NOUN[type]} by ${a.name}`, answers, key, fixedArtist: a.name };
    }
    return null;
}
function ftlGenFirstToX(type) {
    const X = ftlRandom([50, 100, 200]);
    const key = `first:${type}:${X}`;
    if (ftlSeen(key)) return null;
    const seq = indexEntitySequences(type);
    const rows = [];
    for (const e of seq.values()) if (e.dates.length >= X) rows.push({ name: e.name, artist: e.artist, count: e.dates.length, metric: e.dates[X - 1] });
    const answers = ftlFinalizeBy(rows, true, r => `hit ${X} on ${ftlFormatDay(r.metric)}`);
    return answers && { prompt: `First ${FTL_ENTITY_NOUN[type]} to reach ${X} scrobbles`, answers, key };
}
function ftlGenFastestToX(type) {
    const X = ftlRandom([50, 100, 200]);
    const key = `fastest:${type}:${X}`;
    if (ftlSeen(key)) return null;
    const seq = indexEntitySequences(type);
    const rows = [];
    for (const e of seq.values()) if (e.dates.length >= X) rows.push({ name: e.name, artist: e.artist, count: e.dates.length, metric: e.dates[X - 1] - e.dates[0] });
    const answers = ftlFinalizeBy(rows, true, r => `${X} in ${ftlFormatDuration(r.metric)}`);
    return answers && { prompt: `Fastest ${FTL_ENTITY_NOUN[type]} to reach ${X} scrobbles`, answers, key };
}
function ftlGenSingleDay(type) {
    const key = `singleday:${type}`;
    if (ftlSeen(key)) return null;
    const seq = indexEntitySequences(type);
    const rows = [];
    for (const e of seq.values()) {
        if (e.dates.length < FTL_MIN_SCROBBLES) continue;
        const dayCounts = new Map();
        let max = 0, peak = e.dates[0];
        for (const d of e.dates) {
            const k = getLocalDayKeyFromTimestamp(d);
            const c = (dayCounts.get(k) || 0) + 1;
            dayCounts.set(k, c);
            if (c > max) { max = c; peak = d; }
        }
        rows.push({ name: e.name, artist: e.artist, count: e.dates.length, metric: max, peak });
    }
    const answers = ftlFinalizeBy(rows, false, r => `${r.metric} on ${ftlFormatDay(r.peak)}`);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} by scrobbles in a single day`, answers, key };
}
function ftlGenSeparateDays(type) {
    const key = `sepdays:${type}`;
    if (ftlSeen(key)) return null;
    const seq = indexEntitySequences(type);
    const rows = [];
    for (const e of seq.values()) {
        if (e.dates.length < FTL_MIN_SCROBBLES) continue;
        const days = new Set();
        for (const d of e.dates) days.add(getLocalDayKeyFromTimestamp(d));
        rows.push({ name: e.name, artist: e.artist, count: e.dates.length, metric: days.size });
    }
    const answers = ftlFinalizeBy(rows, false, r => `${r.metric} separate days`);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} you've played across the most separate days`, answers, key };
}
function ftlGenSequence(type) {
    const buckets = Math.floor(state.allTracks.length / FTL_SEQUENCE_BUCKET);
    if (buckets < 1) return null;
    const b = Math.floor(Math.random() * buckets);
    const key = `seq:${type}:${b}`;
    if (ftlSeen(key)) return null;
    const lo = b * FTL_SEQUENCE_BUCKET + 1;
    const hi = (b + 1) * FTL_SEQUENCE_BUCKET;
    const answers = ftlRankScrobbles((d, s) => s.order >= lo && s.order <= hi, type);
    return answers && { prompt: `Top ${FTL_ENTITY_NOUN[type]} from scrobbles ${lo.toLocaleString()} to ${hi.toLocaleString()}`, answers, key };
}

const FTL_FACETS = [
    { id: "year", cat: "time", types: ["track", "album", "artist"], gen: ftlGenYear },
    { id: "month", cat: "time", types: ["track", "album", "artist"], gen: ftlGenMonth },
    { id: "yearmonth", cat: "time", types: ["track", "album", "artist"], gen: ftlGenYearMonth },
    { id: "lastdays", cat: "time", types: ["track", "album", "artist"], gen: ftlGenLastDays },
    { id: "initial", cat: "names", types: ["track", "album", "artist"], gen: ftlGenInitial },
    { id: "word", cat: "names", types: ["track", "album", "artist"], gen: ftlGenWord },
    { id: "artistlength", cat: "names", types: ["artist"], gen: ftlGenArtistLength },
    { id: "tracklength", cat: "names", types: ["track"], gen: ftlGenTrackLength },
    { id: "discovery", cat: "deep", types: ["track", "album", "artist"], gen: ftlGenDiscovery },
    { id: "dormant", cat: "deep", types: ["track", "album", "artist"], gen: ftlGenDormant },
    { id: "onehit", cat: "deep", types: ["artist"], gen: ftlGenOneHit },
    { id: "firsttox", cat: "sorting", types: ["track", "album", "artist"], gen: ftlGenFirstToX },
    { id: "fastesttox", cat: "sorting", types: ["track", "album", "artist"], gen: ftlGenFastestToX },
    { id: "singleday", cat: "sorting", types: ["track", "album", "artist"], gen: ftlGenSingleDay },
    { id: "separatedays", cat: "sorting", types: ["track", "album", "artist"], gen: ftlGenSeparateDays },
    { id: "sequence", cat: "sorting", types: ["track", "album", "artist"], gen: ftlGenSequence },
    { id: "byartist", cat: "byartist", types: ["track", "album"], gen: ftlGenByArtist }
];

export function ftlShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function ftlEligibleFacets() {
    const { types, cats } = ftlState.options;
    return FTL_FACETS.filter(f => cats.has(f.cat) && f.types.some(t => types.has(t)));
}

function ftlEligibleCategories() {
    const set = new Set(ftlEligibleFacets().map(f => f.cat));
    return [...ftlState.options.cats].filter(c => set.has(c));
}

// Category deck: cycle through all enabled categories before repeating any.
function ftlDrawCategory() {
    const eligible = ftlEligibleCategories();
    if (!eligible.length) return null;
    if (!ftlState.categoryDeck || !ftlState.categoryDeck.length) {
        ftlState.categoryDeck = ftlShuffle(eligible.slice());
    }
    return ftlState.categoryDeck.pop();
}

// Facet pick with a short cooldown so the same facet doesn't repeat back to back.
function ftlPickFacet(category) {
    const facets = ftlEligibleFacets().filter(f => f.cat === category);
    if (!facets.length) return null;
    const weighted = facets.map(f => {
        const last = ftlState.facetLastUsed.get(f.id);
        const recent = last !== undefined && (ftlState.puzzleNum - last) < 3;
        return { f, w: recent ? 0.08 : 1 };
    });
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of weighted) { r -= x.w; if (r <= 0) return x.f; }
    return weighted[weighted.length - 1].f;
}

function ftlGeneratePuzzle() {
    ftlState.puzzleNum += 1;
    const catCount = ftlEligibleCategories().length;
    for (let c = 0; c < catCount + 1; c++) {
        const category = ftlDrawCategory();
        if (!category) break;
        for (let t = 0; t < 8; t++) {
            const facet = ftlPickFacet(category);
            if (!facet) break;
            const okTypes = facet.types.filter(ty => ftlState.options.types.has(ty));
            if (!okTypes.length) break;
            const entityType = ftlRandom(okTypes);
            const result = facet.gen(entityType);
            if (result) {
                ftlState.facetLastUsed.set(facet.id, ftlState.puzzleNum);
                ftlState.seen.add(result.key);
                return { ...result, entityType, facetId: facet.id };
            }
        }
    }
    // Fallback so the game rarely stalls: overall top list of an enabled type,
    // itself only served once per session.
    for (const type of ftlState.options.types) {
        const key = `overall:${type}`;
        if (ftlSeen(key)) continue;
        const answers = ftlFinalize(indexEntities(type));
        if (answers) {
            ftlState.seen.add(key);
            return { prompt: `Your top ${FTL_ENTITY_NOUN[type]}`, answers, entityType: type, facetId: "overall", key };
        }
    }
    return null; // everything reachable has been played this session
}

// Sporcle-style normalization: case-insensitive, punctuation/diacritics ignored,
// remaster/feat./version tails stripped. Falls back to the raw text if a title
// is entirely symbols.
function ftlNormalize(s) {
    if (!s) return "";
    let t = String(s).toLowerCase();
    t = t.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, " ");
    t = t.replace(/\s*[-–—]\s*[^-–—]*(remaster|remastered|version|edit|mix|mono|stereo|deluxe|anniversary|live|acoustic|demo|radio)[^-–—]*$/i, " ");
    t = t.replace(/\s*(feat|ft|featuring)\.?\s.*$/i, " ");
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const stripped = t.replace(/[^\p{L}\p{N}]+/gu, "");
    return stripped.length ? stripped : String(s).toLowerCase().replace(/\s+/g, "");
}

// Words that mark a parenthetical as a release qualifier rather than a title.
const FTL_QUALIFIER_WORDS = new Set([
    "remaster", "remastered", "remasters", "remastering", "version", "edition",
    "deluxe", "expanded", "anniversary", "live", "acoustic", "demo", "mono",
    "stereo", "bonus", "special", "edit", "mix", "remix", "radio", "single",
    "instrumental", "explicit", "clean", "extended", "reissue", "disc", "original",
    "soundtrack", "ost", "ep", "feat", "ft", "featuring", "cover", "karaoke",
    "session", "sessions", "unplugged", "volume", "vol", "part", "pt", "take",
    "alternate", "reprise", "interlude", "skit"
]);

// Acceptable typed forms for a title. Normally just the normalized title, but
// when the main title is non-Latin (e.g. 복합성 (Complexity)) a parenthetical
// Latin gloss is also accepted, so you can type "complexity" instead of hangul.
// A parenthetical that is a release qualifier (Special Edition, Remastered, …)
// is NOT accepted, since it isn't the title and would match several albums.
function ftlNormsFor(name) {
    const norms = new Set();
    const full = ftlNormalize(name);
    if (full) norms.add(full);
    if (!/[a-z]/.test(full)) {
        const parens = String(name).match(/[\(\[]([^\)\]]+)[\)\]]/g) || [];
        for (const p of parens) {
            const raw = p.slice(1, -1);
            const words = raw.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
            if (words.some(w => FTL_QUALIFIER_WORDS.has(w))) continue;
            const inner = ftlNormalize(raw);
            if (inner && /[a-z]/.test(inner)) norms.add(inner);
        }
    }
    return [...norms];
}

// Levenshtein distance, used to allow a small typo on an otherwise complete guess.
function ftlEditDistance(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        const ai = a.charCodeAt(i - 1);
        for (let j = 1; j <= n; j++) {
            const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[n];
}

// Index of the unfound answer the typed text completes: an exact normalized
// match, or a near-complete one (roughly full length, within ~15% typos). Never
// a prefix, so nothing auto-completes mid-title. Returns -1 if none or ambiguous.
function ftlMatchIndex(typed) {
    const answers = ftlState.puzzle.answers;
    const exact = answers.findIndex((a, i) => !ftlState.found.has(i) && a.norms.includes(typed));
    if (exact >= 0) return exact;
    if (typed.length < 4) return -1;
    const near = [];
    answers.forEach((a, i) => {
        if (ftlState.found.has(i)) return;
        for (const n of a.norms) {
            if (n.length < 4) continue;
            // Never complete a prefix: the typed text must be at least the full
            // length of the answer. That leaves room only for same-length typos
            // (or a stray extra character), so partial titles never auto-fill.
            if (typed.length < n.length) continue;
            const tol = Math.max(1, Math.round(n.length * 0.12));
            if (typed.length - n.length <= tol && ftlEditDistance(typed, n) <= tol) { near.push(i); break; }
        }
    });
    return near.length === 1 ? near[0] : -1;
}

// Accept an answer: fill its slot, clear the box, and finish if all are found.
function ftlAcceptAnswer(idx) {
    ftlState.found.add(idx);
    const input = document.getElementById("ftl-guess");
    input.value = "";
    ftlSetInputProgress(0);
    ftlMarkSlot(idx, false);
    ftlUpdateScore();
    if (ftlState.found.size === ftlState.puzzle.answers.length) ftlFinish(false);
}

// Tint the input greener as the typed text gets closer to an unfound answer.
function ftlSetInputProgress(p) {
    const input = document.getElementById("ftl-guess");
    if (!input) return;
    input.style.backgroundColor = p > 0 ? `rgba(63, 174, 107, ${(0.5 * p).toFixed(2)})` : "";
}

// Runs on every keystroke: auto-completes only once the typed text is a full
// (or near-full, small-typo) match, and colours the box by how close you are.
export function ftlOnInput() {
    if (!ftlState || ftlState.done) return;
    const input = document.getElementById("ftl-guess");
    const typed = ftlNormalize(input.value);
    if (!typed) { ftlSetInputProgress(0); return; }

    const hit = ftlMatchIndex(typed);
    if (hit >= 0) { ftlAcceptAnswer(hit); return; }

    // Colour by how far into the closest matching answer we are, so a title you
    // are typing correctly deepens toward green as it nears completion.
    let bestRatio = 0;
    for (let i = 0; i < ftlState.puzzle.answers.length; i++) {
        if (ftlState.found.has(i)) continue;
        for (const n of ftlState.puzzle.answers[i].norms) {
            if (n.startsWith(typed)) bestRatio = Math.max(bestRatio, typed.length / n.length);
        }
    }
    ftlSetInputProgress(typed.length >= 5 ? bestRatio : 0);
}

// Enter is an optional shortcut. It accepts a full/near-full match like typing
// does, plus an unambiguous prefix once you're at least halfway through the
// title (so you can skip the tail of a long one). A miss never wipes the box.
export function ftlForceGuess() {
    if (!ftlState || ftlState.done) return;
    const input = document.getElementById("ftl-guess");
    const typed = ftlNormalize(input.value);
    if (typed.length < 4) return;
    let hit = ftlMatchIndex(typed);
    if (hit < 0) {
        const m = [];
        ftlState.puzzle.answers.forEach((a, i) => {
            if (ftlState.found.has(i)) return;
            if (a.norms.some(n => n.startsWith(typed) && typed.length >= n.length * 0.5)) m.push(i);
        });
        if (m.length === 1) hit = m[0];
    }
    if (hit >= 0) ftlAcceptAnswer(hit);
}

function ftlRenderSlots() {
    const ol = document.getElementById("ftl-slots");
    ol.innerHTML = "";
    const { puzzle, options } = ftlState;
    const showHint = !options.hard && puzzle.entityType !== "artist" && !puzzle.fixedArtist;
    puzzle.answers.forEach((a, i) => {
        const li = document.createElement("li");
        li.className = "ftl-slot";
        li.dataset.idx = i;
        const hint = showHint && a.artist ? `<span class="ftl-slot-hint">by ${escapeHTML(a.artist)}</span>` : "· · · · ·";
        li.innerHTML = `<span class="ftl-slot-rank">${i + 1}.</span><span class="ftl-slot-text">${hint}</span>`;
        ol.appendChild(li);
    });
}

function ftlMarkSlot(i, missed) {
    const li = document.querySelector(`.ftl-slot[data-idx="${i}"]`);
    if (!li) return;
    const a = ftlState.puzzle.answers[i];
    li.classList.remove("ftl-flash");
    li.classList.add(missed ? "missed" : "found");
    if (!missed) { void li.offsetWidth; li.classList.add("ftl-flash"); }
    const showArtist = ftlState.puzzle.entityType !== "artist" && !ftlState.puzzle.fixedArtist && a.artist;
    const sub = showArtist ? ` <span class="ftl-slot-hint">by ${escapeHTML(a.artist)}</span>` : "";
    const metric = a.detail ? escapeHTML(a.detail) : `${a.count.toLocaleString()} scrobbles`;
    li.querySelector(".ftl-slot-text").innerHTML =
        `${escapeHTML(a.name)}${sub} <span class="ftl-slot-count">${metric}</span>`;
}

function ftlUpdateScore() {
    document.getElementById("ftl-score").textContent = `${ftlState.found.size} / ${ftlState.puzzle.answers.length}`;
}

export function ftlFinish(timedOut) {
    if (!ftlState || ftlState.done) return;
    ftlState.done = true;
    ftlStopTimer();
    ftlState.puzzle.answers.forEach((a, i) => { if (!ftlState.found.has(i)) ftlMarkSlot(i, true); });
    document.getElementById("ftl-guess").disabled = true;
    gamesRecords.ftlPlayed = (gamesRecords.ftlPlayed || 0) + 1;
    if (ftlState.found.size > (gamesRecords.ftlBest || 0)) gamesRecords.ftlBest = ftlState.found.size;
    saveGamesRecords();
}

export function ftlStopTimer() {
    if (ftlState && ftlState.timerId) { clearInterval(ftlState.timerId); ftlState.timerId = null; }
}

function ftlRenderTime() {
    const el = document.getElementById("ftl-timeleft");
    const m = Math.floor(ftlState.timeLeft / 60);
    const s = ftlState.timeLeft % 60;
    el.textContent = `${m}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("low", ftlState.timeLeft <= 10);
}

function ftlStartTimer() {
    ftlStopTimer();
    const el = document.getElementById("ftl-timeleft");
    if (!ftlState.options.timer) { el.hidden = true; return; }
    ftlState.timeLeft = ftlState.options.timer;
    el.hidden = false;
    ftlRenderTime();
    ftlState.timerId = setInterval(() => {
        ftlState.timeLeft -= 1;
        ftlRenderTime();
        if (ftlState.timeLeft <= 0) ftlFinish(true);
    }, 1000);
}

export function ftlNextPuzzle() {
    ftlStopTimer();
    const puzzle = ftlGeneratePuzzle();
    if (!puzzle) { ftlShowSetup(true); return; }
    puzzle.answers.forEach(a => { a.norms = ftlNormsFor(a.name); });
    ftlState.puzzle = puzzle;
    ftlState.found = new Set();
    ftlState.done = false;
    document.getElementById("ftl-prompt").textContent = puzzle.prompt;
    const guess = document.getElementById("ftl-guess");
    guess.disabled = false;
    guess.value = "";
    ftlSetInputProgress(0);
    ftlRenderSlots();
    ftlUpdateScore();
    ftlStartTimer();
    guess.focus();
}

// ---- Fill the List: screens ----
export function ftlOpenGame() {
    ftlStopTimer();
    document.getElementById("hl-game").hidden = true;
    document.getElementById("ord-game").hidden = true;
    document.getElementById("games-home").hidden = true;
    document.getElementById("ftl-game").hidden = false;
    ftlShowSetup(false);
}

function ftlShowSetup(showNote) {
    ftlStopTimer();
    document.getElementById("ftl-setup").hidden = false;
    document.getElementById("ftl-play").hidden = true;
    const note = document.getElementById("ftl-setup-note");
    if (showNote) {
        note.hidden = false;
        note.textContent = "No lists match those options. Turn on more types or puzzle categories.";
    } else {
        note.hidden = true;
    }
}

export function ftlStartGame() {
    const types = new Set([...document.querySelectorAll(".ftl-type:checked")].map(c => c.value));
    const cats = new Set([...document.querySelectorAll(".ftl-cat:checked")].map(c => c.value));
    if (!types.size || !cats.size) { ftlShowSetup(true); return; }
    rebuildScrobbleIndex();
    ftlState = {
        options: {
            types,
            cats,
            hard: document.getElementById("ftl-hard").checked,
            timer: parseInt(document.getElementById("ftl-timer").value, 10) || 0
        },
        categoryDeck: [],
        facetLastUsed: new Map(),
        seen: new Set(),
        puzzleNum: 0,
        puzzle: null,
        found: new Set(),
        done: false,
        timerId: null
    };
    document.getElementById("ftl-setup").hidden = true;
    document.getElementById("ftl-play").hidden = false;
    ftlNextPuzzle();
}
