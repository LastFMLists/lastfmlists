// A one-pass index over the whole scrobble history, shared by the games
// that need per-entity counts, first/last dates and play sequences.

import { state } from '../state.js';

export const FTL_MIN_SCROBBLES = 5;   // entries below this are dropped
const FTL_BY_ARTIST_MIN = 10;  // an artist needs this many qualifying entries to be a "by artist" puzzle

// Cached index over the whole scrobble history, shared by Fill the List and Put
// Them In Order. Both rebuild it when a game starts.
let scrobbleIndexCache = null;

export function rebuildScrobbleIndex() {
    scrobbleIndexCache = buildScrobbleIndex();
    return scrobbleIndexCache;
}

export function getScrobbleIndex() {
    return scrobbleIndexCache || rebuildScrobbleIndex();
}

export function toScrobbleTime(v) { return typeof v === "string" ? parseInt(v, 10) : v; }

// One pass over allTracks builds per-entity aggregates (count, first/last date,
// per-artist distinct-track count) plus the "by artist" eligibility lists.
function buildScrobbleIndex() {
    const artist = new Map(), album = new Map(), track = new Map();
    const artistTracks = new Map();
    let minY = Infinity, maxY = -Infinity;

    const upd = (map, key, base, date) => {
        let e = map.get(key);
        if (!e) { e = { ...base, count: 0, first: date, last: date }; map.set(key, e); }
        e.count++;
        if (date < e.first) e.first = date;
        if (date > e.last) e.last = date;
    };

    for (const s of state.allTracks) {
        const d = toScrobbleTime(s.Date);
        if (!d) continue;
        const y = new Date(d).getFullYear();
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const A = s.Artist, Al = s.Album, T = s.Track;
        if (A && A !== "Unknown") upd(artist, A.toLowerCase(), { name: A, artist: null }, d);
        if (A && A !== "Unknown" && Al && Al !== "Unknown") upd(album, `${Al.toLowerCase()}|||${A.toLowerCase()}`, { name: Al, artist: A }, d);
        if (A && A !== "Unknown" && T && T !== "Unknown") {
            upd(track, `${T.toLowerCase()}|||${A.toLowerCase()}`, { name: T, artist: A }, d);
            const ak = A.toLowerCase();
            let set = artistTracks.get(ak);
            if (!set) { set = new Set(); artistTracks.set(ak, set); }
            set.add(T.toLowerCase());
        }
    }
    for (const [k, e] of artist) e.trackCount = artistTracks.get(k)?.size || 0;

    // "By artist" eligibility: artists with at least FTL_BY_ARTIST_MIN entries of
    // the given type that each clear the scrobble floor.
    const eligible = (entityMap) => {
        const perArtist = new Map();
        for (const e of entityMap.values()) {
            if (e.count < FTL_MIN_SCROBBLES || !e.artist) continue;
            const ak = e.artist.toLowerCase();
            let q = perArtist.get(ak);
            if (!q) { q = { name: e.artist, count: 0 }; perArtist.set(ak, q); }
            q.count++;
        }
        return [...perArtist.values()].filter(q => q.count >= FTL_BY_ARTIST_MIN).map(q => ({ name: q.name, key: q.name.toLowerCase() }));
    };

    const years = [];
    if (isFinite(minY)) for (let y = minY; y <= maxY; y++) years.push(y);

    return {
        artist: [...artist.values()],
        album: [...album.values()],
        track: [...track.values()],
        years,
        byArtistEligible: { track: eligible(track), album: eligible(album) },
        seq: {}
    };
}

export function indexEntities(type) { return getScrobbleIndex()[type] || []; }

// Lazily build & cache per-entity sorted scrobble-date lists (for streak/first/
// fastest facets). Only built for the entity type a sorting facet actually needs.
export function indexEntitySequences(type) {
    const index = getScrobbleIndex();
    if (index.seq[type]) return index.seq[type];
    const map = new Map();
    for (const s of state.allTracks) {
        const d = toScrobbleTime(s.Date);
        if (!d) continue;
        let name, artist = null, key;
        if (type === "artist") {
            name = s.Artist;
            if (!name || name === "Unknown") continue;
            key = name.toLowerCase();
        } else if (type === "album") {
            name = s.Album; artist = s.Artist;
            if (!name || name === "Unknown" || !artist || artist === "Unknown") continue;
            key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
        } else {
            name = s.Track; artist = s.Artist;
            if (!name || name === "Unknown" || !artist || artist === "Unknown") continue;
            key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
        }
        let e = map.get(key);
        if (!e) { e = { name, artist, dates: [] }; map.set(key, e); }
        e.dates.push(d);
    }
    for (const e of map.values()) e.dates.sort((a, b) => a - b);
    index.seq[type] = map;
    return map;
}
