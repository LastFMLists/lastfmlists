// The bar chart race, drawn on a canvas. Between two steps every bar slides
// from its old rank to its new one and its value grows on the way, so the
// race moves instead of swapping rows. Every bar carries its name and value,
// the date and running total sit in the corner, and colors follow artists
// for the whole race. The same drawing code makes the GIF export, so the
// file looks like the page.

import { trackEventOnce } from '../analytics.js';
import { formatDuration } from '../time.js';
import { autoColorsOn, clearCustomColor, customColor, setAutoColors, setCustomColor } from './race-colors.js';

// Bars reorder all the time, so any two colors can end up side by side.
// Only these four hues pass every pairing (normal and colorblind vision)
// on both site backgrounds; checked with the dataviz palette validator
// using --pairs all against #FFFCF8 and #1E293B. The name on every bar is
// the main identity cue, and color groups by artist on top of it.
const PALETTE = {
    light: ["#2a78d6", "#eda100", "#e87ba4", "#008300"],
    dark: ["#3987e5", "#c98500", "#d55181", "#008300"]
};
const OTHER = { light: "#bdbab0", dark: "#4b5568" };
// Offered when someone adds an artist and the starting colors are taken.
const EXTRA_SUGGESTIONS = ["#8a5cd1", "#00a3a3", "#d1495b", "#7a4a1f", "#5c6bc0", "#c2185b"];
// Starting colors that look like a picked one are skipped, so two artists
// never seem to share a color by accident: too close overall (OKLab
// distance), or the same hue family, like a pink next to a light pink.
const CLOSE_COLORS = 0.15;
const SAME_HUE_DEGREES = 30;
const GRAYISH_CHROMA = 0.04;

// Share of each step that rank changes take.
const RANK_MOVE_SHARE = 0.55;

const DATE_SORTS = new Set(["first-n-scrobbles", "oldest-average-listening-time", "newest-average-listening-time"]);

function themeName() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

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

function looksAlike(a, b) {
    const p = toOklab(a);
    const q = toOklab(b);
    if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < CLOSE_COLORS) return true;
    if (Math.hypot(p[1], p[2]) < GRAYISH_CHROMA || Math.hypot(q[1], q[2]) < GRAYISH_CHROMA) return false;
    const turn = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * 180 / Math.PI;
    return Math.min(turn, 360 - turn) < SAME_HUE_DEGREES;
}

let raceCount = 0;

function shortDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatRaceValue(value, sort) {
    if (DATE_SORTS.has(sort)) return shortDate(value);
    if (sort === "time-spent-listening" || sort === "fastest-n-scrobbles") return formatDuration(value) || "0m";
    if (sort === "highest-listening-percentage") return `${value.toFixed(2)}%`;
    const whole = Math.round(value).toLocaleString();
    if (sort === "consecutive-scrobbles") return `${whole} in a row`;
    if (sort === "consecutive-days" || sort === "separate-days") return `${whole} days`;
    if (sort === "consecutive-weeks" || sort === "separate-weeks") return `${whole} weeks`;
    if (sort === "consecutive-months" || sort === "separate-months") return `${whole} months`;
    return whole;
}

function compact(value) {
    if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${+(value / 1e3).toFixed(1)}K`;
    return String(Math.round(value));
}

// Round axis ticks: 1, 2 or 5 times a power of ten.
function niceStep(max, count) {
    const raw = max / Math.max(1, count);
    const power = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const unit = raw / power;
    return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

// Shortens text with an ellipsis until it fits, instead of letting the
// canvas clip it.
function fitText(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) low = mid;
        else high = mid - 1;
    }
    return low > 0 ? `${text.slice(0, low)}…` : "";
}

function roundedBar(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width, height / 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    ctx.fill();
}

// frames: [{ label, total, rows: [{ key, name, artist, value }] }], rows in
// rank order, a few more than `slots` so bars can slide in from below.
export function createRaceChart(container, frames, { slots, sortingBasis, entityType, title }) {
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const showArtist = entityType !== "artist";
    const dateMetric = DATE_SORTS.has(sortingBasis);

    // Per frame: key -> { rank, value } and the range of the visible bars.
    const indexed = frames.map(frame => {
        const map = new Map();
        frame.rows.forEach((row, rank) => map.set(row.key, { rank, value: row.value }));
        const visible = frame.rows.slice(0, slots).map(row => row.value);
        return {
            map,
            max: visible.length ? Math.max(...visible) : 0,
            min: visible.length ? Math.min(...visible) : 0,
            floor: frame.rows.length ? frame.rows[frame.rows.length - 1].value : 0
        };
    });
    const details = new Map();
    frames.forEach(frame => frame.rows.forEach(row => details.set(row.key, row)));

    // Artists by time on screen, most first, with their names as written.
    const screenTime = new Map();
    const artistNames = new Map();
    frames.forEach(frame => frame.rows.forEach((row, rank) => {
        const name = row.artist || row.name || "";
        const artist = name.toLowerCase();
        if (!artistNames.has(artist)) artistNames.set(artist, name);
        if (rank < slots) screenTime.set(artist, (screenTime.get(artist) || 0) + 1);
    }));
    const artistOrder = [...screenTime.entries()].sort((a, b) => b[1] - a[1]).map(([artist]) => artist);
    const otherLabel = showArtist ? "Other artists" : "Everyone else";

    // Theme colors are read on every draw, so switching themes mid-race
    // repaints with the dark steps instead of keeping the light ones.
    let theme = "light";
    let ink = {};
    function readTheme() {
        theme = themeName();
        ink = {
            primary: cssVar("--primary-text-color", "#3B2F24"),
            secondary: cssVar("--secondary-text-color", "#6C5A4B"),
            hairline: cssVar("--border-color", "#E5CEB4"),
            surface: cssVar("--background-color", "#FFFCF8")
        };
    }

    // Picked colors come first. With automatic colors on, the starting
    // colors then go to the most-shown artists left, once for the whole
    // race, so a bar keeps its color as it moves.
    let colors = { assigned: new Map(), legend: [] };
    function assignColors() {
        const assigned = new Map();
        const picked = [];
        artistOrder.forEach(artist => {
            const color = customColor(artist);
            if (!color) return;
            assigned.set(artist, color);
            picked.push(color);
        });
        if (autoColorsOn()) {
            const free = PALETTE[theme].filter(hex => picked.every(color => !looksAlike(hex, color)));
            let next = 0;
            for (const artist of artistOrder) {
                if (next >= free.length) break;
                if (!assigned.has(artist)) assigned.set(artist, free[next++]);
            }
        }
        const legend = artistOrder.filter(artist => assigned.has(artist)).map(artist => ({
            artist,
            label: artistNames.get(artist),
            color: assigned.get(artist),
            custom: Boolean(customColor(artist))
        }));
        colors = { assigned, legend };
    }
    const colorOf = (row) => {
        const artist = (row.artist || row.name || "").toLowerCase();
        return colors.assigned.get(artist) || customColor(artist) || OTHER[theme];
    };

    const id = ++raceCount;
    const legendBox = document.createElement("div");
    legendBox.className = "race-legend";
    const stage = document.createElement("div");
    stage.className = "race-stage";
    const canvas = document.createElement("canvas");
    canvas.className = "race-canvas";
    canvas.setAttribute("role", "img");
    stage.appendChild(canvas);
    container.append(legendBox, stage);

    const rowHeight = slots <= 12 ? 36 : slots <= 20 ? 30 : 24;
    const barHeight = Math.min(24, rowHeight - 10);
    let width = 0;
    let position = 0;

    // The widest date label at a given size, measured once per size so the
    // header doesn't change shape as the dates change.
    const dateWidths = new Map();
    function widestDate(ctx, size) {
        if (!dateWidths.has(size)) {
            ctx.font = `800 ${size}px ${font}`;
            dateWidths.set(size, Math.max(...frames.map(frame => ctx.measureText(frame.label).width)));
        }
        return dateWidths.get(size);
    }

    // Room for the value at the tip of the longest bar: the widest value
    // anywhere in the race, so the bars don't rescale when one appears.
    let widestValue = null;
    function valueWidth(ctx) {
        if (widestValue === null) {
            ctx.font = `600 12px ${font}`;
            widestValue = 0;
            frames.forEach(frame => frame.rows.slice(0, slots).forEach(row => {
                widestValue = Math.max(widestValue, ctx.measureText(formatRaceValue(row.value, sortingBasis)).width);
            }));
        }
        return widestValue;
    }

    // The header holds the title and legend on the left and the date on the
    // right, or the date under the legend when the chart is too narrow for
    // both. Keeping the date out of the plot means no bar ever runs into it.
    function layout(ctx, totalWidth, withLegend) {
        const dateSize = Math.round(Math.min(36, Math.max(22, totalWidth / 26)));
        const dateWidth = widestDate(ctx, dateSize);
        const dateBeside = totalWidth - dateWidth - 24 >= 300;
        const legendWidth = dateBeside ? totalWidth - dateWidth - 24 : totalWidth;

        ctx.font = `600 12px ${font}`;
        const legendRows = [];
        let line = [];
        let lineWidth = 0;
        if (withLegend && colors.legend.length) {
            const items = [...colors.legend, { label: otherLabel, color: OTHER[theme] }];
            items.forEach(item => {
                const itemWidth = 16 + ctx.measureText(item.label).width + 18;
                if (line.length && lineWidth + itemWidth > legendWidth) {
                    legendRows.push(line);
                    line = [];
                    lineWidth = 0;
                }
                line.push({ ...item, x: lineWidth });
                lineWidth += itemWidth;
            });
        }
        if (line.length) legendRows.push(line);
        const leftHeight = 26 + legendRows.length * 20;
        const date = dateBeside
            ? { size: dateSize, y: dateSize - 2, totalY: dateSize + 16 }
            : { size: dateSize, y: leftHeight + dateSize + 2, totalY: leftHeight + dateSize + 20 };
        const headerHeight = Math.max(leftHeight, date.totalY + 6);
        const axisHeight = 22;
        const labelWidth = totalWidth < 480 ? Math.round(totalWidth * 0.4) : Math.min(Math.max(totalWidth * 0.3, 150), 280);
        return { legendRows, legendWidth, date, headerHeight, axisHeight, labelWidth, height: headerHeight + axisHeight + slots * rowHeight + 10 };
    }

    // Draws the race at a fractional step: 3.4 is 40% of the way from step
    // 3 to step 4.
    function renderTo(ctx, totalWidth, at, withLegend) {
        readTheme();
        assignColors();
        const last = frames.length - 1;
        const clamped = Math.max(0, Math.min(last, at));
        const step = Math.min(Math.floor(clamped), Math.max(0, last - 1));
        const t = last === 0 ? 0 : clamped - step;
        const a = indexed[step];
        const b = indexed[Math.min(step + 1, last)];
        const frame = frames[t < 0.5 ? step : Math.min(step + 1, last)];
        const box = layout(ctx, totalWidth, withLegend);
        const plotTop = box.headerHeight + box.axisHeight;
        const plotLeft = box.labelWidth + 12;
        const valueRoom = valueWidth(ctx) + 10;
        const plotWidth = Math.max(40, totalWidth - plotLeft - valueRoom);

        // Value scale, eased between steps so the axis never jumps.
        const lerp = (x, y) => x + (y - x) * t;
        let low = 0;
        let high = Math.max(lerp(a.max, b.max), 1e-9);
        if (dateMetric) {
            const lo = lerp(a.min, b.min);
            const pad = Math.max(86400000, (high - lo) * 0.08);
            low = lo - pad;
            high += pad / 4;
        }
        const scale = (value) => Math.max(0, (value - low) / (high - low)) * plotWidth;

        // Title and legend
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.fillStyle = ink.primary;
        ctx.font = `700 15px ${font}`;
        ctx.fillText(fitText(ctx, title, box.legendWidth), 0, 17);
        ctx.font = `600 12px ${font}`;
        box.legendRows.forEach((row, index) => {
            const y = 26 + index * 20 + 8;
            row.forEach(item => {
                ctx.fillStyle = item.color;
                roundedBar(ctx, item.x, y - 5, 12, 10, 3);
                ctx.fillStyle = ink.secondary;
                ctx.fillText(item.label, item.x + 16, y + 4);
            });
        });

        // Axis: hairline gridlines with compact ticks (counts only).
        if (!dateMetric) {
            const tick = niceStep(high, Math.max(2, Math.floor(plotWidth / 110)));
            ctx.font = `500 11px ${font}`;
            ctx.textAlign = "center";
            for (let value = 0; value <= high; value += tick) {
                const x = Math.round(plotLeft + scale(value)) + 0.5;
                ctx.strokeStyle = ink.hairline;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, plotTop - 4);
                ctx.lineTo(x, plotTop + slots * rowHeight);
                ctx.stroke();
                ctx.fillStyle = ink.secondary;
                const label = sortingBasis === "time-spent-listening" || sortingBasis === "fastest-n-scrobbles"
                    ? formatDuration(value) || "0"
                    : sortingBasis === "highest-listening-percentage" ? `${+value.toFixed(2)}%` : compact(value);
                ctx.fillText(label, x, plotTop - 8);
            }
        }

        // The date and running total, top right.
        ctx.textAlign = "right";
        ctx.fillStyle = ink.primary;
        ctx.font = `800 ${box.date.size}px ${font}`;
        ctx.fillText(frame.label, totalWidth, box.date.y);
        ctx.fillStyle = ink.secondary;
        ctx.font = `600 13px ${font}`;
        const total = Math.round(lerp(frames[step].total, frames[Math.min(step + 1, last)].total));
        ctx.fillText(`${total.toLocaleString()} scrobbles`, totalWidth, box.date.totalY);

        // Values grow evenly through the step, but overtakes happen in a quick
        // eased move at its start: two bars trading places spend far less
        // time on top of each other, so their labels stay readable.
        const swapT = Math.min(1, t / RANK_MOVE_SHARE);
        const swap = swapT * swapT * (3 - 2 * swapT);

        // Every key on screen at either end of the step.
        const keys = new Set([...a.map.keys(), ...b.map.keys()]);
        const bars = [];
        keys.forEach(key => {
            const from = a.map.get(key);
            const to = b.map.get(key);
            const rankFrom = from ? from.rank : slots + 1;
            const rankTo = to ? to.rank : slots + 1;
            const valueTo = to ? to.value : from.value;
            const valueFrom = from ? from.value : Math.min(valueTo, a.floor);
            const y = rankFrom + (rankTo - rankFrom) * swap;
            if (y > slots) return;
            bars.push({ key, y, value: valueFrom + (valueTo - valueFrom) * t });
        });
        bars.sort((p, q) => q.y - p.y);

        ctx.save();
        ctx.beginPath();
        ctx.rect(-2, plotTop, totalWidth + 4, slots * rowHeight);
        ctx.clip();
        bars.forEach(bar => {
            const row = details.get(bar.key);
            const top = plotTop + bar.y * rowHeight;
            const barTop = top + (rowHeight - barHeight) / 2;
            const middle = top + rowHeight / 2;
            // Fade bars in and out across the last slot.
            ctx.globalAlpha = Math.max(0, Math.min(1, slots - bar.y));
            const length = Math.max(2, scale(bar.value));
            ctx.fillStyle = colorOf(row);
            roundedBar(ctx, plotLeft, barTop, length, barHeight, 4);

            ctx.textAlign = "right";
            const nameRight = box.labelWidth;
            if (showArtist && rowHeight >= 30) {
                ctx.fillStyle = ink.primary;
                ctx.font = `650 13px ${font}`;
                ctx.fillText(fitText(ctx, row.name, box.labelWidth), nameRight, middle - 1);
                ctx.fillStyle = ink.secondary;
                ctx.font = `500 11px ${font}`;
                ctx.fillText(fitText(ctx, row.artist, box.labelWidth), nameRight, middle + 12);
            } else {
                ctx.fillStyle = ink.primary;
                ctx.font = `650 ${rowHeight >= 30 ? 13 : 12}px ${font}`;
                const text = showArtist ? `${row.name} · ${row.artist}` : row.name;
                ctx.fillText(fitText(ctx, text, box.labelWidth), nameRight, middle + 4);
            }

            ctx.textAlign = "left";
            ctx.fillStyle = ink.secondary;
            ctx.font = `600 12px ${font}`;
            ctx.fillText(formatRaceValue(bar.value, sortingBasis), plotLeft + length + 6, middle + 4);
        });
        ctx.restore();
        ctx.globalAlpha = 1;
        return box.height;
    }

    function draw(at = position) {
        position = at;
        const nextWidth = Math.max(280, Math.floor(stage.clientWidth || 640));
        const ratio = window.devicePixelRatio || 1;
        readTheme();
        assignColors();
        syncLegend();
        const probe = canvas.getContext("2d");
        const height = layout(probe, nextWidth, false).height;
        if (nextWidth !== width || canvas.height !== Math.round(height * ratio)) {
            width = nextWidth;
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        renderTo(ctx, width, at, false);
        const frame = frames[Math.round(Math.max(0, Math.min(frames.length - 1, at)))];
        canvas.setAttribute("aria-label", `${title}, ${frame.label}: ${frame.rows.slice(0, slots).map(row => `${row.name} ${formatRaceValue(row.value, sortingBasis)}`).join(", ")}`);
    }

    // A flat copy at 1x for the GIF, on the page background, since GIF has
    // no transparency.
    function snapshot(at) {
        readTheme();
        assignColors();
        const out = document.createElement("canvas");
        const probe = out.getContext("2d");
        const height = layout(probe, width, true).height;
        out.width = width + 24;
        out.height = height + 24;
        const ctx = out.getContext("2d");
        ctx.fillStyle = ink.surface;
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.translate(12, 12);
        renderTo(ctx, width, at, true);
        return out;
    }

    // The legend on the page is also where colors are changed: a swatch per
    // colored artist opens a color picker, x goes back to the automatic
    // color, and any artist can be added by name. (The GIF draws its own
    // legend on the canvas.)
    const items = document.createElement("div");
    items.className = "race-legend-items";
    const other = document.createElement("span");
    other.className = "race-legend-item race-legend-other";
    const otherSwatch = document.createElement("span");
    otherSwatch.className = "race-swatch";
    other.append(otherSwatch, Object.assign(document.createElement("span"), { className: "race-legend-name", textContent: otherLabel }));

    const tools = document.createElement("div");
    tools.className = "race-legend-tools";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "race-legend-add";
    addButton.innerHTML = '<i class="fas fa-palette" aria-hidden="true"></i> Color an artist';
    const form = document.createElement("form");
    form.className = "race-legend-form";
    form.hidden = true;
    const field = document.createElement("input");
    field.type = "text";
    field.placeholder = "Artist name";
    field.setAttribute("aria-label", "Artist to color");
    field.setAttribute("list", `race-artists-${id}`);
    field.autocomplete = "off";
    const options = document.createElement("datalist");
    options.id = `race-artists-${id}`;
    const known = [...artistOrder, ...[...artistNames.keys()].filter(artist => !screenTime.has(artist))];
    known.forEach(artist => options.appendChild(Object.assign(document.createElement("option"), { value: artistNames.get(artist) })));
    const submit = Object.assign(document.createElement("button"), { type: "submit", textContent: "Add" });
    const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
    form.append(field, options, submit, cancel);
    const autoLabel = document.createElement("label");
    autoLabel.className = "race-legend-auto";
    const autoBox = document.createElement("input");
    autoBox.type = "checkbox";
    autoLabel.append(autoBox, document.createTextNode(" Color the top artists for me"));
    const note = document.createElement("span");
    note.className = "race-legend-note";
    note.setAttribute("role", "status");
    tools.append(addButton, form, autoLabel, note);
    legendBox.append(items, tools);

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
        const artist = typed.toLowerCase();
        const name = artistNames.get(artist) || typed;
        const taken = [...colors.assigned.values()];
        const color = colors.assigned.get(artist)
            || [...PALETTE[theme], ...EXTRA_SUGGESTIONS].find(hex => taken.every(used => !looksAlike(hex, used)))
            || EXTRA_SUGGESTIONS[0];
        closeForm();
        setCustomColor(name, color);
        trackEventOnce("race/color", "Race: picked an artist color");
        const chip = chips.get(artist);
        if (chip) {
            chip.open();
        } else {
            note.textContent = `Saved. ${name} will have this color in any race they show up in.`;
        }
    });
    autoBox.addEventListener("change", () => setAutoColors(autoBox.checked));

    const chips = new Map();
    function makeChip(item) {
        const el = document.createElement("span");
        el.className = "race-legend-item";
        const swatch = document.createElement("label");
        swatch.className = "race-swatch";
        const picker = document.createElement("input");
        picker.type = "color";
        swatch.appendChild(picker);
        const name = document.createElement("span");
        name.className = "race-legend-name";
        name.textContent = item.label;
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "race-legend-reset";
        reset.textContent = "×";
        el.append(swatch, name, reset);
        picker.addEventListener("input", () => {
            setCustomColor(item.label, picker.value);
            trackEventOnce("race/color", "Race: picked an artist color");
        });
        reset.addEventListener("click", () => clearCustomColor(item.label));
        return {
            el,
            update(next) {
                swatch.style.background = next.color;
                // Leave the picker alone while it is open, or it would jump.
                if (document.activeElement !== picker) picker.value = next.color;
                picker.setAttribute("aria-label", `Color for ${next.label}`);
                swatch.title = `Change the color for ${next.label}`;
                reset.hidden = !next.custom;
                reset.setAttribute("aria-label", `Use the automatic color for ${next.label}`);
                reset.title = "Use the automatic color";
                el.classList.toggle("is-custom", next.custom);
            },
            open() {
                try {
                    picker.click();
                } catch (e) {
                    picker.focus();
                }
            }
        };
    }

    let legendSignature = "";
    function syncLegend() {
        const signature = `${theme}|${autoColorsOn()}|${colors.legend.map(item => `${item.artist}:${item.color}:${item.custom}`).join("|")}`;
        if (signature === legendSignature) return;
        legendSignature = signature;
        const keep = new Set();
        colors.legend.forEach((item, index) => {
            let chip = chips.get(item.artist);
            if (!chip) {
                chip = makeChip(item);
                chips.set(item.artist, chip);
            }
            keep.add(item.artist);
            chip.update(item);
            if (items.children[index] !== chip.el) items.insertBefore(chip.el, items.children[index] || null);
        });
        chips.forEach((chip, artist) => {
            if (keep.has(artist)) return;
            chip.el.remove();
            chips.delete(artist);
        });
        otherSwatch.style.background = OTHER[theme];
        items.appendChild(other);
        autoBox.checked = autoColorsOn();
    }

    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
    if (resize) resize.observe(stage);

    draw(0);
    return {
        draw,
        snapshot,
        destroy() {
            if (resize) resize.disconnect();
        }
    };
}
