// Higher or Lower: two entities, guess which you played more.

import { state } from '../state.js';
import { ftlStopTimer } from './fill-the-list.js';
import { gamesRecords, saveGamesRecords } from './records.js';

// Fair-play pools: an item qualifies by rank OR by raw scrobble count, so
// there's always enough to play even for a modest library.
const HL_POOL_RULES = {
    artist: { rankMax: 300, minScrobbles: 100 },
    album: { rankMax: 500, minScrobbles: 50 },
    track: { rankMax: 1000, minScrobbles: 10 }
};

// Difficulty ramp by round: start with familiar items at wide ratios, then
// widen the pool and tighten the ratio. Difficulty is the ratio between the
// two counts, not the absolute gap.
const HL_TIERS = [
    { maxRound: 3, depth: 50, ratioMin: 2.0, ratioMax: 3.0 },
    { maxRound: 6, depth: 100, ratioMin: 1.6, ratioMax: 2.2 },
    { maxRound: 10, depth: 250, ratioMin: 1.35, ratioMax: 1.7 },
    { maxRound: 15, depth: 500, ratioMin: 1.15, ratioMax: 1.4 },
    { maxRound: Infinity, depth: Infinity, ratioMin: 1.01, ratioMax: 1.15 }
];

const HL_RECENT_MEMORY = 12; // items excluded from reuse across recent rounds
const HL_REVEAL_MS = 1500;   // pause on the reveal before advancing

let hlState = null;

function hlBest(type) {
    return (gamesRecords.hlBest && gamesRecords.hlBest[type]) || 0;
}

function hlSourceData(type) {
    if (type === "artist") return state.artistsData;
    if (type === "album") return state.albumsData;
    return state.tracksData;
}

function hlBuildPool(type) {
    const rule = HL_POOL_RULES[type];
    const data = hlSourceData(type) || [];
    return data
        .map(item => ({
            name: item.name,
            artist: item.artist || null,
            count: parseInt(item.user_scrobbles, 10) || 0
        }))
        .filter(e => e.name && e.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((e, idx) => ({
            ...e,
            poolRank: idx + 1,
            key: `${(e.name || "").toLowerCase()}|||${(e.artist || "").toLowerCase()}`
        }))
        .filter(e => e.poolRank <= rule.rankMax || e.count >= rule.minScrobbles);
}

function hlTierForRound(round) {
    return HL_TIERS.find(t => round <= t.maxRound) || HL_TIERS[HL_TIERS.length - 1];
}

// One attempt at a pair for the given tier. Returns { anchor, partner, ratio }
// or null. Direction (partner higher/lower) is steered by where the anchor
// sits in the tier pool so the target count actually exists in range.
function hlAttemptPair(tier, tierPool) {
    const { pool, recent } = hlState;

    let anchorPool = tierPool.filter(e => !recent.has(e.key));
    if (anchorPool.length < 1) anchorPool = tierPool;
    const anchor = anchorPool[Math.floor(Math.random() * anchorPool.length)];

    const ratioTarget = tier.ratioMin + Math.random() * (tier.ratioMax - tier.ratioMin);

    // tierPool is sorted by count desc; anchor near the top should look down,
    // near the bottom should look up, so the target stays inside the pool.
    const hi = tierPool[0].count;
    const lo = tierPool[tierPool.length - 1].count;
    const frac = hi > lo ? (anchor.count - lo) / (hi - lo) : 0.5;
    let goUp;
    if (frac < 0.25) goUp = true;
    else if (frac > 0.75) goUp = false;
    else goUp = Math.random() < 0.5;
    const target = goUp ? anchor.count * ratioTarget : anchor.count / ratioTarget;

    let candidates = tierPool.filter(e => e.key !== anchor.key && !recent.has(e.key));
    if (candidates.length < 3) candidates = pool.filter(e => e.key !== anchor.key && !recent.has(e.key));
    if (candidates.length < 1) candidates = pool.filter(e => e.key !== anchor.key);
    if (candidates.length < 1) return null;

    candidates.sort((a, b) =>
        Math.abs(Math.log(a.count / target)) - Math.abs(Math.log(b.count / target)));
    const nearest = candidates.slice(0, Math.min(5, candidates.length));
    const partner = nearest[Math.floor(Math.random() * nearest.length)];
    if (!partner) return null;

    const ratio = Math.max(anchor.count, partner.count) / Math.min(anchor.count, partner.count);
    return { anchor, partner, ratio };
}

function hlPickPair() {
    const { pool } = hlState;
    if (pool.length < 2) return null;

    const tier = hlTierForRound(hlState.round);
    const depth = Math.min(tier.depth, pool.length);
    const tierPool = pool.slice(0, depth);

    // Retry until the ACTUAL ratio lands near the tier band, so a bottom-of-pool
    // anchor can't hand us a 76-vs-77 coin flip. Keep the closest fallback for
    // small or tightly clustered libraries where the band can't be hit.
    const loOK = tier.ratioMin * 0.85;
    const hiOK = tier.ratioMax * 1.35;
    const mid = Math.sqrt(tier.ratioMin * tier.ratioMax);
    let best = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < 16; attempt++) {
        const candidate = hlAttemptPair(tier, tierPool);
        if (!candidate) continue;
        if (candidate.ratio >= loOK && candidate.ratio <= hiOK) { best = candidate; break; }
        const score = Math.abs(Math.log(candidate.ratio / mid));
        if (score < bestScore) { bestScore = score; best = candidate; }
    }
    if (!best) return null;

    return Math.random() < 0.5
        ? { left: best.anchor, right: best.partner }
        : { left: best.partner, right: best.anchor };
}

function hlOptionEls() {
    return {
        left: document.querySelector('.hl-option[data-side="left"]'),
        right: document.querySelector('.hl-option[data-side="right"]')
    };
}

function hlFillOption(el, entry, type) {
    el.classList.remove("revealed", "correct", "wrong");
    el.querySelector(".hl-option-name").textContent = entry.name;
    const sub = el.querySelector(".hl-option-sub");
    const subText = (type !== "artist" && entry.artist) ? entry.artist : "";
    sub.textContent = subText;
    sub.style.display = subText ? "" : "none";
    el.querySelector(".hl-option-count").textContent = "";
}

function hlRenderRound() {
    const pair = hlPickPair();
    if (!pair) { hlEndGame(); return; }
    hlState.current = pair;
    hlState.locked = false;
    hlState.pending = null;
    const els = hlOptionEls();
    hlFillOption(els.left, pair.left, hlState.type);
    hlFillOption(els.right, pair.right, hlState.type);
    const fb = document.getElementById("hl-feedback");
    fb.textContent = "";
    fb.className = "hl-feedback";
}

function hlRemember(key) {
    hlState.recentQueue.push(key);
    hlState.recent.add(key);
    while (hlState.recentQueue.length > HL_RECENT_MEMORY) {
        const old = hlState.recentQueue.shift();
        if (!hlState.recentQueue.includes(old)) hlState.recent.delete(old);
    }
}

export function hlGuess(side) {
    if (!hlState) return;
    // A click during the reveal skips the pause and moves on.
    if (hlState.locked) { hlResolvePending(); return; }

    hlState.locked = true;
    const { left, right } = hlState.current;
    const chosen = side === "left" ? left : right;
    const other = side === "left" ? right : left;
    const tie = chosen.count === other.count;
    const correct = tie || chosen.count > other.count;

    const els = hlOptionEls();
    els.left.classList.add("revealed");
    els.right.classList.add("revealed");
    els.left.querySelector(".hl-option-count").textContent = `${left.count.toLocaleString()} scrobbles`;
    els.right.querySelector(".hl-option-count").textContent = `${right.count.toLocaleString()} scrobbles`;

    const higherSide = left.count >= right.count ? "left" : "right";
    els[higherSide].classList.add("correct");
    if (!correct) els[side].classList.add("wrong");

    hlRemember(left.key);
    hlRemember(right.key);

    const fb = document.getElementById("hl-feedback");
    if (correct) {
        hlState.streak += 1;
        if (hlState.streak > hlBest(hlState.type)) {
            gamesRecords.hlBest[hlState.type] = hlState.streak;
            saveGamesRecords();
        }
        document.getElementById("hl-streak").textContent = hlState.streak;
        document.getElementById("hl-best").textContent = hlBest(hlState.type);
        fb.textContent = tie ? "Dead heat, that counts!" : "Correct!";
        fb.className = "hl-feedback good";
        hlState.round += 1;
        hlState.pending = "next";
    } else {
        fb.textContent = "Nope.";
        fb.className = "hl-feedback bad";
        hlState.pending = "end";
    }
    hlState.timer = setTimeout(hlResolvePending, HL_REVEAL_MS);
}

function hlResolvePending() {
    if (!hlState || !hlState.pending) return;
    hlClearTimer();
    const pending = hlState.pending;
    hlState.pending = null;
    if (pending === "next") hlRenderRound();
    else hlEndGame();
}

export function hlClearTimer() {
    if (hlState && hlState.timer) {
        clearTimeout(hlState.timer);
        hlState.timer = null;
    }
}

// ---- Higher or Lower: screens ----
// Shared "back to the games menu" used by both games.
export function hlShowHome() {
    hlClearTimer();
    ftlStopTimer();
    document.getElementById("games-home").hidden = false;
    document.getElementById("hl-game").hidden = true;
    document.getElementById("ftl-game").hidden = true;
    document.getElementById("ord-game").hidden = true;
}

export function hlOpenGame() {
    hlClearTimer();
    document.getElementById("ftl-game").hidden = true;
    document.getElementById("ord-game").hidden = true;
    document.getElementById("games-home").hidden = true;
    document.getElementById("hl-game").hidden = false;
    hlShowSetup();
}

export function hlShowSetup() {
    hlClearTimer();
    document.getElementById("hl-setup").hidden = false;
    document.getElementById("hl-play").hidden = true;
    document.getElementById("hl-over").hidden = true;
    document.getElementById("hl-setup-note").hidden = true;
}

export function hlStart(type) {
    const pool = hlBuildPool(type);
    if (pool.length < 2) {
        const note = document.getElementById("hl-setup-note");
        note.hidden = false;
        note.textContent = `Not enough ${type} data to play this one yet. Try another type, or load more of your history.`;
        return;
    }
    hlState = {
        type,
        pool,
        round: 1,
        streak: 0,
        recent: new Set(),
        recentQueue: [],
        current: null,
        locked: false,
        pending: null,
        timer: null
    };
    document.getElementById("hl-setup").hidden = true;
    document.getElementById("hl-over").hidden = true;
    document.getElementById("hl-play").hidden = false;
    document.getElementById("hl-streak").textContent = "0";
    document.getElementById("hl-best").textContent = hlBest(type);
    hlRenderRound();
}

// Replay the round type that is currently loaded, if any.
export function hlRestartCurrent() {
    if (hlState) hlStart(hlState.type);
}

function hlEndGame() {
    hlClearTimer();
    document.getElementById("hl-play").hidden = true;
    document.getElementById("hl-setup").hidden = true;
    document.getElementById("hl-over").hidden = false;
    document.getElementById("hl-final").textContent = hlState ? hlState.streak : 0;
    document.getElementById("hl-best-2").textContent = hlState ? hlBest(hlState.type) : 0;
}
