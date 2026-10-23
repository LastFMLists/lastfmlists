// Odd One Out: three of four items share a fact, and you pick the one that doesn't.

import { trackGameRound } from '../analytics.js';
import { createArtworkElement } from '../data/artwork.js';
import { escapeHTML } from '../dom.js';
import { showCelebration } from './celebration.js';
import { buildOddRound, createFactMemory, factContext, factPool, resetFactStats, showFact } from './facts.js';
import { gamesRecords, saveGamesRecords } from './records.js';
import { rebuildScrobbleIndex } from './scrobble-index.js';
import { showGamePanel } from './screens.js';

let oddState = null;

function oddRenderRound() {
    const { round, type } = oddState;
    document.getElementById("odd-prompt").textContent = `Three of these ${round.stmt.text}.`;
    const list = document.getElementById("odd-options");
    list.innerHTML = "";
    for (const st of round.items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "odd-option";
        btn.dataset.key = st.key;
        const sub = type !== "artist" && st.artist ? `<span class="odd-option-sub">${escapeHTML(st.artist)}</span>` : "";
        btn.innerHTML =
            `<span class="odd-option-name">${escapeHTML(st.name)}</span>${sub}` +
            `<span class="odd-option-value"></span>`;
        btn.prepend(createArtworkElement(type, st.name, st.artist || st.name, null, "odd-option-art"));
        list.appendChild(btn);
    }
    const fb = document.getElementById("odd-feedback");
    fb.textContent = "";
    fb.className = "hl-feedback";
    document.getElementById("odd-next").hidden = true;
    document.getElementById("odd-actions").hidden = false;
    document.getElementById("odd-over").hidden = true;
    oddUpdateScore();
}

function oddUpdateScore() {
    document.getElementById("odd-score").textContent = `Streak ${oddState.streak} · best ${gamesRecords.oddBest || 0}`;
}

export function oddPick(key) {
    if (!oddState || !oddState.round || oddState.picked) return;
    oddState.picked = true;
    const { round } = oddState;
    const byKey = new Map(round.items.map(st => [st.key, st]));
    const correct = key === round.oddKey;

    for (const btn of document.querySelectorAll("#odd-options .odd-option")) {
        const st = byKey.get(btn.dataset.key);
        btn.classList.add("revealed");
        btn.querySelector(".odd-option-value").textContent = showFact(round.stmt, st);
        if (btn.dataset.key === round.oddKey) btn.classList.add("correct");
        else if (btn.dataset.key === key) btn.classList.add("wrong");
    }

    oddState.rounds += 1;
    trackGameRound("odd-one-out", oddState.rounds);
    gamesRecords.oddPlayed = (gamesRecords.oddPlayed || 0) + 1;
    const fb = document.getElementById("odd-feedback");
    if (correct) {
        oddState.streak += 1;
        if (oddState.streak > (gamesRecords.oddBest || 0)) gamesRecords.oddBest = oddState.streak;
        saveGamesRecords();
        fb.textContent = "Correct";
        fb.className = "hl-feedback good";
        showCelebration("Correct!");
        oddUpdateScore();
        document.getElementById("odd-next").hidden = false;
        return;
    }

    // A wrong pick ends the run. The cards stay revealed so the values can be read.
    saveGamesRecords();
    fb.textContent = `Not that one. ${byKey.get(round.oddKey).name} is the odd one out.`;
    fb.className = "hl-feedback bad";
    document.getElementById("odd-final").textContent = oddState.streak;
    document.getElementById("odd-best").textContent = gamesRecords.oddBest || 0;
    document.getElementById("odd-actions").hidden = true;
    document.getElementById("odd-over").hidden = false;
}

export function oddNextRound() {
    const round = buildOddRound(oddState.type, oddState.streak, oddState.memory, oddState.ctx);
    if (!round) {
        oddShowSetup(true);
        return;
    }
    oddState.round = round;
    oddState.picked = false;
    oddRenderRound();
}

export function oddStart(type) {
    rebuildScrobbleIndex();
    resetFactStats();
    if (factPool(type, Infinity).length < 4) {
        oddShowSetup(true);
        return;
    }
    beginRun(type);
}

// Play the same type again after a miss: the streak and the ramp start over,
// but the memory of recent items and criteria carries on.
export function oddRestartCurrent() {
    if (oddState) beginRun(oddState.type, oddState.memory);
}

function beginRun(type, memory = createFactMemory()) {
    oddState = { type, memory, ctx: factContext(), streak: 0, rounds: 0, round: null, picked: false };
    document.getElementById("odd-setup").hidden = true;
    document.getElementById("odd-play").hidden = false;
    oddNextRound();
}

export function oddOpenGame() {
    showGamePanel("odd-game");
    oddShowSetup(false);
}

export function oddShowSetup(showNote) {
    document.getElementById("odd-setup").hidden = false;
    document.getElementById("odd-play").hidden = true;
    const note = document.getElementById("odd-setup-note");
    note.hidden = !showNote;
    if (showNote) note.textContent = "Not enough data of that kind to build a round yet. Try another type.";
}
