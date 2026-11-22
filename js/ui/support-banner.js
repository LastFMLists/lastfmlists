// A slim strip at the top of the page about the Last.fm Pro requirement.
// From December 1, 2026 Last.fm only serves its API to paid Pro accounts,
// so the site runs only as long as donations pay for one. The strip sits in
// the page flow (it scrolls away with the page and never covers anything),
// shows a progress bar toward a year of Pro, and goes away for good once the
// goal is met or someone says they donated. Closing it puts it off for a few
// days. Its state stays in this browser; analytics.js only counts that the
// strip was shown and which button was pressed.

import { trackEvent, trackEventOnce } from '../analytics.js';

// ---- Update these by hand ----
// RAISED is the total from Ko-fi so far, in dollars. The strip disappears
// for everyone once it reaches GOAL.
const RAISED = 0;
const GOAL = 50;        // a year of Last.fm Pro
const MONTH_COST = 5;   // one month of Last.fm Pro
// Local midnight at the start of December 1, 2026.
const DEADLINE = new Date(2026, 11, 1);
// -------------------------------

const KOFI_URL = "https://ko-fi.com/lastfmlists";
// A new key, so people who turned off the old donation popup still hear
// once that the site is about to stop working.
const STORAGE_KEY = "lastfmlists-support-pro";
const SNOOZE_DAYS = 3;
const DAY_MS = 86400000;

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && typeof saved === "object") return { hidden: false, snoozedUntil: 0, ...saved };
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
        // Private browsing with storage blocked: the strip just won't remember.
    }
}

function hideForGood(reason) {
    record.hidden = true;
    record.hiddenReason = reason;
    save();
}

function money(amount) {
    return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function daysLeftText(now) {
    const days = Math.ceil((DEADLINE - now) / DAY_MS);
    if (days <= 1) return "tomorrow";
    return `in ${days} days`;
}

// What the strip says depends on the date and on how much has come in.
function copy(now) {
    if (now < DEADLINE) {
        return {
            icon: "fa-triangle-exclamation",
            title: `lastfmlists stops working on December 1 <span class="support-strip-when">(${daysLeftText(now)})</span>`,
            body: `Last.fm is putting its API behind a paid Pro subscription, a change outside my control, and the site can't load any scrobbles without it. I'm a uni student and can't cover another ${money(MONTH_COST)} a month myself, so lastfmlists keeps running only if donations pay for it.`,
            short: `Last.fm is putting its API behind a paid subscription. I'm a student and can't pay for it, so the site only keeps running on donations.`,
            meter: `first ${money(MONTH_COST)} keeps it on in December`
        };
    }
    if (RAISED < MONTH_COST) {
        return {
            icon: "fa-circle-pause",
            title: "lastfmlists is paused",
            body: `Since December 1, Last.fm only serves its API to paid Pro accounts, and I can't pay for one myself. The site comes back as soon as donations reach ${money(MONTH_COST)}.`,
            short: `Last.fm now charges for its API and I can't pay for it. ${money(MONTH_COST)} in donations brings the site back.`,
            meter: `${money(MONTH_COST)} brings it back for a month`
        };
    }
    return {
        icon: "fa-heart",
        title: "lastfmlists runs on donations",
        body: `Since December 1, Last.fm only serves its API to paid Pro accounts. Your donations pay for it: every ${money(MONTH_COST)} keeps the site running for another month.`,
        short: `Last.fm now charges for its API. Every ${money(MONTH_COST)} keeps the site running for another month.`,
        meter: "a full year of Last.fm Pro"
    };
}

function isDue() {
    if (RAISED >= GOAL) return false;
    return !record.hidden && Date.now() >= (record.snoozedUntil || 0);
}

// ---- The strip ----

let strip = null;

function buildStrip() {
    const text = copy(new Date());
    const filled = Math.min(100, (RAISED / GOAL) * 100);
    const tick = (MONTH_COST / GOAL) * 100;

    strip = document.createElement("aside");
    strip.className = "support-strip content-block";
    strip.setAttribute("aria-label", "Donations keep lastfmlists running");
    strip.innerHTML = `
        <span class="support-strip-icon" aria-hidden="true"><i class="fas ${text.icon}"></i></span>
        <div class="support-strip-text">
            <p class="support-strip-title"><strong>${text.title}</strong></p>
            <p class="support-strip-body"><span class="support-strip-long">${text.body}</span><span class="support-strip-short">${text.short}</span></p>
        </div>
        <div class="support-strip-side">
            <div class="support-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${GOAL}" aria-valuenow="${RAISED}" aria-valuetext="${money(RAISED)} of ${money(GOAL)} raised">
                <span class="support-meter-fill" style="width: ${filled}%"></span>
                <span class="support-meter-tick" style="left: ${tick}%"></span>
            </div>
            <p class="support-meter-label"><strong>${money(RAISED)} of ${money(GOAL)}</strong> · ${text.meter}</p>
            <div class="support-strip-actions">
                <a class="support-strip-donate" href="${KOFI_URL}" target="_blank" rel="noopener" data-support="kofi"><i class="fas fa-mug-hot" aria-hidden="true"></i>Donate on Ko-fi</a>
                <button type="button" class="support-strip-done" data-support="donated">I've donated</button>
            </div>
        </div>
        <button type="button" class="support-close" data-support="later" aria-label="Hide for ${SNOOZE_DAYS} days" title="Hide for ${SNOOZE_DAYS} days"><i class="fas fa-xmark" aria-hidden="true"></i></button>`;

    strip.addEventListener("click", (event) => {
        const action = event.target.closest("[data-support]")?.dataset.support;
        if (!action) return;
        trackEvent(`support/${action}`, `Donation strip: ${action}`);
        if (action === "later") {
            record.snoozedUntil = Date.now() + SNOOZE_DAYS * DAY_MS;
            save();
            hideStrip();
        } else if (action === "donated") {
            hideForGood("donated");
            showThanks();
        } else if (action === "kofi") {
            hideForGood("kofi");
            // Leave it on screen while the Ko-fi tab opens; it is gone next visit.
        }
    });

    const main = document.querySelector("main");
    if (main) main.prepend(strip);
    document.body.classList.add("has-support-strip");
}

function hideStrip() {
    if (strip) strip.remove();
    strip = null;
    document.body.classList.remove("has-support-strip");
}

function showThanks() {
    if (!strip) return;
    strip.classList.add("is-thanks");
    strip.querySelector(".support-strip-icon i").className = "fas fa-heart";
    strip.querySelector(".support-strip-text").innerHTML = "<p class=\"support-strip-title\"><strong>Thank you!</strong></p><p class=\"support-strip-body\">You're the reason lastfmlists keeps running. This message won't show again.</p>";
    strip.querySelector(".support-strip-side").remove();
    setTimeout(hideStrip, 4000);
}

if (isDue()) {
    buildStrip();
    trackEventOnce("support/shown", "Donation strip shown");
}

// Anyone who opens a Ko-fi link elsewhere on the page is not asked again.
document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href*="ko-fi.com"]');
    if (link && !link.closest(".support-strip") && !record.hidden) hideForGood("kofi");
});
