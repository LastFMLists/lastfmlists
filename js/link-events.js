// Names a clicked link by where it goes, for the anonymous counts: only the
// site (Reddit, GitHub, Ko-fi, Last.fm) or our own page, never the full
// address, which can hold a username or an artist name.

const SITES = {
    "reddit.com": ["reddit", "Reddit"],
    "github.com": ["github", "GitHub"],
    "ko-fi.com": ["kofi", "Ko-fi"],
    "last.fm": ["lastfm", "Last.fm"],
    "goatcounter.com": ["goatcounter", "GoatCounter"]
};

const PAGES = {
    "/guide/": ["guide", "the guide"],
    "/faq/": ["faq", "the FAQ"]
};

// [path, title] for GoatCounter, or null for links that aren't worth a count
// (anchors on the same page, the app itself).
export function linkEvent(anchor) {
    let url;
    try {
        url = new URL(anchor.getAttribute("href") || "", location.href);
    } catch (e) {
        return null;
    }
    if (url.origin === location.origin) {
        const page = PAGES[url.pathname];
        if (!page || url.pathname === location.pathname) return null;
        return [`link/${page[0]}`, `Link to ${page[1]}`];
    }
    const host = url.hostname.replace(/^www\./, "");
    const [name, label] = SITES[host] || ["other", "another site"];
    return [`link/${name}`, `Link to ${label}`];
}
