// Colors for artists (and, in the graph builder, single tracks and albums)
// in the bar chart race, the bar chart and graphs. People pick their own
// and the rest get starting colors. Picks are kept in this browser for every
// profile, since Radiohead being blue has nothing to do with whose library
// is loaded. A shared link can carry colors too; those apply for the visit
// without replacing the visitor's own. Any change sends
// "artist-colors:changed" so charts on screen repaint.

import { trackEventOnce } from '../analytics.js';
import { openColorPicker } from './color-picker.js';

const STORAGE_KEY = "lastfmlists-artist-colors";

// Bars reorder all the time, so any two colors can end up side by side.
// Only these four hues pass every pairing (normal and colorblind vision)
// on both site backgrounds; checked with the dataviz palette validator
// using --pairs all against #FFFCF8 and #1E293B. The name on every bar is
// the main identity cue, and color groups by artist on top of it.
export const PALETTE = {
    light: ["#2a78d6", "#eda100", "#e87ba4", "#008300"],
    dark: ["#3987e5", "#c98500", "#d55181", "#008300"]
};
const OTHER = { light: "#bdbab0", dark: "#4b5568" };
// Graph lines take these in order, and adding an artist to a chart offers
// them: the starting colors, then violet, rust, teal, wine, lime and indigo.
// Validated with the dataviz palette validator against #FFFCF8 and #1E293B:
// neighbors pass colorblind and normal vision in both themes, and the
// closest pair overall is 13.5 apart in light and 12.3 in dark (OKLab x100).
// Lines can cross any other line, so every line also has its name in the
// legend and the tooltip.
const LINE_PALETTE = {
    light: [...PALETTE.light, "#8b55d9", "#c75d14", "#23b3ad", "#8f1d40", "#86b52c", "#3a3fae"],
    dark: [...PALETTE.dark, "#9b70e6", "#ad5216", "#1fa396", "#a3264c", "#73a12a", "#4b50d4"]
};
// Starting colors that look like a picked one are skipped, so two artists
// never seem to share a color by accident: too close overall (OKLab
// distance), or the same hue family, like a pink next to a light pink.
const CLOSE_COLORS = 0.15;
const SAME_HUE_DEGREES = 30;
const GRAYISH_CHROMA = 0.04;

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value || "");
const keyOf = (name) => (name || "").trim().toLowerCase();

// ---- Stored picks, plus the ones a link brought ----

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        return {
            colors: saved && typeof saved.colors === "object" && saved.colors ? saved.colors : {},
            auto: saved?.auto !== false,
            other: isHex(saved?.other) ? saved.other : null
        };
    } catch (e) {
        return { colors: {}, auto: true, other: null };
    }
}

const store = load();
let fromLink = { colors: {}, auto: null, other: null };

function changed() {
    document.dispatchEvent(new CustomEvent("artist-colors:changed"));
}

// Charts repaint at once; the write to storage waits until a drag in the
// color picker settles.
let saveTimer = null;
function writeStore() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
        // Private windows can refuse storage; the colors still last the visit.
    }
}

function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeStore, 200);
    changed();
}

// A pick made just before the tab closes still gets saved.
window.addEventListener("pagehide", () => {
    if (saveTimer) writeStore();
});

// The picked color for a name (any capitalisation), or null.
export function customColor(name) {
    const key = keyOf(name);
    const entry = fromLink.colors[key] || store.colors[key];
    return entry && isHex(entry.color) ? entry.color : null;
}

export function setCustomColor(name, color) {
    const label = (name || "").trim();
    if (!label || !isHex(color)) return;
    delete fromLink.colors[keyOf(label)];
    store.colors[keyOf(label)] = { name: label, color: color.toLowerCase() };
    trackEventOnce("chart/color", "Charts: picked a color");
    save();
}

export function clearCustomColor(name) {
    delete fromLink.colors[keyOf(name)];
    delete store.colors[keyOf(name)];
    save();
}

// Whether the most-shown artists without a picked color get one of the
// starting colors.
export function autoColorsOn() {
    return fromLink.auto ?? store.auto;
}

export function setAutoColors(on) {
    fromLink.auto = null;
    store.auto = Boolean(on);
    save();
}

// The color for everyone without a color of their own.
export function otherColor(theme) {
    return fromLink.other || store.other || OTHER[theme];
}

export function otherIsCustom() {
    return Boolean(fromLink.other || store.other);
}

export function setOtherColor(color) {
    fromLink.other = null;
    store.other = isHex(color) ? color.toLowerCase() : null;
    if (store.other) trackEventOnce("chart/color", "Charts: picked a color");
    save();
}

// ---- Telling picked colors apart ----

function toOklab(hex) {
    const channel = (index) => {
        const value = parseInt(hex.slice(index, index + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const r = channel(1);
    const g = channel(3);
    const b = channel(5);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
}

export function looksAlike(a, b) {
    const p = toOklab(a);
    const q = toOklab(b);
    if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < CLOSE_COLORS) return true;
    if (Math.hypot(p[1], p[2]) < GRAYISH_CHROMA || Math.hypot(q[1], q[2]) < GRAYISH_CHROMA) return false;
    const turn = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * 180 / Math.PI;
    return Math.min(turn, 360 - turn) < SAME_HUE_DEGREES;
}

// A color for a newly added name: the first line color that looks like
// none in use, or failing that the first one not in use at all.
export function suggestColor(taken, theme) {
    const colors = LINE_PALETTE[theme];
    return colors.find(hex => taken.every(used => !looksAlike(hex, used)))
        || colors.find(hex => !taken.includes(hex))
        || colors[0];
}

// Colors for graph lines, given each line's picked color or null. Picked
// colors stay; the other lines take the line colors in order, skipping any
// that look like a picked one until there are no others left. Automatic
// colors are only checked against picked ones: the line colors were chosen
// to work together.
export function lineColors(picked, theme) {
    const chosen = picked.filter(Boolean);
    const unused = LINE_PALETTE[theme].filter(hex => !chosen.includes(hex));
    const order = [
        ...unused.filter(hex => chosen.every(color => !looksAlike(hex, color))),
        ...unused.filter(hex => chosen.some(color => looksAlike(hex, color)))
    ];
    let next = 0;
    return picked.map(color => color || order[next++ % order.length]);
}

// Colors for the names in `order` (lowercase, most shown first). Picked
// colors come first. With automatic colors on, the starting colors then go
// to the most-shown names left, skipping any that look like a picked one.
// Returns { assigned: Map(name -> color), legend: [...], other }.
export function assignColors(order, names, theme, { autoCount = PALETTE[theme].length } = {}) {
    const assigned = new Map();
    const picked = [];
    order.forEach(key => {
        const color = customColor(key);
        if (!color) return;
        assigned.set(key, color);
        picked.push(color);
    });
    if (autoColorsOn()) {
        const free = PALETTE[theme].filter(hex => picked.every(color => !looksAlike(hex, color))).slice(0, autoCount);
        let next = 0;
        for (const key of order) {
            if (next >= free.length) break;
            if (!assigned.has(key)) assigned.set(key, free[next++]);
        }
    }
    const legend = order.filter(key => assigned.has(key)).map(key => ({
        key,
        label: names.get(key) || key,
        color: assigned.get(key),
        custom: Boolean(customColor(key))
    }));
    return { assigned, legend, other: otherColor(theme) };
}

// ---- The legend, which is also where colors are changed ----

let legendCount = 0;

// A legend row: a swatch per colored name opens a color picker, x goes back
// to the automatic color, "Everyone else" can be recolored too, and any
// name can be added. `known` is the [key, label] list offered when adding.
export function createColorLegend({ otherLabel, known, addLabel = "Color an artist", placeholder = "Artist name", autoText = "Color the top artists for me" }) {
    const id = ++legendCount;
    const el = document.createElement("div");
    el.className = "race-legend";
    const items = document.createElement("div");
    items.className = "race-legend-items";

    const tools = document.createElement("div");
    tools.className = "race-legend-tools";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "race-legend-add";
    addButton.innerHTML = `<i class="fas fa-palette" aria-hidden="true"></i> ${addLabel}`;
    const form = document.createElement("form");
    form.className = "race-legend-form";
    form.hidden = true;
    const field = document.createElement("input");
    field.type = "text";
    field.placeholder = placeholder;
    field.setAttribute("aria-label", placeholder);
    field.setAttribute("list", `color-names-${id}`);
    field.autocomplete = "off";
    const options = document.createElement("datalist");
    options.id = `color-names-${id}`;
    known.forEach(([, label]) => options.appendChild(Object.assign(document.createElement("option"), { value: label })));
    const submit = Object.assign(document.createElement("button"), { type: "submit", textContent: "Add" });
    const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
    form.append(field, options, submit, cancel);
    const autoLabel = document.createElement("label");
    autoLabel.className = "race-legend-auto";
    const autoBox = document.createElement("input");
    autoBox.type = "checkbox";
    autoLabel.append(autoBox, document.createTextNode(` ${autoText}`));
    const note = document.createElement("span");
    note.className = "race-legend-note";
    note.setAttribute("role", "status");
    tools.append(addButton, form, autoLabel, note);
    el.append(items, tools);

    const knownLabels = new Map(known.map(([key, label]) => [keyOf(label), label]));
    let current = { assigned: new Map(), legend: [], other: OTHER.light };
    let currentTheme = "light";

    const closeForm = () => {
        form.hidden = true;
        addButton.hidden = false;
        field.value = "";
    };
    addButton.addEventListener("click", () => {
        form.hidden = false;
        addButton.hidden = true;
        note.textContent = "";
        field.focus();
    });
    cancel.addEventListener("click", closeForm);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const typed = field.value.trim();
        if (!typed) return;
        const key = keyOf(typed);
        const label = knownLabels.get(key) || typed;
        const color = current.assigned.get(key) || suggestColor([...current.assigned.values()], currentTheme);
        closeForm();
        setCustomColor(label, color);
        const chip = chips.get(key);
        if (chip) chip.open();
        else note.textContent = `Saved. ${label} will have this color wherever it shows up.`;
    });
    autoBox.addEventListener("change", () => setAutoColors(autoBox.checked));

    function makeChip(item, { onPick, onReset }) {
        const chipEl = document.createElement("span");
        chipEl.className = "race-legend-item";
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "race-swatch";
        swatch.setAttribute("aria-haspopup", "dialog");
        swatch.setAttribute("aria-expanded", "false");
        const name = document.createElement("span");
        name.className = "race-legend-name";
        name.textContent = item.label;
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "race-legend-reset";
        reset.textContent = "×";
        chipEl.append(swatch, name, reset);
        let shown = item;
        const pick = () => openColorPicker(swatch, shown.color, onPick, {
            title: `Color for ${shown.label}`,
            reset: shown.custom ? { label: "Automatic", run: onReset } : null
        });
        swatch.addEventListener("click", pick);
        reset.addEventListener("click", onReset);
        return {
            el: chipEl,
            update(next) {
                shown = next;
                swatch.style.background = next.color;
                swatch.setAttribute("aria-label", `Color for ${next.label}`);
                swatch.title = `Change the color for ${next.label}`;
                reset.hidden = !next.custom;
                reset.setAttribute("aria-label", `Use the automatic color for ${next.label}`);
                reset.title = "Use the automatic color";
                chipEl.classList.toggle("is-custom", next.custom);
            },
            open: pick
        };
    }

    const chips = new Map();
    const other = makeChip({ label: otherLabel }, { onPick: setOtherColor, onReset: () => setOtherColor(null) });
    other.el.classList.add("race-legend-other");

    let signature = "";
    function sync(colors, theme) {
        current = colors;
        currentTheme = theme;
        const next = `${theme}|${autoColorsOn()}|${colors.other}|${otherIsCustom()}|${colors.legend.map(item => `${item.key}:${item.color}:${item.custom}`).join("|")}`;
        if (next === signature) return;
        signature = next;
        const keep = new Set();
        colors.legend.forEach((item, index) => {
            let chip = chips.get(item.key);
            if (!chip) {
                chip = makeChip(item, {
                    onPick: (color) => setCustomColor(item.label, color),
                    onReset: () => clearCustomColor(item.label)
                });
                chips.set(item.key, chip);
            }
            keep.add(item.key);
            chip.update(item);
            if (items.children[index] !== chip.el) items.insertBefore(chip.el, items.children[index] || null);
        });
        chips.forEach((chip, key) => {
            if (keep.has(key)) return;
            chip.el.remove();
            chips.delete(key);
        });
        other.update({ label: otherLabel, color: colors.other, custom: otherIsCustom() });
        items.appendChild(other.el);
        autoBox.checked = autoColorsOn();
    }

    return { el, sync };
}

// ---- Colors in shared links ----

// The names whose colors a link should carry: the ones on screen.
let shownKeys = new Set();

export function setShownNames(keys) {
    shownKeys = new Set(keys);
    document.dispatchEvent(new CustomEvent("artist-colors:shown"));
}

// [key, value] pairs for the address bar: color=f19ec2:Sakurazaka46 for
// each picked color on screen, color.other and color.auto=0 when changed.
export function colorLinkPairs(keys = shownKeys) {
    const pairs = [];
    keys = new Set(keys);
    keys.forEach(key => {
        const entry = fromLink.colors[key] || store.colors[key];
        if (entry && isHex(entry.color)) pairs.push(["color", `${entry.color.slice(1)}:${entry.name}`]);
    });
    if (keys.size && otherIsCustom()) pairs.push(["color.other", otherColor("light").slice(1)]);
    if (keys.size && !autoColorsOn()) pairs.push(["color.auto", "0"]);
    return pairs;
}

// Reads a link's colors. They apply for this visit on top of the
// visitor's own, and picking a color replaces the link's for that name.
export function applyLinkColors(params) {
    const next = { colors: {}, auto: null, other: null };
    params.getAll("color").forEach(value => {
        const split = value.indexOf(":");
        const color = `#${value.slice(0, split)}`;
        const name = value.slice(split + 1).trim();
        if (split > 0 && isHex(color) && name) next.colors[keyOf(name)] = { name, color: color.toLowerCase() };
    });
    const otherValue = `#${params.get("color.other") || ""}`;
    if (isHex(otherValue)) next.other = otherValue.toLowerCase();
    if (params.get("color.auto") === "0") next.auto = false;
    const any = Object.keys(next.colors).length || next.other || next.auto === false;
    if (!any) return false;
    fromLink = next;
    changed();
    return true;
}
