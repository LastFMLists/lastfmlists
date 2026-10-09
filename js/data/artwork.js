// Album artwork for list rows and entity pages. Last.fm sends a cover with
// every scrobble in the history download, so most covers are known without
// extra requests. Anything still missing is fetched with album.getInfo, but
// only once its row scrolls into view.

import { fetchAlbumCoverUrl } from '../api/lastfm.js';
import { state } from '../state.js';

// Last.fm's grey star image, returned when it has no real cover.
const PLACEHOLDER_IMAGE_ID = "2a96cbd8b46e442fc41c2b86b821562f";

export function albumArtKey(album, artist) {
    return `${(album || "").trim().toLowerCase()}||${(artist || "").trim().toLowerCase()}`;
}

function isUsableImageUrl(url) {
    return typeof url === "string"
        && /^https?:\/\//.test(url)
        && !url.includes(PLACEHOLDER_IMAGE_ID);
}

// The largest real image in a Last.fm image array, or "".
export function pickImageUrl(images) {
    if (!Array.isArray(images)) return "";
    const usable = images.map(image => image?.["#text"]).filter(isUsableImageUrl);
    return usable.length ? usable[usable.length - 1] : "";
}

function isNamedAlbum(album) {
    return Boolean(album) && album !== "Unknown";
}

export function rememberAlbumArt(album, artist, url) {
    if (!isNamedAlbum(album) || !artist || !isUsableImageUrl(url)) return;
    if (!state.albumArt) state.albumArt = {};
    state.albumArt[albumArtKey(album, artist)] = url;
}

// Undefined when nobody has looked yet, "" when Last.fm has no cover.
function knownArt(album, artist) {
    return state.albumArt ? state.albumArt[albumArtKey(album, artist)] : undefined;
}

// Tracks and artists borrow the cover of the album they were played from
// most. Built once per history and reused until the history changes.
let representativeCache = { source: null, length: 0, trackAlbum: null, artistAlbum: null };

function buildRepresentativeAlbums() {
    const tracks = state.allTracks || [];
    if (representativeCache.source === tracks && representativeCache.length === tracks.length) {
        return representativeCache;
    }
    const trackCounts = new Map();
    const artistCounts = new Map();
    const bump = (outer, key, album) => {
        let inner = outer.get(key);
        if (!inner) { inner = new Map(); outer.set(key, inner); }
        inner.set(album, (inner.get(album) || 0) + 1);
    };
    for (const scrobble of tracks) {
        if (!isNamedAlbum(scrobble.Album) || !scrobble.Artist) continue;
        const artistKey = scrobble.Artist.toLowerCase();
        bump(trackCounts, `${(scrobble.Track || "").toLowerCase()}||${artistKey}`, scrobble.Album);
        bump(artistCounts, artistKey, scrobble.Album);
    }
    const topOf = (outer) => {
        const result = new Map();
        outer.forEach((inner, key) => {
            let best = null, bestCount = 0;
            inner.forEach((count, album) => {
                if (count > bestCount) { best = album; bestCount = count; }
            });
            result.set(key, best);
        });
        return result;
    };
    representativeCache = {
        source: tracks,
        length: tracks.length,
        trackAlbum: topOf(trackCounts),
        artistAlbum: topOf(artistCounts)
    };
    return representativeCache;
}

// Which album cover stands for an entity: { album, artist } or null.
export function artworkSourceFor(type, name, artist, album = null) {
    if (type === "album") return isNamedAlbum(name) ? { album: name, artist } : null;
    const cache = buildRepresentativeAlbums();
    if (type === "artist") {
        const best = cache.artistAlbum.get((name || "").toLowerCase());
        return best ? { album: best, artist: name } : null;
    }
    if (isNamedAlbum(album)) return { album, artist };
    const best = cache.trackAlbum.get(`${(name || "").toLowerCase()}||${(artist || "").toLowerCase()}`);
    return best ? { album: best, artist } : null;
}

const pendingLookups = new Map();

async function loadArt(album, artist) {
    const known = knownArt(album, artist);
    if (known !== undefined) return known;
    const key = albumArtKey(album, artist);
    if (!pendingLookups.has(key)) {
        pendingLookups.set(key, (async () => {
            const url = await fetchAlbumCoverUrl(album, artist).catch(() => null);
            const usable = isUsableImageUrl(url) ? url : "";
            if (!state.albumArt) state.albumArt = {};
            state.albumArt[key] = usable;
            pendingLookups.delete(key);
            return usable;
        })());
    }
    return pendingLookups.get(key);
}

function paintArt(holder, url) {
    if (!url || holder.querySelector("img")) return;
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    // Lets the PNG export draw the cover without tainting its canvas.
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => holder.classList.add("has-image"));
    image.addEventListener("error", () => image.remove());
    image.src = url;
    holder.appendChild(image);
}

let artObserver = null;

function observeArt(holder) {
    if (typeof IntersectionObserver === "undefined") {
        resolveHolder(holder);
        return;
    }
    if (!artObserver) {
        artObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                artObserver.unobserve(entry.target);
                resolveHolder(entry.target);
            });
        }, { rootMargin: "200px 0px" });
    }
    artObserver.observe(holder);
}

async function resolveHolder(holder) {
    const album = holder.dataset.album;
    const artist = holder.dataset.artist;
    if (!album || !artist) return;
    const url = await loadArt(album, artist);
    paintArt(holder, url);
}

// A square cover for an entity. Shows a music-note placeholder until the
// cover arrives, and keeps it when there is no cover.
export function createArtworkElement(type, name, artist, album = null, extraClass = "") {
    const holder = document.createElement("span");
    holder.className = `entity-art${extraClass ? ` ${extraClass}` : ""}`;
    holder.setAttribute("aria-hidden", "true");
    const icon = document.createElement("i");
    icon.className = type === "artist" ? "fas fa-microphone" : (type === "album" ? "fas fa-compact-disc" : "fas fa-music");
    holder.appendChild(icon);

    const source = artworkSourceFor(type, name, artist, album);
    if (!source) return holder;
    holder.dataset.album = source.album;
    holder.dataset.artist = source.artist;
    const known = knownArt(source.album, source.artist);
    if (known) paintArt(holder, known);
    else if (known === undefined) observeArt(holder);
    return holder;
}
