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
            if (mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE) {
                displayEntities();
            }
        }, 0);
    });
}

// ---- View switching (Lists / Games) ----
export function setActiveView(view) {
    const games = view === "games";
    document.body.classList.toggle("view-games", games);
    const listsTab = document.getElementById("tab-lists");
    const gamesTab = document.getElementById("tab-games");
    if (listsTab) {
        listsTab.classList.toggle("is-active", !games);
        listsTab.setAttribute("aria-pressed", String(!games));
    }
    if (gamesTab) {
        gamesTab.classList.toggle("is-active", games);
        gamesTab.setAttribute("aria-pressed", String(games));
    }
    if (games) hlShowHome();
    else hlClearTimer();
}

// The Games tab is only usable once a library has actually loaded.
export function enableGamesTab() {
    const gamesTab = document.getElementById("tab-games");
    if (gamesTab) {
        gamesTab.disabled = false;
        gamesTab.title = "Play games with your listening data";
    }
}

function syncSidebarLayoutState() {
    const sidebar = document.getElementById("filters-section");
    if (!sidebar) return;
    document.body.classList.toggle("sidebar-collapsed", sidebar.classList.contains("closed"));
}

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
