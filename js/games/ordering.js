// Put Them In Order: rank a handful of entities by a chosen metric.

import { escapeHTML } from '../dom.js';
import { state } from '../state.js';
import { getLocalDayKeyFromTimestamp } from '../time.js';
import { FTL_MONTHS, ftlFormatDay, ftlRandom, ftlShuffle } from './fill-the-list.js';
import { gamesRecords, saveGamesRecords } from './records.js';
import {
    getScrobbleIndex,
    indexEntities,
    indexEntitySequences,
    rebuildScrobbleIndex,
    toScrobbleTime
} from './scrobble-index.js';

const ORD_POOL_LIMIT = { artist: 200, album: 300, track: 600 };
const ORD_MIN_SCROBBLES = 5;

// Difficulty ramp. Early rounds are short lists of very familiar items whose
// values are far apart; later rounds get longer, dig deeper into the library,
// and allow values that sit much closer together.
const ORD_TIERS = [
    { maxRound: 2, items: 3, depth: 30, minRatio: 2.5, minDays: 120 },
    { maxRound: 4, items: 4, depth: 60, minRatio: 2.0, minDays: 90 },
    { maxRound: 7, items: 4, depth: 120, minRatio: 1.7, minDays: 60 },
    { maxRound: 11, items: 5, depth: 250, minRatio: 1.5, minDays: 35 },
    { maxRound: Infinity, items: 5, depth: Infinity, minRatio: 1.35, minDays: 21 }
];

// How many rounds a criterion is pushed to the back of the queue after use, so
// you don't get the same question every other round.
const ORD_CRITERION_COOLDOWN = 5;

function ordTierForRound(round) {
    return ORD_TIERS.find(t => round <= t.maxRound) || ORD_TIERS[ORD_TIERS.length - 1];
}

let ordState = null;
let ordConsecutiveCache = {};
let ordTrackStatsCache = {};
let ordDayStatsCache = {};
let ordDragEl = null;

// Key for a raw scrobble, matching the entity keys used by the index.
function ordScrobbleKey(type, s) {
    const A = s.Artist;
    if (!A || A === "Unknown") return null;
    if (type === "artist") return A.toLowerCase();
    const n = type === "album" ? s.Album : s.Track;
    if (!n || n === "Unknown") return null;
    return `${n.toLowerCase()}|||${A.toLowerCase()}`;
}

function ordEntityKey(type, e) {
    return type === "artist"
        ? (e.name || "").toLowerCase()
        : `${(e.name || "").toLowerCase()}|||${(e.artist || "").toLowerCase()}`;
}

// Recognisable candidates only: the most-played slice of the library, narrowed
// further on early rounds so beginners get names they definitely know.
function ordBasePool(type, depth) {
    const ents = indexEntities(type).filter(e => e.count >= ORD_MIN_SCROBBLES);
    ents.sort((a, b) => b.count - a.count);
    const limit = Math.min(depth || Infinity, ORD_POOL_LIMIT[type] || 300);
    return ents.slice(0, limit).map(e => ({
        name: e.name,
        artist: e.artist || null,
        count: e.count,
        first: e.first,
        last: e.last,
        trackCount: e.trackCount,
        key: ordEntityKey(type, e)
    }));
}

// Longest run of back-to-back scrobbles, from one pass over the play history.
function ordConsecutiveMap(type) {
    if (ordConsecutiveCache[type]) return ordConsecutiveCache[type];
    const map = new Map();
    let prevKey = null, run = 0;
    for (const s of state.allTracks) {
        const k = ordScrobbleKey(type, s);
        if (!k) { prevKey = null; run = 0; continue; }
        run = k === prevKey ? run + 1 : 1;
        prevKey = k;
        if (run > (map.get(k) || 0)) map.set(k, run);
    }
    ordConsecutiveCache[type] = map;
    return map;
}

// Per artist/album: biggest single track and how many distinct tracks.
function ordTrackStats(type) {
    if (ordTrackStatsCache[type]) return ordTrackStatsCache[type];
    const perEntity = new Map();
    for (const s of state.allTracks) {
        const ek = ordScrobbleKey(type, s);
        if (!ek || !s.Track || s.Track === "Unknown") continue;
        const tk = s.Track.toLowerCase();
        let m = perEntity.get(ek);
        if (!m) { m = new Map(); perEntity.set(ek, m); }
        m.set(tk, (m.get(tk) || 0) + 1);
    }
    const out = new Map();
    for (const [ek, m] of perEntity) {
        let max = 0;
        for (const c of m.values()) if (c > max) max = c;
        out.set(ek, { maxTrack: max, distinct: m.size });
    }
    ordTrackStatsCache[type] = out;
    return out;
}

// Per entity: biggest single day and how many separate days.
function ordDayStats(type) {
    if (ordDayStatsCache[type]) return ordDayStatsCache[type];
    const seq = indexEntitySequences(type);
    const out = new Map();
    for (const [key, e] of seq) {
        const days = new Map();
        let max = 0;
        for (const d of e.dates) {
            const k = getLocalDayKeyFromTimestamp(d);
            const c = (days.get(k) || 0) + 1;
            days.set(k, c);
            if (c > max) max = c;
        }
        out.set(key, { maxDay: max, days: days.size });
    }
    ordDayStatsCache[type] = out;
    return out;
}

// Each criterion builds a spec: the items with their values, which way to sort,
// and how to render the value on reveal.
const ORD_CRITERIA = [
    {
        id: "plays", types: ["artist", "album", "track"],
        build: (type, pool) => ({
            title: "Total scrobbles", instruction: "Most played at the top", desc: true, isDate: false,
            items: pool.map(e => ({ ...e, value: e.count })),
            format: v => `${v.toLocaleString()} scrobbles`
        })
    },
    {
        id: "first", types: ["artist", "album", "track"],
        build: (type, pool) => ({
            title: "First ever scrobble", instruction: "Whatever you discovered first at the top", desc: false, isDate: true,
            items: pool.filter(e => e.first).map(e => ({ ...e, value: e.first })),
            format: v => `first played ${ftlFormatDay(v)}`
        })
    },
    {
        id: "last", types: ["artist", "album", "track"],
        build: (type, pool) => ({
            title: "Most recent scrobble", instruction: "Most recently played at the top", desc: true, isDate: true,
            items: pool.filter(e => e.last).map(e => ({ ...e, value: e.last })),
            format: v => `last played ${ftlFormatDay(v)}`
        })
    },
    {
        id: "period", types: ["artist", "album", "track"],
        build: (type, pool) => {
            const years = getScrobbleIndex().years;
            const modes = years.length ? ["year", "yearmonth", "lastdays"] : ["lastdays"];
            const mode = ftlRandom(modes);
            let pred, label;
            if (mode === "year") {
                const y = ftlRandom(years);
                pred = d => new Date(d).getFullYear() === y;
                label = `in ${y}`;
            } else if (mode === "yearmonth") {
                const y = ftlRandom(years);
                const m = Math.floor(Math.random() * 12);
                pred = d => { const dt = new Date(d); return dt.getFullYear() === y && dt.getMonth() === m; };
                label = `in ${FTL_MONTHS[m]} ${y}`;
            } else {
                const n = ftlRandom([30, 90, 180, 365]);
                const cutoff = Date.now() - n * 86400000;
                pred = d => d >= cutoff;
                label = `in the last ${n} days`;
            }
            const map = new Map();
            for (const s of state.allTracks) {
                const d = toScrobbleTime(s.Date);
                if (!d || !pred(d)) continue;
                const k = ordScrobbleKey(type, s);
                if (k) map.set(k, (map.get(k) || 0) + 1);
            }
            return {
                title: `Scrobbles ${label}`, instruction: `Most played ${label} at the top`, desc: true, isDate: false,
                items: pool.map(e => ({ ...e, value: map.get(e.key) || 0 })).filter(e => e.value >= 8),
                format: v => `${v.toLocaleString()} ${label}`
            };
        }
    },
    {
        id: "toptrack", types: ["artist", "album"],
        build: (type, pool) => {
            const stats = ordTrackStats(type);
            return {
                title: "Biggest single track", instruction: "Whoever has the most-played single track at the top", desc: true, isDate: false,
                items: pool.map(e => ({ ...e, value: stats.get(e.key)?.maxTrack || 0 })).filter(e => e.value >= 5),
                format: v => `top track played ${v.toLocaleString()} times`
            };
        }
    },
    {
        id: "distincttracks", types: ["artist", "album"],
        build: (type, pool) => {
            const stats = ordTrackStats(type);
            return {
                title: "Different tracks played", instruction: "Most different tracks at the top", desc: true, isDate: false,
                items: pool.map(e => ({ ...e, value: stats.get(e.key)?.distinct || 0 })).filter(e => e.value >= 3),
                format: v => `${v.toLocaleString()} different tracks`
            };
        }
    },
    {
        id: "consecutive", types: ["artist", "album", "track"],
        build: (type, pool) => {
            const map = ordConsecutiveMap(type);
            return {
                title: "Longest run back to back", instruction: "Longest unbroken run at the top", desc: true, isDate: false,
                items: pool.map(e => ({ ...e, value: map.get(e.key) || 0 })).filter(e => e.value >= 3),
                format: v => `${v} in a row`
            };
        }
    },
    {
        id: "singleday", types: ["artist", "album", "track"],
        build: (type, pool) => {
            const stats = ordDayStats(type);
            return {
                title: "Most scrobbles in one day", instruction: "Biggest single day at the top", desc: true, isDate: false,
                items: pool.map(e => ({ ...e, value: stats.get(e.key)?.maxDay || 0 })).filter(e => e.value >= 3),
                format: v => `${v} in one day`
            };
        }
    },
    {
        id: "separatedays", types: ["artist", "album", "track"],
        build: (type, pool) => {
            const stats = ordDayStats(type);
            return {
                title: "Days played on", instruction: "Played across the most separate days at the top", desc: true, isDate: false,
                items: pool.map(e => ({ ...e, value: stats.get(e.key)?.days || 0 })).filter(e => e.value >= 4),
                format: v => `${v.toLocaleString()} separate days`
            };
        }
    }
];

// Pick items whose values are clearly apart, so the ordering is knowable rather
// than a coin flip between near-identical numbers.
// Two values count as tellable apart only if they differ by a clear FACTOR, not
// a flat amount. A flat gap is meaningless down in the tail: 5 vs 6 scrobbles is
// a coin flip even though the difference is "1", which is what an 8% rule with a
// floor of 1 wrongly allowed.
function ordSeparated(a, b, isDate, minRatio, minDays) {
    if (isDate) return Math.abs(a - b) >= minDays * 86400000;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (lo <= 0) return hi >= 3;
    return (hi / lo) >= minRatio && (hi - lo) >= 2;
}

function ordPickSpread(items, n, isDate, minRatio, minDays) {
    const valid = items.filter(i => typeof i.value === "number" && isFinite(i.value));
    if (valid.length < n) return null;
    valid.sort((a, b) => b.value - a.value);

    // Start near the top of the list rather than anywhere in it, so rounds use
    // items the player actually recognises and values big enough to rank.
    const maxStart = Math.max(0, Math.min(valid.length - n, Math.ceil(valid.length * 0.55)));
    for (let attempt = 0; attempt < 40; attempt++) {
        const start = Math.floor(Math.pow(Math.random(), 1.7) * (maxStart + 1));
        const picked = [valid[start]];
        for (let i = start + 1; i < valid.length && picked.length < n; i++) {
            if (ordSeparated(valid[i].value, picked[picked.length - 1].value, isDate, minRatio, minDays)) picked.push(valid[i]);
        }
        if (picked.length === n) return picked;
    }
    return null; // let the round builder try a different criterion
}

// Criteria queued so anything used recently sinks to the back. A criterion is
// only revisited once the others have had a turn or failed to build a board,
// which stops the same question alternating round after round.
function ordQueuedCriteria(type, round) {
    return ORD_CRITERIA
        .filter(c => c.types.includes(type))
        .map(c => {
            const last = ordState.criterionLastUsed.get(c.id);
            const age = last === undefined ? Infinity : round - last;
            const penalty = age < ORD_CRITERION_COOLDOWN ? (ORD_CRITERION_COOLDOWN - age) * 10 : 0;
            return { c, score: penalty + Math.random() * 5 };
        })
        .sort((a, b) => a.score - b.score)
        .map(x => x.c);
}

function ordBuildRound(type) {
    const round = ordState.rounds + 1;
    const tier = ordTierForRound(round);
    const pool = ordBasePool(type, tier.depth);
    if (pool.length < tier.items) return null;

    for (const crit of ordQueuedCriteria(type, round)) {
        // A couple of goes per criterion, since some roll a random value.
        for (let attempt = 0; attempt < 3; attempt++) {
            const spec = crit.build(type, pool);
            if (!spec || !spec.items || spec.items.length < tier.items) continue;
            const picked = ordPickSpread(spec.items, tier.items, spec.isDate, tier.minRatio, tier.minDays);
            if (!picked) continue;
            const correct = [...picked].sort((a, b) => spec.desc ? b.value - a.value : a.value - b.value);
            let display = ftlShuffle([...correct]);
            // Don't hand them an already-solved board.
            if (display.every((d, i) => d.key === correct[i].key)) display = ftlShuffle([...correct].reverse());
            ordState.criterionLastUsed.set(crit.id, round);
            return { title: spec.title, instruction: spec.instruction, format: spec.format, correct, display };
        }
    }
    return null;
}

function ordRenumber() {
    document.querySelectorAll("#ord-list .ord-item").forEach((li, i) => {
        const rank = li.querySelector(".ord-rank");
        if (rank) rank.textContent = `${i + 1}.`;
    });
}

function ordRenderRound() {
    const list = document.getElementById("ord-list");
    list.innerHTML = "";
    const showArtist = ordState.type !== "artist";
    ordState.round.display.forEach((item, i) => {
        const li = document.createElement("li");
        li.className = "ord-item";
        li.draggable = true;
        li.dataset.key = item.key;
        const sub = showArtist && item.artist ? `<span class="ord-sub">by ${escapeHTML(item.artist)}</span>` : "";
        li.innerHTML =
            `<span class="ord-rank">${i + 1}.</span>` +
            `<span class="ord-name">${escapeHTML(item.name)}${sub}</span>` +
            `<span class="ord-value"></span>` +
            `<span class="ord-moves"><button type="button" class="ord-up" aria-label="Move up">&#9650;</button>` +
            `<button type="button" class="ord-down" aria-label="Move down">&#9660;</button></span>`;
        list.appendChild(li);
    });
    document.getElementById("ord-title").textContent = ordState.round.title;
    document.getElementById("ord-instruction").textContent = ordState.round.instruction;
    document.getElementById("ord-check").hidden = false;
    document.getElementById("ord-next").hidden = true;
    document.getElementById("ord-actions").hidden = false;
    document.getElementById("ord-over").hidden = true;
    ordUpdateScore();
}

function ordUpdateScore() {
    const el = document.getElementById("ord-score");
    const best = gamesRecords.ordBest || 0;
    el.textContent = ordState.rounds
        ? `Round ${ordState.rounds + 1} · perfect streak ${ordState.streak} · best ${best}`
        : `Best perfect streak: ${best}`;
}

export function ordCheck() {
    if (!ordState || !ordState.round || ordState.checked) return;
    ordState.checked = true;
    const rows = [...document.querySelectorAll("#ord-list .ord-item")];
    const correct = ordState.round.correct;
    const correctKeys = correct.map(c => c.key);
    const byKey = new Map(correct.map((c, i) => [c.key, { item: c, pos: i }]));

    let right = 0;
    rows.forEach((li, idx) => {
        const info = byKey.get(li.dataset.key);
        li.classList.add("checked");
        li.draggable = false;
        const moves = li.querySelector(".ord-moves");
        if (moves) moves.remove();
        if (!info) return;
        const isRight = correctKeys[idx] === li.dataset.key;
        if (isRight) right++;
        li.classList.add(isRight ? "ok" : "bad");
        const valueEl = li.querySelector(".ord-value");
        valueEl.textContent = ordState.round.format(info.item.value);
        if (!isRight) {
            const badge = document.createElement("span");
            badge.className = "ord-correct-pos";
            badge.textContent = `belongs at #${info.pos + 1}`;
            li.appendChild(badge);
        }
    });

    ordState.rounds += 1;
    const perfect = right === correct.length;
    if (perfect) {
        ordState.streak += 1;
        if (ordState.streak > (gamesRecords.ordBest || 0)) {
            gamesRecords.ordBest = ordState.streak;
        }
    }
    gamesRecords.ordPlayed = (gamesRecords.ordPlayed || 0) + 1;
    saveGamesRecords();

    const best = gamesRecords.ordBest || 0;
    document.getElementById("ord-check").hidden = true;

    if (perfect) {
        document.getElementById("ord-score").textContent =
            `${right} of ${correct.length} in the right place · perfect streak ${ordState.streak} · best ${best}`;
        document.getElementById("ord-next").hidden = false;
        return;
    }

    // One row out of place ends the run. The board stays on screen with the
    // "belongs at #n" badges so the answer is still readable.
    document.getElementById("ord-score").textContent =
        `${right} of ${correct.length} in the right place`;
    document.getElementById("ord-final").textContent = ordState.streak;
    document.getElementById("ord-best").textContent = best;
    document.getElementById("ord-actions").hidden = true;
    document.getElementById("ord-over").hidden = false;
    ordState.streak = 0;
}

export function ordNextRound() {
    const round = ordBuildRound(ordState.type);
    if (!round) {
        ordShowSetup(true);
        return;
    }
    ordState.round = round;
    ordState.checked = false;
    ordRenderRound();
}

export function ordStart(type) {
    rebuildScrobbleIndex();
    ordConsecutiveCache = {};
    ordTrackStatsCache = {};
    ordDayStatsCache = {};
    if (ordBasePool(type, Infinity).length < ORD_TIERS[0].items) {
        ordState = { type, round: null, checked: false, rounds: 0, streak: 0, criterionLastUsed: new Map() };
        ordShowSetup(true);
        return;
    }
    beginRun(type);
}

// Play the same type again after a miss. The caches are derived from the play
// history and are still valid, so only the run resets: the streak goes back to
// zero and the difficulty ramp starts again at round one.
export function ordRestartCurrent() {
    if (ordState) beginRun(ordState.type);
}

function beginRun(type) {
    ordState = { type, round: null, checked: false, rounds: 0, streak: 0, criterionLastUsed: new Map() };
    document.getElementById("ord-setup").hidden = true;
    document.getElementById("ord-play").hidden = false;
    ordNextRound();
}

export function ordOpenGame() {
    document.getElementById("hl-game").hidden = true;
    document.getElementById("ftl-game").hidden = true;
    document.getElementById("games-home").hidden = true;
    document.getElementById("ord-game").hidden = false;
    ordShowSetup(false);
}

export function ordShowSetup(showNote) {
    document.getElementById("ord-setup").hidden = false;
    document.getElementById("ord-play").hidden = true;
    const note = document.getElementById("ord-setup-note");
    if (showNote) {
        note.hidden = false;
        note.textContent = "Not enough data of that kind to build a round yet. Try another type.";
    } else {
        note.hidden = true;
    }
}

export function initOrderingControls() {
    const list = document.getElementById("ord-list");
    if (!list) return;

    list.addEventListener("click", (e) => {
        if (!ordState || ordState.checked) return;
        const li = e.target.closest(".ord-item");
        if (!li) return;
        if (e.target.closest(".ord-up") && li.previousElementSibling) {
            list.insertBefore(li, li.previousElementSibling);
            ordRenumber();
        } else if (e.target.closest(".ord-down") && li.nextElementSibling) {
            list.insertBefore(li.nextElementSibling, li);
            ordRenumber();
        }
    });

    list.addEventListener("dragstart", (e) => {
        const li = e.target.closest(".ord-item");
        if (!li || !ordState || ordState.checked) { e.preventDefault(); return; }
        ordDragEl = li;
        li.classList.add("dragging");
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", ""); } catch (err) { /* some browsers need this */ }
        }
    });

    list.addEventListener("dragover", (e) => {
        if (!ordDragEl) return;
        e.preventDefault();
        const target = e.target.closest(".ord-item");
        if (!target || target === ordDragEl) return;
        const rect = target.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        list.insertBefore(ordDragEl, after ? target.nextSibling : target);
    });

    list.addEventListener("drop", (e) => e.preventDefault());

    list.addEventListener("dragend", () => {
        if (ordDragEl) ordDragEl.classList.remove("dragging");
        ordDragEl = null;
        ordRenumber();
    });
}
