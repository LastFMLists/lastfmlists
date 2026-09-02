// Stands in for the Last.fm API so the app can run where outbound requests are
// blocked. Generates one deterministic listening history and answers every
// endpoint the app calls from it. Nothing here touches the app's own code.
(function () {
    "use strict";

    // ---- deterministic randomness, so the library is the same on every load ----
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    const rnd = mulberry32(20260902);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    // Heavy-tailed index: low indices come up far more often, like a real library.
    const zipf = (n, skew) => Math.min(n - 1, Math.floor(n * Math.pow(rnd(), skew)));

    // ---- an invented catalogue that reads like a real one ----
    const ADJ = ["Paper", "Neon", "Harbour", "Slow", "Velvet", "Northern", "Glass", "Quiet", "Amber",
        "Hollow", "Midnight", "Copper", "Salt", "Wild", "Pale", "Electric", "Winter", "Little", "Iron", "Golden"];
    const NOUN = ["Lantern", "Orchard", "Signal", "Tigers", "Cartographer", "Static", "Ravine", "Almanac",
        "Coast", "Machine", "Sparrow", "Foundry", "Tideline", "Chorus", "Meridian", "Wireless", "Kestrel",
        "Provincial", "Lighthouse", "Anthem"];
    const ALBUM_WORDS = ["Weather Fronts", "Low Country", "Everything Louder", "Small Hours", "The Long Way Round",
        "Cold Open", "Signal Fires", "Hinterland", "Nightswimming Hours", "Paper Radio", "Second Language",
        "The Quiet Part", "Blue Hour", "Fieldwork", "Common Ground", "Tessellate", "After the Fact", "Slow Exposure"];
    const TRACK_WORDS = ["Anywhere But Here", "Cartography", "Static Bloom", "Half Light", "Ferry Building",
        "Dial Tone", "Winter Count", "Hold Steady", "Marginalia", "Sleeper Train", "Understudy", "Salt Flats",
        "Long Division", "Vanishing Point", "Reservoir", "Telegram", "Nightshift", "Blueprint", "Hairline",
        "Weathervane", "Overture", "Low Tide", "Afterimage", "Continental", "Rooftops", "Bright Field"];

    // Draw a name that isn't taken yet. Falls back through fixed suffixes and
    // finally a counter, so it always terminates.
    function unique(taken, draw, suffixes) {
        for (let i = 0; i < 12; i++) {
            const base = draw();
            if (!taken.has(base)) { taken.add(base); return base; }
            for (const suffix of suffixes) {
                if (!taken.has(base + suffix)) { taken.add(base + suffix); return base + suffix; }
            }
        }
        let n = 2, base = draw();
        while (taken.has(base + " " + n)) n++;
        taken.add(base + " " + n);
        return base + " " + n;
    }

    const usedNames = new Set();
    function artistName() {
        return unique(usedNames, () => rnd() < 0.25 ? pick(NOUN) : pick(ADJ) + " " + pick(NOUN), [" Club", " Society"]);
    }

    const ARTIST_COUNT = 48;
    const artists = [];
    for (let a = 0; a < ARTIST_COUNT; a++) {
        const name = artistName();
        const albumCount = 1 + Math.floor(rnd() * 3);
        const albums = [];
        const usedAlbums = new Set();
        for (let b = 0; b < albumCount; b++) {
            const title = unique(usedAlbums, () => pick(ALBUM_WORDS), [" II", " III"]);
            const tracks = [];
            const usedTracks = new Set();
            for (let t = 0; t < 5 + Math.floor(rnd() * 5); t++) {
                tracks.push({
                    name: unique(usedTracks, () => pick(TRACK_WORDS), [" (Reprise)", " (Live)", " (Coda)"]),
                    duration: 120 + Math.floor(rnd() * 260)
                });
            }
            albums.push({ name: title, tracks });
        }
        artists.push({ name, albums, listeners: 900000 - a * 17000 + Math.floor(rnd() * 40000) });
    }

    // ---- the listening history: sessions on real days, so streaks mean something ----
    const DAY = 86400000;
    const DAYS = 1580;
    const endDay = Date.now() - Math.floor(rnd() * 2) * DAY;
    const scrobbles = [];
    let favourite = 0;

    for (let d = DAYS; d >= 0; d--) {
        // Taste drifts: the favourite artist shifts every few months.
        if (d % 120 === 0) favourite = zipf(ARTIST_COUNT, 1.6);
        // Not every day has listening, and some days have a lot.
        if (rnd() > 0.62) continue;
        const dayStart = endDay - d * DAY;
        const sessions = rnd() > 0.75 ? 2 : 1;
        for (let s = 0; s < sessions; s++) {
            const hour = 7 + Math.floor(rnd() * 15);
            let at = dayStart - (dayStart % DAY) + hour * 3600000 + Math.floor(rnd() * 3600000);
            const runLength = 3 + Math.floor(rnd() * 16);
            // A session usually sticks with one artist, often one album.
            const ai = rnd() < 0.12 ? favourite : zipf(ARTIST_COUNT, 1.45);
            const artist = artists[ai];
            const album = artist.albums[zipf(artist.albums.length, 1.2)];
            for (let i = 0; i < runLength; i++) {
                const track = rnd() < 0.6
                    ? album.tracks[zipf(album.tracks.length, 1.15)]
                    : album.tracks[Math.floor(rnd() * album.tracks.length)];
                scrobbles.push({ artist: artist.name, album: album.name, track: track.name, uts: Math.floor(at / 1000) });
                at += (track.duration + 5 + Math.floor(rnd() * 40)) * 1000;
            }
        }
    }
    scrobbles.sort((a, b) => b.uts - a.uts);   // newest first, as Last.fm returns them

    // ---- aggregates for the top-list endpoints ----
    const SEP = "\u0000";
    function tally(keyFn) {
        const m = new Map();
        for (const s of scrobbles) {
            const k = keyFn(s);
            m.set(k, (m.get(k) || 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }
    const topArtists = tally(s => s.artist);
    const topAlbums = tally(s => s.album + SEP + s.artist);
    const topTracks = tally(s => s.track + SEP + s.artist);

    const TAGS = ["indie", "alternative", "dream pop", "post-rock", "folk", "shoegaze", "electronic",
        "ambient", "singer-songwriter", "britpop", "seen live", "2010s"];
    function tagsFor(seedText) {
        let h = 0;
        for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) >>> 0;
        const r = mulberry32(h);
        const out = [];
        while (out.length < 4) {
            const t = TAGS[Math.floor(r() * TAGS.length)];
            if (!out.includes(t)) out.push(t);
        }
        return { tag: out.map(name => ({ name })) };
    }
    function statsFor(seedText, base) {
        let h = 0;
        for (let i = 0; i < seedText.length; i++) h = (h * 33 + seedText.charCodeAt(i)) >>> 0;
        const r = mulberry32(h);
        const listeners = Math.floor(base * (0.4 + r()));
        return { listeners: String(listeners), playcount: String(Math.floor(listeners * (6 + r() * 20))) };
    }
    const findTrack = (artistName2, trackName) => {
        const a = artists.find(x => x.name === artistName2);
        if (!a) return null;
        for (const al of a.albums) {
            const t = al.tracks.find(x => x.name === trackName);
            if (t) return { track: t, album: al };
        }
        return null;
    };

    // ---- the endpoints ----
    function respond(params) {
        const method = (params.get("method") || "").toLowerCase();
        const user = params.get("user") || "";
        const page = parseInt(params.get("page") || "1", 10);
        const limit = Math.min(1000, parseInt(params.get("limit") || "50", 10));

        // Any name works except this one, which exercises the "user not found" path.
        if (user.toLowerCase() === "nosuchuser") return { error: 6, message: "User not found" };

        if (method === "user.getinfo") {
            return { user: { name: user, playcount: String(scrobbles.length), image: [{ "#text": "" }] } };
        }

        if (method === "user.getrecenttracks") {
            const totalPages = Math.max(1, Math.ceil(scrobbles.length / limit));
            const slice = scrobbles.slice((page - 1) * limit, page * limit);
            return {
                recenttracks: {
                    "@attr": { user, total: String(scrobbles.length), page: String(page), perPage: String(limit), totalPages: String(totalPages) },
                    track: slice.map(s => ({
                        artist: { name: s.artist }, album: { "#text": s.album },
                        name: s.track, date: { uts: String(s.uts) }
                    }))
                }
            };
        }

        if (method === "user.gettopartists") {
            const slice = topArtists.slice((page - 1) * limit, page * limit);
            return {
                topartists: {
                    "@attr": { totalPages: String(Math.ceil(topArtists.length / limit)), page: String(page) },
                    artist: slice.map(([name, count], i) => ({
                        name, playcount: String(count), "@attr": { rank: String((page - 1) * limit + i + 1) }
                    }))
                }
            };
        }

        if (method === "user.gettopalbums") {
            const slice = topAlbums.slice((page - 1) * limit, page * limit);
            return {
                topalbums: {
                    "@attr": { totalPages: String(Math.ceil(topAlbums.length / limit)), page: String(page) },
                    album: slice.map(([key, count]) => {
                        const [name, artist] = key.split(SEP);
                        return { name, artist: { name: artist }, playcount: String(count) };
                    })
                }
            };
        }

        if (method === "user.gettoptracks") {
            const slice = topTracks.slice((page - 1) * limit, page * limit);
            return {
                toptracks: {
                    "@attr": { totalPages: String(Math.ceil(topTracks.length / limit)), page: String(page) },
                    track: slice.map(([key, count]) => {
                        const [name, artist] = key.split(SEP);
                        return { name, artist: { name: artist }, playcount: String(count) };
                    })
                }
            };
        }

        if (method === "artist.getinfo") {
            const name = params.get("artist") || "";
            const found = artists.find(a => a.name === name);
            return {
                artist: {
                    name, stats: statsFor(name, found ? found.listeners : 200000),
                    tags: tagsFor(name)
                }
            };
        }

        if (method === "album.getinfo") {
            const name = params.get("album") || "";
            const artist = params.get("artist") || "";
            return {
                album: Object.assign({ name, artist, tags: tagsFor(name + artist), image: [{ "#text": "" }] },
                    statsFor(name + artist, 90000))
            };
        }

        if (method === "track.getinfo") {
            const name = params.get("track") || "";
            const artist = params.get("artist") || "";
            const hit = findTrack(artist, name);
            return {
                track: Object.assign({
                    name, artist: { name: artist },
                    album: hit ? { title: hit.album.name } : undefined,
                    duration: String((hit ? hit.track.duration : 210) * 1000),
                    toptags: tagsFor(name + artist)
                }, statsFor(name + artist, 60000))
            };
        }

        return {};
    }

    const realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf("ws.audioscrobbler.com") === -1) return realFetch(input, init);
        let params;
        try { params = new URL(url).searchParams; } catch (e) { params = new URLSearchParams(); }
        const body = JSON.stringify(respond(params));
        return Promise.resolve(new Response(body, {
            status: 200, headers: { "content-type": "application/json" }
        }));
    };

    window.__demoLibrary = {
        scrobbles: scrobbles.length,
        artists: topArtists.length,
        albums: topAlbums.length,
        tracks: topTracks.length,
        from: new Date(scrobbles[scrobbles.length - 1].uts * 1000),
        to: new Date(scrobbles[0].uts * 1000)
    };
})();
