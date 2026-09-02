// The filter sidebar: control wiring, the active-filter summary, reset,
// comparison mode and the equation tag buttons.

import {
    DISPLAY_MODE_BAR_CHART,
    DISPLAY_MODE_BAR_RACE,
    DISPLAY_MODE_LIST,
    GLOBAL_BASE_SETTING_IDS
} from '../config.js';
import {
    equationCommands,
    equationFieldResolvers,
    equationOperatorDescriptions,
    equationOperatorTokens,
    formatEquationFieldLabel
} from '../data/equations.js';
import {
    applyFilterInputState,
    filterTracks,
    getManagedFilterElements,
    normalizeEntitySorting,
    readCurrentFilterInputState
} from '../data/filters.js';
import { isSortingBasisUsingXValue } from '../data/metrics.js';
import { getControlLabelText, insertAtCursor, serializeControlValue } from '../dom.js';
import { state } from '../state.js';
import {
    destroyVisualizationState,
    ensureRaceDateDefaults,
    hasRaceSettingsReady,
    updateRaceControlsVisibility
} from './charts.js';
import { displayEntities, getSelectedDisplayMode } from './lists.js';

function getEquationInsertTargetInput() {
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.id === "equations" || activeElement.id === "equations-right")) {
        if (activeElement.id === "equations-right" && !isComparisonEnabled()) {
            const leftFallback = document.getElementById("equations");
            if (leftFallback) return leftFallback;
        }
        state.lastEquationInsertTargetId = activeElement.id;
        return activeElement;
    }

    const rememberedTarget = document.getElementById(state.lastEquationInsertTargetId);
    if (rememberedTarget) {
        if (rememberedTarget.id === "equations-right" && !isComparisonEnabled()) {
            const leftFallback = document.getElementById("equations");
            if (leftFallback) return leftFallback;
        }
        return rememberedTarget;
    }

    return document.getElementById("equations");
}

function buildStreamlinedTooltip(control) {
    const labelText = getControlLabelText(control);
    const base = labelText || control.name || control.id || "Filter";
    const cleanBase = base.replace(/\s*:\s*$/, "").trim();
    const placeholder = (control.getAttribute("placeholder") || "").trim();
    if (placeholder) {
        return `${cleanBase}. Example: ${placeholder}`;
    }
    return cleanBase;
}

function applyStreamlinedFilterTooltips() {
    document.querySelectorAll("#filters-section input, #filters-section select, #filters-section textarea").forEach(control => {
        if (!control || !control.id) return;
        if (control.type === "hidden") return;
        control.title = buildStreamlinedTooltip(control);
    });

    const equationsLeft = document.getElementById("equations");
    if (equationsLeft) {
        equationsLeft.title = "Left equations pipeline. Use ; to separate commands.";
    }

    const equationsRight = document.getElementById("equations-right");
    if (equationsRight) {
        equationsRight.title = "Right equations pipeline for comparison mode.";
    }
}

function renderEquationTagButtons() {
    const commandContainer = document.getElementById("equation-command-tags");
    const fieldContainer = document.getElementById("equation-field-tags");
    const operatorContainer = document.getElementById("equation-operator-tags");
    const equationsInput = document.getElementById("equations");

    if (!fieldContainer || !operatorContainer || !equationsInput) return;

    if (commandContainer) {
        commandContainer.innerHTML = "";
        equationCommands.forEach(command => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "equation-tag";
            button.textContent = command.label;
            button.title = command.description;
            button.addEventListener("click", () => insertAtCursor(getEquationInsertTargetInput(), command.label));
            commandContainer.appendChild(button);
        });
    }

    fieldContainer.innerHTML = "";
    operatorContainer.innerHTML = "";

    Object.keys(equationFieldResolvers).forEach(fieldName => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "equation-tag";
        button.textContent = fieldName;
        button.title = `Field: ${formatEquationFieldLabel(fieldName)}`;
        button.addEventListener("click", () => insertAtCursor(getEquationInsertTargetInput(), fieldName));
        fieldContainer.appendChild(button);
    });

    equationOperatorTokens.forEach(operatorToken => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "equation-tag";
        const normalizedOperator = operatorToken.trim() || operatorToken;
        button.textContent = normalizedOperator;
        button.title = `Operator: ${equationOperatorDescriptions[normalizedOperator] || normalizedOperator}`;
        button.addEventListener("click", () => insertAtCursor(getEquationInsertTargetInput(), operatorToken));
        operatorContainer.appendChild(button);
    });
}

export function initializeEquationControls() {
    renderEquationTagButtons();
    applyStreamlinedFilterTooltips();

    ["equations", "equations-right"]
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .forEach(input => {
            ["focus", "click", "keyup", "input", "select"].forEach(eventName => {
                input.addEventListener(eventName, () => {
                    state.lastEquationInsertTargetId = input.id;
                });
            });
        });
}

function addFilter(id, value) {
    if (value.trim() === "") {
        removeFilter(id);
        return;
    }
    const existingFilter = state.activeFilters.find(filter => filter.id === id);
    if (existingFilter) {
        existingFilter.value = value;
    } else {
        state.activeFilters.push({ id, value });
    }
}

function removeFilter(id) {
    const index = state.activeFilters.findIndex(filter => filter.id === id);
    if (index !== -1) {
        state.activeFilters.splice(index, 1);
    }
}

export function isComparisonEnabled() {
    return document.getElementById("comparison-toggle")?.dataset.active === "true";
}

export function getComparisonEditTarget() {
    const value = (document.getElementById("comparison-edit-target")?.value || "left").toLowerCase();
    return value === "right" ? "right" : "left";
}

export function updateComparisonInteractionState() {
    const comparisonEnabled = isComparisonEnabled();
    const comparisonEditTarget = document.getElementById("comparison-edit-target");
    const rightEquationsInput = document.getElementById("equations-right");

    if (comparisonEditTarget) {
        comparisonEditTarget.disabled = !comparisonEnabled;
        comparisonEditTarget.setAttribute("aria-disabled", comparisonEnabled ? "false" : "true");
    }

    if (rightEquationsInput) {
        rightEquationsInput.disabled = !comparisonEnabled;
        rightEquationsInput.setAttribute("aria-disabled", comparisonEnabled ? "false" : "true");
    }

    if (!comparisonEnabled && state.lastEquationInsertTargetId === "equations-right") {
        state.lastEquationInsertTargetId = "equations";
    }
}

// Attach event listeners to filter inputs
document.querySelectorAll(".filters").forEach(filter => {
    const handleFilterInputEvent = (event) => {
        if (!event.target || !event.target.id) return;
        const value = serializeControlValue(event.target);

        if (isComparisonEnabled()) {
            if (event.target.id === "equations") {
                state.comparisonFilterStates.left.equations = value;
            } else if (event.target.id === "equations-right") {
                state.comparisonFilterStates.right.equations = value;
            } else if (GLOBAL_BASE_SETTING_IDS.has(event.target.id)) {
                addFilter(event.target.id, value);
            } else {
                const side = getComparisonEditTarget();
                state.comparisonFilterStates[side][event.target.id] = value;
            }
            updateActiveFilters();
            return;
        }

        if (event.target.id === "equations-right") {
            state.comparisonFilterStates.right.equations = value;
            updateActiveFilters();
            return;
        }

        addFilter(event.target.id, value);
    };

    filter.addEventListener("input", handleFilterInputEvent);
    filter.addEventListener("change", handleFilterInputEvent);
});

// Function to update the active filters display
export function updateActiveFilters() {
    const activeFiltersDiv = document.getElementById("active-filters");
    activeFiltersDiv.innerHTML = ""; // Clear previous filters

    const filters = [

        // { id: "display-mode", label: "Display mode", isSelect: true }, // Removed as requested
        // { id: "list-length", label: "List length" },
        // { id: "unfiltered-stats", label: "Show unfiltered stats", isSelect: false },
        // { id: "chart-axis", label: "Chart orientation", isSelect: true }, // Removed as requested
        // { id: "chart-scale", label: "Chart scale", isSelect: true }, // Removed as requested
        { id: "race-start-date", label: "Race start date" },
        { id: "race-end-date", label: "Race end date" },
        { id: "race-frequency", label: "Race update frequency", isSelect: true },
        { id: "race-speed-ms", label: "Race speed (ms/frame)" },

        { id: "sorting-basis", label: "Sorting basis", isSelect: true },
        { id: "x-value", label: "X" },

        { id: "max-per-artist", label: "Displayed tracks per artist" },

        // Artist filters

        { id: "artist-initial", label: "Artist initial" },
        { id: "artist-name", label: "Artist name" },
        { id: "artist-includes", label: "Artist name includes" },
        { id: "artist-excludes", label: "Artist name excludes" },
        { id: "artist-name-length-min", label: "Artist min name length" },
        { id: "artist-name-length-max", label: "Artist max name length" },
        { id: "artist-word-count-min", label: "Artist min word count" },
        { id: "artist-word-count-max", label: "Artist max word count" },

        { id: "artist-scrobble-count-min", label: "Artist min user scrobbles" },
        { id: "artist-scrobble-count-max", label: "Artist max user scrobbles" },
        { id: "artist-rank-min", label: "Artist min rank" },
        { id: "artist-rank-max", label: "Artist max rank" },
        { id: "artist-track-count-min", label: "Artist min track count" },
        { id: "artist-track-count-max", label: "Artist max track count" },
        { id: "artist-first-scrobble-years", label: "Artist first scrobble years" },
        { id: "artist-days-since-last-min", label: "Min days since artist last scrobbled" },
        { id: "artist-days-since-last-max", label: "Max days since artist last scrobbled" },


        { id: "artist-listeners-min", label: "Artist min listeners" },
        { id: "artist-listeners-max", label: "Artist max listeners" },
        { id: "artist-global-scrobbles-min", label: "Artist min global playcount" },
        { id: "artist-global-scrobbles-max", label: "Artist max global playcount" },
        { id: "artist-tags", label: "Artist tags" },

        // Album filters

        { id: "album-initial", label: "Album initial" },
        { id: "album-name", label: "Album title" },
        { id: "album-includes", label: "Album title includes" },
        { id: "album-excludes", label: "Album title excludes" },       
        { id: "album-name-length-min", label: "Album min title length" },
        { id: "album-name-length-max", label: "Album max title length" },
        { id: "album-word-count-min", label: "Album min word count" },
        { id: "album-word-count-max", label: "Album max word count" },

        { id: "album-scrobble-count-min", label: "Album min user scrobbles" },
        { id: "album-scrobble-count-max", label: "Album max user scrobbles" },
        { id: "album-rank-min", label: "Album min rank" },
        { id: "album-rank-max", label: "Album max rank" },
        { id: "album-track-count-min", label: "Album min tracks scrobbled" },
        { id: "album-track-count-max", label: "Album max tracks scrobbled" },
        { id: "album-first-scrobble-years", label: "Album first scrobble years" },
        { id: "album-days-since-last-min", label: "Min days since album last scrobbled" },
        { id: "album-days-since-last-max", label: "Max days since album last scrobbled" },

        { id: "album-listeners-min", label: "Album min listeners" },
        { id: "album-listeners-max", label: "Album max listeners" },
        { id: "album-global-scrobbles-min", label: "Album min global playcount" },
        { id: "album-global-scrobbles-max", label: "Album max global playcount" },


        // Track filters

        { id: "track-initial", label: "Track initial" },
        { id: "track-name", label: "Track title" },
        { id: "track-includes", label: "Track title includes" },
        { id: "track-excludes", label: "Track title excludes" },
        { id: "track-name-length-min", label: "Track min title length" },
        { id: "track-name-length-max", label: "Track max title length" },
        { id: "track-word-count-min", label: "Track min word count" },
        { id: "track-word-count-max", label: "Track max word count" },

        { id: "track-scrobble-count-min", label: "Track min user scrobbles" },
        { id: "track-scrobble-count-max", label: "Track max user scrobbles" },
        { id: "track-rank-min", label: "Track min rank" },
        { id: "track-rank-max", label: "Track max rank" },
        { id: "track-first-scrobble-years", label: "Track first scrobble years" },
        { id: "track-days-since-last-min", label: "Min days since track last scrobbled" },
        { id: "track-days-since-last-max", label: "Max days since track last scrobbled" },

        { id: "track-listeners-min", label: "Track min listeners" },
        { id: "track-listeners-max", label: "Track max listeners" },
        { id: "track-global-scrobbles-min", label: "Track min global playcount" },
        { id: "track-global-scrobbles-max", label: "Track max global playcount" },
        { id: "track-duration-min", label: "Track minimum duration" },
        { id: "track-duration-max", label: "Track maximum duration" },

        // Time filters

        { id: "year", label: "Year" },
        { id: "month", label: "Month", isSelect: true },
        { id: "day-of-month", label: "Day of month" },
        { id: "weekday", label: "Weekday", isSelect: true },
        { id: "time-of-day-start", label: "Time of day (start)" },
        { id: "time-of-day-end", label: "Time of day (end)" },
        { id: "session-starter-only", label: "Session starter", isSelect: true },
        { id: "day-starter-only", label: "Day starter", isSelect: true },
        { id: "day-starter-gap-hours", label: "Session/day starter long gap (hours)" },
        { id: "date-range-start", label: "Date range start" },
        { id: "date-range-end", label: "Date range end" },
        { id: "last-n-days", label: "Last X days" },
        { id: "scrobble-order-from", label: "Scrobble order (min)" },
        { id: "scrobble-order-to", label: "Scrobble order (max)" },

        // Equation filters

        { id: "equations", label: "Equations" },
        { id: "equations-right", label: "Equations" }
    ];

    const labelById = {};
    const isSelectById = {};
    filters.forEach(filter => {
        labelById[filter.id] = filter.label;
        isSelectById[filter.id] = filter.isSelect === true;
    });

    const formatTagValue = (id, rawValue) => {
        const value = (rawValue ?? "").toString();
        if (value === "") return value;

        if (isSelectById[id]) {
            const element = document.getElementById(id);
            if (element?.multiple) {
                const selectedValues = new Set(
                    value
                        .split(",")
                        .map(item => item.trim())
                        .filter(Boolean)
                );
                return Array.from(element.options || [])
                    .filter(option => selectedValues.has(option.value))
                    .map(option => option.text)
                    .join(", ");
            }
            const option = element ? Array.from(element.options || []).find(item => item.value === value) : null;
            return option ? option.text : value;
        }

        return value;
    };

    const appendFilterLabel = (text) => {
        const filterLabel = document.createElement("div");
        filterLabel.classList.add("filter-label");
        filterLabel.textContent = text;
        activeFiltersDiv.appendChild(filterLabel);
    };

    if (isComparisonEnabled()) {
        const leftState = state.comparisonFilterStates.left || {};
        const rightState = state.comparisonFilterStates.right || {};
        const leftEquationValue = (document.getElementById("equations")?.value || leftState.equations || "").toString().trim();
        const rightEquationValue = (document.getElementById("equations-right")?.value || rightState.equations || rightState["equations-right"] || "").toString().trim();

        if (leftEquationValue) {
            appendFilterLabel(`Equations (left): ${leftEquationValue}`);
        }

        if (rightEquationValue) {
            appendFilterLabel(`Equations (right): ${rightEquationValue}`);
        }

        const ids = new Set([...Object.keys(leftState), ...Object.keys(rightState)]);
        ids.forEach(id => {
            if (id === "equations" || id === "equations-right") return;
            const canonicalId = id === "equations-right" ? "equations" : id;
            if (canonicalId === "entity-type") return;
            if (!labelById[canonicalId]) return;

            if (canonicalId === "x-value") {
                const leftSorting = (leftState["sorting-basis"] || document.getElementById("sorting-basis")?.value || "").toString();
                const rightSorting = (rightState["sorting-basis"] || document.getElementById("sorting-basis")?.value || "").toString();
                const usesX = (sortingValue) => isSortingBasisUsingXValue(sortingValue);
                if (!usesX(leftSorting) && !usesX(rightSorting)) return;
            }

            const leftValue = (leftState[canonicalId] ?? "").toString().trim();
            const rightValue = (rightState[canonicalId] ?? "").toString().trim();

            if (!leftValue && !rightValue) return;

            // Special handling for sorting-basis in comparison mode
            if (canonicalId === "sorting-basis") {
                // Default value for right is "scrobbles"
                const rightDefault = "scrobbles";
                if (leftValue === rightValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)}`);
                } else if (rightValue === rightDefault || !rightValue) {
                    // Only left is set or right is default, don't specify (Left)
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)}`);
                } else if (leftValue && rightValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)} (Left)`);
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, rightValue)} (Right)`);
                } else if (leftValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)} (Left)`);
                } else if (rightValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, rightValue)} (Right)`);
                }
                return;
            }

            if (leftValue === rightValue) {
                appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)}`);
                return;
            }

            if (leftValue) {
                appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)} (Left)`);
            }

            if (rightValue) {
                appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, rightValue)} (Right)`);
            }
        });

        return;
    }

    filters.forEach(filter => {
        const element = document.getElementById(filter.id);
        if (!element) return; // Skip if element is not found

        const sortingBasisValue = document.getElementById("sorting-basis")?.value || "";
        const sessionStarterValue = document.getElementById("session-starter-only")?.value || "";
        const dayStarterValue = document.getElementById("day-starter-only")?.value || "";

        const rawValue = (element.value ?? "").toString().trim();
        const displayValue = filter.isSelect
            ? Array.from(element.selectedOptions).map(option => option.text).join(", ")
            : (element.type === "checkbox" ? (element.checked ? "Yes" : "No") : element.value);

        let shouldShow = rawValue !== "";

        if (filter.id === "session-starter-only" || filter.id === "day-starter-only") {
            shouldShow = rawValue !== "";
        }

        if (filter.id === "x-value") {
            const usesXValue = isSortingBasisUsingXValue(sortingBasisValue);
            shouldShow = usesXValue && rawValue !== "";
        }

        if (filter.id === "day-starter-gap-hours") {
            const longGapIsUsed = sessionStarterValue === "use-gap" || dayStarterValue === "first-day-smart";
            shouldShow = longGapIsUsed && rawValue !== "";
        }

        if (filter.id === "chart-axis" || filter.id === "chart-scale") {
            const mode = document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST;
            shouldShow = mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE;
        }

        if (filter.id === "race-start-date" || filter.id === "race-end-date" || filter.id === "race-frequency" || filter.id === "race-speed-ms") {
            const mode = document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST;
            shouldShow = mode === DISPLAY_MODE_BAR_RACE && rawValue !== "";
        }

        if (filter.id === "unfiltered-stats") {
            shouldShow = element.checked === true;
        }

        if (shouldShow) {
            appendFilterLabel(`${filter.label}: ${displayValue}`);
        }
    });
}

function resetFilters() {
    destroyVisualizationState();
    state.raceRenderArmed = false;

    // Reset all input and select elements within #filters-section
    document.querySelectorAll("#filters-section input, #filters-section select, #filters-section textarea").forEach(element => {
        element.value = "";
    });
    
    // Clear the activeFilters array (using splice or reassigning an empty array)
    state.activeFilters.length = 0;
    state.comparisonFilterStates = { left: {}, right: {} };
    state.comparisonStateInitialized = false;
    
    // Set default values for sorting basis and entity type
    document.getElementById("sorting-basis").value = "scrobbles";
    document.getElementById("entity-type").value = "track";
    const displayModeSelect = document.getElementById("display-mode");
    if (displayModeSelect) {
        displayModeSelect.value = DISPLAY_MODE_LIST;
    }

    const raceFrequency = document.getElementById("race-frequency");
    if (raceFrequency) raceFrequency.value = "day";

    const raceSpeedInput = document.getElementById("race-speed-ms");
    if (raceSpeedInput) raceSpeedInput.value = "260";
    state.racePlaybackSpeedMs = 260;

    const chartAxis = document.getElementById("chart-axis");
    if (chartAxis) chartAxis.value = "horizontal";

    const chartScale = document.getElementById("chart-scale");
    if (chartScale) chartScale.value = "linear";

    const comparisonButton = document.getElementById("comparison-toggle");
    if (comparisonButton) {
        comparisonButton.dataset.active = "false";
        comparisonButton.textContent = "Comparison: Off";
    }

    const comparisonEditTarget = document.getElementById("comparison-edit-target");
    if (comparisonEditTarget) {
        comparisonEditTarget.value = "left";
    }

    const rightEquationsInput = document.getElementById("equations-right");
    if (rightEquationsInput) {
        rightEquationsInput.value = "";
    }

    ensureRaceDateDefaults(true);
    updateComparisonInteractionState();

    updateRaceControlsVisibility();
    
    // Display the full track list and update active filters display
    filterTracks();
    displayEntities();
    updateActiveFilters();
}

// Event listener for Apply Filters button
document.getElementById("apply-filters").addEventListener("click", () => {
    const mode = getSelectedDisplayMode();
    state.raceRenderArmed = mode === DISPLAY_MODE_BAR_RACE && hasRaceSettingsReady();

    if (isComparisonEnabled()) {
        displayEntities();
        return;
    }

    filterTracks();
    displayEntities(); // Displays tracks, albums, or artists based on sorting
});

// Event listener for Reset Filters button
document.getElementById("reset-filters").addEventListener("click", resetFilters);

document.getElementById("comparison-toggle").addEventListener("click", () => {
    const button = document.getElementById("comparison-toggle");
    const isActive = button.dataset.active === "true";
    const nextValue = !isActive;

    if (nextValue && !state.comparisonStateInitialized) {
        const snapshot = readCurrentFilterInputState();
        state.comparisonFilterStates.left = {
            ...snapshot,
            equations: (document.getElementById("equations")?.value || snapshot.equations || "").toString()
        };
        state.comparisonFilterStates.right = {
            equations: (document.getElementById("equations-right")?.value || "").toString()
        };
        state.comparisonStateInitialized = true;
    }

    if (isActive) {
        const currentSide = getComparisonEditTarget();
        const snapshot = readCurrentFilterInputState();
        if (currentSide === "right") {
            snapshot.equations = (document.getElementById("equations-right")?.value || state.comparisonFilterStates.right?.equations || "").toString();
        } else {
            snapshot.equations = (document.getElementById("equations")?.value || state.comparisonFilterStates.left?.equations || "").toString();
        }
        state.comparisonFilterStates[currentSide] = {
            ...(state.comparisonFilterStates[currentSide] || {}),
            ...snapshot
        };
    }

    button.dataset.active = nextValue ? "true" : "false";
    button.textContent = nextValue ? "Comparison: On" : "Comparison: Off";

    if (nextValue) {
        const target = getComparisonEditTarget();
        applyFilterInputState(state.comparisonFilterStates[target]);
    } else {
        state.activeFilters.length = 0;
        getManagedFilterElements().forEach(element => {
            const value = element.type === "checkbox"
                ? (element.checked ? "true" : "")
                : element.value;
            addFilter(element.id, value);
        });

        const rightEquationsInput = document.getElementById("equations-right");
        if (rightEquationsInput) {
            state.comparisonFilterStates.right.equations = rightEquationsInput.value;
        }
    }

    updateComparisonInteractionState();
    updateActiveFilters();
});

document.getElementById("comparison-edit-target").addEventListener("change", () => {
    if (!isComparisonEnabled()) return;

    const previousSide = getComparisonEditTarget() === "left" ? "right" : "left";
    const snapshot = readCurrentFilterInputState();
    if (previousSide === "right") {
        snapshot.equations = (document.getElementById("equations-right")?.value || state.comparisonFilterStates.right?.equations || "").toString();
    } else {
        snapshot.equations = (document.getElementById("equations")?.value || state.comparisonFilterStates.left?.equations || "").toString();
    }
    state.comparisonFilterStates[previousSide] = {
        ...(state.comparisonFilterStates[previousSide] || {}),
        ...snapshot
    };

    const currentSide = getComparisonEditTarget();
    applyFilterInputState(state.comparisonFilterStates[currentSide]);
    updateActiveFilters();
});

document.querySelectorAll('.dropdown').forEach(dropdown => {
    dropdown.addEventListener('click', function(event) {
        const content = this.querySelector('.dropdown-content');
        content.classList.toggle('open');
        
        // Prevent scrolling of the body when the dropdown is open
        if (content.classList.contains('open')) {
            document.body.classList.add('no-scroll');
        } else {
            document.body.classList.remove('no-scroll');
        }
        
        // Prevent the dropdown click from propagating and causing body scroll
        event.stopPropagation();
    });
});

function syncEntitySortingSelectors() {
    const entityElement = document.getElementById("entity-type");
    const sortingElement = document.getElementById("sorting-basis");
    if (!entityElement || !sortingElement) return;

    const normalized = normalizeEntitySorting(entityElement.value, sortingElement.value);
    entityElement.value = normalized.entityType;
    sortingElement.value = normalized.sortingBasis;

    const xInput = document.getElementById("x-value");
    if (xInput) {
        const usesX = isSortingBasisUsingXValue(normalized.sortingBasis);
        xInput.style.display = usesX ? "block" : "none";
    }

    if (isComparisonEnabled()) {
        const side = getComparisonEditTarget();
        state.comparisonFilterStates[side] = {
            ...(state.comparisonFilterStates[side] || {}),
            ...readCurrentFilterInputState(),
            equations: (state.comparisonFilterStates[side]?.equations ?? "").toString()
        };
    } else {
        addFilter("entity-type", normalized.entityType);
        addFilter("sorting-basis", normalized.sortingBasis);
    }
}

document.getElementById("sorting-basis").addEventListener("change", () => {
    syncEntitySortingSelectors();
    updateActiveFilters();
});

document.getElementById("entity-type").addEventListener("change", () => {
    syncEntitySortingSelectors();
    updateActiveFilters();
});

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const openDropdown = document.querySelector('.dropdown-content.open');
    if (openDropdown && !openDropdown.contains(event.target)) {
        openDropdown.classList.remove('open');
        document.body.classList.remove('no-scroll');
    }
});
