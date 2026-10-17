// A color picker in the site's own style, used by every color swatch: a row
// of ready colors, a saturation and brightness square, a hue slider and a
// hex box. It opens under the swatch that was clicked, reports colors while
// they are dragged, and closes on Escape or a click elsewhere.

const PRESETS = [
    "#2a78d6", "#7cc7f0", "#00a3a3", "#008300", "#2e9e5b", "#9ccc65",
    "#eda100", "#f4c430", "#e8743b", "#d1495b", "#800020", "#c2185b",
    "#e87ba4", "#f19ec2", "#8a5cd1", "#5c6bc0", "#7a4a1f", "#6b7280"
];

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value || "");

function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? delta / max : 0, v: max };
}

function hsvToHex({ h, s, v }) {
    const f = (n) => {
        const k = (n + h / 60) % 6;
        return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
    };
    return `#${[f(5), f(3), f(1)].map(part => part.toString(16).padStart(2, "0")).join("")}`;
}

let open = null;

export function closeColorPicker() {
    if (!open) return;
    const { panel, anchor, cleanup } = open;
    open = null;
    cleanup();
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
}

// Opens the picker for `anchor`. onPick(hex) runs on every change; `reset`
// ({ label, run }) adds a button that goes back to the automatic color.
export function openColorPicker(anchor, color, onPick, { title = "Color", reset = null } = {}) {
    if (open && open.anchor === anchor) {
        closeColorPicker();
        return;
    }
    closeColorPicker();
    let hsv = hexToHsv(isHex(color) ? color : "#2a78d6");

    const panel = document.createElement("div");
    panel.className = "color-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);
    panel.innerHTML = `
        <div class="color-picker-presets"></div>
        <div class="color-picker-area" tabindex="0" role="slider" aria-label="Saturation and brightness"><span class="color-picker-thumb"></span></div>
        <input type="range" class="color-picker-hue" min="0" max="359" step="1" aria-label="Hue">
        <div class="color-picker-row">
            <span class="color-picker-preview"></span>
            <input type="text" class="color-picker-hex" maxlength="7" spellcheck="false" aria-label="Hex color">
            ${reset ? `<button type="button" class="color-picker-reset">${reset.label}</button>` : ""}
        </div>`;
    const presets = panel.querySelector(".color-picker-presets");
    PRESETS.forEach(hex => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "color-picker-preset";
        swatch.style.background = hex;
        swatch.title = hex;
        swatch.setAttribute("aria-label", hex);
        swatch.addEventListener("click", () => set(hexToHsv(hex), true));
        presets.appendChild(swatch);
    });
    const area = panel.querySelector(".color-picker-area");
    const thumb = panel.querySelector(".color-picker-thumb");
    const hue = panel.querySelector(".color-picker-hue");
    const hex = panel.querySelector(".color-picker-hex");
    const preview = panel.querySelector(".color-picker-preview");

    function paint() {
        const current = hsvToHex(hsv);
        area.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h}, 100%, 50%)`;
        thumb.style.left = `${hsv.s * 100}%`;
        thumb.style.top = `${(1 - hsv.v) * 100}%`;
        thumb.style.background = current;
        hue.value = String(Math.round(hsv.h));
        preview.style.background = current;
        if (document.activeElement !== hex) hex.value = current;
        area.setAttribute("aria-valuetext", current);
    }

    function set(next, report) {
        hsv = next;
        paint();
        if (report) onPick(hsvToHex(hsv));
    }

    const fromPointer = (event) => {
        const box = area.getBoundingClientRect();
        const s = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        const v = 1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
        set({ h: hsv.h, s, v }, true);
    };
    area.addEventListener("pointerdown", (event) => {
        area.setPointerCapture(event.pointerId);
        fromPointer(event);
    });
    area.addEventListener("pointermove", (event) => {
        if (area.hasPointerCapture(event.pointerId)) fromPointer(event);
    });
    area.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (!moves[event.key]) return;
        event.preventDefault();
        const [ds, dv] = moves[event.key];
        set({ h: hsv.h, s: Math.min(1, Math.max(0, hsv.s + ds)), v: Math.min(1, Math.max(0, hsv.v + dv)) }, true);
    });
    hue.addEventListener("input", () => set({ ...hsv, h: Number(hue.value) }, true));
    hex.addEventListener("input", () => {
        const typed = hex.value.trim().startsWith("#") ? hex.value.trim() : `#${hex.value.trim()}`;
        if (isHex(typed)) set(hexToHsv(typed.toLowerCase()), true);
    });
    hex.addEventListener("blur", paint);
    panel.querySelector(".color-picker-reset")?.addEventListener("click", () => {
        reset.run();
        closeColorPicker();
    });

    document.body.appendChild(panel);
    paint();

    // Under the swatch, kept inside the window.
    const place = () => {
        const box = anchor.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
        const below = box.bottom + 6;
        const top = below + height > window.innerHeight - 8 && box.top - height - 6 > 8 ? box.top - height - 6 : below;
        panel.style.left = `${left + window.scrollX}px`;
        panel.style.top = `${top + window.scrollY}px`;
    };
    place();

    const onDocument = (event) => {
        if (!panel.contains(event.target) && !anchor.contains(event.target)) closeColorPicker();
    };
    const onKey = (event) => {
        if (event.key !== "Escape") return;
        closeColorPicker();
        anchor.focus();
    };
    document.addEventListener("pointerdown", onDocument, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    anchor.setAttribute("aria-expanded", "true");
    open = {
        panel,
        anchor,
        cleanup() {
            document.removeEventListener("pointerdown", onDocument, true);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", place);
        }
    };
    panel.querySelector(".color-picker-preset")?.focus();
}

// Whether a picker is open for this swatch, so callers can keep it in place
// instead of rebuilding it while a color is being dragged.
export function isPickingFor(anchor) {
    return Boolean(open && open.anchor === anchor);
}
