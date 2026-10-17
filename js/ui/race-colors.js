// Artist colors people pick for the bar chart race. They are kept in this
// browser for every profile, since Radiohead being blue has nothing to do
// with whose library is loaded. Changing one sends "race-colors:changed" so
// the race on screen repaints.

const STORAGE_KEY = "lastfmlists-race-colors";

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        return {
            colors: saved && typeof saved.colors === "object" && saved.colors ? saved.colors : {},
            auto: saved?.auto !== false
        };
    } catch (e) {
        return { colors: {}, auto: true };
    }
}

const store = load();

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
        // Private windows can refuse storage; the colors still last the visit.
    }
    document.dispatchEvent(new CustomEvent("race-colors:changed"));
}

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value || "");

// The picked color for an artist (any capitalisation), or null.
export function customColor(artist) {
    const entry = store.colors[(artist || "").toLowerCase()];
    return entry && isHex(entry.color) ? entry.color : null;
}

export function setCustomColor(artist, color) {
    const name = (artist || "").trim();
    if (!name || !isHex(color)) return;
    store.colors[name.toLowerCase()] = { name, color: color.toLowerCase() };
    save();
}

export function clearCustomColor(artist) {
    delete store.colors[(artist || "").toLowerCase()];
    save();
}

// Whether the most-shown artists without a picked color get one of the
// starting colors.
export function autoColorsOn() {
    return store.auto;
}

export function setAutoColors(on) {
    store.auto = Boolean(on);
    save();
}
