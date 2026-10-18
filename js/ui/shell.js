// The frame around everything: welcome screen versus loaded app, load
// errors, the metadata lock, view switching and the filter sidebar.

import { updateSessionAvatar } from '../api/lastfm.js';
import {
    DISPLAY_MODE_BAR_CHART,
    DISPLAY_MODE_BAR_RACE,
    EXTENDED_LOCKED_MSG
} from '../config.js';
import { loadingDiv, resultsDiv } from '../dom.js';
import { hlClearTimer, hlShowHome } from '../games/higher-lower.js';
import { state } from '../state.js';
import { displayEntities, getSelectedDisplayMode } from './lists.js';

export function setAppLoadedState(username) {
    document.body.classList.add('app-loaded');
    const sessionUsername = document.getElementById('session-username');
    const avatarFallback = document.getElementById('session-avatar-fallback');
    if (sessionUsername && username) {
        sessionUsername.textContent = `Lists for ${username}`;
    }
    if (avatarFallback) {
        avatarFallback.textContent = (username || '?').trim().charAt(0).toUpperCase() || '?';
    }
    if (username) {
        updateSessionAvatar(username);
    }
}

// While a history load runs the list on screen is only a preview, so the
// controls that would rebuild it wait until the load is done. Filters can
// still be set up meanwhile; they apply when the load finishes.
const LIST_CONTROLS_LOCKED_WHILE_LOADING = ["apply-filters", "reset-filters", "display-mode", "comparison-toggle", "graph-this-list"];
const WAIT_FOR_LOAD_MSG = "Available once your data has finished loading";

export function setListControlsLocked(locked) {
    LIST_CONTROLS_LOCKED_WHILE_LOADING.forEach(id => {
        const control = document.getElementById(id);
        if (!control) return;
        if (locked) {
            if (control.dataset.titleBeforeLoad === undefined) control.dataset.titleBeforeLoad = control.title;
            control.title = WAIT_FOR_LOAD_MSG;
        } else if (control.dataset.titleBeforeLoad !== undefined) {
            control.title = control.dataset.titleBeforeLoad;
            delete control.dataset.titleBeforeLoad;
        }
        control.disabled = locked;
    });
}

// Undo setAppLoadedState so a failed load returns to the welcome screen
// instead of stranding the user on an empty app shell.
export function clearAppLoadedState() {
    document.body.classList.remove('app-loaded');
    if (loadingDiv) loadingDiv.innerHTML = "";
    const heading = document.querySelector("#results-section h2");
    if (heading) heading.textContent = "Results";
    if (resultsDiv) resultsDiv.innerHTML = "";
}

export function showLoadError(message) {
    const box = document.getElementById('load-error');
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
}

export function clearLoadError() {
    const box = document.getElementById('load-error');
    if (!box) return;
    box.textContent = "";
    box.hidden = true;
}

// Enable/disable every control that only works once detailed Last.fm metadata
// has been loaded, and explain via tooltip how to unlock it. Called on init,
// after metadata loads, and after restoring saved data that already has it.
export function updateExtendedDataUI() {
    const locked = !state.extendedDataLoaded;

    document.querySelectorAll(".requires-extended").forEach(group => {
        group.classList.toggle("locked", locked);
        group.title = locked ? EXTENDED_LOCKED_MSG : "";
        group.querySelectorAll("input, select, textarea").forEach(control => {
            control.disabled = locked;
            control.title = locked ? EXTENDED_LOCKED_MSG : "";
        });
    });

    // Sorting options that depend on metadata (duration, global playcount).
    const sortingSelect = document.getElementById("sorting-basis");
    if (sortingSelect) {
        ["time-spent-listening", "highest-listening-percentage"].forEach(value => {
            const option = sortingSelect.querySelector(`option[value="${value}"]`);
            if (!option) return;
            option.disabled = locked;
            const base = option.textContent.replace(/\s*🔒.*$/, "");
            option.textContent = locked ? `${base} 🔒` : base;
        });
        // If a now-locked option was somehow selected, revert to the default.
        if (locked && sortingSelect.selectedOptions[0]?.disabled) {
            sortingSelect.value = "scrobbles";
        }
    }

    // Lets the filter controls re-apply which sorts fit the list type.
    document.dispatchEvent(new CustomEvent("filters:changed"));
}

// Detect whether an already-loaded dataset (e.g. restored from the browser)
// contains detailed metadata, so gated controls unlock without a re-fetch.
export function datasetHasExtendedMetadata() {
    const hasTags = Array.isArray(state.artistsData) && state.artistsData.some(a => Array.isArray(a?.tags) && a.tags.length > 0);
    const hasDuration = Array.isArray(state.tracksData) && state.tracksData.some(t => parseInt(t?.duration, 10) > 0);
    const hasGlobal = Array.isArray(state.artistsData) && state.artistsData.some(a => parseInt(a?.listeners, 10) > 0 || parseInt(a?.playcount, 10) > 0);
    return hasTags || hasDuration || hasGlobal;
}

const themeToggleButton = document.getElementById("theme-toggle");
if (themeToggleButton) {
    themeToggleButton.addEventListener("click", () => {
        setTimeout(() => {
            const mode = getSelectedDisplayMode();
            if (mode === DISPLAY_MODE_BAR_RACE && (state.activeRaceState || state.raceBuilding)) {
                // The race reads its colors on every draw, so a repaint is
                // enough and it keeps its place. One still being built picks
                // up the theme when it appears.
                state.activeRaceState?.redraw();
            } else if (mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE) {
                displayEntities();
            }
        }, 0);
    });
}

// ---- View switching (Explore / Lists / Graphs / Games) ----
const VIEWS = ["explore", "lists", "graphs", "games"];
const VIEW_STORAGE_KEY = "lastfmlists-view";

// The tab used last, so a returning visitor lands where they left off.
export function rememberedView() {
    try {
        const view = localStorage.getItem(VIEW_STORAGE_KEY);
        return VIEWS.includes(view) ? view : null;
    } catch (e) {
        return null;
    }
}

export function getActiveView() {
    if (document.body.classList.contains("view-games")) return "games";
    if (document.body.classList.contains("view-explore")) return "explore";
    if (document.body.classList.contains("view-graphs")) return "graphs";
    return "lists";
}

// The lit tab is the view on screen. An artist, album or track page sits on
// top of a view without being one, so no tab is lit while it is open.
export function syncViewTabs() {
    const view = document.body.classList.contains("view-entity") ? null : getActiveView();
    VIEWS.forEach(name => {
        const tab = document.getElementById(`tab-${name}`);
        if (!tab) return;
        tab.classList.toggle("is-active", name === view);
        tab.setAttribute("aria-pressed", String(name === view));
    });
}

export function setActiveView(view) {
    const previous = getActiveView();
    const games = view === "games";
    document.body.classList.toggle("view-games", games);
    document.body.classList.toggle("view-explore", view === "explore");
    document.body.classList.toggle("view-graphs", view === "graphs");
    syncViewTabs();
    if (games) hlShowHome();
    else hlClearTimer();
    // Coming to Lists opens the filters; on phones the drawer would cover
    // the list, so it stays as it was there.
    if (view === "lists" && previous !== "lists" && !window.matchMedia("(max-width: 768px)").matches) {
        openFilterSidebar();
    }
    if (document.body.classList.contains("app-loaded")) {
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, view);
        } catch (e) {
            // Storage blocked: the next visit starts on Explore.
        }
    }
    document.dispatchEvent(new CustomEvent("view:changed", { detail: { view } }));
}

// The Explore, Graphs and Games tabs are only usable once a library has loaded.
export function enableGamesTab() {
    const graphsTab = document.getElementById("tab-graphs");
    if (graphsTab) {
        graphsTab.disabled = false;
        graphsTab.title = "Plot your listening over time";
    }
    const gamesTab = document.getElementById("tab-games");
    if (gamesTab) {
        gamesTab.disabled = false;
        gamesTab.title = "Play games with your listening data";
    }
    const exploreTab = document.getElementById("tab-explore");
    if (exploreTab) {
        exploreTab.disabled = false;
        exploreTab.title = "Ready-made lists from your history";
    }
}

function syncSidebarLayoutState() {
    const sidebar = document.getElementById("filters-section");
    if (!sidebar) return;
    document.body.classList.toggle("sidebar-collapsed", sidebar.classList.contains("closed"));
}

function openFilterSidebar() {
    const sidebar = document.getElementById("filters-section");
    const toggle = document.getElementById("filters-section-toggle");
    if (!sidebar || !sidebar.classList.contains("closed")) return;
    sidebar.classList.remove("closed");
    if (toggle) toggle.innerHTML = "&#10094;";
    syncSidebarLayoutState();
}

// On phones the edge tab only closes the open panel; this button in the
// list header opens it, so nothing sits on top of the list.
document.getElementById("open-filters-mobile")?.addEventListener("click", () => {
    const sidebar = document.getElementById("filters-section");
    if (sidebar?.classList.contains("closed")) document.getElementById("filters-section-toggle").click();
});

document.getElementById("filters-section-toggle").addEventListener("click", function () {
    const sidebar = document.getElementById("filters-section");
    sidebar.classList.toggle("closed");
    syncSidebarLayoutState();

    // Change arrow direction
    this.innerHTML = sidebar.classList.contains("closed") ? "&#10095;" : "&#10094;";
});

// Start with the filter drawer collapsed on small touchscreens so it
// doesn't cover the results when data first loads.
(function initResponsiveSidebarState() {
    const sidebar = document.getElementById("filters-section");
    const toggle = document.getElementById("filters-section-toggle");
    if (sidebar && toggle && window.matchMedia("(max-width: 768px)").matches) {
        sidebar.classList.add("closed");
        toggle.innerHTML = "&#10095;";
    }
})();

syncSidebarLayoutState();
