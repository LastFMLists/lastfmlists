// Lets people leave a long load running in another tab. The tab title shows
// the progress and says when the lists are ready, and a "Notify me" button,
// offered once a load has run for a while, can send a browser notification
// when it finishes. The browser asks for permission only after that click.

import { trackEvent } from '../analytics.js';
import { loadingDiv } from '../dom.js';

const SITE_NAME = "lastfmlists";
// Quick loads never show the button, so most visits see no new UI at all.
const OFFER_AFTER_MS = 10000;

const originalTitle = document.title;
let offerTimer = null;
let notifyWhenDone = false;
let button = null;
let loading = false;

function setTitle(text) {
    document.title = `${text} · ${SITE_NAME}`;
}

// Phones suspend background tabs, and Chrome on Android cannot show a
// notification from a page without a service worker, so the button is
// offered on desktop browsers only.
function canOfferNotification() {
    if (!("Notification" in window) || Notification.permission === "denied") return false;
    return !window.matchMedia("(pointer: coarse)").matches;
}

function ensureButton() {
    if (button) return button;
    button = document.createElement("button");
    button.type = "button";
    button.className = "load-notify";
    button.hidden = true;
    button.addEventListener("click", async () => {
        let permission = Notification.permission;
        if (permission === "default") {
            try {
                permission = await Notification.requestPermission();
            } catch (e) {
                permission = "denied";
            }
        }
        trackEvent(`load-notice/${permission}`, `Notify me: ${permission}`);
        if (permission === "granted") {
            notifyWhenDone = true;
            button.disabled = true;
            button.innerHTML = `<i class="fas fa-bell" aria-hidden="true"></i>You'll get a notification`;
        } else {
            button.hidden = true;
        }
    });
    loadingDiv.after(button);
    return button;
}

function offerButton() {
    if (!loading || !canOfferNotification()) return;
    const offer = ensureButton();
    offer.disabled = false;
    offer.innerHTML = `<i class="fas fa-bell" aria-hidden="true"></i>Notify me when it's done`;
    offer.hidden = false;
}

// Only needed when the person is elsewhere: another tab, or another window
// on top of this one.
function notify(body) {
    if (!notifyWhenDone) return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    try {
        const notification = new Notification(SITE_NAME, { body, icon: "logo.png" });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch (e) {
        // Some browsers refuse page notifications; the tab title still says it.
    }
}

// A finished or failed load keeps its marker in the title until the person
// comes back to the tab.
function showUntilSeen(text) {
    if (document.visibilityState === "visible") {
        document.title = originalTitle;
        return;
    }
    setTitle(text);
    const restore = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", restore);
        if (!loading) document.title = originalTitle;
    };
    document.addEventListener("visibilitychange", restore);
}

function endLoad() {
    loading = false;
    clearTimeout(offerTimer);
    if (button) button.hidden = true;
}

export function startLoadNotice() {
    loading = true;
    notifyWhenDone = false;
    setTitle("Loading…");
    clearTimeout(offerTimer);
    offerTimer = setTimeout(offerButton, OFFER_AFTER_MS);
}

// fraction is 0 to 1 while the history pages arrive; null for the steps
// that have no count, such as building the lists afterwards.
export function setLoadProgress(fraction) {
    if (!loading) return;
    setTitle(fraction == null ? "Loading…" : `Loading ${Math.floor(fraction * 100)}%`);
}

export function finishLoadNotice() {
    if (!loading) return;
    endLoad();
    showUntilSeen("✓ Ready");
    notify("Your lists are ready.");
}

export function failLoadNotice(message) {
    if (!loading) return;
    endLoad();
    showUntilSeen("Load failed");
    notify(message || "Loading stopped.");
}
