// A small popup asking for a donation, shown right after someone exports an
// image, a race GIF or an album grid: the moment they have just taken
// something from the site. It can be put off for 30 days or hidden for
// good, and it never returns for anyone who says they already donated or
// who follows a Ko-fi link. Its state stays in this browser; analytics.js
// only counts that the popup was shown and which button was pressed.

import { trackEvent, trackEventOnce } from '../analytics.js';

const STORAGE_KEY = "lastfmlists-support";
const KOFI_URL = "https://ko-fi.com/lastfmlists";
const SNOOZE_DAYS = 30;
// Wait for the export window to close and the download to start first.
const SHOW_DELAY_MS = 800;

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && typeof saved === "object") {
            return { hidden: false, snoozedUntil: 0, ...saved };
        }
    } catch (e) {
        // Blocked or malformed storage: start fresh, and nothing persists.
    }
    return { hidden: false, snoozedUntil: 0 };
}

let record = load();

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
        // Private browsing with storage blocked: the popup just won't remember.
    }
}

function hideForGood(reason) {
    record.hidden = true;
    record.hiddenReason = reason;
    save();
}

function isDue() {
    return !record.hidden && Date.now() >= (record.snoozedUntil || 0);
}

// ---- The popup ----

let banner = null;

const HEADLINES = {
    image: "Enjoy your image!",
    gif: "Enjoy your GIF!",
    grid: "Enjoy your album grid!"
};

function buildBanner() {
    banner = document.createElement("aside");
    banner.className = "support-banner";
    banner.setAttribute("aria-label", "Support lastfmlists");
    banner.innerHTML = `
        <button type="button" class="support-close" data-support="later" aria-label="Close for now"><i class="fas fa-xmark" aria-hidden="true"></i></button>
        <div class="support-body">
            <span class="support-icon" aria-hidden="true"><i class="fas fa-mug-hot"></i></span>
            <div class="support-text">
                <strong></strong>
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
        trackEvent(`support/${action}`, `Donation banner: ${action}`);
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

function showBanner(kind) {
    if (!banner) buildBanner();
    banner.querySelector(".support-text strong").textContent = HEADLINES[kind] || "Enjoying lastfmlists?";
    if (!banner.classList.contains("is-visible")) trackEventOnce("support/shown", "Donation banner shown");
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

document.addEventListener("export:done", (event) => {
    if (!isDue()) return;
    const kind = event.detail && event.detail.kind;
    setTimeout(() => {
        if (isDue()) showBanner(kind);
    }, SHOW_DELAY_MS);
});

// Anyone who opens a Ko-fi link on their own is not asked again.
document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href*="ko-fi.com"]');
    if (link && !link.closest(".support-banner") && !record.hidden) {
        hideForGood("kofi");
        hideBanner();
    }
});
