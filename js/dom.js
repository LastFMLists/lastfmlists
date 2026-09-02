// Element handles the app keeps for its lifetime, HTML escaping, modal
// plumbing and the helpers that read and restore form-control values.

export const resultsDiv = document.getElementById("results");
export const loadingDiv = document.getElementById("loading-stats");

export function waitForNextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export async function mapWithConcurrency(items, mapper, concurrency = 4) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= items.length) break;

            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

export const exportOptionsPanel = document.getElementById("export-options");
export const exportOptionsToggle = document.getElementById("open-export-options");
export const confirmExportButton = document.getElementById("confirm-export-image");
export const exportModal = document.getElementById("export-modal");
export const closeExportModalButton = document.getElementById("close-export-modal");
export const openGridExportButton = document.getElementById("open-grid-export");
export const gridExportModal = document.getElementById("grid-export-modal");
export const closeGridExportModalButton = document.getElementById("close-grid-export-modal");
export const confirmGridExportButton = document.getElementById("confirm-export-grid");

export function openModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.add("is-open");
    modalElement.setAttribute("aria-hidden", "false");
}

export function closeModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.remove("is-open");
    modalElement.setAttribute("aria-hidden", "true");
}

// Escape closes whichever modal is open, matching the click-outside behaviour.
document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-overlay.is-open").forEach(closeModal);
});

function getSelectedValues(selectElementId) {
    const select = document.getElementById(selectElementId);
    return Array.from(select.selectedOptions).map(option => option.value);
}

export function serializeControlValue(control) {
    if (!control) return "";
    if (control.type === "checkbox") {
        return control.checked ? "true" : "";
    }
    if (control.tagName === "SELECT" && control.multiple) {
        return Array.from(control.selectedOptions).map(option => option.value).join(",");
    }
    return (control.value || "").toString();
}

export function applySerializedControlValue(control, serializedValue) {
    if (!control) return;
    const safeValue = (serializedValue ?? "").toString();

    if (control.type === "checkbox") {
        control.checked = safeValue === "true";
        return;
    }

    if (control.tagName === "SELECT" && control.multiple) {
        const selectedValues = new Set(
            safeValue
                .split(",")
                .map(value => value.trim())
                .filter(Boolean)
        );
        Array.from(control.options || []).forEach(option => {
            option.selected = selectedValues.has(option.value);
        });
        return;
    }

    control.value = safeValue;
}

export function parseSerializedNumberList(serializedValue) {
    return (serializedValue || "")
        .toString()
        .split(",")
        .map(value => parseInt(value.trim(), 10))
        .filter(value => !isNaN(value));
}

export function insertAtCursor(textarea, text) {
    if (!textarea) return;

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);

    const caret = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function getControlLabelText(control) {
    if (!control?.id) return "";

    const directLabel = document.querySelector(`label[for="${control.id}"]`);
    if (directLabel) {
        return directLabel.textContent.replace(/\s+/g, " ").trim();
    }

    const inputPair = control.closest(".input-pair");
    if (inputPair) {
        const groupLabel = inputPair.parentElement?.querySelector("label");
        if (groupLabel) {
            return groupLabel.textContent.replace(/\s+/g, " ").trim();
        }
    }

    return "";
}

export function getListLengthLimit() {
    return Math.max(1, parseInt(document.getElementById("list-length")?.value, 10) || 10);
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}
