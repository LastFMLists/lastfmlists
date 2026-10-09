// Friendlier controls for the filter panel. Each one is drawn on top of the
// original input, which stays in the page (hidden where it is replaced) and
// keeps holding the value in the same format as before. The filter engine,
// saved comparison states and the active-filter summary all read those
// inputs, so none of them change.
//
// Writing to an input dispatches the same input/change events a person
// typing would, so the panel's own listeners record the value. When code
// sets an input directly, filters-panel.js fires "filters:changed" and
// every control here redraws from its input.

import { isSortingBasisUsingXValue } from '../data/metrics.js';
import { state } from '../state.js';

const refreshers = [];

function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function setValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function chip(label, pressed, onClick, extraClass = "") {
    const button = make("button", `fc-chip${extraClass ? ` ${extraClass}` : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(pressed));
    button.addEventListener("click", onClick);
    return button;
}

function clearButton(onClick, label = "Clear") {
    const button = make("button", "fc-clear", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
}

function labelFor(input) {
    return document.querySelector(`label[for="${input.id}"]`);
}

// ---- Minimum/maximum pairs become one card ----

function enhanceRangeGroups() {
    document.querySelectorAll("#filters-section .input-group").forEach(group => {
        const pair = group.querySelector(".input-pair");
        if (!pair) return;
        const inputs = Array.from(pair.querySelectorAll("input"));
        if (inputs.length !== 2) return;
        group.classList.add("range-card");

        const title = group.querySelector(":scope > label");
        const header = make("div", "range-card-header");
        if (title) {
            title.replaceWith(header);
            header.appendChild(title);
        } else {
            group.prepend(header);
        }
        const clear = clearButton(() => {
            inputs.forEach(input => { if (input.value) setValue(input, ""); });
        });
        header.appendChild(clear);

        const captions = (pair.dataset.captions || "At least,At most").split(",");
        inputs.forEach((input, index) => {
            const wrapper = make("label", "range-end");
            const caption = make("span", "range-caption", captions[index]);
            input.replaceWith(wrapper);
            wrapper.append(caption, input);
            if (input.type === "number") input.placeholder = "Any";
        });

        const refresh = () => { clear.hidden = !inputs.some(input => input.value); };
        inputs.forEach(input => input.addEventListener("input", refresh));
        refreshers.push(refresh);
        refresh();
    });
}

// ---- Multi-selects and day lists become toggle chips ----

function chipCard(input, { title, collapsed = false }) {
    const card = make("div", "fc-card");
    const header = make("div", "fc-card-header");
    const heading = make("span", "fc-card-title", title);
    const summary = make("span", "fc-card-summary");
    const clear = clearButton(() => {});
    header.append(heading, summary, clear);
    const body = make("div", "fc-chips");
    card.append(header, body);

    let expanded = !collapsed;
    let toggle = null;
    if (collapsed) {
        toggle = make("button", "fc-clear fc-toggle");
        toggle.type = "button";
        toggle.addEventListener("click", () => { expanded = !expanded; paint(); });
        header.appendChild(toggle);
    }
    card._parts = { summary, clear, body };
    let paint = () => {};
    card._setPainter = (fn) => {
        paint = () => {
            fn();
            body.hidden = !expanded;
            if (toggle) {
                toggle.textContent = expanded ? "Hide days" : "Choose days";
                toggle.setAttribute("aria-expanded", String(expanded));
            }
        };
        return paint;
    };
    return card;
}

function enhanceMultiSelect(selectId, title, shortNames) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const label = labelFor(select);
    const card = chipCard(select, { title });
    select.hidden = true;
    if (label) label.hidden = true;
    select.after(card);
    select._fcWidget = card;
    const { summary, clear, body } = card._parts;
    clear.addEventListener("click", () => {
        Array.from(select.options).forEach(option => { option.selected = false; });
        select.dispatchEvent(new Event("change", { bubbles: true }));
        paint();
    });
    const paint = card._setPainter(() => {
        body.innerHTML = "";
        const chosen = Array.from(select.options).filter(option => option.selected);
        Array.from(select.options).forEach(option => {
            body.appendChild(chip(shortNames ? option.text.slice(0, 3) : option.text, option.selected, () => {
                option.selected = !option.selected;
                select.dispatchEvent(new Event("change", { bubbles: true }));
                paint();
            }));
        });
        summary.textContent = chosen.length ? "" : "Any";
        clear.hidden = chosen.length === 0;
    });
    refreshers.push(paint);
    paint();
}

function parseNumberList(value) {
    return (value || "").split(",").map(part => parseInt(part.trim(), 10)).filter(number => !isNaN(number));
}

function enhanceNumberChips(inputId, title, numbers, { collapsed = false } = {}) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const label = labelFor(input);
    const card = chipCard(input, { title, collapsed });
    input.hidden = true;
    if (label) label.hidden = true;
    input.after(card);
    input._fcWidget = card;
    const { summary, clear, body } = card._parts;
    clear.addEventListener("click", () => { setValue(input, ""); paint(); });
    const paint = card._setPainter(() => {
        const chosen = new Set(parseNumberList(input.value));
        body.innerHTML = "";
        const all = typeof numbers === "function" ? numbers() : numbers;
        // Keep values typed in earlier that fall outside the offered range.
        const offered = [...new Set([...all, ...chosen])].sort((a, b) => a - b);
        offered.forEach(number => {
            body.appendChild(chip(String(number), chosen.has(number), () => {
                if (chosen.has(number)) chosen.delete(number);
                else chosen.add(number);
                setValue(input, [...chosen].sort((a, b) => a - b).join(","));
                paint();
            }));
        });
        summary.textContent = chosen.size ? `${chosen.size} selected` : "Any";
        clear.hidden = chosen.size === 0;
    });
    refreshers.push(paint);
    paint();
}

// Every year between the first and last loaded scrobble.
function libraryYears() {
    const tracks = state.allTracks || [];
    if (!tracks.length) return [];
    const first = new Date(Number(tracks[0].Date)).getFullYear();
    const last = new Date(Number(tracks[tracks.length - 1].Date)).getFullYear();
    const years = [];
    for (let year = first; year <= last; year++) years.push(year);
    return years;
}

// ---- Name includes/excludes and tags become word groups ----
//
// The stored value keeps its old syntax: commas separate alternatives and
// semicolons separate groups that must all match.

function termGroups(value) {
    return (value || "").split(";")
        .map(group => group.split(",").map(word => word.trim()).filter(Boolean))
        .filter(group => group.length);
}

function encodeTermGroups(groups) {
    return groups.map(group => group.join(",")).join(";");
}

function enhanceTermField(input, exclude) {
    const label = labelFor(input);
    const card = make("div", "fc-card fc-terms");
    const header = make("div", "fc-card-header");
    const title = make("span", "fc-card-title", label ? label.textContent.trim() : "Words");
    const clear = clearButton(() => { setValue(input, ""); paint(); });
    header.append(title, clear);
    const help = make("p", "fc-help", exclude
        ? "Leaves out names containing any word in a group. With more than one group, a name is left out only when it matches every group."
        : "Keeps names containing any word in a group. With more than one group, a name has to match every group.");
    const groupsBox = make("div", "fc-term-groups");
    const entry = make("input", "fc-term-entry");
    entry.type = "text";
    entry.placeholder = input.placeholder || "Word or phrase";
    entry.setAttribute("aria-label", `${title.textContent}: word or phrase`);
    const actions = make("div", "fc-term-actions");
    const addAlternative = make("button", "fc-chip fc-action", "Add to last group");
    addAlternative.type = "button";
    const addRequired = make("button", "fc-chip fc-action", "Add as new group");
    addRequired.type = "button";
    actions.append(addAlternative, addRequired);
    card.append(header, help, groupsBox, entry, actions);

    if (label) label.hidden = true;
    input.hidden = true;
    input.after(card);
    input._fcWidget = card;

    const add = (newGroup) => {
        const word = entry.value.replace(/[,;]/g, " ").trim();
        if (!word) return;
        const groups = termGroups(input.value);
        if (!groups.length || newGroup) groups.push([word]);
        else groups[groups.length - 1].push(word);
        setValue(input, encodeTermGroups(groups));
        entry.value = "";
        paint();
        entry.focus();
    };
    addAlternative.addEventListener("click", () => add(false));
    addRequired.addEventListener("click", () => add(true));
    entry.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); add(false); }
    });
    // Stop the panel from recording the draft word as the filter value.
    ["input", "change"].forEach(type => entry.addEventListener(type, event => event.stopPropagation()));
    entry.addEventListener("input", () => paintActions());

    const paintActions = () => {
        const hasWord = entry.value.trim() !== "";
        const hasGroups = termGroups(input.value).length > 0;
        addAlternative.disabled = !hasWord;
        addRequired.disabled = !hasWord;
        addAlternative.textContent = hasGroups ? "Add to last group" : "Add";
        addRequired.hidden = !hasGroups;
    };

    const paint = () => {
        const groups = termGroups(input.value);
        groupsBox.innerHTML = "";
        groups.forEach((group, groupIndex) => {
            const row = make("div", "fc-term-group");
            row.appendChild(make("span", "fc-term-joiner", groupIndex === 0 ? "Any of" : "and any of"));
            group.forEach((word, wordIndex) => {
                const remove = chip(word, true, () => {
                    const next = termGroups(input.value);
                    next[groupIndex].splice(wordIndex, 1);
                    setValue(input, encodeTermGroups(next.filter(g => g.length)));
                    paint();
                }, "fc-removable");
                remove.setAttribute("aria-label", `Remove ${word}`);
                row.appendChild(remove);
            });
            groupsBox.appendChild(row);
        });
        clear.hidden = groups.length === 0;
        paintActions();
    };
    refreshers.push(paint);
    paint();
}

// ---- Numbers with common choices ----

function enhancePresets(input, { title, presets, unit = "", note = "" }) {
    const label = labelFor(input);
    const card = make("div", "fc-card");
    const header = make("div", "fc-card-header");
    const heading = make("span", "fc-card-title", title);
    header.appendChild(heading);
    const body = make("div", "fc-chips");
    card.append(header, body);
    if (note) card.appendChild(make("p", "fc-help", note));
    if (label) label.hidden = true;
    input.after(card);
    card.appendChild(input);
    input.classList.add("fc-custom-input");
    input._fcWidget = card;
    let custom = false;

    const options = () => (typeof presets === "function" ? presets() : presets);
    const paint = () => {
        const list = options();
        if (typeof title === "function") heading.textContent = title();
        const value = input.value.trim();
        const matched = list.some(preset => preset.value === value);
        if (value && !matched) custom = true;
        body.innerHTML = "";
        list.forEach(preset => {
            body.appendChild(chip(preset.label, !custom && preset.value === value, () => {
                custom = false;
                setValue(input, preset.value);
                paint();
            }));
        });
        body.appendChild(chip("Custom", custom, () => {
            custom = true;
            paint();
            input.focus();
        }));
        input.style.display = custom ? "" : "none";
        if (unit) input.placeholder = `Number of ${unit}`;
    };
    card._paint = paint;
    refreshers.push(paint);
    paint();
    return card;
}

const X_SETTINGS = {
    "first-n-scrobbles": { title: "Play milestone", unit: "plays", values: [10, 25, 50, 100] },
    "fastest-n-scrobbles": { title: "Play milestone", unit: "plays", values: [10, 25, 50, 100] },
    "max-rolling-xh": { title: "Time window", unit: "hours", values: [1, 6, 12, 24] },
    "oldest-average-listening-time": { title: "Minimum plays per item", unit: "plays", values: [1, 5, 10, 25] },
    "newest-average-listening-time": { title: "Minimum plays per item", unit: "plays", values: [1, 5, 10, 25] }
};

function currentXSetting() {
    return X_SETTINGS[document.getElementById("sorting-basis")?.value] || X_SETTINGS["first-n-scrobbles"];
}

function enhanceXValue() {
    const input = document.getElementById("x-value");
    const label = document.getElementById("x-value-label");
    if (!input) return;
    // The X box used to be shown and hidden by filters-panel.js; the card
    // below takes over, so the box itself only appears for Custom.
    const card = enhancePresets(input, {
        title: () => currentXSetting().title,
        unit: "",
        presets: () => {
            const setting = currentXSetting();
            return setting.values.map(value => ({ value: String(value), label: `${value} ${setting.unit}` }));
        }
    });
    const sync = () => {
        const sort = document.getElementById("sorting-basis")?.value;
        card.hidden = !isSortingBasisUsingXValue(sort);
        if (label) label.hidden = true;
        card._paint();
        input.placeholder = `Number of ${currentXSetting().unit}`;
    };
    document.getElementById("sorting-basis")?.addEventListener("change", sync);
    refreshers.push(sync);
    sync();
}

// The per-artist cap only applies to track and scrobble lists.
function syncPerArtistVisibility() {
    const type = document.getElementById("entity-type")?.value || "track";
    const applies = type === "track" || type === "scrobble";
    const input = document.getElementById("max-per-artist");
    const card = input?._fcWidget;
    if (card) card.hidden = !applies;
    const separator = card?.nextElementSibling;
    if (separator && separator.classList.contains("separator")) separator.hidden = !applies;
}

// ---- Clearing a single date or time ----

function addClearButtons() {
    document.querySelectorAll('#filters-section input[type="date"], #filters-section input[type="time"]').forEach(input => {
        if (input.closest(".mode-controls")) return;
        const wrapper = make("span", "fc-clearable");
        input.replaceWith(wrapper);
        const clear = make("button", "fc-input-clear");
        clear.type = "button";
        clear.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
        clear.setAttribute("aria-label", `Clear ${input.getAttribute("aria-label") || "date"}`);
        clear.addEventListener("click", () => { setValue(input, ""); refresh(); });
        wrapper.append(input, clear);
        const refresh = () => { clear.hidden = !input.value; };
        input.addEventListener("input", refresh);
        input.addEventListener("change", refresh);
        refreshers.push(refresh);
        refresh();
    });
}

// ---- Clicking an active-filter chip opens that filter ----

function openFilterField(id) {
    const field = document.getElementById(id === "equations-right" ? "equations-right" : id);
    if (!field) return;
    const sidebar = document.getElementById("filters-section");
    const toggle = document.getElementById("filters-section-toggle");
    if (sidebar && sidebar.classList.contains("closed") && toggle) toggle.click();

    const content = field.closest(".dropdown-content");
    if (content) {
        document.querySelectorAll(".dropdown-content").forEach(menu => {
            if (menu !== content) menu.style.display = "none";
        });
        content.style.display = "block";
    }
    const widget = field._fcWidget;
    const target = (widget && !field.offsetParent)
        ? widget.querySelector("input:not([hidden]), button, select") || widget
        : field;
    const holder = widget || field;
    holder.classList.add("fc-flash");
    setTimeout(() => holder.classList.remove("fc-flash"), 1400);
    requestAnimationFrame(() => {
        holder.scrollIntoView({ block: "center", behavior: "smooth" });
        if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
    });
}

function wireActiveFilterChips() {
    const box = document.getElementById("active-filters");
    if (!box) return;
    box.addEventListener("click", (event) => {
        const chipButton = event.target.closest("[data-filter-id]");
        if (!chipButton) return;
        // The page closes open filter panels on any click; this one opens one.
        event.stopPropagation();
        openFilterField(chipButton.dataset.filterId);
    });
}

export function refreshFilterControls() {
    refreshers.forEach(refresh => refresh());
    syncPerArtistVisibility();
}

export function initFilterControls() {
    enhanceRangeGroups();
    enhanceMultiSelect("month", "Months", true);
    enhanceMultiSelect("weekday", "Weekdays", true);
    enhanceNumberChips("day-of-month", "Days of the month", Array.from({ length: 31 }, (_, i) => i + 1), { collapsed: true });
    ["year", "artist-first-scrobble-years", "album-first-scrobble-years", "track-first-scrobble-years"].forEach(id => {
        const input = document.getElementById(id);
        const label = input ? labelFor(input) : null;
        enhanceNumberChips(id, label ? label.textContent.trim() : "Years", libraryYears);
    });
    ["artist-includes", "album-includes", "track-includes", "artist-tags"].forEach(id => {
        const input = document.getElementById(id);
        if (input) enhanceTermField(input, false);
    });
    ["artist-excludes", "album-excludes", "track-excludes"].forEach(id => {
        const input = document.getElementById(id);
        if (input) enhanceTermField(input, true);
    });

    const lastDays = document.getElementById("last-n-days");
    if (lastDays) enhancePresets(lastDays, {
        title: "Played in the last",
        unit: "days",
        presets: [{ value: "", label: "Any time" }, ...[7, 30, 90, 365].map(days => ({ value: String(days), label: `${days} days` }))]
    });
    const gap = document.getElementById("day-starter-gap-hours");
    if (gap) enhancePresets(gap, {
        title: "Long gap before a session",
        unit: "hours",
        presets: [{ value: "", label: "6 hours (default)" }, ...[4, 12, 24].map(hours => ({ value: String(hours), label: `${hours} hours` }))],
        note: "Used by the session starter and the smart day starter."
    });
    const listLength = document.getElementById("list-length");
    if (listLength) enhancePresets(listLength, {
        title: "List length",
        unit: "rows",
        presets: [
            { value: "", label: "Top 10" },
            ...[25, 50, 100].map(rows => ({ value: String(rows), label: `Top ${rows}` })),
            { value: "0", label: "All" }
        ]
    });
    const perArtist = document.getElementById("max-per-artist");
    if (perArtist) enhancePresets(perArtist, {
        title: "Tracks per artist",
        unit: "tracks",
        presets: [{ value: "", label: "No limit" }, ...[1, 2, 3, 5].map(count => ({ value: String(count), label: String(count) }))],
        note: "Shows at most this many tracks by the same artist."
    });
    enhanceXValue();
    addClearButtons();
    wireActiveFilterChips();

    document.addEventListener("filters:changed", refreshFilterControls);
    document.getElementById("entity-type")?.addEventListener("change", syncPerArtistVisibility);
    // Year chips depend on the loaded history, so redraw when a panel opens.
    document.querySelectorAll("#filters-section .dropdown-button").forEach(button => {
        button.addEventListener("click", refreshFilterControls);
    });
    syncPerArtistVisibility();
}
