// A small banner asking for a donation, shown once someone has clearly
// found the site useful: five different lists viewed, or ten minutes spent
// with a library loaded. It can be put off for 30 days or hidden for good,
// and it never returns for anyone who says they already donated or who
// follows a Ko-fi link. Everything is kept in this browser; nothing is sent
// anywhere.

import { readCurrentFilterInputState } from '../data/filters.js';
import { state } from '../state.js';

const STORAGE_KEY = "lastfmlists-support";
const KOFI_URL = "https://ko-fi.com/lastfmlists";
const LISTS_NEEDED = 5;
const SECONDS_NEEDED = 10 * 60;
const SNOOZE_DAYS = 30;
// A list counts once it has been on screen this long, so clicking through
// filters quickly does not count as viewing lists.
const VIEW_DELAY_MS = 1500;
const TICK_SECONDS = 15;

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && typeof saved === "object") {
            return { lists: [], seconds: 0, hidden: false, snoozedUntil: 0, ...saved };
        }
    } catch (e) {
        // Blocked or malformed storage: start fresh, and nothing persists.
    }
    return { lists: [], seconds: 0, hidden: false, snoozedUntil: 0 };
}

let record = load();

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
        // Private browsing with storage blocked: the banner just won't remember.
    }
}

function hideForGood(reason) {
    record.hidden = true;
    record.hiddenReason = reason;
    save();
}

// Short, stable fingerprint of the list on screen.
function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function currentListSignature() {
    const comparison = document.getElementById("comparison-toggle")?.dataset.active === "true";
    const clean = (values) => Object.fromEntries(Object.entries(values || {})
        .filter(([, value]) => (value ?? "").toString().trim() !== "")
        .sort(([a], [b]) => a.localeCompare(b)));
    return hashText(JSON.stringify({
        comparison,
        filters: comparison ? null : clean(readCurrentFilterInputState()),
        equations: (document.getElementById("equations")?.value || "").trim(),
        left: comparison ? clean(state.comparisonFilterStates.left) : null,
        right: comparison ? clean(state.comparisonFilterStates.right) : null,
        // An empty box shows ten rows, the same list as typing 10.
        length: document.getElementById("list-length")?.value || "10"
    }));
}

function onListsView() {
    const body = document.body;
    return body.classList.contains("app-loaded")
        && !body.classList.contains("view-games")
        && !document.querySelector(".modal-overlay.is-open");
}

function isDue() {
    if (record.hidden || Date.now() < (record.snoozedUntil || 0)) return false;
    return record.lists.length >= LISTS_NEEDED || record.seconds >= SECONDS_NEEDED;
}

// ---- The banner ----

let banner = null;

function buildBanner() {
    banner = document.createElement("aside");
    banner.className = "support-banner";
    banner.setAttribute("aria-label", "Support lastfmlists");
    banner.innerHTML = `
        <button type="button" class="support-close" data-support="later" aria-label="Close for now"><i class="fas fa-xmark" aria-hidden="true"></i></button>
        <div class="support-body">
            <span class="support-icon" aria-hidden="true"><i class="fas fa-mug-hot"></i></span>
            <div class="support-text">
                <strong>Enjoying lastfmlists?</strong>
                <p>I build and maintain lastfmlists on my own. If it is useful to you, a small donation helps me keep working on it. Every feature stays free.</p>
            </div>
        </div>
        <a class="support-primary" href="${KOFI_URL}" target="_blank" rel="noopener" data-support="kofi"><i class="fas fa-heart" aria-hidden="true"></i>Support on Ko-fi</a>
        <div class="support-secondary">
            <button type="button" data-support="later">Not now</button>
            <button type="button" data-support="donated">I already donated</button>
            <button type="button" data-support="never">Don't show again</button>
        </div>`;
    banner.addEventListener("click", (event) => {
        const action = event.target.closest("[data-support]")?.dataset.support;
        if (!action) return;
        if (action === "later") {
            record.snoozedUntil = Date.now() + SNOOZE_DAYS * 86400000;
            save();
            hideBanner();
        } else if (action === "never") {
            hideForGood("dismissed");
            hideBanner();
        } else if (action === "donated") {
            hideForGood("donated");
            showThanks();
        } else if (action === "kofi") {
            hideForGood("kofi");
            hideBanner();
        }
    });
    document.body.appendChild(banner);
}

function showBanner() {
    if (!banner) buildBanner();
    banner.classList.add("is-visible");
}

function hideBanner() {
    if (banner) banner.classList.remove("is-visible");
}

function showThanks() {
    if (!banner) return;
    banner.querySelector(".support-text").innerHTML = "<strong>Thank you!</strong><p>Your support means a lot. This message won't appear again.</p>";
    banner.querySelector(".support-primary").remove();
    banner.querySelector(".support-secondary").remove();
    setTimeout(hideBanner, 3000);
}

function maybeShow() {
    if (isDue() && onListsView()) showBanner();
}

// ---- Counting ----

let viewTimer = null;

document.addEventListener("lists:rendered", (event) => {
    clearTimeout(viewTimer);
    if (record.hidden || !(event.detail && event.detail.count > 0)) return;
    const signature = currentListSignature();
    viewTimer = setTimeout(() => {
        if (!onListsView() || document.body.classList.contains("view-entity")) return;
        if (!record.lists.includes(signature)) {
            record.lists.push(signature);
            if (record.lists.length > 50) record.lists.shift();
            save();
        }
        maybeShow();
    }, VIEW_DELAY_MS);
});

setInterval(() => {
    if (record.hidden || document.visibilityState !== "visible") return;
    if (!document.body.classList.contains("app-loaded")) return;
    record.seconds += TICK_SECONDS;
    save();
    maybeShow();
}, TICK_SECONDS * 1000);

// Anyone who opens a Ko-fi link on their own is not asked again.
document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href*="ko-fi.com"]');
    if (link && !link.closest(".support-banner") && !record.hidden) {
        hideForGood("kofi");
        hideBanner();
    }
});
