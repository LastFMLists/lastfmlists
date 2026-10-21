// Common Thread: four items and four statements, and only one statement holds
// for all four.

import { createArtworkElement } from '../data/artwork.js';
import { escapeHTML } from '../dom.js';
import { showCelebration } from './celebration.js';
import { buildThreadRound, createFactMemory, factContext, factPool, resetFactStats, showFact, statementHolds } from './facts.js';
import { gamesRecords, saveGamesRecords } from './records.js';
import { rebuildScrobbleIndex } from './scrobble-index.js';
import { showGamePanel } from './screens.js';

let threadState = null;

function threadRenderRound() {
    const { round, type } = threadState;
    const items = document.getElementById("thread-items");
    items.innerHTML = "";
    for (const st of round.items) {
        const li = document.createElement("li");
        li.className = "thread-item";
        const sub = type !== "artist" && st.artist ? `<span class="thread-item-sub">${escapeHTML(st.artist)}</span>` : "";
        li.innerHTML = `<span class="thread-item-text"><span class="thread-item-name">${escapeHTML(st.name)}</span>${sub}</span>`;
        li.prepend(createArtworkElement(type, st.name, st.artist || st.name, null, "thread-item-art"));
        items.appendChild(li);
    }
    const list = document.getElementById("thread-statements");
    list.innerHTML = "";
    round.statements.forEach((stmt, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "thread-statement";
        btn.dataset.index = i;
        btn.innerHTML = `<span class="thread-statement-text">All four ${escapeHTML(stmt.text)}</span><span class="thread-checks"></span>`;
        list.appendChild(btn);
    });
    const fb = document.getElementById("thread-feedback");
    fb.textContent = "";
    fb.className = "hl-feedback";
    document.getElementById("thread-next").hidden = true;
    document.getElementById("thread-actions").hidden = false;
    document.getElementById("thread-over").hidden = true;
    threadUpdateScore();
}

function threadUpdateScore() {
    document.getElementById("thread-score").textContent = `Streak ${threadState.streak} · best ${gamesRecords.threadBest || 0}`;
}

// Under every statement, each item's real value and whether it holds.
function threadReveal(pickedIndex) {
    const { round } = threadState;
    document.querySelectorAll("#thread-statements .thread-statement").forEach(btn => {
        const stmt = round.statements[Number(btn.dataset.index)];
        btn.classList.add("revealed");
        if (stmt === round.answer) btn.classList.add("correct");
        else if (Number(btn.dataset.index) === pickedIndex) btn.classList.add("wrong");
        btn.querySelector(".thread-checks").innerHTML = round.items.map(st => {
            const holds = statementHolds(stmt, st);
            return `<span class="thread-check ${holds ? "ok" : "no"}">` +
                `<i class="fas ${holds ? "fa-check" : "fa-xmark"}" aria-hidden="true"></i>` +
                `<span><span class="visually-hidden">${holds ? "Holds" : "Doesn't hold"}: </span>` +
                `<strong>${escapeHTML(st.name)}</strong> ${escapeHTML(showFact(stmt, st))}</span></span>`;
        }).join("");
    });
}

export function threadPick(index) {
    if (!threadState || !threadState.round || threadState.picked) return;
    threadState.picked = true;
    const { round } = threadState;
    const correct = round.statements[index] === round.answer;
    threadReveal(index);

    gamesRecords.threadPlayed = (gamesRecords.threadPlayed || 0) + 1;
    const fb = document.getElementById("thread-feedback");
    if (correct) {
        threadState.streak += 1;
        if (threadState.streak > (gamesRecords.threadBest || 0)) gamesRecords.threadBest = threadState.streak;
        saveGamesRecords();
        fb.textContent = "Correct";
        fb.className = "hl-feedback good";
        showCelebration("Correct!");
        threadUpdateScore();
        document.getElementById("thread-next").hidden = false;
        return;
    }

    // A wrong pick ends the run, with every statement's values left on screen.
    saveGamesRecords();
    fb.textContent = "Not that one. The green statement is the one all four share.";
    fb.className = "hl-feedback bad";
    document.getElementById("thread-final").textContent = threadState.streak;
    document.getElementById("thread-best").textContent = gamesRecords.threadBest || 0;
    document.getElementById("thread-actions").hidden = true;
    document.getElementById("thread-over").hidden = false;
}

export function threadNextRound() {
    const round = buildThreadRound(threadState.type, threadState.streak, threadState.memory, threadState.ctx);
    if (!round) {
        threadShowSetup(true);
        return;
    }
    threadState.round = round;
    threadState.picked = false;
    threadRenderRound();
}

export function threadStart(type) {
    rebuildScrobbleIndex();
    resetFactStats();
    if (factPool(type, Infinity).length < 4) {
        threadShowSetup(true);
        return;
    }
    beginRun(type);
}

// Play the same type again after a miss: the streak and the ramp start over,
// but the memory of recent items and criteria carries on.
export function threadRestartCurrent() {
    if (threadState) beginRun(threadState.type, threadState.memory);
}

function beginRun(type, memory = createFactMemory()) {
    threadState = { type, memory, ctx: factContext(), streak: 0, round: null, picked: false };
    document.getElementById("thread-setup").hidden = true;
    document.getElementById("thread-play").hidden = false;
    threadNextRound();
}

export function threadOpenGame() {
    showGamePanel("thread-game");
    threadShowSetup(false);
}

export function threadShowSetup(showNote) {
    document.getElementById("thread-setup").hidden = false;
    document.getElementById("thread-play").hidden = true;
    const note = document.getElementById("thread-setup-note");
    note.hidden = !showNote;
    if (showNote) note.textContent = "Not enough data of that kind to build a round yet. Try another type.";
}
