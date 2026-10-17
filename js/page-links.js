// Link counts for the guide and FAQ, which don't load the app's analytics.
// Only the destination site is sent; see link-events.js.

import { linkEvent } from './link-events.js';

document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a");
    const link = anchor && linkEvent(anchor);
    const counter = window.goatcounter;
    if (!link || !counter || typeof counter.count !== "function") return;
    try {
        counter.count({ path: link[0], title: link[1], event: true });
    } catch (e) {
        // A failed count must never break the page.
    }
});
