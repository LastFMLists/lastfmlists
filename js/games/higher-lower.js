// Higher or Lower: two entities, guess which you played more.

import { createArtworkElement } from '../data/artwork.js';
import { state } from '../state.js';
import { ftlStopTimer } from './fill-the-list.js';
import { showCelebration } from './celebration.js';
import { gamesRecords, saveGamesRecords } from './records.js';

// Fair-play pools: an item qualifies by rank OR by raw scrobble count, so
// there's always enough to play even for a modest library.
const HL_POOL_RULES = {
    artist: { rankMax: 300, minScrobbles: 100 },
    album: { rankMax: 500, minScrobbles: 50 },
    track: { rankMax: 1000, minScrobbles: 10 }
};

// Difficulty grows smoothly with the streak. Over the first 20 wins the
// pool widens from the top 45 to the top 600, and the ratio the pair is
// aimed at narrows from 2.4x to 1.1x. Difficulty is the ratio between the
// two counts, not the gap: 50 vs 100 is as easy as 500 vs 1,000.
const HL_RAMP_WINS = 20;
const HL_DEPTH_START = 45;
const HL_DEPTH_END = 600;
const HL_RATIO_START = 2.4;
const HL_RATIO_END = 1.1;

const HL_RECENT_MEMORY = 12;    // items shown recently are less likely to come back
const HL_RECENT_PENALTY = 0.38; // added to a pair's score per recently shown item
const HL_REVEAL_MS = 1500;      // pause on the reveal before advancing

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

function hlShuffled(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Score many random pairs from the current depth and keep the one whose
// count ratio is closest to the target, preferring items not seen lately.
// The exact pair from the previous round is never offered twice in a row.
function hlPickPair() {
    const { pool, recent } = hlState;
    if (pool.length < 2) return null;

    const progress = Math.min(hlState.streak / HL_RAMP_WINS, 1);
    const depth = Math.min(pool.length, Math.round(HL_DEPTH_START + progress * (HL_DEPTH_END - HL_DEPTH_START)));
    const target = HL_RATIO_START - progress * (HL_RATIO_START - HL_RATIO_END);
    const candidates = hlShuffled(pool.slice(0, Math.max(2, depth)));

    let best = null;
    let bestScore = Infinity;
    for (const a of candidates.slice(0, 30)) {
        for (const b of candidates.slice(0, 60)) {
            if (a.key === b.key) continue;
            const signature = [a.key, b.key].sort().join("\n");
            if (signature === hlState.lastPair && candidates.length > 2) continue;
            const ratio = Math.max(a.count, b.count) / Math.min(a.count, b.count);
            const score = Math.abs(Math.log(ratio / target))
                + (recent.has(a.key) ? HL_RECENT_PENALTY : 0)
                + (recent.has(b.key) ? HL_RECENT_PENALTY : 0);
            if (score < bestScore) { bestScore = score; best = [a, b]; }
        }
    }
    if (!best) best = candidates.slice(0, 2);
    hlState.lastPair = [best[0].key, best[1].key].sort().join("\n");

    return Math.random() < 0.5
        ? { left: best[0], right: best[1] }
        : { left: best[1], right: best[0] };
}

function hlOptionEls() {
    return {
        left: document.querySelector('.hl-option[data-side="left"]'),
        right: document.querySelector('.hl-option[data-side="right"]')
    };
}

function hlFillOption(el, entry, type) {
    el.classList.remove("revealed", "correct", "wrong");
    el.querySelector(".entity-art")?.remove();
    el.prepend(createArtworkElement(type, entry.name, entry.artist || entry.name, null, "hl-option-art"));
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
        fb.textContent = tie ? "Same count, so either answer is right." : "Correct";
        fb.className = "hl-feedback good";
        showCelebration("Correct!");
        hlState.pending = "next";
    } else {
        fb.textContent = "Wrong. The other one has more scrobbles.";
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
        streak: 0,
        lastPair: "",
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
