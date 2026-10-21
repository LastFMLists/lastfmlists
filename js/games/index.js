// Wiring shared by the games.

import { getActiveView, setActiveView } from '../ui/shell.js';
import {
    ftlFinish,
    ftlForceGuess,
    ftlNextPuzzle,
    ftlOnInput,
    ftlOpenGame,
    ftlShowSetup,
    ftlStartGame
} from './fill-the-list.js';
import {
    hlGuess,
    hlOpenGame,
    hlRestartCurrent,
    hlShowHome,
    hlShowSetup,
    hlStart
} from './higher-lower.js';
import {
    initOrderingControls,
    ordCheck,
    ordNextRound,
    ordOpenGame,
    ordRestartCurrent,
    ordShowSetup,
    ordStart
} from './ordering.js';
import {
    oddNextRound,
    oddOpenGame,
    oddPick,
    oddRestartCurrent,
    oddShowSetup,
    oddStart
} from './odd-one-out.js';
import {
    threadNextRound,
    threadOpenGame,
    threadPick,
    threadRestartCurrent,
    threadShowSetup,
    threadStart
} from './common-thread.js';
import { loadGamesRecords } from './records.js';

export function initGames() {
    loadGamesRecords();

    const tabLists = document.getElementById("tab-lists");
    const tabGames = document.getElementById("tab-games");
    if (tabLists) tabLists.addEventListener("click", () => {
        if (getActiveView() !== "lists") setActiveView("lists");
    });
    if (tabGames) tabGames.addEventListener("click", () => {
        if (!tabGames.disabled && !document.body.classList.contains("view-games")) setActiveView("games");
    });

    // Higher or Lower
    const openHL = document.getElementById("open-higherlower");
    if (openHL) openHL.addEventListener("click", hlOpenGame);

    const back = document.getElementById("hl-back");
    if (back) back.addEventListener("click", hlShowHome);

    document.querySelectorAll(".hl-type").forEach(btn =>
        btn.addEventListener("click", () => hlStart(btn.dataset.type)));

    document.querySelectorAll(".hl-option").forEach(btn =>
        btn.addEventListener("click", () => hlGuess(btn.dataset.side)));

    const again = document.getElementById("hl-again");
    if (again) again.addEventListener("click", hlRestartCurrent);

    const changeType = document.getElementById("hl-change-type");
    if (changeType) changeType.addEventListener("click", hlShowSetup);

    // Fill the List
    const openFTL = document.getElementById("open-filllist");
    if (openFTL) openFTL.addEventListener("click", ftlOpenGame);

    const ftlBack = document.getElementById("ftl-back");
    if (ftlBack) ftlBack.addEventListener("click", hlShowHome);

    const ftlStartBtn = document.getElementById("ftl-start");
    if (ftlStartBtn) ftlStartBtn.addEventListener("click", ftlStartGame);

    const ftlInput = document.getElementById("ftl-guess");
    if (ftlInput) ftlInput.addEventListener("input", ftlOnInput);

    const ftlForm = document.getElementById("ftl-guess-form");
    if (ftlForm) ftlForm.addEventListener("submit", (e) => { e.preventDefault(); ftlForceGuess(); });

    const ftlReveal = document.getElementById("ftl-reveal");
    if (ftlReveal) ftlReveal.addEventListener("click", () => ftlFinish(false));

    const ftlOptions = document.getElementById("ftl-options");
    if (ftlOptions) ftlOptions.addEventListener("click", () => ftlShowSetup(false));

    const ftlNext = document.getElementById("ftl-next");
    if (ftlNext) ftlNext.addEventListener("click", ftlNextPuzzle);

    // Put Them In Order
    const openOrd = document.getElementById("open-ordering");
    if (openOrd) openOrd.addEventListener("click", ordOpenGame);

    const ordBack = document.getElementById("ord-back");
    if (ordBack) ordBack.addEventListener("click", hlShowHome);

    document.querySelectorAll(".ord-type").forEach(btn =>
        btn.addEventListener("click", () => ordStart(btn.dataset.type)));

    const ordCheckBtn = document.getElementById("ord-check");
    if (ordCheckBtn) ordCheckBtn.addEventListener("click", ordCheck);

    const ordNextBtn = document.getElementById("ord-next");
    if (ordNextBtn) ordNextBtn.addEventListener("click", ordNextRound);

    const ordChangeType = document.getElementById("ord-change-type");
    if (ordChangeType) ordChangeType.addEventListener("click", () => ordShowSetup(false));

    const ordAgain = document.getElementById("ord-again");
    if (ordAgain) ordAgain.addEventListener("click", ordRestartCurrent);

    const ordOverChangeType = document.getElementById("ord-over-change-type");
    if (ordOverChangeType) ordOverChangeType.addEventListener("click", () => ordShowSetup(false));

    initOrderingControls();

    // Odd One Out and Common Thread share the same screens: a type choice, a
    // round with a Next round button, and a run-over panel under the reveal.
    const factGames = [
        { prefix: "odd", open: oddOpenGame, start: oddStart, next: oddNextRound, setup: oddShowSetup, again: oddRestartCurrent },
        { prefix: "thread", open: threadOpenGame, start: threadStart, next: threadNextRound, setup: threadShowSetup, again: threadRestartCurrent }
    ];
    for (const g of factGames) {
        document.getElementById(`open-${g.prefix}`)?.addEventListener("click", g.open);
        document.getElementById(`${g.prefix}-back`)?.addEventListener("click", hlShowHome);
        document.querySelectorAll(`.${g.prefix}-type`).forEach(btn =>
            btn.addEventListener("click", () => g.start(btn.dataset.type)));
        document.getElementById(`${g.prefix}-next`)?.addEventListener("click", g.next);
        document.getElementById(`${g.prefix}-again`)?.addEventListener("click", g.again);
        document.getElementById(`${g.prefix}-change-type`)?.addEventListener("click", () => g.setup(false));
        document.getElementById(`${g.prefix}-over-change-type`)?.addEventListener("click", () => g.setup(false));
    }

    document.getElementById("odd-options")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".odd-option");
        if (btn) oddPick(btn.dataset.key);
    });
    document.getElementById("thread-statements")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".thread-statement");
        if (btn) threadPick(Number(btn.dataset.index));
    });
}
