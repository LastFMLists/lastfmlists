// Wiring shared by the three games.

import { setActiveView } from '../ui/shell.js';
import {
    ftlFinish,
    ftlForceGuess,
    ftlNextPuzzle,
    ftlOnInput,
    ftlOpenGame,
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
import { loadGamesRecords } from './records.js';

export function initGames() {
    loadGamesRecords();

    const tabLists = document.getElementById("tab-lists");
    const tabGames = document.getElementById("tab-games");
    if (tabLists) tabLists.addEventListener("click", () => {
        if (document.body.classList.contains("view-games")) setActiveView("lists");
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
}
