// The Equations menu as a list of steps you pick from, ported from the
// Android app's editor. Each step is one clause of the pipeline language in
// data/equations.js, and the text boxes #equations and #equations-right still
// hold the pipeline itself: the editor writes them and fires the same input
// event as typing, so saving, comparison mode and the filter chips work as
// before. Text that the editor can't show opens in the advanced text editor.

import { equationFieldResolvers } from '../data/equations.js';
import { escapeHTML } from '../dom.js';

// ---- Fields, with the names the Android app uses ----

const KIND_FIELDS = [
    ["name", "name"], ["name-length", "name length"], ["word-count", "name word count"],
    ["scrobble-count", "play count"], ["rank", "library rank"], ["first-scrobble-year", "first listen year"],
    ["days-since-last", "days since last listen"], ["listeners", "global listeners"], ["global-scrobbles", "global plays"]
];

const FIELD_GROUPS = [
    ...["artist", "album", "track"].map(kind => {
        const title = kind[0].toUpperCase() + kind.slice(1);
        const fields = KIND_FIELDS.map(([id, label]) => [`${kind}-${id}`, `${title} ${label}`]);
        if (kind === "artist") fields.push(["artist-track-count", "Artist distinct tracks"]);
        if (kind === "album") fields.push(["album-track-count", "Album distinct tracks"]);
        if (kind === "track") fields.push(
            ["track-duration", "Track duration (seconds)"],
            ["oldest-average-listening-time", "Average listen date (earliest)"],
            ["newest-average-listening-time", "Average listen date (latest)"]
        );
        return { title, fields };
    }),
    {
        title: "Play",
        fields: [
            ["scrobble-order", "Play position in history"], ["year", "Play year"], ["month", "Play month (1–12)"],
            ["day-of-month", "Day of month"], ["weekday", "Weekday (0 = Sunday)"]
        ]
    }
];

const FIELD_LABELS = new Map(FIELD_GROUPS.flatMap(group => group.fields));
// Longest first, so "artist-name-length" is not read as "artist-name".
const FIELD_IDS = Object.keys(equationFieldResolvers).sort((a, b) => b.length - a.length);

const isTextField = (id) => id.endsWith("-name");

const ACTIONS = [["filter", "Keep matching plays"], ["sort", "Order plays"], ["unique", "Keep first per value"], ["show", "Show value"]];
const COMPARISONS = [["=", "equals"], ["!=", "does not equal"], [">", "is greater than"], [">=", "is at least"], ["<", "is less than"], ["<=", "is at most"]];
const KINDS = [["field", "Library field"], ["number", "Number"], ["text", "Text"], ["calc", "Calculation"]];
const OPERATORS = [["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["/", "Divide"], ["%", "Remainder"]];
const DIRECTIONS = [["asc", "Ascending · A–Z, smallest first"], ["desc", "Descending · Z–A, largest first"]];

// ---- Steps <-> pipeline text ----

const field = (id = "track-scrobble-count") => ({ kind: "field", id });
const number = (text = "10") => ({ kind: "number", text });
const text = (value = "") => ({ kind: "text", text: value });
const calc = (left = field(), op = "/", right = number("2")) => ({ kind: "calc", left, op, right });
const newStep = () => ({ action: "filter", left: field(), comparison: ">=", right: number(), field: "artist-name", direction: "asc", limit: "1" });

const operandIsText = (operand) => operand.kind === "text" || (operand.kind === "field" && isTextField(operand.id));

function operandCode(operand) {
    switch (operand.kind) {
        case "field":
            if (!FIELD_LABELS.has(operand.id)) throw new Error("Choose a field");
            return operand.id;
        case "number": {
            const value = Number(operand.text);
            if (operand.text.trim() === "" || !Number.isFinite(value)) throw new Error("Enter a valid number");
            return String(value);
        }
        case "text":
            // The pipeline splits steps at semicolons and line breaks, even inside quotes.
            if (/[;\n]/.test(operand.text)) throw new Error("Text can't contain semicolons or line breaks");
            if (!operand.text.includes('"')) return `"${operand.text}"`;
            if (!operand.text.includes("'")) return `'${operand.text}'`;
            throw new Error("Text can't contain both kinds of quotes");
        default:
            if (operandIsText(operand.left) || operandIsText(operand.right)) throw new Error("Calculations need numbers, not text");
            return `(${operandCode(operand.left)} ${operand.op} ${operandCode(operand.right)})`;
    }
}

function stepCode(step) {
    if (step.action === "filter") {
        if (operandIsText(step.left) !== operandIsText(step.right)) throw new Error("Compare text with text, or numbers with numbers");
        if (operandIsText(step.left) && !["=", "!="].includes(step.comparison)) throw new Error("Text can only be equal or not equal");
        return `filter ${operandCode(step.left)} ${step.comparison} ${operandCode(step.right)}`;
    }
    const fieldCode = operandCode(field(step.field));
    if (step.action === "sort") return `sort ${fieldCode} ${step.direction}`;
    if (step.action === "unique") {
        const limit = Number(step.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new Error("Keep at least one play per value");
        return `unique ${fieldCode} ${limit}`;
    }
    return `show ${fieldCode}`;
}

export function encodeSteps(steps) {
    return steps.map(stepCode).join(";\n");
}

function splitClauses(source) {
    const clauses = [];
    let quote = null;
    let part = "";
    for (const c of source) {
        if (quote) {
            part += c;
            if (c === quote) quote = null;
        } else if (c === "'" || c === '"') {
            quote = c;
            part += c;
        } else if (c === ";" || c === "\n") {
            if (part.trim()) clauses.push(part.trim());
            part = "";
        } else {
            part += c;
        }
    }
    if (quote) throw new Error("Close the quoted text");
    if (part.trim()) clauses.push(part.trim());
    return clauses;
}

function tokenize(source) {
    const tokens = [];
    let p = 0;
    while (p < source.length) {
        const c = source[p];
        if (/\s/.test(c)) { p++; continue; }
        if (c === "'" || c === '"') {
            const end = source.indexOf(c, p + 1);
            if (end < 0) throw new Error("Close the quoted text");
            tokens.push(source.slice(p, end + 1));
            p = end + 1;
        } else if (/[\d.]/.test(c)) {
            let end = p + 1;
            while (end < source.length && /[\d.]/.test(source[end])) end++;
            tokens.push(source.slice(p, end));
            p = end;
        } else if ("+-*/%()=<>!".includes(c)) {
            const pair = source.slice(p, p + 2);
            const token = ["<=", ">=", "!=", "=="].includes(pair) ? pair : c;
            tokens.push(token);
            p += token.length;
        } else {
            const id = FIELD_IDS.find(name => source.slice(p, p + name.length).toLowerCase() === name);
            if (!id) throw new Error(`Unknown field near "${source.slice(p, p + 20)}"`);
            tokens.push(id);
            p += id.length;
        }
    }
    return tokens;
}

// Reads one side of a condition: numbers, fields, quoted text and + - * / %
// with brackets, the same grammar data/equations.js evaluates.
function readCondition(source) {
    const tokens = tokenize(source);
    let i = 0;
    const take = () => {
        if (i >= tokens.length) throw new Error("Complete both sides of the condition");
        return tokens[i++];
    };
    const factor = () => {
        const token = take();
        if (token === "(") {
            const inner = expression();
            if (take() !== ")") throw new Error("Close the bracket");
            return inner;
        }
        if (token === "-") return calc(number("0"), "-", factor());
        if (token[0] === '"' || token[0] === "'") return text(token.slice(1, -1));
        if (token !== "." && Number.isFinite(Number(token))) return number(token);
        if (FIELD_LABELS.has(token)) return field(token);
        throw new Error("Choose a field, number or text");
    };
    const term = () => {
        let left = factor();
        while (["*", "/", "%"].includes(tokens[i])) { const op = take(); left = calc(left, op, factor()); }
        return left;
    };
    const expression = () => {
        let left = term();
        while (["+", "-"].includes(tokens[i])) { const op = take(); left = calc(left, op, term()); }
        return left;
    };
    const left = expression();
    let comparison = take();
    if (comparison === "==") comparison = "=";
    if (!COMPARISONS.some(([id]) => id === comparison)) throw new Error("Use a comparison such as = or >=");
    const right = expression();
    if (i !== tokens.length) throw new Error("Unexpected text after the condition");
    return { ...newStep(), left, comparison, right };
}

export function decodeSteps(source) {
    return splitClauses(source || "").map(clause => {
        const words = clause.split(/\s+/);
        const action = words[0].toLowerCase();
        if (["sort", "unique", "show"].includes(action)) {
            const fieldId = (words[1] || "").toLowerCase();
            if (words.length < 2 || words.length > 3 || (action === "show" && words.length !== 2)) throw new Error(`Check the ${action} step`);
            const step = {
                ...newStep(),
                action,
                field: fieldId,
                direction: action === "sort" ? (words[2] || "asc").toLowerCase() : "asc",
                limit: action === "unique" ? words[2] || "1" : "1"
            };
            if (action === "sort" && !["asc", "desc"].includes(step.direction)) throw new Error("Sort with asc or desc");
            stepCode(step);
            return step;
        }
        const step = readCondition(action === "filter" ? clause.slice(words[0].length) : clause);
        stepCode(step);
        return step;
    });
}

// ---- Rendering ----

function options(list, selected) {
    return list.map(([value, label]) => `<option value="${escapeHTML(value)}"${value === selected ? " selected" : ""}>${escapeHTML(label)}</option>`).join("");
}

function fieldOptions(selected) {
    return FIELD_GROUPS.map(group => `<optgroup label="${group.title}">${options(group.fields, selected)}</optgroup>`).join("");
}

function operandHTML(label, operand, path) {
    let value;
    if (operand.kind === "field") {
        value = `<select data-path="${path}" data-k="value" aria-label="${label}: field">${fieldOptions(operand.id)}</select>`;
    } else if (operand.kind === "number") {
        value = `<input type="text" inputmode="decimal" data-path="${path}" data-k="value" value="${escapeHTML(operand.text)}" aria-label="${label}: number">`;
    } else if (operand.kind === "text") {
        value = `<input type="text" data-path="${path}" data-k="value" value="${escapeHTML(operand.text)}" placeholder="Text to match" aria-label="${label}: text">`;
    } else {
        value = `<div class="eq-calc">
            ${operandHTML("First value", operand.left, `${path}.left`)}
            <label class="eq-field"><span>Calculate</span><select data-path="${path}" data-k="op">${options(OPERATORS, operand.op)}</select></label>
            ${operandHTML("Second value", operand.right, `${path}.right`)}
        </div>`;
    }
    return `<div class="eq-operand">
        <span class="eq-label">${label}</span>
        <div class="eq-operand-row">
            <select data-path="${path}" data-k="kind" aria-label="${label}: type">${options(KINDS, operand.kind)}</select>
            ${operand.kind === "calc" ? "" : value}
        </div>
        ${operand.kind === "calc" ? value : ""}
    </div>`;
}

function stepHTML(step, index, count) {
    let body;
    if (step.action === "filter") {
        const comparisons = operandIsText(step.left) ? COMPARISONS.slice(0, 2) : COMPARISONS;
        body = `${operandHTML("Compare", step.left, "left")}
            <label class="eq-field"><span>Condition</span><select data-k="comparison">${options(comparisons, step.comparison)}</select></label>
            ${operandHTML("With", step.right, "right")}`;
    } else {
        body = `<label class="eq-field"><span>Field</span><select data-k="field">${fieldOptions(step.field)}</select></label>`;
        if (step.action === "sort") body += `<label class="eq-field"><span>Order</span><select data-k="direction">${options(DIRECTIONS, step.direction)}</select></label>`;
        if (step.action === "unique") body += `<label class="eq-field"><span>Plays per value</span><input type="number" min="1" step="1" data-k="limit" value="${escapeHTML(step.limit)}"></label>`;
    }
    return `<div class="eq-step" data-step="${index}">
        <div class="eq-step-head">
            <strong>Step ${index + 1}</strong>
            <span class="eq-step-tools">
                <button type="button" data-act="up" aria-label="Move step ${index + 1} up"${index === 0 ? " disabled" : ""}><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
                <button type="button" data-act="down" aria-label="Move step ${index + 1} down"${index === count - 1 ? " disabled" : ""}><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                <button type="button" data-act="remove" aria-label="Remove step ${index + 1}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
            </span>
        </div>
        <label class="eq-field"><span>Operation</span><select data-k="action">${options(ACTIONS, step.action)}</select></label>
        ${body}
    </div>`;
}

function getOperand(step, path) {
    return path.split(".").reduce((operand, key) => operand[key], step);
}

function setOperand(step, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((operand, key) => operand[key], step)[last] = value;
}

const EXAMPLES = [
    ["Tracks with at least 10 plays", "filter track-scrobble-count >= 10"],
    ["Tracks with at least 10% of their artist's plays", "filter (track-scrobble-count / artist-scrobble-count) >= 0.1"],
    ["Last 3 plays per artist, with library rank", "show artist-rank;\nsort scrobble-order desc;\nunique artist-name 3"],
    ["Plays of artists with 500 plays in 2023", "filter year = 2023;\nfilter artist-scrobble-count >= 500"],
    ["2023 plays of artists with 500 plays overall", "filter artist-scrobble-count >= 500;\nfilter year = 2023"],
    ["Top track for each title length, where the artist name is just as long", "filter artist-name-length = track-name-length;\nsort track-scrobble-count desc;\nunique track-name-length 1;\nsort track-name-length asc"]
];

// ---- One editor per text box ----

class SideEditor {
    constructor(side, textarea) {
        this.side = side;
        this.textarea = textarea;
        this.steps = [];
        this.problem = null;
        this.readable = true;
        this.writing = false;
        this.list = document.createElement("div");
        this.list.className = "eq-steps";
        this.add = document.createElement("button");
        this.add.type = "button";
        this.add.className = "eq-add";
        this.add.innerHTML = `<i class="fas fa-plus" aria-hidden="true"></i>Add step`;
        this.message = document.createElement("p");
        this.message.className = "eq-problem";
        this.message.setAttribute("role", "alert");
        textarea.before(this.list, this.add);
        textarea.after(this.message);

        this.add.addEventListener("click", () => this.update([...this.steps, newStep()]));
        this.list.addEventListener("click", (event) => this.onClick(event));
        this.list.addEventListener("change", (event) => this.onEdit(event, true));
        this.list.addEventListener("input", (event) => this.onEdit(event, false));
        // Changes from the visual editor must not reach the panel's listener as
        // raw selects; only the text box below speaks for this side.
        ["input", "change"].forEach(type => this.list.addEventListener(type, event => event.stopPropagation()));
        textarea.addEventListener("input", () => { if (!this.writing) this.readText(); });
    }

    // The text box changed (typed, reset, other side, opened list): re-read it.
    readText() {
        try {
            this.steps = decodeSteps(this.textarea.value);
            this.problem = null;
            this.readable = true;
        } catch (error) {
            this.problem = error.message;
            this.readable = false;
        }
        this.render();
    }

    update(steps) {
        this.steps = steps;
        this.render();
        this.write();
    }

    // Steps -> text box, when they make a valid pipeline. The input event
    // lets the panel store it exactly as if it had been typed.
    write() {
        try {
            const code = encodeSteps(this.steps);
            this.problem = null;
            this.readable = true;
            if (code !== this.textarea.value) {
                this.textarea.value = code;
                // Our own write: skip re-reading it, which would redraw the
                // steps and take the cursor out of the box being typed in.
                this.writing = true;
                this.textarea.dispatchEvent(new Event("input", { bubbles: true }));
                this.writing = false;
            }
        } catch (error) {
            this.problem = error.message;
        }
        this.paintProblem();
    }

    onClick(event) {
        const button = event.target.closest("[data-act]");
        const card = event.target.closest("[data-step]");
        if (!button || !card) return;
        const index = Number(card.dataset.step);
        const steps = [...this.steps];
        if (button.dataset.act === "remove") steps.splice(index, 1);
        else {
            const target = button.dataset.act === "up" ? index - 1 : index + 1;
            [steps[index], steps[target]] = [steps[target], steps[index]];
        }
        this.update(steps);
    }

    onEdit(event, structural) {
        const control = event.target;
        const card = control.closest("[data-step]");
        if (!card || !control.dataset.k) return;
        // Typing in a box only rewrites the text; choosing from a list may
        // change which controls the step needs, so it redraws the step.
        if (!structural && control.tagName === "SELECT") return;
        const step = this.steps[Number(card.dataset.step)];
        const { k, path } = control.dataset;
        const value = control.value;
        let redraw = control.tagName === "SELECT";

        if (path) {
            const operand = getOperand(step, path);
            if (k === "kind") {
                setOperand(step, path, value === "field" ? field() : value === "number" ? number() : value === "text" ? text() : calc());
            } else if (k === "op") {
                operand.op = value;
            } else if (operand.kind === "field") {
                operand.id = value;
            } else {
                operand.text = value;
                redraw = false;
            }
            // Keep both sides comparable when one switches between text and numbers.
            if (path === "left" && (k === "kind" || k === "value") && operandIsText(step.left) !== operandIsText(step.right)) {
                step.right = operandIsText(step.left) ? text() : number();
            }
        } else if (k === "action") {
            Object.assign(step, { ...newStep(), action: value, field: step.field });
        } else {
            step[k] = value;
            if (k === "limit") redraw = false;
        }
        if (step.action === "filter" && operandIsText(step.left) && !["=", "!="].includes(step.comparison)) step.comparison = "=";

        if (redraw) this.render();
        this.write();
    }

    render() {
        this.list.innerHTML = this.steps.length
            ? this.steps.map((step, index) => stepHTML(step, index, this.steps.length)).join("")
            : `<p class="eq-empty">No steps yet. Add one, or try an example from the guide above.</p>`;
        this.paintProblem();
    }

    paintProblem() {
        this.message.textContent = this.problem || "";
        this.message.hidden = !this.problem;
    }
}

// ---- The menu ----

const layout = document.querySelector(".equation-editor-layout");
const editors = [];

function setAdvanced(advanced) {
    layout.classList.toggle("is-visual", !advanced);
    layout.classList.toggle("is-advanced", advanced);
    modeButton.textContent = advanced ? "Use the step editor" : "Advanced text editor";
    syncModeButton();
}

// The step editor can only take over when it can show every step.
function syncModeButton() {
    const advanced = layout.classList.contains("is-advanced");
    const unreadable = editors.some(editor => !editor.readable && !editor.textarea.disabled);
    modeButton.disabled = advanced && unreadable;
    modeButton.title = modeButton.disabled ? "Fix the text first: the step editor can't show it yet" : "";
}

// The right side only exists in comparison mode.
function syncSides() {
    editors.forEach(editor => {
        const sideElement = editor.textarea.closest(".eq-side");
        sideElement.hidden = editor.side === "right" && editor.textarea.disabled;
        editor.readText();
    });
    layout.classList.toggle("is-comparison", editors.some(editor => editor.side === "right" && !editor.textarea.disabled));
    if (editors.some(editor => !editor.readable && !editor.textarea.disabled)) setAdvanced(true);
    syncModeButton();
}

let modeButton = null;

if (layout) {
    const pane = layout.querySelector(".equation-editor-pane");
    const intro = pane.querySelector(".eq-intro");

    const guide = document.createElement("div");
    guide.className = "eq-guide";
    guide.innerHTML = `<button type="button" class="eq-link" data-act="guide" aria-expanded="false">How to use steps</button>
        <div class="eq-guide-body" hidden>
            <ol>
                <li><b>Keep matching plays</b> compares a field with a number, text or another field. With several of these steps, a play has to match all of them.</li>
                <li><b>Order plays</b> changes the order the later steps work in. On a track list it also sets the order of the list.</li>
                <li><b>Keep first per value</b> keeps a number of plays for each artist, album or other value. This changes the counts.</li>
                <li><b>Show value</b> adds a field's value to every row of the list.</li>
            </ol>
            <p>For a calculation, choose Calculation on either side. It takes two values and an operation, and either value can be another calculation. Missing details and division by zero never match.</p>
            <p class="eq-examples-title">Examples (these replace the current steps)</p>
            <div class="eq-examples">${EXAMPLES.map(([label], index) => `<button type="button" class="eq-example" data-example="${index}">${escapeHTML(label)}</button>`).join("")}</div>
        </div>`;
    intro.after(guide);

    modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.className = "eq-link eq-mode";
    pane.appendChild(modeButton);

    pane.querySelectorAll(".eq-side").forEach(sideElement => {
        const textarea = sideElement.querySelector("textarea");
        editors.push(new SideEditor(sideElement.dataset.side, textarea));
    });

    guide.addEventListener("click", (event) => {
        const toggle = event.target.closest('[data-act="guide"]');
        if (toggle) {
            const body = guide.querySelector(".eq-guide-body");
            body.hidden = !body.hidden;
            toggle.setAttribute("aria-expanded", String(!body.hidden));
            toggle.textContent = body.hidden ? "How to use steps" : "Hide the guide";
            return;
        }
        const example = event.target.closest("[data-example]");
        if (!example) return;
        // Examples go to the side being edited in comparison mode.
        const target = document.getElementById("comparison-edit-target")?.value === "right"
            ? editors.find(editor => editor.side === "right" && !editor.textarea.disabled)
            : null;
        const editor = target || editors[0];
        editor.textarea.value = EXAMPLES[Number(example.dataset.example)][1];
        editor.textarea.dispatchEvent(new Event("input", { bubbles: true }));
        setAdvanced(false);
    });

    modeButton.addEventListener("click", () => {
        if (modeButton.disabled) return;
        setAdvanced(!layout.classList.contains("is-advanced"));
    });

    editors.forEach(editor => editor.textarea.addEventListener("input", syncModeButton));
    document.addEventListener("filters:changed", syncSides);
    const opener = layout.closest(".dropdown")?.querySelector(".dropdown-button");
    if (opener) opener.addEventListener("click", syncSides);
    ["comparison-toggle", "comparison-edit-target", "reset-filters"].forEach(id => {
        const control = document.getElementById(id);
        if (control) control.addEventListener(control.tagName === "SELECT" ? "change" : "click", () => setTimeout(syncSides, 0));
    });

    setAdvanced(false);
    syncSides();
}
