// Global variables
let allTracks = [];
let filteredData = [];
let lastfmData = [];
let artistsData = []; // [{ name, listeners, playcount, debutYear }]
let albumsData = [];  // [{ title, artist, releaseDate, playcount }]
let tracksData = [];  // [{ title, album, listeners, playcount }]
let artistDataMap = {};
let albumDataMap = {};
let trackDataMap = {};
let topArtists = [];
let topAlbums = [];
let topTracks = [];
let activeFilters = [];
let comparisonFilterStates = { left: {}, right: {} };
let comparisonStateInitialized = false;
let lastEquationInsertTargetId = "equations";
let lastRenderedListState = {
    isComparison: false,
    current: { entities: [], entityType: "track" },
    left: { entities: [], entityType: "track" },
    right: { entities: [], entityType: "track" }
};
const unfilteredStatsCache = {
    track: { source: null, length: 0, mapping: null },
    album: { source: null, length: 0, mapping: null },
    artist: { source: null, length: 0, mapping: null }
};
const trackAverageListeningCache = {
    source: null,
    length: 0,
    minScrobbles: null,
    mapping: null
};
let previousScrobbleTimestampByOrder = {};
let isFirstScrobbleOfDayByOrder = {};
const SCROBBLE_SORT_ASC = "earliest-to-latest";
const SCROBBLE_SORT_DESC = "latest-to-earliest";
const DB_NAME = 'lastfmDataDB';
const DB_VERSION = 1;
const STORE_NAME = 'userData';
const API_KEY = "edbd779d54b373b8710af5c346148ae3";
const resultsDiv = document.getElementById("results");
const loadingDiv = document.getElementById("loading-stats");
const albumCoverCache = new Map();
let artistLimit = 250;
let albumLimit = 500;
let trackLimit = 1000;
let chartInstances = [];
let activeRaceState = null;
let racePlaybackTimerId = null;
let gifWorkerBlobUrl = null;
let raceRenderArmed = false;
let racePlaybackSpeedMs = 260;
let raceSpeedReadoutElement = null;

const DISPLAY_MODE_LIST = "list";
const DISPLAY_MODE_BAR_CHART = "bar-chart";
const DISPLAY_MODE_BAR_RACE = "bar-race";
const GLOBAL_BASE_SETTING_IDS = new Set([
    "display-mode",
    "list-length",
    "unfiltered-stats",
    "chart-axis",
    "chart-scale",
    "race-start-date",
    "race-end-date",
    "race-frequency",
    "race-speed-ms"
]);

function setAppLoadedState(username) {
    document.body.classList.add('app-loaded');
    const sessionUsername = document.getElementById('session-username');
    const avatarFallback = document.getElementById('session-avatar-fallback');
    if (sessionUsername && username) {
        sessionUsername.textContent = `Lists for ${username}`;
    }
    if (avatarFallback) {
        avatarFallback.textContent = (username || '?').trim().charAt(0).toUpperCase() || '?';
    }
    if (username) {
        updateSessionAvatar(username);
    }
}

async function updateSessionAvatar(username) {
    const avatar = document.getElementById('session-avatar');
    const avatarFallback = document.getElementById('session-avatar-fallback');
    if (!avatar || !avatarFallback || !username) {
        return;
    }

    avatar.style.display = 'none';
    avatar.removeAttribute('src');
    avatarFallback.style.display = 'inline';

    try {
        const response = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json&autocorrect=0`);
        const data = await response.json();
        const images = Array.isArray(data?.user?.image) ? data.user.image : [];
        const preferred = images.find(img => img.size === 'extralarge' || img.size === 'large') || images[images.length - 1];
        const imageUrl = preferred?.['#text'];

        if (imageUrl) {
            avatar.src = imageUrl;
            avatar.style.display = 'block';
            avatarFallback.style.display = 'none';
        }
    } catch (error) {
        console.warn('Could not load profile image:', error);
    }
}

const EXPORT_MAX_ROWS_PER_COLUMN = 100;

function trimExportRows(resultClone) {
    const comparisonColumns = resultClone.querySelectorAll('.comparison-column');

    if (comparisonColumns.length > 0) {
        comparisonColumns.forEach(column => {
            const rows = Array.from(column.querySelectorAll('.track, .album, .artist'));
            rows.slice(EXPORT_MAX_ROWS_PER_COLUMN).forEach(row => row.remove());
        });
        return;
    }

    const rows = Array.from(resultClone.querySelectorAll('.track, .album, .artist'));
    rows.slice(EXPORT_MAX_ROWS_PER_COLUMN).forEach(row => row.remove());
}

function copyCanvasBitmaps(sourceRoot, clonedRoot) {
    if (!sourceRoot || !clonedRoot) return;
    const sourceCanvases = Array.from(sourceRoot.querySelectorAll("canvas"));
    const clonedCanvases = Array.from(clonedRoot.querySelectorAll("canvas"));
    const count = Math.min(sourceCanvases.length, clonedCanvases.length);

    for (let index = 0; index < count; index++) {
        const sourceCanvas = sourceCanvases[index];
        const targetCanvas = clonedCanvases[index];
        if (!sourceCanvas || !targetCanvas) continue;

        targetCanvas.width = sourceCanvas.width;
        targetCanvas.height = sourceCanvas.height;
        targetCanvas.style.width = `${sourceCanvas.clientWidth}px`;
        targetCanvas.style.height = `${sourceCanvas.clientHeight}px`;

        const targetContext = targetCanvas.getContext("2d");
        if (!targetContext) continue;
        targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        targetContext.drawImage(sourceCanvas, 0, 0);
    }
}

async function exportCurrentListAsImage() {
    if (typeof html2canvas === 'undefined') {
        alert('Export library is not loaded. Please refresh and try again.');
        return;
    }

    if (getSelectedDisplayMode() === DISPLAY_MODE_BAR_RACE && hasRaceSettingsReady()) {
        await exportCurrentRaceAsGif();
        return;
    }

    const resultsHeader = document.querySelector('#results-section h2');
    const resultsRoot = document.getElementById('results');
    if (!resultsRoot || !resultsRoot.children.length) {
        alert('There are no results to export yet.');
        return;
    }

    const exportTheme = document.getElementById('export-theme')?.value || 'current';
    const includeFilters = document.getElementById('export-include-filters')?.checked === true;

    const captureRoot = document.createElement('div');
    const resultsBounds = resultsRoot.getBoundingClientRect();
    captureRoot.style.position = 'fixed';
    captureRoot.style.left = '-100000px';
    captureRoot.style.top = '0';
    captureRoot.style.zIndex = '-1';
    captureRoot.style.width = `${Math.max(320, Math.ceil(resultsBounds.width || 1000))}px`;
    captureRoot.style.padding = '16px';
    captureRoot.style.backgroundColor = 'var(--background-color)';
    captureRoot.style.color = 'var(--primary-text-color)';
    captureRoot.style.fontFamily = 'Roboto Flex, sans-serif';

    const pageTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const captureTheme = exportTheme === 'current' ? pageTheme : exportTheme;
    
    // 1. Temporarily force the entire document to the export theme
    let themeWasSwapped = false;
    if (captureTheme !== pageTheme) {
        themeWasSwapped = true;
        document.documentElement.setAttribute('data-theme', captureTheme);
        document.body.setAttribute('data-theme', captureTheme); // Add this line
        
        // FORCE REFLOW
        void document.body.offsetHeight; 
        
        const targetColors = getChartThemeColors();
        applyColorsToChartInstances(targetColors);
    }

    if (captureTheme === 'dark') {
        captureRoot.setAttribute('data-theme', 'dark');
    } else {
        captureRoot.setAttribute('data-theme', 'light');
    }

    const headingRow = document.createElement('div');
    headingRow.style.display = 'flex';
    headingRow.style.justifyContent = 'space-between';
    headingRow.style.alignItems = 'baseline';
    headingRow.style.gap = '12px';
    headingRow.style.marginBottom = '8px';

    const heading = document.createElement('h2');
    heading.textContent = resultsHeader?.textContent || 'Results';
    heading.style.margin = '0';
    headingRow.appendChild(heading);

    const watermark = document.createElement('div');
    watermark.textContent = 'created with lastfmlists.com';
    watermark.style.fontSize = '0.9rem';
    watermark.style.color = 'var(--secondary-text-color)';
    watermark.style.whiteSpace = 'nowrap';
    headingRow.appendChild(watermark);

    captureRoot.appendChild(headingRow);

    if (includeFilters) {
        const activeFilters = document.getElementById('active-filters');
        if (activeFilters && activeFilters.children.length > 0) {
            const filtersClone = activeFilters.cloneNode(true);
            filtersClone.style.margin = '0 0 10px 0';
            captureRoot.appendChild(filtersClone);
        }
    }

    const resultsClone = resultsRoot.cloneNode(true);
    
    // 2. The live canvases currently hold the correct export theme pixels, so we copy them now
    copyCanvasBitmaps(resultsRoot, resultsClone);
    
    // 3. Immediately revert the live DOM and charts to the user's actual theme
    if (themeWasSwapped) {
        document.documentElement.setAttribute('data-theme', pageTheme);
        document.body.setAttribute('data-theme', pageTheme); // Add this line
        
        // FORCE REFLOW again
        void document.body.offsetHeight;
        
        const originalColors = getChartThemeColors();
        applyColorsToChartInstances(originalColors);
    }

    trimExportRows(resultsClone);
    captureRoot.appendChild(resultsClone);

    document.body.appendChild(captureRoot);

    try {
        const canvas = await html2canvas(captureRoot, {
            scale: 2,
            useCORS: true,
            backgroundColor: null
        });

        const downloadLink = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        downloadLink.href = canvas.toDataURL('image/png');
        downloadLink.download = `lastfmlists-${stamp}.png`;
        downloadLink.click();
    } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed. Please try again.');
    } finally {
        captureRoot.remove();
    }
}

function applyColorsToChartInstances(colors) {
    chartInstances.forEach(chart => {
        if (chart.data.datasets && chart.data.datasets[0]) {
            chart.data.datasets[0].backgroundColor = colors.accentFill;
            chart.data.datasets[0].borderColor = colors.accent;
        }
        
        if (chart.options.plugins && chart.options.plugins.title) {
            chart.options.plugins.title.color = colors.text;
        }
        
        if (chart.options.scales) {
            Object.keys(chart.options.scales).forEach(axisKey => {
                if (chart.options.scales[axisKey].ticks) {
                    chart.options.scales[axisKey].ticks.color = colors.text;
                }
            });
        }
        
        chart.update("none");
    });
}

function waitForNextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function getGifWorkerScriptUrl() {
    if (gifWorkerBlobUrl) {
        return gifWorkerBlobUrl;
    }

    const workerCdnUrl = 'https://cdn.jsdelivr.net/npm/gif.js.optimized/dist/gif.worker.js';
    const response = await fetch(workerCdnUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch GIF worker script (HTTP ${response.status})`);
    }

    const workerSource = await response.text();
    const workerBlob = new Blob([workerSource], { type: 'application/javascript' });
    gifWorkerBlobUrl = URL.createObjectURL(workerBlob);
    return gifWorkerBlobUrl;
}

async function exportCurrentRaceAsGif() {
    if (typeof html2canvas === 'undefined') {
        alert('Export library is not loaded. Please refresh and try again.');
        return;
    }

    if (typeof GIF === 'undefined') {
        alert('GIF export library is not loaded. Please refresh and try again.');
        return;
    }

    if (!activeRaceState || activeRaceState.totalFrames <= 0 || typeof activeRaceState.updateFrame !== 'function') {
        alert('Race frames are not ready yet. Apply filters in Bar Chart Race mode first.');
        return;
    }

    const captureTarget = document.getElementById('results-section');
    if (!captureTarget) {
        alert('Could not find chart section to export.');
        return;
    }

    const frameDelayMs = 260;
    const originalFrameIndex = activeRaceState.frameIndex || 0;

    if (racePlaybackTimerId !== null) {
        clearInterval(racePlaybackTimerId);
        racePlaybackTimerId = null;
    }

    const bounds = captureTarget.getBoundingClientRect();
    const workerScriptUrl = await getGifWorkerScriptUrl();

    const gif = new GIF({
        workers: 2,
        quality: 10,
        width: Math.max(320, Math.ceil(bounds.width)),
        height: Math.max(240, Math.ceil(bounds.height)),
        workerScript: workerScriptUrl
    });

    try {
        for (let frameIndex = 0; frameIndex < activeRaceState.totalFrames; frameIndex++) {
            activeRaceState.updateFrame(frameIndex);
            await waitForNextPaint();

            const frameCanvas = await html2canvas(captureTarget, {
                scale: 1,
                useCORS: true,
                backgroundColor: null
            });

            gif.addFrame(frameCanvas, { copy: true, delay: frameDelayMs });
        }

        const gifBlob = await new Promise((resolve, reject) => {
            gif.on('finished', resolve);
            gif.on('abort', () => reject(new Error('GIF render aborted')));
            gif.render();
        });

        const downloadLink = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        downloadLink.href = URL.createObjectURL(gifBlob);
        downloadLink.download = `lastfmlists-race-${stamp}.gif`;
        downloadLink.click();
        setTimeout(() => URL.revokeObjectURL(downloadLink.href), 30000);
    } catch (error) {
        console.error('GIF export failed:', error);
        alert('GIF export failed. Please try again.');
    } finally {
        if (activeRaceState && typeof activeRaceState.updateFrame === 'function') {
            activeRaceState.updateFrame(originalFrameIndex);
        }
    }
}

function getMostCommonAlbumName(entity) {
    if (!entity || !entity.albumCounts) return "";
    let albumName = "";
    let maxCount = -1;
    Object.entries(entity.albumCounts).forEach(([name, count]) => {
        if (count > maxCount) {
            maxCount = count;
            albumName = name;
        }
    });
    return albumName;
}

function getTopAlbumForArtist(artistName) {
    if (!artistName) return "";
    const counts = {};
    allTracks.forEach(track => {
        if ((track.Artist || "").toLowerCase() !== artistName.toLowerCase()) return;
        const albumName = (track.Album || "").trim();
        if (!albumName) return;
        counts[albumName] = (counts[albumName] || 0) + 1;
    });

    let topAlbum = "";
    let topCount = -1;
    Object.entries(counts).forEach(([albumName, count]) => {
        if (count > topCount) {
            topCount = count;
            topAlbum = albumName;
        }
    });

    return topAlbum;
}

function getGridBaseListState() {
    if (!lastRenderedListState.isComparison) {
        return lastRenderedListState.current;
    }

    const target = getComparisonEditTarget();
    return target === "right" ? lastRenderedListState.right : lastRenderedListState.left;
}

function getAlbumSeedsFromCurrentList() {
    const state = getGridBaseListState();
    const entities = Array.isArray(state?.entities) ? state.entities : [];
    const entityType = state?.entityType || "track";

    return entities.map(entity => {
        if (!entity) return null;

        if (entityType === "album") {
            return {
                album: (entity.name || entity.Album || "").trim(),
                artist: (entity.artist || entity.Artist || "").trim()
            };
        }

        if (entityType === "track" || entityType === "scrobble") {
            return {
                album: (entity.Album || entity.album || getMostCommonAlbumName(entity) || "").trim(),
                artist: (entity.Artist || entity.artist || "").trim()
            };
        }

        if (entityType === "artist") {
            const artistName = (entity.name || entity.Artist || "").trim();
            return {
                album: getTopAlbumForArtist(artistName),
                artist: artistName
            };
        }

        return null;
    }).filter(seed => seed && seed.album && seed.artist);
}

function buildGridAlbumSelection(totalSlots, allowDuplicates) {
    const seeds = getAlbumSeedsFromCurrentList();
    if (!seeds.length) return [];

    if (allowDuplicates) {
        return seeds.slice(0, totalSlots);
    }

    const seen = new Set();
    const uniqueSeeds = [];
    seeds.forEach(seed => {
        const key = `${seed.album.toLowerCase()}||${seed.artist.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        uniqueSeeds.push(seed);
    });

    return uniqueSeeds.slice(0, totalSlots);
}

async function fetchAlbumCoverUrl(albumName, artistName) {
    const cacheKey = `${albumName.toLowerCase()}||${artistName.toLowerCase()}`;
    if (albumCoverCache.has(cacheKey)) {
        return albumCoverCache.get(cacheKey);
    }

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&album=${encodeURIComponent(albumName)}&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&autocorrect=0`;
        const response = await fetch(url);
        const data = await response.json();
        const images = Array.isArray(data?.album?.image) ? data.album.image : [];
        const preferred =
            images.find(img => img.size === 'mega' && img['#text']) ||
            images.find(img => img.size === 'extralarge' && img['#text']) ||
            images.find(img => img.size === 'large' && img['#text']) ||
            images.find(img => img.size === 'medium' && img['#text']) ||
            images.find(img => img.size === 'small' && img['#text']) ||
            images[images.length - 1];
        const imageUrl = preferred?.['#text'] || null;

        albumCoverCache.set(cacheKey, imageUrl);
        return imageUrl;
    } catch {
        albumCoverCache.set(cacheKey, null);
        return null;
    }
}

async function exportCurrentListAsGrid() {
    if (typeof html2canvas === 'undefined') {
        alert('Export library is not loaded. Please refresh and try again.');
        return;
    }

    const gridX = Math.max(1, parseInt(document.getElementById('grid-size-x')?.value, 10) || 1);
    const gridY = Math.max(1, parseInt(document.getElementById('grid-size-y')?.value, 10) || 1);
    const allowDuplicates = document.getElementById('grid-allow-duplicates')?.checked === true;
    const skipMissingArtwork = document.getElementById('grid-skip-missing-artwork')?.checked === true;
    const showText = document.getElementById('grid-show-text')?.checked === true;
    const totalSlots = gridX * gridY;
    const overlayElementsToFit = [];

    // Scaled up font limits for the new 300px base container
    const fitOverlayText = (textElement, minFontPx = 9, maxFontPx = 16) => {
        if (!textElement) return;
        const container = textElement.parentElement;
        if (!container) return;

        let fontSize = maxFontPx;
        textElement.style.fontSize = `${fontSize}px`;

        // Scaled up horizontal padding
        const horizontalPadding = 24;
        const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);
        if (availableWidth <= 0) return;

        while (fontSize > minFontPx && textElement.scrollWidth > availableWidth) {
            fontSize -= 0.5;
            textElement.style.fontSize = `${fontSize}px`;
        }
    };

    const candidateAlbums = skipMissingArtwork
        ? buildGridAlbumSelection(Number.MAX_SAFE_INTEGER, allowDuplicates)
        : buildGridAlbumSelection(totalSlots, allowDuplicates);

    if (!candidateAlbums.length) {
        alert('No album entries are available in the current list for grid export.');
        return;
    }

    let processed = 0;
    loadingDiv.textContent = skipMissingArtwork
        ? `Loading album covers ${processed} (need ${totalSlots})...`
        : `Loading album covers ${processed}/${candidateAlbums.length}...`;

    const covers = [];
    try {
        for (const seed of candidateAlbums) {
            const coverUrl = await fetchAlbumCoverUrl(seed.album, seed.artist);
            processed += 1;
            loadingDiv.textContent = skipMissingArtwork
                ? `Loading album covers ${processed} (need ${totalSlots})...`
                : `Loading album covers ${processed}/${candidateAlbums.length}...`;

            if (skipMissingArtwork && !coverUrl) {
                continue;
            }

            covers.push({ ...seed, coverUrl });
            if (covers.length >= totalSlots) {
                break;
            }
        }
    } finally {
        loadingDiv.textContent = '';
    }

    if (!covers.length) {
        alert('No artwork could be fetched for the selected list.');
        return;
    }

    const captureRoot = document.createElement('div');
    captureRoot.style.position = 'fixed';
    captureRoot.style.left = '-100000px';
    captureRoot.style.top = '0';
    captureRoot.style.zIndex = '-1';
    captureRoot.style.padding = '0';
    captureRoot.style.backgroundColor = 'var(--background-color)';
    captureRoot.style.color = 'var(--primary-text-color)';
    captureRoot.style.fontFamily = 'Roboto Flex, sans-serif';
    
    // INCREASED: Base width is now 300px per column
    captureRoot.style.width = `${gridX * 300}px`;

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${gridX}, minmax(0, 1fr))`;
    grid.style.gap = '0';

    const renderSlots = skipMissingArtwork ? covers.length : totalSlots;
    for (let index = 0; index < renderSlots; index++) {
        const cell = document.createElement('div');
        cell.style.width = '100%';
        cell.style.aspectRatio = '1 / 1';
        cell.style.backgroundColor = 'var(--sidebar-color)';
        cell.style.overflow = 'hidden';
        cell.style.position = 'relative';

        const entry = covers[index];
        if (entry?.coverUrl) {
            const image = document.createElement('img');
            image.src = entry.coverUrl;
            image.alt = `${entry.album} by ${entry.artist}`;
            image.crossOrigin = 'anonymous';
            image.style.width = '100%';
            image.style.height = '100%';
            image.style.objectFit = 'cover';
            cell.appendChild(image);
        }

        if (showText && entry) {
            const overlayText = `${entry.artist} - ${entry.album}`;
            const textOverlay = document.createElement('div');
            
            // INCREASED: Scaled overlay UI elements
            textOverlay.style.position = 'absolute';
            textOverlay.style.left = '50%';
            textOverlay.style.bottom = '12px';
            textOverlay.style.transform = 'translateX(-50%)';
            textOverlay.style.maxWidth = 'calc(100% - 12px)';
            textOverlay.style.boxSizing = 'border-box';
            textOverlay.style.padding = '8px 12px';
            textOverlay.style.borderRadius = '8px';
            textOverlay.style.fontSize = '16px';
            textOverlay.style.lineHeight = '1.15';
            textOverlay.style.color = '#fff';
            textOverlay.style.whiteSpace = 'nowrap';
            textOverlay.style.overflow = 'hidden';
            textOverlay.style.textOverflow = 'ellipsis';
            textOverlay.style.textAlign = 'center';
            textOverlay.style.background = 'rgba(55, 55, 55, 0.72)';
            
            textOverlay.textContent = overlayText;
            cell.appendChild(textOverlay);
            overlayElementsToFit.push(textOverlay);
        }

        grid.appendChild(cell);
    }

    captureRoot.appendChild(grid);
    document.body.appendChild(captureRoot);

    overlayElementsToFit.forEach(overlay => fitOverlayText(overlay));

    try {
        const canvas = await html2canvas(captureRoot, {
            scale: 2, // Combined with the 300px base, albums now export at 600x600px
            useCORS: true,
            backgroundColor: null
        });

        const downloadLink = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        downloadLink.href = canvas.toDataURL('image/png');
        downloadLink.download = `lastfmlists-grid-${stamp}.png`;
        downloadLink.click();
    } catch (error) {
        console.error('Grid export failed:', error);
        alert('Grid export failed. Please try again.');
    } finally {
        captureRoot.remove();
    }
}

async function mapWithConcurrency(items, mapper, concurrency = 4) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= items.length) break;

            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

function getLocalDayKeyFromTimestamp(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseTimeToMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) return null;
    const [hoursStr, minutesStr] = timeValue.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
}

function isWithinTimeRange(timestamp, startTime, endTime) {
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);
    if (startMinutes === null && endMinutes === null) return true;

    const date = new Date(timestamp);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    if (startMinutes !== null && endMinutes !== null) {
        if (startMinutes <= endMinutes) {
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        }
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    if (startMinutes !== null) {
        return currentMinutes >= startMinutes;
    }

    return currentMinutes <= endMinutes;
}

function buildHistoryContextMaps() {
    previousScrobbleTimestampByOrder = {};
    isFirstScrobbleOfDayByOrder = {};

    let previousTimestamp = null;
    let previousDayKey = null;

    for (let index = 0; index < allTracks.length; index++) {
        const track = allTracks[index];
        const order = track.order ?? index + 1;
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) continue;

        previousScrobbleTimestampByOrder[order] = previousTimestamp;

        const dayKey = getLocalDayKeyFromTimestamp(timestamp);
        isFirstScrobbleOfDayByOrder[order] = dayKey !== previousDayKey;

        previousTimestamp = timestamp;
        previousDayKey = dayKey;
    }
}

// Helper function to merge new data into an existing array by matching a key
function mergeData(existingArray = [], newData, keyFn) {
    if (!Array.isArray(existingArray)) {
        existingArray = [];
    }

    const existingMap = new Map(
        existingArray.map(item => [keyFn(item), item])
    );

    newData.forEach(newItem => {
        const key = keyFn(newItem);
        const existingItem = existingMap.get(key);

        if (existingItem) {
            // Preserve existing properties and add new ones
            Object.entries(newItem).forEach(([prop, value]) => {
                if (value !== undefined && value !== null) {
                    existingItem[prop] = value;
                }
            });
        } else {
            existingArray.push(newItem);
        }
    });

    return existingArray;
}

function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (event) => {
        console.error('IndexedDB open error', event);
        reject(event);
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'username' });
        }
      };
    });
}

function sanitizeForIndexedDb(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
        return value;
    }

    if (valueType === 'function' || valueType === 'symbol') {
        return undefined;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Array.isArray(value)) {
        return value
            .map(item => sanitizeForIndexedDb(item, seen))
            .filter(item => item !== undefined);
    }

    if (value instanceof Set) {
        return Array.from(value)
            .map(item => sanitizeForIndexedDb(item, seen))
            .filter(item => item !== undefined);
    }

    if (value instanceof Map) {
        const mapped = {};
        value.forEach((entryValue, entryKey) => {
            const key = String(entryKey);
            const safeEntryValue = sanitizeForIndexedDb(entryValue, seen);
            if (safeEntryValue !== undefined) {
                mapped[key] = safeEntryValue;
            }
        });
        return mapped;
    }

    if (valueType === 'object') {
        if (seen.has(value)) {
            return undefined;
        }
        seen.add(value);

        const result = {};
        Object.keys(value).forEach(key => {
            const safeValue = sanitizeForIndexedDb(value[key], seen);
            if (safeValue !== undefined) {
                result[key] = safeValue;
            }
        });
        return result;
    }

    return undefined;
}

function normalizeUsernameKey(username) {
    return (username || "").toString().trim().toLowerCase();
}
  
function saveUserData(username, data) {
    if (!data || Object.keys(data).length === 0) {
        return Promise.reject(new Error('Cannot save empty data'));
    }

    const normalizedUsername = normalizeUsernameKey(username);
    if (!normalizedUsername) {
        return Promise.reject(new Error('Cannot save data without a username'));
    }

    const safeData = sanitizeForIndexedDb(data);

    return openDatabase().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ username: normalizedUsername, data: safeData, timestamp: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event);
        });
    });
}
  
function getUserData(username) {
    const normalizedUsername = normalizeUsernameKey(username);
    if (!normalizedUsername) {
        return Promise.resolve(null);
    }

    return openDatabase().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(normalizedUsername);

        request.onsuccess = (event) => {
            const directMatch = event.target.result;
            if (directMatch) {
                resolve(directMatch);
                return;
            }

            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const allEntries = Array.isArray(getAllRequest.result) ? getAllRequest.result : [];
                const legacyMatch = allEntries.find(entry => normalizeUsernameKey(entry?.username) === normalizedUsername) || null;

                if (!legacyMatch) {
                    resolve(null);
                    return;
                }

                const migratedEntry = {
                    ...legacyMatch,
                    username: normalizedUsername,
                    timestamp: legacyMatch.timestamp || Date.now()
                };

                const migrateRequest = store.put(migratedEntry);
                migrateRequest.onsuccess = () => {
                    if (legacyMatch.username !== normalizedUsername) {
                        store.delete(legacyMatch.username);
                    }
                    resolve(migratedEntry);
                };
                migrateRequest.onerror = (migrationError) => reject(migrationError);
            };
            getAllRequest.onerror = (getAllError) => reject(getAllError);
        };

        request.onerror = (event) => reject(event);
      });
    });
}

// Event listener for form submission (data load)
document.getElementById("username-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	const username = document.getElementById("username").value.trim();

    if (username) {
        setAppLoadedState(username);
    }

	// Try to load saved data for the username from IndexedDB
	let savedData = await getUserData(username).catch(err => {
		console.error("Error retrieving saved data", err);
		return null;
	});

    if (savedData) {
        // Saved data exists – retrieve the saved tracks, artists, and albums.
        let { allTracks: savedAllTracks, artistsData: savedArtistsData, albumsData: savedAlbumsData, tracksData: savedTracksData } = savedData.data;
    
        // Assign saved data to global variables
        artistsData = savedArtistsData || [];
        albumsData = savedAlbumsData || [];
        tracksData = savedTracksData || [];
    
        // Find the latest track date in the saved allTracks.
        let latestTimestamp = 0;
        savedAllTracks.forEach(track => {
            const ts = parseInt(track.Date);
            if (ts > latestTimestamp) latestTimestamp = ts;
        });
    
        // Fetch recent tracks from Last.fm that occurred after the latest saved track.
        loadingDiv.innerHTML = "<p>Fetching recent tracks...</p>";
        let newTracks = await fetchRecentTracksSince(username, latestTimestamp);
    
        // Merge new tracks with the saved tracks, keeping chronological order.
        allTracks = newTracks.concat(savedAllTracks);
    } else {
        // No saved data exists, fetch all history.
        allTracks = await fetchListeningHistory(username);
    }
    
    allTracks = allTracks.filter(track => {
        if (!track.Date) {
            console.warn("Skipping track due to missing date:", track);
            return false;
        }
        return true;
    });

    // Sort allTracks by date (assuming track.Date is a timestamp in milliseconds as a string)
    allTracks.sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));

    // Assign an order key (index + 1) to each track
    allTracks = allTracks.map((track, index) => {
        track.order = index + 1;
        return track;
    });

    buildHistoryContextMaps();
    ensureRaceDateDefaults(true);

	// ✅ ALWAYS re-fetch the top stats to update rankings and counts!
	topArtists = await fetchTopArtists(username);
	topAlbums = await fetchTopAlbums(username);
	topTracks = await fetchTopTracks(username);

    // Reset track counts in artistsData and albumsData
    const artistTrackSets = Object.create(null);
    const albumTrackSets = Object.create(null);

    allTracks.forEach(item => {
        const artistKey = item.Artist.trim().toLowerCase();
        const albumKey = `${item.Album.trim().toLowerCase()}||${item.Artist.trim().toLowerCase()}`;
        const trackKey = item.Track.trim().toLowerCase();

        if (!artistTrackSets[artistKey]) artistTrackSets[artistKey] = new Set();
        if (!albumTrackSets[albumKey]) albumTrackSets[albumKey] = new Set();

        artistTrackSets[artistKey].add(trackKey);
        albumTrackSets[albumKey].add(trackKey);
    });

	// Objects to track earliest scrobbles
	const firstScrobbles = { artists: {}, albums: {}, tracks: {} };
    const lastScrobbles = { artists: {}, albums: {}, tracks: {} };
    loadingDiv.innerHTML = "<p>Processing first/last scrobbles...</p>";

	// Iterate over allTracks to determine first scrobbles
	allTracks.forEach(track => {
		if (!track.Artist || !track.Track || !track.Date) {
			console.warn("Skipping track due to missing data:", track);
			return;
		}

		const artistKey = track.Artist.trim().toLowerCase();
		const albumKey = track.Album?.trim() ? `${track.Album.trim().toLowerCase()}||${artistKey}` : null;
		const trackKey = `${track.Track.trim().toLowerCase()}_${artistKey}`;
		const uts = parseInt(track.Date, 10); // Already in milliseconds

		if (!firstScrobbles.artists[artistKey] || uts < firstScrobbles.artists[artistKey]) {
			firstScrobbles.artists[artistKey] = uts;
		}
		if (albumKey && (!firstScrobbles.albums[albumKey] || uts < firstScrobbles.albums[albumKey])) {
			firstScrobbles.albums[albumKey] = uts;
		}
		if (!firstScrobbles.tracks[trackKey] || uts < firstScrobbles.tracks[trackKey]) {
			firstScrobbles.tracks[trackKey] = uts;
		}

        if (!lastScrobbles.artists[artistKey] || uts > lastScrobbles.artists[artistKey]) {
            lastScrobbles.artists[artistKey] = uts;
        }
        
        // For albums: if we haven't stored a value yet, or if this track's uts is later than the stored one, update it.
        if (albumKey && (!lastScrobbles.albums[albumKey] || uts > lastScrobbles.albums[albumKey])) {
            lastScrobbles.albums[albumKey] = uts;
        }
        
        // For tracks: if we haven't stored a value yet, or if this track's uts is later than the stored one, update it.
        if (!lastScrobbles.tracks[trackKey] || uts > lastScrobbles.tracks[trackKey]) {
            lastScrobbles.tracks[trackKey] = uts;
        }
	});

	// ✅ Update data arrays with correct first scrobbles
    const newArtistsData = topArtists.map((artist, index) => {
        const key = artist.name.trim().toLowerCase();
        return {
            name: artist.name,
            rank: index + 1, // Overwrite rank from the new fetch
            firstscrobble: firstScrobbles.artists?.[key] ?? null,
            lastscrobble: lastScrobbles.artists?.[key] ?? null,
            user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0,
            track_count: artistTrackSets[key] ? artistTrackSets[key].size : 0
        };
    });
    
    // Create newAlbumsData with track counts
    const newAlbumsData = topAlbums.map((album, index) => {
        const key = `${album.name.trim().toLowerCase()}||${album.artist.trim().toLowerCase()}`;
        return {
            name: album.name,
            artist: album.artist,
            rank: index + 1,
            firstscrobble: firstScrobbles.albums?.[key] ?? null,
            lastscrobble: lastScrobbles.albums?.[key] ?? null,
            user_scrobbles: parseInt(album.user_scrobbles, 10) || 0,
            track_count: albumTrackSets[key] ? albumTrackSets[key].size : 0
        };
    });
    
    const newTracksData = topTracks.map((track, index) => {
        const key = `${track.name.trim().toLowerCase()}_${track.artist.trim().toLowerCase()}`;
        return {
            name: track.name,
            artist: track.artist,
            rank: index + 1,
            firstscrobble: firstScrobbles.tracks?.[key] ?? null,
            lastscrobble: lastScrobbles.tracks?.[key] ?? null,
            user_scrobbles: parseInt(track.user_scrobbles, 10) || 0
        };
    });
    
    loadingDiv.innerHTML = "<p>Merging data...</p>";

    // Merge new data into the existing arrays (only updating the keys specified)
    artistsData = mergeData(artistsData, newArtistsData, item => item.name.trim().toLowerCase());
    albumsData = mergeData(albumsData, newAlbumsData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    tracksData = mergeData(tracksData, newTracksData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    
    console.log("Merged artistsData:", artistsData);
	console.log("Merged albumsData:", albumsData);
	console.log("Merged tracksData:", tracksData);

    loadingDiv.innerHTML = "<p>Mapping artists...</p>";

    artistDataMap = artistsData.reduce((map, artist) => {
        map[artist.name.toLowerCase()] = artist;
        return map;
    }, {});

    loadingDiv.innerHTML = "<p>Mapping albums...</p>";
    
    albumDataMap = albumsData.reduce((map, album) => {
        map[`${album.name.toLowerCase()}||${album.artist.toLowerCase()}`] = album;
        return map;
    }, {});

    loadingDiv.innerHTML = "<p>Mapping tracks...</p>";
    
    trackDataMap = tracksData.reduce((map, track) => {
        map[`${track.name.toLowerCase()}||${track.artist.toLowerCase()}`] = track;
        return map;
    }, {});

	// ✅ Enable "Load Detailed Data" button
	const loadDetailedBtn = document.getElementById("load-detailed-data");
    const loadAllDetailsBtn = document.getElementById("load-all-details");
    if (loadDetailedBtn) {
        loadDetailedBtn.disabled = false;
        loadDetailedBtn.title = "Click to load detailed data!";
    }
    if (loadAllDetailsBtn) {
        loadAllDetailsBtn.disabled = false;
        loadAllDetailsBtn.title = "Downloads metadata for every single song you've ever listened to. This can take a very long time.";
    }

	console.log("Final allTracks:", allTracks);
	loadingDiv.innerHTML = ""; // Clear loading message

    setAppLoadedState(username);

	// ✅ Update UI
	filterTracks();
    displayEntities();
	updateActiveFilters();

});

async function loadDetailedMetadata(loadAll = false) {
    const selectCandidates = (all) => {
        const selectedArtists = all
            ? topArtists.slice()
            : (() => {
                const preferred = topArtists.filter(artist => artist.playcount > 100);
                return preferred.length < artistLimit ? topArtists.slice(0, artistLimit) : preferred;
            })();

        const selectedAlbums = all
            ? topAlbums.slice()
            : (() => {
                const preferred = topAlbums.filter(album => album.playcount > 10);
                return preferred.length < albumLimit ? topAlbums.slice(0, albumLimit) : preferred;
            })();

        const selectedTracks = all
            ? topTracks.slice()
            : (() => {
                const preferred = topTracks.filter(track => track.playcount > 5);
                return preferred.length < trackLimit ? topTracks.slice(0, trackLimit) : preferred;
            })();

        return { selectedArtists, selectedAlbums, selectedTracks };
    };

    const { selectedArtists, selectedAlbums, selectedTracks } = selectCandidates(loadAll);

    const confirmMsg = loadAll
        ? `Load ALL details downloads metadata for every single song you've ever listened to. This WILL take hours.\n\nThis run will request ${selectedArtists.length} artist metadata entries, ${selectedAlbums.length} album metadata entries, and ${selectedTracks.length} track metadata entries.\n\nDo you want to continue?`
        : `Load Details will download ${selectedArtists.length} artist metadata entries, ${selectedAlbums.length} album metadata entries, and ${selectedTracks.length} track metadata entries.\n\nThis is enough for most stats. Use \"Load ALL Details\" if you want metadata for everything you've ever listened to.\n\nDo you want to continue?`;
    if (!confirm(confirmMsg)) return;

    const username = document.getElementById("username").value.trim();
    if (!username) return;

    const activeArtistLimit = loadAll ? Infinity : artistLimit;
    const activeAlbumLimit = loadAll ? Infinity : albumLimit;
    const activeTrackLimit = loadAll ? Infinity : trackLimit;

    const fetchedArtists = await fetchAllArtistDetails(selectedArtists, activeArtistLimit);
    console.log("Fetched artist details:", fetchedArtists);

    const fetchedAlbums = await fetchAllAlbumDetails(selectedAlbums, activeAlbumLimit);
    console.log("Fetched album details:", fetchedAlbums);

    const fetchedTracks = await fetchAllTrackDetails(selectedTracks, activeTrackLimit);
    console.log("Fetched track details:", fetchedTracks);

	// Process fetched data and format it before merging
	const newArtistsData = fetchedArtists.map(artist => ({
        ...artist,
        name: artist.name,
        listeners: parseInt(artist.listeners, 10) || 0,
        playcount: parseInt(artist.playcount, 10) || 0,
        tags: artist.tags || []
    }));
    
    const newAlbumsData = fetchedAlbums.map(album => ({
        ...album,
        name: album.name,
        artist: album.artist,
        listeners: parseInt(album.listeners, 10) || 0,
        playcount: parseInt(album.playcount, 10) || 0,
    }));
    
    const newTracksData = fetchedTracks.map(track => ({
        ...track,
        name: track.name,
        artist: track.artist?.name || track.artist,
        duration: parseInt(track.duration, 10) || 0,
        listeners: parseInt(track.listeners, 10) || 0,
        playcount: parseInt(track.playcount, 10) || 0
    }));

	// Merge the new data into existing global arrays while keeping firstscrobble, user_scrobbles, and rank
    artistsData = mergeData(artistsData, newArtistsData, item => item.name.trim().toLowerCase());
    albumsData = mergeData(albumsData, newAlbumsData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    tracksData = mergeData(tracksData, newTracksData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);

	console.log("Merged artistsData:", artistsData);
	console.log("Merged albumsData:", albumsData);
	console.log("Merged tracksData:", tracksData);

	// Update display, filters, etc.
	loadingDiv.innerHTML = ""; // Clear loading message
	filterTracks();
    displayEntities();
}

const loadDetailedButton = document.getElementById("load-detailed-data");
if (loadDetailedButton) {
    loadDetailedButton.addEventListener("click", async () => {
        await loadDetailedMetadata(false);
    });
}

const loadAllDetailsButton = document.getElementById("load-all-details");
if (loadAllDetailsButton) {
    loadAllDetailsButton.addEventListener("click", async () => {
        await loadDetailedMetadata(true);
    });
}

document.getElementById("save-data").addEventListener("click", async () => {
    const username = document.getElementById("username").value.trim();
    const dataToSave = {
      allTracks,
      artistsData,
      albumsData,
      tracksData
    };
    try {
      await saveUserData(username, dataToSave);
      alert("Data saved to browser successfully!");
    } catch (err) {
      console.error("Error saving data", err);
      alert("Failed to save data.");
    }
  });

const exportOptionsPanel = document.getElementById("export-options");
const exportOptionsToggle = document.getElementById("open-export-options");
const confirmExportButton = document.getElementById("confirm-export-image");
const exportModal = document.getElementById("export-modal");
const closeExportModalButton = document.getElementById("close-export-modal");
const openGridExportButton = document.getElementById("open-grid-export");
const gridExportModal = document.getElementById("grid-export-modal");
const closeGridExportModalButton = document.getElementById("close-grid-export-modal");
const confirmGridExportButton = document.getElementById("confirm-export-grid");

function openModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.add("is-open");
    modalElement.setAttribute("aria-hidden", "false");
}

function closeModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.remove("is-open");
    modalElement.setAttribute("aria-hidden", "true");
}

if (exportOptionsToggle && exportOptionsPanel) {
    exportOptionsToggle.addEventListener("click", () => {
        openModal(exportModal);
    });
}

if (closeExportModalButton) {
    closeExportModalButton.addEventListener("click", () => closeModal(exportModal));
}

if (exportModal) {
    exportModal.addEventListener("click", (event) => {
        if (event.target === exportModal) {
            closeModal(exportModal);
        }
    });
}

if (confirmExportButton) {
    confirmExportButton.addEventListener("click", async () => {
        await exportCurrentListAsImage();
        closeModal(exportModal);
    });
}

if (openGridExportButton) {
    openGridExportButton.addEventListener("click", () => {
        openModal(gridExportModal);
    });
}

if (closeGridExportModalButton) {
    closeGridExportModalButton.addEventListener("click", () => closeModal(gridExportModal));
}

if (gridExportModal) {
    gridExportModal.addEventListener("click", (event) => {
        if (event.target === gridExportModal) {
            closeModal(gridExportModal);
        }
    });
}

if (confirmGridExportButton) {
    confirmGridExportButton.addEventListener("click", async () => {
        await exportCurrentListAsGrid();
        closeModal(gridExportModal);
    });
}
  
async function fetchListeningHistory(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${API_KEY}&format=json&extended=1&limit=200&autocorrect=0`;

    // 1. Use the retry helper for the INITIAL request too
    const firstData = await fetchJsonWithRetry(baseUrl);

    if (!firstData || !firstData.recenttracks || !Array.isArray(firstData.recenttracks.track)) {
        console.error("Error: Could not connect to Last.fm or user not found.");
        loadingDiv.innerHTML = `<p style="color: #ff6b6b;">Failed to connect to Last.fm. Please try again.</p>`;
        return [];
    }

    const totalPages = parseInt(firstData.recenttracks["@attr"].totalPages, 10) || 1;
    console.log(`Total Pages: ${totalPages}`);

    // 2. Process first page
    let lastfmData = firstData.recenttracks.track.map((track) => {
        const timestamp = track.date?.uts ? parseInt(track.date.uts) * 1000 : null;
        return {
            Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
            Album: track.album?.["#text"] || "Unknown",
            Track: track.name || "Unknown",
            Date: timestamp
        };
    });

    loadingDiv.innerHTML = `<p>Loading data... Page 1 of ${totalPages}</p>`;

    // 3. Process remaining pages
    for (let page = 2; page <= totalPages; page++) {
        const data = await fetchJsonWithRetry(`${baseUrl}&page=${page}`);

        if (data && data.recenttracks && Array.isArray(data.recenttracks.track)) {
            const pageTracks = data.recenttracks.track.map((track) => {
                const timestamp = track.date?.uts ? parseInt(track.date.uts) * 1000 : null;
                return {
                    Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
                    Album: track.album?.["#text"] || "Unknown",
                    Track: track.name || "Unknown",
                    Date: timestamp
                };
            });

            // OPTIMIZATION: Use .push(...array) instead of .concat()
            // .concat() creates a new array in memory every loop. 
            // .push() modifies the existing one, which is much faster for 100k scrobbles.
            lastfmData.push(...pageTracks);
            
            loadingDiv.innerHTML = `<p>Loading data... Page ${page} of ${totalPages}</p>`;

            // 4. Throttling - Give the browser/API a breather every 15 pages
            if (page % 15 === 0) { 
                await new Promise(resolve => setTimeout(resolve, 150)); 
            }

        } else {
            // If it still fails after retries, we warn but don't crash.
            console.warn(`Skipping Page ${page} after multiple failed attempts.`);
        }
    }

    console.log(`Fetched ${lastfmData.length} total tracks.`);
    return lastfmData;
}

async function fetchRecentTracksSince(username, latestTimestamp) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${API_KEY}&format=json&extended=1&limit=200&autocorrect=0`;
    let newTracks = [];
    let page = 1;
    let totalPages = 1;
    let keepFetching = true;
  
    while (keepFetching && page <= totalPages) {
      const response = await fetch(`${baseUrl}&page=${page}`);
      const data = await response.json();
  
      if (!data.recenttracks || !Array.isArray(data.recenttracks.track)) {
        console.error(`No tracks found on page ${page}.`);
        break;
      }
  
      // On the first page, determine the total number of pages.
      if (page === 1 && data.recenttracks['@attr'] && data.recenttracks['@attr'].totalPages) {
        totalPages = parseInt(data.recenttracks['@attr'].totalPages, 10);
      }
  
      // Process each track on this page.
      for (const track of data.recenttracks.track) {
        // Some tracks (e.g., currently playing) might not have a date.
        if (!track.date || !track.date.uts) continue;
  
        // Convert Last.fm's uts (seconds) to a JavaScript timestamp (ms)
        const ts = parseInt(track.date.uts, 10) * 1000;
  
        // If the track is newer than latestTimestamp, include it.
        if (ts > latestTimestamp) {
          newTracks.push({
            Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
            Album: track.album?.["#text"] || "Unknown",
            Track: track.name || "Unknown",
            Date: ts
          });
        } else {
          // We've reached tracks older than our saved latest timestamp; stop processing.
          keepFetching = false;
          break;
        }
      }
      page++;
    }
  
    console.log(`Fetched ${newTracks.length} new tracks since timestamp ${latestTimestamp}`);
    return newTracks;
  }

async function fetchJsonWithRetry(url, maxRetries = 3, delayMs = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            
            // Check for HTTP errors (500, 503, etc.)
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // CHECK CONTENT TYPE: This is the critical fix
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text(); // Read the HTML to clear the buffer
                console.warn(`Attempt ${attempt + 1}: Expected JSON but got HTML/Text. Full response starts with: ${text.substring(0, 50)}`);
                throw new Error("Invalid Content-Type: Received HTML instead of JSON");
            }

            return await response.json();
            
        } catch (error) {
            if (attempt === maxRetries) {
                console.error(`Final failure after ${maxRetries + 1} attempts: ${url}`, error);
                return null;
            }
            
            // Wait longer for each subsequent retry (Exponential Backoff)
            const waitTime = delayMs * Math.pow(2, attempt); 
            console.log(`Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    return null;
}

// Fetch the user's top artists from Last.fm
async function fetchTopArtists(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${username}&api_key=${API_KEY}&format=json&limit=200&autocorrect=0`;
    
    try {
      // Fetch the first page
            const firstData = await fetchJsonWithRetry(baseUrl);
            if (!firstData) {
                return [];
            }
      
      if (!firstData.topartists || !firstData.topartists.artist) {
        console.warn("No top artists found for user:", username);
        return [];
      }
      
      // Determine total pages from the @attr property
      const totalPages = parseInt(firstData.topartists['@attr'].totalPages, 10) || 1;
      
      // Start with the artists from the first page
      let allArtists = firstData.topartists.artist;
      
            // If more than one page, fetch the rest with limited concurrency and retries
      if (totalPages > 1) {
                const pageNumbers = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
                const pagesData = await mapWithConcurrency(
                    pageNumbers,
                    (page) => fetchJsonWithRetry(`${baseUrl}&page=${page}`),
                    3
                );
        pagesData.forEach(pageData => {
          if (pageData.topartists && pageData.topartists.artist) {
            allArtists = allArtists.concat(pageData.topartists.artist);
          }
        });
      }
      
      // Optionally, you can update progress messages here if needed.
      return allArtists.map(artist => ({ 
        name: artist.name,
        user_scrobbles: parseInt(artist.playcount, 10)
       }));
    } catch (error) {
      console.error("Error fetching top artists:", error);
      return [];
    }
  }  

async function fetchArtistDetails(artistName) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&autocorrect=0`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.artist || !data.artist.stats) {
            console.warn("No details found for artist:", artistName);
            return null;
        }

        // Update progress display if desired:
        loadingDiv.innerHTML = `<p>Loading data... Artist: ${artistName}</p>`;

        // Extract tags; ensure it's always an array of lowercased strings.
        let tags = [];
        if (data.artist.tags && data.artist.tags.tag) {
            if (Array.isArray(data.artist.tags.tag)) {
                tags = data.artist.tags.tag.map(t => t.name.toLowerCase());
            } else if (data.artist.tags.tag.name) {
                tags = [data.artist.tags.tag.name.toLowerCase()];
            }
        }

        return {
            name: data.artist.name,
            listeners: parseInt(data.artist.stats.listeners, 10),
            playcount: parseInt(data.artist.stats.playcount, 10),
            tags: tags, // Array of lowercase tag strings
        };
    } catch (error) {
        console.error("Error fetching artist details:", error);
        return null;
    }
}

async function fetchAllArtistDetails(artists, limit) {
    const limitedArtists = artists.slice(0, limit);
    const results = await mapWithConcurrency(
        limitedArtists,
        (artist) => fetchArtistDetails(artist.name),
        4
    );
    return results.filter(result => result !== null);
}
  
// Fetch the user's top albums from Last.fm
async function fetchTopAlbums(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getTopAlbums&api_key=${API_KEY}&user=${encodeURIComponent(username)}&limit=200&format=json&autocorrect=0`;
  
    try {
      // Fetch the first page
            const firstData = await fetchJsonWithRetry(baseUrl);
            if (!firstData) {
                return [];
            }
  
      if (firstData.topalbums && firstData.topalbums.album) {
        // Optionally update progress display
        const totalAlbums = parseInt(firstData.topalbums['@attr'].total, 10) || firstData.topalbums.album.length;
        // For progress, you can display a message for the first page
        loadingDiv.innerHTML = `<p>Loading data... Album 1 of ${totalAlbums}</p>`;
  
        // Start with the albums from the first page.
        let allAlbums = firstData.topalbums.album;
  
        // Determine total pages
        const totalPages = parseInt(firstData.topalbums['@attr'].totalPages, 10) || 1;
        
                // If more than one page, fetch the rest with limited concurrency and retries.
        if (totalPages > 1) {
                    const pageNumbers = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
                    const pagesData = await mapWithConcurrency(
                        pageNumbers,
                        (page) => fetchJsonWithRetry(`${baseUrl}&page=${page}`),
                        3
                    );
          pagesData.forEach((pageData, idx) => {
            if (pageData.topalbums && pageData.topalbums.album) {
              // Optionally update progress display:
              loadingDiv.innerHTML = `<p>Loading data... Album ${idx + 2} of ${totalAlbums}</p>`;
              allAlbums = allAlbums.concat(pageData.topalbums.album);
            }
          });
        }
        
        // Map the albums to the required format.
        return allAlbums.map(album => ({
          name: album.name,
          artist: album.artist.name,
          user_scrobbles: parseInt(album.playcount, 10)
        }));
      } else {
        console.warn("No top albums found for user:", username);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching top albums for ${username}:`, error);
      return [];
    }
}
  
// Fetch detailed album info for each album
async function fetchAlbumDetails(album) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.name)}&format=json&autocorrect=0`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.album) {

            loadingDiv.innerHTML = `<p>Loading data... Album: ${album.name}</p>`;

            return {
                name: album.name,
                artist: album.artist,
                listeners: parseInt(data.album.listeners, 10) || 0,
                playcount: parseInt(data.album.playcount, 10) || 0,
            };
        } else {
            console.warn("No details found for album:", album.name);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching details for album ${album.name} by ${album.artist}:`, error);
        return null;
    }
}

async function fetchAllAlbumDetails(albums, limit) {
    const limitedAlbums = albums.slice(0, limit);
    const results = await mapWithConcurrency(
        limitedAlbums,
        (album) => fetchAlbumDetails(album),
        4
    );
    return results.filter(result => result !== null);
}
  
// Fetch the user's top tracks from Last.fm
async function fetchTopTracks(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getTopTracks&api_key=${API_KEY}&user=${encodeURIComponent(username)}&limit=200&format=json&autocorrect=0`;
  
    try {
      // Fetch the first page
            const firstData = await fetchJsonWithRetry(baseUrl);
            if (!firstData) {
                return [];
            }
  
      if (firstData.toptracks && firstData.toptracks.track) {
        // Optionally update progress display
        const totalTracks = parseInt(firstData.toptracks['@attr'].total, 10) || firstData.toptracks.track.length;
        loadingDiv.innerHTML = `<p>Loading data... Track 1 of ${totalTracks}</p>`;
  
        // Start with the tracks from the first page.
        let allTracksFetched = firstData.toptracks.track;
  
        // Determine total pages
        const totalPages = parseInt(firstData.toptracks['@attr'].totalPages, 10) || 1;
        
                // If more than one page, fetch the rest with limited concurrency and retries.
        if (totalPages > 1) {
                    const pageNumbers = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
                    const pagesData = await mapWithConcurrency(
                        pageNumbers,
                        (page) => fetchJsonWithRetry(`${baseUrl}&page=${page}`),
                        3
                    );
          pagesData.forEach((pageData, idx) => {
            if (pageData.toptracks && pageData.toptracks.track) {
              loadingDiv.innerHTML = `<p>Loading data... Track ${idx + 2} of ${totalTracks}</p>`;
              allTracksFetched = allTracksFetched.concat(pageData.toptracks.track);
            }
          });
        }
        
        // Map the tracks to the required format.
        return allTracksFetched.map(track => ({
          name: track.name,
          artist: track.artist.name,
          user_scrobbles: parseInt(track.playcount, 10)
        }));
      } else {
        console.warn("No top tracks found for user:", username);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching top tracks for ${username}:`, error);
      return [];
    }
}
  
// Fetch detailed track info for each track
async function fetchTrackDetails(track) {
	const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(track.artist)}&track=${encodeURIComponent(track.name)}&format=json&autocorrect=0`;

	let attempts = 0;
	while (attempts < 2) {
		try {
			const response = await fetch(url);
			const data = await response.json();

			// Rate limit detection (Last.fm sometimes returns errors when limited)
			if (data.error && data.error === 29) {
				console.warn(`Rate limit hit for track: ${track.name}. Retrying in 500ms...`);
				await new Promise((resolve) => setTimeout(resolve, 500)); // Properly wait before retrying
				attempts++;
				continue; // Retry after delay
			}

			// Check if the response has valid track data.
			if (data.track && data.track.name) {
				if (typeof loadingDiv !== "undefined" && loadingDiv) {
					loadingDiv.innerHTML = `<p>Loading data... Track: ${track.name}</p>`;
				}
				return {
					name: data.track.name,
					artist: data.track.artist?.name || track.artist,
					album: data.track.album?.title || "Unknown",
					duration: parseInt(data.track.duration, 10) || 0,
					listeners: parseInt(data.track.listeners, 10) || 0,
					playcount: parseInt(data.track.playcount, 10) || 0,
				};
			} else {
				console.warn("No details found for track:", track.name);
				return {
					name: "Unknown",
					artist: "Unknown",
					album: "Unknown",
					duration: 0,
					listeners: 0,
					playcount: 0,
				};
			}
		} catch (error) {
			console.error(`Error fetching details for track ${track.name} by ${track.artist}:`, error);
			if (attempts === 0) {
				console.warn(`Retrying fetch for ${track.name} in 500ms...`);
				await new Promise((resolve) => setTimeout(resolve, 500)); // Proper wait
			} else {
				console.warn(`Skipping track ${track.name} after multiple failures.`);
				return null;
			}
		}
		attempts++;
	}
	return null; // Fallback return in case of failure
}

async function fetchAllTrackDetails(tracks, limit) {
    const limitedTracks = tracks.slice(0, limit);
    const results = await mapWithConcurrency(
        limitedTracks,
        (track) => fetchTrackDetails(track),
        3
    );
    return results.filter(result => result !== null);
}

// Load CSV file
const csvFileInput = document.getElementById('csv-file');
if (csvFileInput) csvFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;

        // ✅ Parse the CSV (including extracting username)
        allTracks = parseCSV(csvData);

        // ✅ Try extracting the username if missing
        if (!allTracks.username) {
            console.warn("Username missing from parsed data, checking CSV manually...");
            const firstLine = csvData.split("\n")[0]; // Get the first line
            console.log("CSV First Line:", firstLine);

            const match = firstLine.match(/Date#(.*)/);
            if (match && match[1]) {
                allTracks.username = match[1].trim();
                console.log("Extracted username from CSV:", allTracks.username);
            } else {
                console.error("Failed to extract Last.fm username from CSV.");
                return;
            }
        }

        // ✅ Ensure a username exists after parsing
        if (!allTracks.username) {
            console.error("Failed to extract Last.fm username from CSV.");
            return;
        }
        const username = allTracks.username;
        console.log("Detected Last.fm username:", username);

        // ✅ Initialize tracking objects
        raw_data = [];
        const firstScrobbles = { artists: {}, albums: {}, tracks: {} };
        const lastScrobbles = { artists: {}, albums: {}, tracks: {} };
        const artistTrackSets = Object.create(null);
        const albumTrackSets = Object.create(null);

        // ✅ Iterate over allTracks to determine first scrobbles and track counts
        allTracks.forEach(track => {
            if (!track.artist || !track.track || !track.date) {
                console.warn("Skipping track due to missing data:", track);
                return;
            }

            const artistKey = track.artist.trim().toLowerCase();
            const albumKey = track.album?.trim() ? `${track.album.trim().toLowerCase()}_${artistKey}` : null;
            const trackKey = `${track.track.trim().toLowerCase()}_${artistKey}`;
            const uts = parseInt(track.date, 10); // Already in milliseconds

            if (!firstScrobbles.artists[artistKey] || uts < firstScrobbles.artists[artistKey]) {
                firstScrobbles.artists[artistKey] = uts;
            }
            if (albumKey && (!firstScrobbles.albums[albumKey] || uts < firstScrobbles.albums[albumKey])) {
                firstScrobbles.albums[albumKey] = uts;
            }
            if (!firstScrobbles.tracks[trackKey] || uts < firstScrobbles.tracks[trackKey]) {
                firstScrobbles.tracks[trackKey] = uts;
            }

            if (!lastScrobbles.artists[artistKey] || uts > lastScrobbles.artists[artistKey]) {
                lastScrobbles.artists[artistKey] = uts;
            }
            
            // For albums: if we haven't stored a value yet, or if this track's uts is later than the stored one, update it.
            if (albumKey && (!lastScrobbles.albums[albumKey] || uts > lastScrobbles.albums[albumKey])) {
                lastScrobbles.albums[albumKey] = uts;
            }
            
            // For tracks: if we haven't stored a value yet, or if this track's uts is later than the stored one, update it.
            if (!lastScrobbles.tracks[trackKey] || uts > lastScrobbles.tracks[trackKey]) {
                lastScrobbles.tracks[trackKey] = uts;
            }

            if (!artistTrackSets[artistKey]) artistTrackSets[artistKey] = new Set();
            if (!albumTrackSets[albumKey]) albumTrackSets[albumKey] = new Set();
            
            artistTrackSets[artistKey].add(trackKey);
            albumTrackSets[albumKey].add(trackKey);

            // Add to raw_data
            raw_data.push({
                Artist: track.artist,
                Album: track.album,
                Track: track.track,
                Date: uts
            });
        });

        // ✅ Sort by Date (oldest first) and assign order
        raw_data.sort((a, b) => a.Date - b.Date);
        raw_data.forEach((track, index) => {
            track.order = index + 1;
        });

        allTracks = raw_data; // Update allTracks with sorted data
        buildHistoryContextMaps();
        ensureRaceDateDefaults(true);

        // ✅ Fetch top stats using the extracted username
        const topArtists = await fetchTopArtists(username);
        const topAlbums = await fetchTopAlbums(username);
        const topTracks = await fetchTopTracks(username);

        // ✅ Ensure first scrobbles are properly retrieved
        console.log("First Scrobbles Data:", firstScrobbles);

        // ✅ Update data arrays with correct first scrobbles
        artistsData = topArtists.map((artist, index) => {
            if (!artist.name) return null; // Prevent undefined objects

            const artistKey = artist.name.trim().toLowerCase();
            return {
                name: artist.name,
                rank: index + 1,
                firstscrobble: firstScrobbles.artists?.[artistKey] ?? null,
                lastscrobble: lastScrobbles.artists?.[artistKey] ?? null,
                user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0,
                track_count: artistTrackSets[artistKey] ? artistTrackSets[artistKey].size : 0,
            };
        }).filter(Boolean);

        albumsData = topAlbums.map((album, index) => {
            if (!album.name || !album.artist) return null;

            const albumKey = `${album.name.trim().toLowerCase()}_${album.artist.trim().toLowerCase()}`;
            return {
                name: album.name,
                artist: album.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.albums?.[albumKey] ?? null,
                lastscrobble: lastScrobbles.albums?.[albumKey] ?? null,
                user_scrobbles: parseInt(album.user_scrobbles, 10) || 0,
                track_count: albumTrackSets[albumKey] ? albumTrackSets[albumKey].size : 0,
            };
        }).filter(Boolean);

        tracksData = topTracks.map((track, index) => {
            if (!track.name || !track.artist) return null;

            const trackKey = `${track.name.trim().toLowerCase()}_${track.artist.trim().toLowerCase()}`;
            return {
                name: track.name,
                artist: track.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.tracks?.[trackKey] ?? null,
                lastscrobble: lastScrobbles.tracks?.[trackKey] ?? null,
                user_scrobbles: parseInt(track.user_scrobbles, 10) || 0,
            };
        }).filter(Boolean);

        loadingDiv.innerHTML = "<p>Mapping artists...</p>";

        artistDataMap = artistsData.reduce((map, artist) => {
            map[artist.name.toLowerCase()] = artist;
            return map;
        }, {});
    
        loadingDiv.innerHTML = "<p>Mapping albums...</p>";
        
        albumDataMap = albumsData.reduce((map, album) => {
            map[`${album.name.toLowerCase()}||${album.artist.toLowerCase()}`] = album;
            return map;
        }, {});
    
        loadingDiv.innerHTML = "<p>Mapping tracks...</p>";
        
        trackDataMap = tracksData.reduce((map, track) => {
            map[`${track.name.toLowerCase()}||${track.artist.toLowerCase()}`] = track;
            return map;
        }, {});

        // ✅ Enable "Load Detailed Data" button
        const loadDetailedBtn = document.getElementById("load-detailed-data");
        const loadAllDetailsBtn = document.getElementById("load-all-details");
        if (loadDetailedBtn) {
            loadDetailedBtn.disabled = false;
            loadDetailedBtn.title = "Click to load detailed data!";
        }
        if (loadAllDetailsBtn) {
            loadAllDetailsBtn.disabled = false;
            loadAllDetailsBtn.title = "Downloads metadata for every single song you've ever listened to. This can take a very long time.";
        }

        setAppLoadedState(username);

        console.log("Final allTracks:", allTracks);
        console.log("Updated artistsData:", artistsData);
        console.log("Updated albumsData:", albumsData);
        console.log("Updated tracksData:", tracksData);

        loadingDiv.innerHTML = ""; // Clear loading message

        // ✅ Update UI
        filterTracks();
        displayEntities();
        updateActiveFilters();
    };
    reader.readAsText(file);
});

// Parse CSV data
function parseCSV(data) {
    const lines = data.trim().split('\n');
    const headers = lines[0].split(';').map(header => header.trim().toLowerCase());

    // Find the date header and rename it to 'date'
    const dateHeader = headers.find(header => header.startsWith('date#'));
    const renamedHeaders = headers.map(header => (header === dateHeader ? 'date' : header));

    return lines.slice(1).map(line => {
        const values = line.match(/(".*?"|[^;]+)(?=;|$)/g)
            .map(val => val.replace(/"/g, '').trim());

        const track = renamedHeaders.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});

        if (track.date) {
            const timestamp = parseInt(track.date);
            if (!isNaN(timestamp)) {
                track.date = timestamp
            }
        }

        return track;
    });
}

/**
 * Computes a mapping from a group key to its global ranking and total scrobble count,
 * based on allTracks (the unfiltered list). The group key is defined differently depending
 * on the entityType.
 * @param {string} entityType - "track", "album", or "artist".
 * @returns {Object} - Mapping: { groupKey: { rank, count } }
 */
function computeUnfilteredStats(entityType) {
    const cacheEntry = unfilteredStatsCache[entityType];
    if (
        cacheEntry &&
        cacheEntry.source === allTracks &&
        cacheEntry.length === allTracks.length &&
        cacheEntry.mapping
    ) {
        return cacheEntry.mapping;
    }

    const groups = {};
    if (entityType === 'track') {
        allTracks.forEach(track => {
            const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    } else if (entityType === 'album') {
        allTracks.forEach(track => {
            const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    } else if (entityType === 'artist') {
        allTracks.forEach(track => {
            const key = track.Artist.toLowerCase();
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    }
    // Convert to array and sort descending by count.
    const groupArray = Object.entries(groups).map(([key, data]) => ({ key, count: data.count }));
    groupArray.sort((a, b) => b.count - a.count);
    // Now assign ranking (1-indexed)
    const mapping = {};
    groupArray.forEach((item, index) => {
        mapping[item.key] = { rank: index + 1, count: item.count };
    });

    if (cacheEntry) {
        cacheEntry.source = allTracks;
        cacheEntry.length = allTracks.length;
        cacheEntry.mapping = mapping;
    }

    return mapping;
}

/**
 * Calculate the number of separate periods (day/week/month) an entity (track/album/artist) has been scrobbled.
 * @param {Array} tracks - Array of track objects.
 * @param {string} period - The period to calculate ('day', 'week', 'month').
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with counts of separate periods.
 */
function calculateSeparateScrobbles(tracks, period, entityType = 'track') {
    console.log(`Calculating separate scrobbles for period: ${period}, entityType: ${entityType}`);
    
    // Grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`; // Group by Artist & Track
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;   // Group by Album & Artist
        } else if (entityType === 'artist') {
            return track.Artist;                       // Group by Artist only
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    const groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: new Set()
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }
        if (track.Date) {
            const timestamp = parseInt(track.Date);
            if (!isNaN(timestamp)) {
                const date = new Date(timestamp); // Date is in ms already
                let periodKey;
                switch (period) {
                    case 'day':
                        periodKey = date.toISOString().split('T')[0];
                        break;
                    case 'week':
                        periodKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
                        break;
                    case 'month':
                        periodKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
                        break;
                    default:
                        periodKey = date.toISOString().split('T')[0];
                }
                if (!acc[key].dates.has(periodKey)) {
                    acc[key].count++;
                    acc[key].dates.add(periodKey);
                }
            }
        }
        return acc;
    }, {});

    console.log('Separate scrobbles groups:', groups);
    return Object.values(groups);
}

function calculateConsecutiveScrobbles(tracks, entityType = 'track') {
    const sortedTracks = [...tracks].sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));

    const groupKeyFunc = (track) => {
        if (entityType === 'track') return `${track.Artist} - ${track.Track}`;
        if (entityType === 'album') return `${track.Album}||${track.Artist}`;
        if (entityType === 'artist') return track.Artist;
        return `${track.Artist} - ${track.Track}`;
    };

    const groups = {};
    let previousKey = null;
    let previousOrder = null;

    for (const track of sortedTracks) {
        const key = groupKeyFunc(track);

        if (!groups[key]) {
            groups[key] = {
                maxConsecutive: 0,
                currentConsecutive: 0,
                startTime: null,
                endTime: null,
                currentStartTime: null
            };
            if (entityType === 'track') {
                groups[key].Artist = track.Artist;
                groups[key].Track = track.Track;
            } else if (entityType === 'album') {
                groups[key].name = track.Album;
                groups[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                groups[key].name = track.Artist;
            }
        }

        const currentOrder = track.order;
        const isConsecutive = previousKey === key && currentOrder === previousOrder + 1;

        if (!isConsecutive) {
            groups[key].currentConsecutive = 1;
            groups[key].currentStartTime = track.Date;
        } else {
            groups[key].currentConsecutive += 1;
        }

        if (groups[key].currentConsecutive > groups[key].maxConsecutive) {
            groups[key].maxConsecutive = groups[key].currentConsecutive;
            groups[key].startTime = groups[key].currentStartTime;
            groups[key].endTime = track.Date;
        }

        previousKey = key;
        previousOrder = currentOrder;
    }

    return Object.values(groups);
}

function calculateConsecutivePeriods(tracks, period, entityType = 'track') {
	const sortedTracks = [...tracks].sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));
    const timezoneOffsetMs = new Date().getTimezoneOffset() * 60000;

	const groupKeyFunc = (track) => {
		if (entityType === 'track') return `${track.Artist} - ${track.Track}`;
		if (entityType === 'album') return `${track.Album}||${track.Artist}`;
		if (entityType === 'artist') return track.Artist;
		return `${track.Artist} - ${track.Track}`;
	};

    const getPeriodKey = (timestamp) => {
        const date = new Date(timestamp);
        switch (period) {
            case 'day':
                return Math.floor((timestamp - timezoneOffsetMs) / 86400000);
            case 'week':
                return getWeekIdentifier(date);
            case 'month':
                return date.getFullYear() * 12 + date.getMonth();
            default:
                return Math.floor((timestamp - timezoneOffsetMs) / 86400000);
        }
    };

	const results = {};
    const states = {};

    for (const track of sortedTracks) {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) continue;

        const key = groupKeyFunc(track);
        const periodKey = getPeriodKey(timestamp);

        if (!states[key]) {
            states[key] = {
                lastPeriod: null,
                currentConsecutive: 0,
                maxConsecutive: 0,
                currentStartTime: null,
                currentEndTime: null,
                bestStartTime: null,
                bestEndTime: null,
                sample: track
            };
        }

        const state = states[key];

        if (state.lastPeriod === periodKey) {
            continue;
        }

        if (state.lastPeriod !== null && isNextPeriod(state.lastPeriod, periodKey, period)) {
            state.currentConsecutive += 1;
            state.currentEndTime = timestamp;
        } else {
            if (state.currentConsecutive > state.maxConsecutive) {
                state.maxConsecutive = state.currentConsecutive;
                state.bestStartTime = state.currentStartTime;
                state.bestEndTime = state.currentEndTime;
            }
            state.currentConsecutive = 1;
            state.currentStartTime = timestamp;
            state.currentEndTime = timestamp;
        }

        state.lastPeriod = periodKey;
    }

    Object.keys(states).forEach((key) => {
        const state = states[key];

        if (state.currentConsecutive > state.maxConsecutive) {
            state.maxConsecutive = state.currentConsecutive;
            state.bestStartTime = state.currentStartTime;
            state.bestEndTime = state.currentEndTime;
        }

        results[key] = {
            maxConsecutive: state.maxConsecutive,
            startTime: state.bestStartTime,
            endTime: state.bestEndTime,
        };

		if (entityType === 'track') {
			results[key].Artist = state.sample.Artist;
			results[key].Track = state.sample.Track;
		} else if (entityType === 'album') {
			results[key].name = state.sample.Album;
			results[key].artist = state.sample.Artist;
		} else if (entityType === 'artist') {
			results[key].name = state.sample.Artist;
		}
    });

	return Object.values(results);
}

// Helper function to find a matching track's timestamp
function getMatchingTrackTime(groupTracks, periodKey, period) {
    const timezoneOffset = new Date().getTimezoneOffset(); // Minutes
    const timezoneOffsetMs = timezoneOffset * 60000; 
	const matchingTrack = groupTracks.find((t) => {
		const ts = parseInt(t.Date);
		const d = new Date(ts);
		let pKey;
		switch (period) {
			case 'day':
				pKey = Math.floor((ts - timezoneOffsetMs) / 86400000);
				break;
			case 'week':
				pKey = getWeekIdentifier(d);
				break;
			case 'month':
				pKey = d.getFullYear() * 12 + d.getMonth();
				break;
		}
		return pKey === periodKey;
	});
	return matchingTrack ? matchingTrack.Date : null;
}

// Convert a date to a unique week identifier
function getWeekIdentifier(date) {
    const timezoneOffset = new Date().getTimezoneOffset(); // Minutes
    const timezoneOffsetMs = timezoneOffset * 60000; 
    const firstJan = new Date(date.getFullYear(), 0, 1);
    const daysOffset = Math.floor((date - timezoneOffsetMs - firstJan) / 86400000);
    return date.getFullYear() * 52 + Math.ceil((daysOffset + firstJan.getDay()) / 7);
}

// Check if two periods are consecutive
function isNextPeriod(prev, curr, periodType) {
    if (periodType === 'day') {
        return curr === prev + 1; // Next day in numerical sequence
    } else if (periodType === 'week' || periodType === 'month') {
        return curr === prev + 1; // Next week/month in numerical sequence
    }
    return false;
}

function calculateListeningPercentage(tracks, entityType = 'track') {
    console.log(`Calculating listening percentage for entityType: ${entityType}`);

    // Grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`; // Group by Artist & Track
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;   // Group by Album & Artist
        } else if (entityType === 'artist') {
            return track.Artist;                       // Group by Artist only
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    // To track processed entities and avoid duplication in calculations
    const processedEntities = new Set();

    const groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (processedEntities.has(key)) {
            return acc; // Skip processing if the entity has already been processed
        }
        processedEntities.add(key);

        if (!acc[key]) {
            acc[key] = {
                listeningPercentage: 0,
                scrobbles: 0,
                playcount: 0
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        // Get the playcount and user scrobbles from the data maps for album/artist/track
        let scrobbles = 0;
        let playcount = 0;

        // Assuming trackDataMap, albumDataMap, and artistDataMap are available and contain playcount and user_scrobbles
        if (entityType === 'track') {
            scrobbles = trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.user_scrobbles || 0;
            playcount = trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.playcount || 0;
        } else if (entityType === 'album') {
            scrobbles = albumDataMap[`${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`]?.user_scrobbles || 0;
            playcount = albumDataMap[`${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`]?.playcount || 0;
        } else if (entityType === 'artist') {
            scrobbles = artistDataMap[track.Artist.toLowerCase()]?.user_scrobbles || 0;
            playcount = artistDataMap[track.Artist.toLowerCase()]?.playcount || 0;
        }

        // Calculate listening percentage and update the group's data
        if (playcount > 0) {
            const listeningPercentage = (scrobbles / playcount) * 100;
            acc[key].listeningPercentage = listeningPercentage;
        }

        acc[key].scrobbles += scrobbles;
        acc[key].playcount += playcount;

        return acc;
    }, {});

    // Convert the grouped data into an array for returning
    const result = Object.values(groups);

    // Sort by listening percentage in descending order
    result.sort((a, b) => b.listeningPercentage - a.listeningPercentage);

    console.log('Listening percentage groups:', result);
    return result;
}

/**
 * Calculate listening duration for each entity (track/album/artist).
 * @param {Array} filteredData - Array of track objects after filtering.
 * @param {string} entityType - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with listening durations.
 */
function calculateListeningDuration(filteredData, entityType = 'track') {
    console.log(`Calculating listening duration for entityType: ${entityType}`);

    // Step 1: Group tracks by Artist + Track
    const trackGroups = {};

    filteredData.forEach(track => {
        const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
        
        if (!trackGroups[key]) {
            trackGroups[key] = { ...track, count: 0, albumCounts: {}, duration: 0 };
        }
        trackGroups[key].count++;

        // Count album occurrences to get the most common album for the track
        const albumName = track.Album;
        if (!trackGroups[key].albumCounts[albumName]) {
            trackGroups[key].albumCounts[albumName] = 0;
        }
        trackGroups[key].albumCounts[albumName]++;

        // Get the duration of the track from trackDataMap
        trackGroups[key].duration = trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.duration || 0;
    });

    // Convert the grouped data into an array
    filteredData = Object.values(trackGroups);

    // Step 2: If entityType is 'track', return the listening duration for tracks
    if (entityType === 'track') {
        return filteredData.map(track => {
            return {
                ...track,
                listeningDuration: track.duration * track.count
            };
        }).sort((a, b) => b.listeningDuration - a.listeningDuration); // Sort by listeningDuration
    }

    // Step 3: Aggregate by artist or album
    const aggregatedData = filteredData.reduce((acc, track) => {
        const entityKey = entityType === 'album' ? track.Album : track.Artist; // Use Album for album-type, Artist otherwise
    
        // Ensure that the key is consistent and add artist for albums
        if (!acc[entityKey]) {
            acc[entityKey] = { 
                listeningDuration: 0, 
                name: entityKey, 
                artist: entityType === 'album' ? track.Artist : null // Only add artist for albums
            };
        }
    
        // Add the track's listening duration to the entity's total listening duration
        acc[entityKey].listeningDuration += track.duration * track.count;
    
        return acc;
    }, {});

    // Convert aggregated data into an array and sort by listeningDuration
    const sortedAggregatedData = Object.values(aggregatedData).sort((a, b) => b.listeningDuration - a.listeningDuration);

    console.log('Aggregated listening durations:', sortedAggregatedData);
    return sortedAggregatedData;
}

/**
 * Format the duration from milliseconds into a readable string: "x days y hours z minutes".
 * @param {number} durationInMillis - Duration in milliseconds.
 * @returns {string} - Formatted duration string.
 */
function formatDuration(durationInMillis) {
    const days = Math.floor(durationInMillis / (1000 * 60 * 60 * 24));
    const hours = Math.floor((durationInMillis % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((durationInMillis % (1000 * 60 * 60)) / (1000 * 60));

    let result = '';
    if (days > 0) result += `${days} day${days > 1 ? 's' : ''} `;
    if (hours > 0) result += `${hours} hour${hours > 1 ? 's' : ''} `;
    if (minutes > 0) result += `${minutes} minute${minutes > 1 ? 's' : ''}`;

    return result.trim();
}

function calculateAverageListeningTime(tracks, entityType = 'track', minScrobbles = 1) {
    const threshold = Math.max(1, parseInt(minScrobbles, 10) || 1);

    const groups = tracks.reduce((acc, track) => {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return acc;

        let key;
        if (entityType === 'track') {
            key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (!acc[key]) {
                acc[key] = { ...track, count: 0, timestampSum: 0, albumCounts: {} };
            }
            acc[key].count += 1;
            acc[key].timestampSum += timestamp;
            const albumName = track.Album;
            if (!acc[key].albumCounts[albumName]) {
                acc[key].albumCounts[albumName] = 0;
            }
            acc[key].albumCounts[albumName] += 1;
            return acc;
        }

        if (entityType === 'album') {
            key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
            if (!acc[key]) {
                acc[key] = { name: track.Album, artist: track.Artist, count: 0, timestampSum: 0 };
            }
            acc[key].count += 1;
            acc[key].timestampSum += timestamp;
            return acc;
        }

        key = track.Artist.toLowerCase();
        if (!acc[key]) {
            acc[key] = { name: track.Artist, count: 0, timestampSum: 0 };
        }
        acc[key].count += 1;
        acc[key].timestampSum += timestamp;
        return acc;
    }, {});

    return Object.values(groups)
        .filter(entity => entity.count >= threshold)
        .map(entity => ({
            ...entity,
            averageListeningTimestamp: Math.floor(entity.timestampSum / entity.count)
        }));
}

/**
 * Calculate the first instance an entity (track/album/artist) reaches X scrobbles.
 * @param {Array} tracks - Array of track objects.
 * @param {number} x - The scrobble milestone.
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with date reached and time needed.
 */
function calculateFirstToXScrobbles(tracks, x, entityType = 'track') {
    console.log(`Calculating first to ${x} scrobbles for entityType: ${entityType}`);

    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`;
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;
        } else if (entityType === 'artist') {
            return track.Artist;
        }
        return `${track.Artist} - ${track.Track}`;
    };

    let groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: []
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        const timestamp = parseInt(track.Date);
        if (!isNaN(timestamp)) {
            acc[key].dates.push(timestamp);
            acc[key].count++;

            if (acc[key].count === x) {
                acc[key].dateReached = timestamp;
                acc[key].timeNeeded = timestamp - tracks[0].Date;
            }
        }
        return acc;
    }, {});

    console.log('First to X scrobbles groups:', groups);
    return Object.values(groups).filter(item => item.count >= x);
}

/**
 * Calculate the fastest time an entity (track/album/artist) reaches X scrobbles.
 * @param {Array} tracks - Array of track objects.
 * @param {number} x - The scrobble milestone.
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with time needed, first scrobble, and date reached.
 */
function calculateFastestToXScrobbles(tracks, x, entityType = 'track') {
    console.log(`Calculating fastest to ${x} scrobbles for entityType: ${entityType}`);

    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`;
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;
        } else if (entityType === 'artist') {
            return track.Artist;
        }
        return `${track.Artist} - ${track.Track}`;
    };

    let groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: []
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        const timestamp = parseInt(track.Date);
        if (!isNaN(timestamp)) {
            acc[key].dates.push(timestamp);
            acc[key].count++;

            if (acc[key].count === x) {
                acc[key].firstScrobble = acc[key].dates[0];
                acc[key].dateReached = timestamp;
                acc[key].timeNeeded = timestamp - acc[key].firstScrobble;
            }
        }
        return acc;
    }, {});

    console.log('Fastest to X scrobbles groups:', groups);
    return Object.values(groups)
        .filter(item => item.count >= x)
}

function getEntityKeyAndSample(track, entityType) {
    if (entityType === 'track') {
        return {
            key: `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`,
            sample: { Artist: track.Artist, Track: track.Track }
        };
    }
    if (entityType === 'album') {
        return {
            key: `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`,
            sample: { name: track.Album, artist: track.Artist }
        };
    }
    return {
        key: track.Artist.toLowerCase(),
        sample: { name: track.Artist }
    };
}

function getPeriodInfo(date, period) {
    if (period === 'day') {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return {
            key: `${y}-${m}-${d}`,
            label: `${y}-${m}-${d}`
        };
    }

    if (period === 'week') {
        const year = date.getFullYear();
        const week = getWeekNumber(date);
        return {
            key: `${year}-W${week}`,
            label: `${year}-W${week}`
        };
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return {
        key: `${y}-${m}`,
        label: `${y}-${m}`
    };
}

function calculateMaxScrobblesInSinglePeriod(tracks, period, entityType = 'track') {
    const periodCounts = {};
    const entityBest = {};

    tracks.forEach(track => {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return;

        const { key: entityKey, sample } = getEntityKeyAndSample(track, entityType);
        const periodInfo = getPeriodInfo(new Date(timestamp), period);
        const countKey = `${entityKey}@@${periodInfo.key}`;

        periodCounts[countKey] = (periodCounts[countKey] || 0) + 1;
        const currentCount = periodCounts[countKey];

        if (!entityBest[entityKey] || currentCount > entityBest[entityKey].count) {
            entityBest[entityKey] = {
                ...sample,
                count: currentCount,
                periodLabel: periodInfo.label
            };
        }
    });

    return Object.values(entityBest);
}

function calculateMaxScrobblesInRollingWindow(tracks, windowHours, entityType = 'track') {
    const windowMs = windowHours * 60 * 60 * 1000;
    const grouped = {};

    tracks.forEach(track => {
        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return;

        const { key: entityKey, sample } = getEntityKeyAndSample(track, entityType);
        if (!grouped[entityKey]) {
            grouped[entityKey] = {
                ...sample,
                timestamps: []
            };
        }
        grouped[entityKey].timestamps.push(timestamp);
    });

    const results = [];
    Object.values(grouped).forEach(entity => {
        const timestamps = entity.timestamps.sort((a, b) => a - b);
        let left = 0;
        let bestCount = 0;
        let bestStart = null;
        let bestEnd = null;

        for (let right = 0; right < timestamps.length; right++) {
            while (timestamps[right] - timestamps[left] > windowMs) {
                left++;
            }
            const currentCount = right - left + 1;
            if (currentCount > bestCount) {
                bestCount = currentCount;
                bestStart = timestamps[left];
                bestEnd = timestamps[right];
            }
        }

        results.push({
            ...entity,
            count: bestCount,
            windowStart: bestStart,
            windowEnd: bestEnd,
            windowHours
        });
    });

    return results;
}

function isRollingWindowSortingBasis(sortingBasis) {
    return typeof sortingBasis === "string"
        && (sortingBasis === "max-rolling-24h" || sortingBasis === "max-rolling-168h" || sortingBasis === "max-rolling-xh");
}

function getRollingWindowHoursForSortingBasis(sortingBasis, xValue) {
    if (sortingBasis === "max-rolling-24h") return 24;
    if (sortingBasis === "max-rolling-168h") return 168;
    if (sortingBasis === "max-rolling-xh") return Math.max(1, parseInt(xValue, 10) || 1);
    return null;
}

function isSortingBasisUsingXValue(sortingBasis) {
    return [
        "first-n-scrobbles",
        "fastest-n-scrobbles",
        "oldest-average-listening-time",
        "newest-average-listening-time",
        "max-rolling-xh"
    ].includes((sortingBasis || "").toString());
}


function displayTopTracks(tracks, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("track");
    }
    const fragment = document.createDocumentFragment();
    
    tracks.slice(0, listLength).forEach((track, index) => {
        const trackDiv = document.createElement("div");
        trackDiv.classList.add("track");
        let additionalInfo = '';
        additionalInfo = getAdditionalInfo(sortingBasis, track);
        

        // If the track appears on multiple albums, display the album with the highest scrobble count.
        let albumDisplay = '';
        if (track.albumCounts) {
            let maxCount = 0;
            for (const album in track.albumCounts) {
                if (track.albumCounts[album] > maxCount) {
                    maxCount = track.albumCounts[album];
                    albumDisplay = album;
                }
            }
        }

        // If unfiltered stats should be shown, look up the global ranking and count.
        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        trackDiv.innerHTML = `
            <strong>${index + 1}. ${escapeHTML(track.Track)}</strong> by ${escapeHTML(track.Artist)}${unfilteredInfo}
            ${albumDisplay ? `<br>Album: ${escapeHTML(albumDisplay)}` : ''}
            <br>${additionalInfo}
        `;
        fragment.appendChild(trackDiv);
    });
    resultsDiv.appendChild(fragment);
}

function displayTopAlbums(albums, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("album");
    }
    const fragment = document.createDocumentFragment();

    albums.slice(0, listLength).forEach((album, index) => {
        const albumDiv = document.createElement("div");
        albumDiv.classList.add("album");
        let additionalInfo = '';

        additionalInfo = getAdditionalInfo(sortingBasis, album);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${album.name.toLowerCase()}||${album.artist.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        albumDiv.innerHTML = `
            <strong>${index + 1}. ${escapeHTML(album.name)}</strong> by ${escapeHTML(album.artist)}${unfilteredInfo}<br>
            ${additionalInfo}
        `;
        fragment.appendChild(albumDiv);
    });
    resultsDiv.appendChild(fragment);
}

function displayTopArtists(artists, targetDiv = null, sortingBasisOverride = null) {
    const resultsDiv = targetDiv || document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = sortingBasisOverride || document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("artist");
    }
    const fragment = document.createDocumentFragment();

    artists.slice(0, listLength).forEach((artist, index) => {
        const artistDiv = document.createElement("div");
        artistDiv.classList.add("artist");
        let additionalInfo = '';

        additionalInfo = getAdditionalInfo(sortingBasis, artist);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = artist.name.toLowerCase();
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        artistDiv.innerHTML = `
            <strong>${index + 1}. ${escapeHTML(artist.name)}</strong>${unfilteredInfo}<br>
            ${additionalInfo}
        `;
        fragment.appendChild(artistDiv);
    });
    resultsDiv.appendChild(fragment);
}

function getAdditionalInfo(sortingBasis, entity) {
    const hiddenByDefaultEquationDetailFields = new Set(["artist-name", "track-name"]);
    const sortHistory = Array.isArray(entity.equationPipelineSortHistory) ? entity.equationPipelineSortHistory : [];
    const showFields = Array.isArray(entity.equationPipelineShowFields) ? entity.equationPipelineShowFields : [];
    const shownFieldSet = new Set(showFields);

    if (sortHistory.length > 0 || showFields.length > 0 || entity.equationPipelineUniqueField) {
        const lines = [];
        const seenLines = new Set();

        sortHistory.forEach(sortStep => {
            if (hiddenByDefaultEquationDetailFields.has(sortStep.field) && !shownFieldSet.has(sortStep.field)) {
                return;
            }
            const line = `${formatEquationFieldLabel(sortStep.field)}: ${sortStep.value}`;
            if (!seenLines.has(line)) {
                seenLines.add(line);
                lines.push(line);
            }
        });

        showFields.forEach(fieldName => {
            const fieldValue = getEquationFieldValue(entity, fieldName);
            if (fieldValue === null || fieldValue === undefined) return;
            const line = `${formatEquationFieldLabel(fieldName)}: ${fieldValue}`;
            if (!seenLines.has(line)) {
                seenLines.add(line);
                lines.push(line);
            }
        });

        if (entity.equationPipelineUniqueField) {
            if (
                !hiddenByDefaultEquationDetailFields.has(entity.equationPipelineUniqueField)
                || shownFieldSet.has(entity.equationPipelineUniqueField)
            ) {
                const uniqueLine = `${formatEquationFieldLabel(entity.equationPipelineUniqueField)}: ${entity.equationPipelineUniqueValue ?? 'N/A'}`;
                if (!seenLines.has(uniqueLine)) {
                    seenLines.add(uniqueLine);
                    lines.push(uniqueLine);
                }
            }
        }

        return lines.join("<br>");
    }

	if (sortingBasis === 'separate-days') {
		return `Different days: ${entity.count}`;
	} else if (sortingBasis === 'separate-weeks') {
		return `Different weeks: ${entity.count}`;
	} else if (sortingBasis === 'separate-months') {
		return `Different months: ${entity.count}`;
    } else if (sortingBasis === 'max-single-day') {
        return `Max scrobbles in a day: ${entity.count}<br>Day: ${entity.periodLabel}`;
    } else if (sortingBasis === 'max-single-week') {
        return `Max scrobbles in a week: ${entity.count}<br>Week: ${entity.periodLabel}`;
    } else if (sortingBasis === 'max-single-month') {
        return `Max scrobbles in a month: ${entity.count}<br>Month: ${entity.periodLabel}`;
    } else if (isRollingWindowSortingBasis(sortingBasis)) {
        const start = entity.windowStart ? new Date(entity.windowStart).toLocaleString() : 'N/A';
        const end = entity.windowEnd ? new Date(entity.windowEnd).toLocaleString() : 'N/A';
        return `Max scrobbles in ${entity.windowHours}h: ${entity.count}<br>Window start: ${start}<br>Window end: ${end}`;
	} else if (sortingBasis.startsWith('consecutive-')) {
		const startDate = entity.startTime ? new Date(parseInt(entity.startTime)).toISOString().split('T')[0] : 'N/A';
		const endDate = entity.endTime ? new Date(parseInt(entity.endTime)).toISOString().split('T')[0] : 'N/A';
		let periodLabel = sortingBasis.replace('consecutive-', '').replace('-', ' ');
		return `Max consecutive ${periodLabel}: ${entity.maxConsecutive}<br>Start: ${startDate}<br>End: ${endDate}`;
	} else if (sortingBasis === 'highest-listening-percentage') {
        return `Listening %: ${entity.listeningPercentage.toFixed(2)}%<br>Scrobbles: ${entity.scrobbles}<br>Playcount: ${entity.playcount}`;
    } else if (sortingBasis === 'time-spent-listening') {
        return `Listening time: ${formatDuration(entity.listeningDuration)}`;
    } else if (sortingBasis === 'first-n-scrobbles') {;
        const firstScrobbleDate = entity.dates?.[0] ? new Date(parseInt(entity.dates[0], 10)).toISOString().split('T')[0] : 'N/A';
		const reachedDate = entity.dateReached ? new Date(parseInt(entity.dateReached, 10)).toISOString().split('T')[0] : 'N/A';
        return `First scrobble: ${firstScrobbleDate}<br>Date reached: ${reachedDate}`
    } else if (sortingBasis === 'fastest-n-scrobbles') {
        const startFastest = entity.firstScrobble ? new Date(parseInt(entity.firstScrobble)).toISOString().split('T')[0] : 'N/A';
		const endFastest = entity.dateReached ? new Date(parseInt(entity.dateReached)).toISOString().split('T')[0] : 'N/A';
        return `Time to reach: ${formatDuration(entity.timeNeeded)}<br>First scrobble: ${startFastest}<br>Date reached: ${endFastest} `
    } else if (sortingBasis === 'oldest-average-listening-time' || sortingBasis === 'newest-average-listening-time') {
        const avgDate = entity.averageListeningTimestamp
            ? new Date(parseInt(entity.averageListeningTimestamp, 10)).toISOString().split('T')[0]
            : 'N/A';
        return `Average listening date: ${avgDate}<br>Scrobbles: ${entity.count}`;
    } else {
		return `Scrobbles: ${entity.count}`;
	}
}

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

function normalizeText(str) {
    // Lowercase, trim, and remove hyphens for a more forgiving comparison.
    return str.trim().toLowerCase().replace(/-/g, '');
}
  
  /**
   * Returns true if the propertyValue (a string) contains the tokens specified
   * in filterInput according to the following logic:
   * - If filterInput is empty, returns true.
   * - If filterInput contains semicolons, each semicolon-separated group must have at least one token (after splitting by commas) that is found within propertyValue.
   * - If filterInput does not contain semicolons, returns true if any of the comma-separated tokens are found.
   */
  function matchFilter(filterInput, propertyValue) {
    // Ensure propertyValue is a string (convert arrays to a single string)
    const normalizedProp = Array.isArray(propertyValue) 
        ? propertyValue.map(normalizeText).join(" ")  // Convert array to a single string
        : normalizeText(propertyValue);

    const input = filterInput.trim().toLowerCase();
    if (!input) return true; // empty filter passes

    if (input.indexOf(';') !== -1) {
        // Split into groups (AND logic across groups)
        const groups = input.split(';').map(group =>
            group.split(',').map(tag => normalizeText(tag)).filter(tag => tag !== '')
        );
        // For each group, at least one token must be found in the property.
        return groups.every(group => group.some(token => normalizedProp.includes(token)));
    } else {
        // Comma-separated tokens: OR logic
        const tokens = input.split(',').map(token => normalizeText(token)).filter(token => token !== '');
        return tokens.some(token => normalizedProp.includes(token));
    }
}
  
  /**
   * For excludes, we simply invert the result of matchFilter.
   */
function matchExclude(filterInput, propertyValue) {
    return !matchFilter(filterInput, propertyValue);
}
  
function getSelectedValues(selectElementId) {
    const select = document.getElementById(selectElementId);
    return Array.from(select.selectedOptions).map(option => option.value);
}

function serializeControlValue(control) {
    if (!control) return "";
    if (control.type === "checkbox") {
        return control.checked ? "true" : "";
    }
    if (control.tagName === "SELECT" && control.multiple) {
        return Array.from(control.selectedOptions).map(option => option.value).join(",");
    }
    return (control.value || "").toString();
}

function applySerializedControlValue(control, serializedValue) {
    if (!control) return;
    const safeValue = (serializedValue ?? "").toString();

    if (control.type === "checkbox") {
        control.checked = safeValue === "true";
        return;
    }

    if (control.tagName === "SELECT" && control.multiple) {
        const selectedValues = new Set(
            safeValue
                .split(",")
                .map(value => value.trim())
                .filter(Boolean)
        );
        Array.from(control.options || []).forEach(option => {
            option.selected = selectedValues.has(option.value);
        });
        return;
    }

    control.value = safeValue;
}

function parseSerializedNumberList(serializedValue) {
    return (serializedValue || "")
        .toString()
        .split(",")
        .map(value => parseInt(value.trim(), 10))
        .filter(value => !isNaN(value));
}

const equationFieldResolvers = {
    "artist-name": (item) => item.Artist,
    "album-name": (item) => item.Album,
    "track-name": (item) => item.Track,
    "artist-name-length": (item) => item.Artist?.length ?? null,
    "album-name-length": (item) => item.Album?.length ?? null,
    "track-name-length": (item) => item.Track?.length ?? null,
    "artist-word-count": (item) => item.Artist?.trim().split(/\s+/).length ?? null,
    "album-word-count": (item) => item.Album?.trim().split(/\s+/).length ?? null,
    "track-word-count": (item) => item.Track?.trim().split(/\s+/).length ?? null,
    "artist-scrobble-count": (item) => artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles ?? null,
    "album-scrobble-count": (item) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles ?? null,
    "track-scrobble-count": (item) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles ?? null,
    "artist-rank": (item) => artistDataMap[item.Artist.toLowerCase()]?.rank ?? null,
    "album-rank": (item) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank ?? null,
    "track-rank": (item) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank ?? null,
    "artist-track-count": (item) => artistDataMap[item.Artist.toLowerCase()]?.track_count ?? null,
    "album-track-count": (item) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count ?? null,
    "artist-first-scrobble-year": (item) => getFirstScrobbleYear(artistDataMap[item.Artist.toLowerCase()]?.firstscrobble),
    "album-first-scrobble-year": (item) => getFirstScrobbleYear(albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble),
    "track-first-scrobble-year": (item) => getFirstScrobbleYear(trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble),
    "artist-days-since-last": (item) => getDaysSinceTimestamp(artistDataMap[item.Artist.toLowerCase()]?.lastscrobble),
    "album-days-since-last": (item) => getDaysSinceTimestamp(albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.lastscrobble),
    "track-days-since-last": (item) => getDaysSinceTimestamp(trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.lastscrobble),
    "artist-listeners": (item) => artistDataMap[item.Artist.toLowerCase()]?.listeners ?? null,
    "album-listeners": (item) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners ?? null,
    "track-listeners": (item) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners ?? null,
    "artist-global-scrobbles": (item) => artistDataMap[item.Artist.toLowerCase()]?.playcount ?? null,
    "album-global-scrobbles": (item) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount ?? null,
    "track-global-scrobbles": (item) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount ?? null,
    "track-duration": (item) => {
        const durationMs = trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration;
        return durationMs === undefined || durationMs === null ? null : durationMs / 1000;
    },
    "scrobble-order": (item) => item.order ?? null,
    "year": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getFullYear() : null,
    "month": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getMonth() + 1 : null,
    "day-of-month": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getDate() : null,
    "weekday": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getDay() : null,
    "oldest-average-listening-time": (item, equationContext = {}) => {
        const minScrobbles = Math.max(1, parseInt(equationContext.xValue, 10) || 1);
        const mapping = getTrackAverageListeningMap(minScrobbles);
        const key = `${item.Track?.toLowerCase() || ""}||${item.Artist?.toLowerCase() || ""}`;
        return mapping[key] ?? null;
    },
    "newest-average-listening-time": (item, equationContext = {}) => {
        const minScrobbles = Math.max(1, parseInt(equationContext.xValue, 10) || 1);
        const mapping = getTrackAverageListeningMap(minScrobbles);
        const key = `${item.Track?.toLowerCase() || ""}||${item.Artist?.toLowerCase() || ""}`;
        const averageTimestamp = mapping[key];
        if (averageTimestamp === undefined || averageTimestamp === null) return null;
        return -averageTimestamp;
    }
};

const equationFieldNames = Object.keys(equationFieldResolvers).sort((a, b) => b.length - a.length);
const equationNumericFieldNames = [
    "artist-name-length",
    "album-name-length",
    "track-name-length",
    "artist-word-count",
    "album-word-count",
    "track-word-count",
    "artist-scrobble-count",
    "album-scrobble-count",
    "track-scrobble-count",
    "artist-rank",
    "album-rank",
    "track-rank",
    "artist-track-count",
    "album-track-count",
    "artist-first-scrobble-year",
    "album-first-scrobble-year",
    "track-first-scrobble-year",
    "artist-days-since-last",
    "album-days-since-last",
    "track-days-since-last",
    "artist-listeners",
    "album-listeners",
    "track-listeners",
    "artist-global-scrobbles",
    "album-global-scrobbles",
    "track-global-scrobbles",
    "track-duration",
    "scrobble-order",
    "year",
    "month",
    "day-of-month",
    "weekday",
    "oldest-average-listening-time",
    "newest-average-listening-time"
];
const equationOperatorTokens = [" = ", " != ", " < ", " <= ", " > ", " >= ", " + ", " - ", " * ", " / ", " % ", "(", ")", "; "];
const equationCommands = [
    {
        label: "sort",
        description: "Sort by a field. Numbers sort numerically, text sorts alphabetically. Syntax: sort <field> [asc|desc]."
    },
    {
        label: "unique",
        description: "Keep at most N items per value. Syntax: unique <field> [max-per-value]."
    },
    {
        label: "filter",
        description: "Filter items with an equation/comparison. Prefix is optional."
    },
    {
        label: "show",
        description: "Show a field in each entry detail. Syntax: show <field>."
    }
];
const equationOperatorDescriptions = {
    "=": "Equals",
    "!=": "Not equal",
    "<": "Less than",
    "<=": "Less than or equal",
    ">": "Greater than",
    ">=": "Greater than or equal",
    "+": "Add",
    "-": "Subtract",
    "*": "Multiply",
    "/": "Divide",
    "%": "Remainder (modulus)",
    "(": "Open parenthesis",
    ")": "Close parenthesis",
    ";": "End command"
};

function formatEquationFieldLabel(fieldName) {
    return fieldName
        .split("-")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function getFirstScrobbleYear(timestampValue) {
    if (timestampValue === undefined || timestampValue === null || timestampValue === "") return null;
    const timestamp = parseInt(timestampValue, 10);
    if (isNaN(timestamp)) return null;
    return new Date(timestamp).getFullYear();
}

function getDaysSinceTimestamp(timestampValue) {
    if (timestampValue === undefined || timestampValue === null || timestampValue === "") return null;
    const timestamp = parseInt(timestampValue, 10);
    if (isNaN(timestamp)) return null;
    return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function getTrackAverageListeningMap(minScrobbles = 1) {
    const threshold = Math.max(1, parseInt(minScrobbles, 10) || 1);
    if (
        trackAverageListeningCache.source === allTracks &&
        trackAverageListeningCache.length === allTracks.length &&
        trackAverageListeningCache.minScrobbles === threshold &&
        trackAverageListeningCache.mapping
    ) {
        return trackAverageListeningCache.mapping;
    }

    const grouped = {};
    allTracks.forEach(track => {
        const key = `${track.Track?.toLowerCase() || ""}||${track.Artist?.toLowerCase() || ""}`;
        if (!key || key === "||") return;

        const timestamp = parseInt(track.Date, 10);
        if (isNaN(timestamp)) return;

        if (!grouped[key]) {
            grouped[key] = { count: 0, timestampSum: 0 };
        }
        grouped[key].count += 1;
        grouped[key].timestampSum += timestamp;
    });

    const mapping = {};
    Object.entries(grouped).forEach(([key, value]) => {
        if (value.count >= threshold) {
            mapping[key] = Math.floor(value.timestampSum / value.count);
        }
    });

    trackAverageListeningCache.source = allTracks;
    trackAverageListeningCache.length = allTracks.length;
    trackAverageListeningCache.minScrobbles = threshold;
    trackAverageListeningCache.mapping = mapping;

    return mapping;
}

function getEquationFieldValue(item, fieldName, equationContext = {}) {
    const resolver = equationFieldResolvers[fieldName];
    if (!resolver) return null;
    const value = resolver(item, equationContext);
    return value === undefined ? null : value;
}

function tokenizeEquationExpression(expression) {
    const tokens = [];
    const source = expression.trim();
    const lowerSource = source.toLowerCase();
    let index = 0;

    while (index < source.length) {
        const current = source[index];

        if (/\s/.test(current)) {
            index += 1;
            continue;
        }

        if (/\d/.test(current)) {
            let numberEnd = index + 1;
            while (numberEnd < source.length && /\d/.test(source[numberEnd])) {
                numberEnd += 1;
            }
            tokens.push({ type: "number", value: Number(source.slice(index, numberEnd)) });
            index = numberEnd;
            continue;
        }

        if (["+", "-", "*", "/", "%", "(", ")"].includes(current)) {
            tokens.push({ type: "symbol", value: current });
            index += 1;
            continue;
        }

        let matchedField = null;
        for (const fieldName of equationFieldNames) {
            if (lowerSource.startsWith(fieldName, index)) {
                matchedField = fieldName;
                break;
            }
        }

        if (!matchedField) {
            return null;
        }

        tokens.push({ type: "field", value: matchedField });
        index += matchedField.length;
    }

    return tokens;
}

function parseEquationExpression(tokens, item, equationContext = {}) {
    let tokenIndex = 0;

    const parseFactor = () => {
        const token = tokens[tokenIndex];
        if (!token) return null;

        if (token.type === "symbol" && token.value === "-") {
            tokenIndex += 1;
            const operand = parseFactor();
            if (typeof operand !== "number" || !Number.isFinite(operand)) return null;
            return -operand;
        }

        if (token.type === "number") {
            tokenIndex += 1;
            return token.value;
        }

        if (token.type === "field") {
            tokenIndex += 1;
            return getEquationFieldValue(item, token.value, equationContext);
        }

        if (token.type === "symbol" && token.value === "(") {
            tokenIndex += 1;
            const innerValue = parseAddSubtract();
            const closing = tokens[tokenIndex];
            if (!closing || closing.type !== "symbol" || closing.value !== ")") return null;
            tokenIndex += 1;
            return innerValue;
        }

        return null;
    };

    const parseMultiplyDivide = () => {
        let left = parseFactor();
        if (left === null || left === undefined) return null;

        while (true) {
            const operator = tokens[tokenIndex];
            if (!operator || operator.type !== "symbol" || (operator.value !== "*" && operator.value !== "/" && operator.value !== "%")) {
                break;
            }

            tokenIndex += 1;
            const right = parseFactor();
            if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
                return null;
            }

            if (operator.value === "*") {
                left *= right;
            } else if (operator.value === "/") {
                if (right === 0) return null;
                left /= right;
            } else {
                if (right === 0) return null;
                left %= right;
            }
        }

        return left;
    };

    const parseAddSubtract = () => {
        let left = parseMultiplyDivide();
        if (left === null || left === undefined) return null;

        while (true) {
            const operator = tokens[tokenIndex];
            if (!operator || operator.type !== "symbol" || (operator.value !== "+" && operator.value !== "-")) {
                break;
            }

            tokenIndex += 1;
            const right = parseMultiplyDivide();
            if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
                return null;
            }

            if (operator.value === "+") {
                left += right;
            } else {
                left -= right;
            }
        }

        return left;
    };

    const result = parseAddSubtract();
    if (tokenIndex !== tokens.length) return null;
    return result;
}

function evaluateEquationSide(sideExpression, item, equationContext = {}) {
    const expression = sideExpression.trim();
    if (!expression) return null;

    const doubleQuoted = expression.match(/^"([\s\S]*)"$/);
    if (doubleQuoted) return doubleQuoted[1];

    const singleQuoted = expression.match(/^'([\s\S]*)'$/);
    if (singleQuoted) return singleQuoted[1];

    const tokens = tokenizeEquationExpression(expression);
    if (!tokens || tokens.length === 0) return null;

    return parseEquationExpression(tokens, item, equationContext);
}

function findTopLevelComparisonOperator(expression) {
    let depth = 0;
    let quote = null;

    for (let index = 0; index < expression.length; index++) {
        const current = expression[index];
        const next = expression[index + 1];

        if (quote) {
            if (current === quote) quote = null;
            continue;
        }

        if (current === '"' || current === "'") {
            quote = current;
            continue;
        }

        if (current === "(") {
            depth += 1;
            continue;
        }

        if (current === ")") {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (depth > 0) continue;

        const pair = `${current}${next || ""}`;
        if (["<=", ">=", "!=", "=="].includes(pair)) {
            return { index, operator: pair === "==" ? "=" : pair, length: 2 };
        }

        if (["=", "<", ">"].includes(current)) {
            return { index, operator: current, length: 1 };
        }
    }

    return null;
}

function compareEquationValues(left, right, operator) {
    const leftIsNumber = typeof left === "number" && Number.isFinite(left);
    const rightIsNumber = typeof right === "number" && Number.isFinite(right);
    const leftIsString = typeof left === "string";
    const rightIsString = typeof right === "string";

    if (operator === "=" || operator === "!=") {
        if (leftIsNumber && rightIsNumber) {
            return operator === "=" ? left === right : left !== right;
        }

        if (leftIsString && rightIsString) {
            const normalizedLeft = left.trim().toLowerCase();
            const normalizedRight = right.trim().toLowerCase();
            return operator === "="
                ? normalizedLeft === normalizedRight
                : normalizedLeft !== normalizedRight;
        }

        return false;
    }

    if (!leftIsNumber || !rightIsNumber) return false;

    if (operator === "<") return left < right;
    if (operator === ">") return left > right;
    if (operator === "<=") return left <= right;
    if (operator === ">=") return left >= right;
    return false;
}

function compileEquationClause(clause) {
    const comparison = findTopLevelComparisonOperator(clause);
    if (!comparison) return null;

    const leftExpression = clause.slice(0, comparison.index).trim();
    const rightExpression = clause.slice(comparison.index + comparison.length).trim();

    if (!leftExpression || !rightExpression) return null;

    return (item, equationContext = {}) => {
        const leftValue = evaluateEquationSide(leftExpression, item, equationContext);
        const rightValue = evaluateEquationSide(rightExpression, item, equationContext);
        if (leftValue === null || leftValue === undefined || rightValue === null || rightValue === undefined) {
            return false;
        }
        return compareEquationValues(leftValue, rightValue, comparison.operator);
    };
}

function createEquationUniqueKey(value) {
    if (value === null || value === undefined) return "__null__";
    if (typeof value === "string") return `string:${value.trim().toLowerCase()}`;
    return `value:${String(value)}`;
}

function parseEquationPipeline(equationsInput) {
    const clauses = equationsInput
        .split(/[;\n]+/)
        .map(clause => clause.trim())
        .filter(Boolean);

    const steps = [];

    for (const clause of clauses) {
        const sortMatch = clause.match(/^sort\s+([a-z0-9-]+)(?:\s+(asc|desc))?$/i);
        if (sortMatch) {
            const fieldName = sortMatch[1].toLowerCase();
            const direction = (sortMatch[2] || "asc").toLowerCase();

            if (!equationFieldResolvers[fieldName]) {
                return { error: `Invalid sort field: ${fieldName}`, steps: [] };
            }

            steps.push({ type: "sort", field: fieldName, direction: direction === "desc" ? "desc" : "asc" });
            continue;
        }

        const uniqueMatch = clause.match(/^unique\s+([a-z0-9-]+)(?:\s+(\d+))?$/i);
        if (uniqueMatch) {
            const fieldName = uniqueMatch[1].toLowerCase();
            const maxPerUnique = parseInt(uniqueMatch[2] || "1", 10);

            if (!equationFieldResolvers[fieldName]) {
                return { error: `Invalid unique field: ${fieldName}`, steps: [] };
            }

            steps.push({
                type: "unique",
                field: fieldName,
                maxPerUnique: isNaN(maxPerUnique) || maxPerUnique < 1 ? 1 : maxPerUnique
            });
            continue;
        }

        const showMatch = clause.match(/^show\s+([a-z0-9-]+)$/i);
        if (showMatch) {
            const fieldName = showMatch[1].toLowerCase();

            if (!equationFieldResolvers[fieldName]) {
                return { error: `Invalid show field: ${fieldName}`, steps: [] };
            }

            steps.push({ type: "show", field: fieldName });
            continue;
        }

        const filterMatch = clause.match(/^filter\s+(.+)$/i);
        const expression = (filterMatch ? filterMatch[1] : clause).trim();
        const predicate = compileEquationClause(expression);
        if (!predicate) {
            return { error: `Invalid filter equation: ${expression}`, steps: [] };
        }

        steps.push({ type: "filter", expression, predicate });
    }

    return { error: null, steps };
}

function applyEquationPipeline(tracks, equationsInput, equationContext = {}) {
    const trimmedInput = (equationsInput || "").trim();
    if (!trimmedInput) {
        return { usedPipeline: false, hasOrderingStep: false, tracks };
    }

    const { error, steps } = parseEquationPipeline(trimmedInput);
    if (error) {
        console.warn(error);
        return { usedPipeline: true, hasOrderingStep: false, tracks: [] };
    }

    const workingTracks = tracks.map(track => ({ ...track, equationPipelineSortHistory: [], equationPipelineShowFields: [] }));
    let hasOrderingStep = false;
    let currentTracks = workingTracks;
    const textSortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    for (const step of steps) {
        if (step.type === "filter") {
            currentTracks = currentTracks.filter(track => step.predicate(track, equationContext));
            continue;
        }

        if (step.type === "sort") {
            hasOrderingStep = true;

            currentTracks = currentTracks
                .map(track => {
                    const sortValue = getEquationFieldValue(track, step.field, equationContext);
                    if (sortValue === null || sortValue === undefined) return null;

                    const isSortableNumber = typeof sortValue === "number" && Number.isFinite(sortValue);
                    const isSortableString = typeof sortValue === "string";
                    if (!isSortableNumber && !isSortableString) return null;

                    const sortType = isSortableNumber ? "number" : "string";
                    const sortKey = isSortableNumber
                        ? sortValue
                        : sortValue.toLocaleLowerCase();

                    return {
                        ...track,
                        equationPipelineSortHistory: [
                            ...(track.equationPipelineSortHistory || []),
                            {
                                field: step.field,
                                direction: step.direction,
                                value: sortValue,
                                sortType,
                                sortKey
                            }
                        ]
                    };
                })
                .filter(Boolean);

            currentTracks.sort((a, b) => {
                const aHistory = a.equationPipelineSortHistory || [];
                const bHistory = b.equationPipelineSortHistory || [];
                const aLast = aHistory[aHistory.length - 1];
                const bLast = bHistory[bHistory.length - 1];
                const aSortType = aLast?.sortType;
                const bSortType = bLast?.sortType;
                const aSortKey = aLast?.sortKey;
                const bSortKey = bLast?.sortKey;

                if (aSortType === "number" && bSortType === "number") {
                    return step.direction === "asc"
                        ? aSortKey - bSortKey
                        : bSortKey - aSortKey;
                }

                const leftText = (aSortKey ?? "").toString();
                const rightText = (bSortKey ?? "").toString();
                const textComparison = textSortCollator.compare(leftText, rightText);

                return step.direction === "asc" ? textComparison : -textComparison;
            });

            continue;
        }

        if (step.type === "unique") {
            hasOrderingStep = true;
            const perUniqueCounts = {};
            const uniqueTracks = [];

            for (const track of currentTracks) {
                const uniqueValue = getEquationFieldValue(track, step.field, equationContext);
                const uniqueKey = createEquationUniqueKey(uniqueValue);
                const countForKey = perUniqueCounts[uniqueKey] || 0;
                if (countForKey >= step.maxPerUnique) {
                    continue;
                }

                perUniqueCounts[uniqueKey] = countForKey + 1;
                uniqueTracks.push({
                    ...track,
                    equationPipelineUniqueField: step.field,
                    equationPipelineUniqueValue: uniqueValue,
                    equationPipelineUniqueLimit: step.maxPerUnique
                });
            }

            currentTracks = uniqueTracks;
            continue;
        }

        if (step.type === "show") {
            currentTracks = currentTracks.map(track => {
                const existingShowFields = Array.isArray(track.equationPipelineShowFields)
                    ? track.equationPipelineShowFields
                    : [];
                if (existingShowFields.includes(step.field)) {
                    return track;
                }

                return {
                    ...track,
                    equationPipelineShowFields: [...existingShowFields, step.field]
                };
            });
        }
    }

    return {
        usedPipeline: true,
        hasOrderingStep,
        tracks: currentTracks
    };
}

function insertAtCursor(textarea, text) {
    if (!textarea) return;

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);

    const caret = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function getEquationInsertTargetInput() {
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.id === "equations" || activeElement.id === "equations-right")) {
        if (activeElement.id === "equations-right" && !isComparisonEnabled()) {
            const leftFallback = document.getElementById("equations");
            if (leftFallback) return leftFallback;
        }
        lastEquationInsertTargetId = activeElement.id;
        return activeElement;
    }

    const rememberedTarget = document.getElementById(lastEquationInsertTargetId);
    if (rememberedTarget) {
        if (rememberedTarget.id === "equations-right" && !isComparisonEnabled()) {
            const leftFallback = document.getElementById("equations");
            if (leftFallback) return leftFallback;
        }
        return rememberedTarget;
    }

    return document.getElementById("equations");
}

function getControlLabelText(control) {
    if (!control?.id) return "";

    const directLabel = document.querySelector(`label[for="${control.id}"]`);
    if (directLabel) {
        return directLabel.textContent.replace(/\s+/g, " ").trim();
    }

    const inputPair = control.closest(".input-pair");
    if (inputPair) {
        const groupLabel = inputPair.parentElement?.querySelector("label");
        if (groupLabel) {
            return groupLabel.textContent.replace(/\s+/g, " ").trim();
        }
    }

    return "";
}

function buildStreamlinedTooltip(control) {
    const labelText = getControlLabelText(control);
    const base = labelText || control.name || control.id || "Filter";
    const cleanBase = base.replace(/\s*:\s*$/, "").trim();
    const placeholder = (control.getAttribute("placeholder") || "").trim();
    if (placeholder) {
        return `${cleanBase}. Example: ${placeholder}`;
    }
    return cleanBase;
}

function applyStreamlinedFilterTooltips() {
    document.querySelectorAll("#filters-section input, #filters-section select, #filters-section textarea").forEach(control => {
        if (!control || !control.id) return;
        if (control.type === "hidden") return;
        control.title = buildStreamlinedTooltip(control);
    });

    const equationsLeft = document.getElementById("equations");
    if (equationsLeft) {
        equationsLeft.title = "Left equations pipeline. Use ; to separate commands.";
    }

    const equationsRight = document.getElementById("equations-right");
    if (equationsRight) {
        equationsRight.title = "Right equations pipeline for comparison mode.";
    }
}

function renderEquationTagButtons() {
    const commandContainer = document.getElementById("equation-command-tags");
    const fieldContainer = document.getElementById("equation-field-tags");
    const operatorContainer = document.getElementById("equation-operator-tags");
    const equationsInput = document.getElementById("equations");

    if (!fieldContainer || !operatorContainer || !equationsInput) return;

    if (commandContainer) {
        commandContainer.innerHTML = "";
        equationCommands.forEach(command => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "equation-tag";
            button.textContent = command.label;
            button.title = command.description;
            button.addEventListener("click", () => insertAtCursor(getEquationInsertTargetInput(), command.label));
            commandContainer.appendChild(button);
        });
    }

    fieldContainer.innerHTML = "";
    operatorContainer.innerHTML = "";

    Object.keys(equationFieldResolvers).forEach(fieldName => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "equation-tag";
        button.textContent = fieldName;
        button.title = `Field: ${formatEquationFieldLabel(fieldName)}`;
        button.addEventListener("click", () => insertAtCursor(getEquationInsertTargetInput(), fieldName));
        fieldContainer.appendChild(button);
    });

    equationOperatorTokens.forEach(operatorToken => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "equation-tag";
        const normalizedOperator = operatorToken.trim() || operatorToken;
        button.textContent = normalizedOperator;
        button.title = `Operator: ${equationOperatorDescriptions[normalizedOperator] || normalizedOperator}`;
        button.addEventListener("click", () => insertAtCursor(getEquationInsertTargetInput(), operatorToken));
        operatorContainer.appendChild(button);
    });
}

function initializeEquationControls() {
    renderEquationTagButtons();
    applyStreamlinedFilterTooltips();

    ["equations", "equations-right"]
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .forEach(input => {
            ["focus", "click", "keyup", "input", "select"].forEach(eventName => {
                input.addEventListener(eventName, () => {
                    lastEquationInsertTargetId = input.id;
                });
            });
        });
}

function addFilter(id, value) {
    if (value.trim() === "") {
        removeFilter(id);
        return;
    }
    const existingFilter = activeFilters.find(filter => filter.id === id);
    if (existingFilter) {
        existingFilter.value = value;
    } else {
        activeFilters.push({ id, value });
    }
}

function removeFilter(id) {
    const index = activeFilters.findIndex(filter => filter.id === id);
    if (index !== -1) {
        activeFilters.splice(index, 1);
    }
}

function isComparisonEnabled() {
    return document.getElementById("comparison-toggle")?.dataset.active === "true";
}

function getComparisonEditTarget() {
    const value = (document.getElementById("comparison-edit-target")?.value || "left").toLowerCase();
    return value === "right" ? "right" : "left";
}

function updateComparisonInteractionState() {
    const comparisonEnabled = isComparisonEnabled();
    const comparisonEditTarget = document.getElementById("comparison-edit-target");
    const rightEquationsInput = document.getElementById("equations-right");

    if (comparisonEditTarget) {
        comparisonEditTarget.disabled = !comparisonEnabled;
        comparisonEditTarget.setAttribute("aria-disabled", comparisonEnabled ? "false" : "true");
    }

    if (rightEquationsInput) {
        rightEquationsInput.disabled = !comparisonEnabled;
        rightEquationsInput.setAttribute("aria-disabled", comparisonEnabled ? "false" : "true");
    }

    if (!comparisonEnabled && lastEquationInsertTargetId === "equations-right") {
        lastEquationInsertTargetId = "equations";
    }
}

function getManagedFilterElements() {
    return Array.from(document.querySelectorAll("#filters-section .filters input, #filters-section .filters select, #filters-section .filters textarea"))
    .filter(element => element.id && element.id !== "comparison-edit-target" && element.id !== "equations" && element.id !== "equations-right" && !GLOBAL_BASE_SETTING_IDS.has(element.id));
}

function readCurrentFilterInputState() {
    const state = {};
    getManagedFilterElements().forEach(element => {
        const value = serializeControlValue(element);
        state[element.id] = value;
    });
    return state;
}

function applyFilterInputState(state) {
    const safeState = state || {};
    getManagedFilterElements().forEach(element => {
        const value = safeState[element.id] ?? "";
        applySerializedControlValue(element, value);
    });

    const leftEquationsInput = document.getElementById("equations");
    if (leftEquationsInput) {
        leftEquationsInput.value = (comparisonFilterStates.left?.equations ?? "").toString();
    }

    const rightEquationsInput = document.getElementById("equations-right");
    if (rightEquationsInput) {
        rightEquationsInput.value = (comparisonFilterStates.right?.equations ?? "").toString();
    }
}

function convertStateToFilterArray(state) {
    return Object.entries(state || {})
        .filter(([, value]) => (value ?? "").toString().trim() !== "")
        .map(([id, value]) => ({ id, value: value.toString() }));
}

function applyTracksPerEntityFilter(tracks, maxArtist) {

    // To track how many tracks we have included from each album and artist
    let artistCount = {};

    // Result list for the filtered tracks
    let filteredTracks = [];

    // Loop through the sorted tracks
    for (let track of tracks) {
        let artist = track.Artist;

        // Check if we've already added a track from this album or artist
        if (maxArtist && artistCount[artist] >= maxArtist) {
            continue; // Skip if the album or artist has reached its limit
        }

        // Add the track to the result list
        filteredTracks.push(track);

        // Increment the counts for the album and artist
        artistCount[artist] = (artistCount[artist] || 0) + 1;
    }

    return filteredTracks;
}

function filterTracks(filtersOverride = null, sourceTracks = null) {
    const tracksSource = sourceTracks || allTracks;
    if (!tracksSource) return [];

    const filterFunctions = {

        // Filters based on name or title

        "artist-initial": (item, value) => item.Artist[0].toLowerCase() === value.toLowerCase(),
        "album-initial": (item, value) => item.Album[0].toLowerCase() === value.toLowerCase(),
        "track-initial": (item, value) => item.Track[0].toLowerCase() === value.toLowerCase(),

        "artist-name": (item, value) => item.Artist.toLowerCase() === value.toLowerCase(),
        "album-name": (item, value) => item.Album.toLowerCase() === value.toLowerCase(),
        "track-name": (item, value) => item.Track.toLowerCase() === value.toLowerCase(),

        "artist-includes": (item, value) => matchFilter(value, item.Artist),
        "artist-excludes": (item, value) => matchExclude(value, item.Artist),
        "album-includes": (item, value) => matchFilter(value, item.Album),
        "album-excludes": (item, value) => matchExclude(value, item.Album),
        "track-includes": (item, value) => matchFilter(value, item.Track),
        "track-excludes": (item, value) => matchExclude(value, item.Track),

        "artist-name-length-min": (item, value) => item.Artist.length >= parseInt(value, 10),
        "artist-name-length-max": (item, value) => item.Artist.length <= parseInt(value, 10),
        "album-name-length-min": (item, value) => item.Album.length >= parseInt(value, 10),
        "album-name-length-max": (item, value) => item.Album.length <= parseInt(value, 10),
        "track-name-length-min": (item, value) => item.Track.length >= parseInt(value, 10),
        "track-name-length-max": (item, value) => item.Track.length <= parseInt(value, 10),
       
        "artist-word-count-min": (item, value) => item.Artist.split(/\s+/).length >= parseInt(value, 10),
        "artist-word-count-max": (item, value) => item.Artist.split(/\s+/).length <= parseInt(value, 10),
        "album-word-count-min": (item, value) => item.Album.split(/\s+/).length >= parseInt(value, 10),
        "album-word-count-max": (item, value) => item.Album.split(/\s+/).length <= parseInt(value, 10),
        "track-word-count-min": (item, value) => item.Track.split(/\s+/).length >= parseInt(value, 10),
        "track-word-count-max": (item, value) => item.Track.split(/\s+/).length <= parseInt(value, 10),

        // Filters based on user data

        "artist-scrobble-count-min": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles >= parseInt(value, 10),
        "artist-scrobble-count-max": (item, value) =>
            artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles <= parseInt(value, 10),
        "album-scrobble-count-min": (item, value) =>
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles >= parseInt(value, 10),
        "album-scrobble-count-max": (item, value) =>
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles <= parseInt(value, 10),
        "track-scrobble-count-min": (item, value) =>
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles >= parseInt(value, 10),
        "track-scrobble-count-max": (item, value) =>
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles <= parseInt(value, 10),
        
        "artist-rank-min": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.rank >= parseInt(value, 10),

        "artist-rank-max": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.rank <= parseInt(value, 10),

        "album-rank-min": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank >= parseInt(value, 10),

        "album-rank-max": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank <= parseInt(value, 10),

        "track-rank-min": (item, value) => 
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank >= parseInt(value, 10),

        "track-rank-max": (item, value) => 
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank <= parseInt(value, 10),

        "artist-track-count-min": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.track_count >= parseInt(value, 10),

        "artist-track-count-max": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.track_count <= parseInt(value, 10),

        "album-track-count-min": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count >= parseInt(value, 10),

        "album-track-count-max": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count <= parseInt(value, 10),

        "artist-first-scrobble-years": (item, value) => {
            const firstYear = artistDataMap[item.Artist.toLowerCase()]?.firstscrobble 
                ? new Date(parseInt(artistDataMap[item.Artist.toLowerCase()].firstscrobble, 10)).getFullYear() 
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "album-first-scrobble-years": (item, value) => {
            const firstYear = albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble
                ? new Date(parseInt(albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`].firstscrobble, 10)).getFullYear()
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "track-first-scrobble-years": (item, value) => {
            const firstYear = trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble
                ? new Date(parseInt(trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`].firstscrobble, 10)).getFullYear()
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "artist-days-since-last-min": (item, value) => {
            // Look up the artist's last scrobble timestamp from artistDataMap
            const lastScrobble = artistDataMap[item.Artist.toLowerCase()]?.lastscrobble;
            if (!lastScrobble) return false;
            // Calculate days since last scrobble
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince >= parseInt(value, 10);
        },
        "artist-days-since-last-max": (item, value) => {
            const lastScrobble = artistDataMap[item.Artist.toLowerCase()]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince <= parseInt(value, 10);
        },
        "album-days-since-last-min": (item, value) => {
            // Construct the album key: "album||artist"
            const albumKey = `${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = albumDataMap[albumKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince >= parseInt(value, 10);
        },
        "album-days-since-last-max": (item, value) => {
            const albumKey = `${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = albumDataMap[albumKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince <= parseInt(value, 10);
        },
        "track-days-since-last-min": (item, value) => {
            // Construct the track key: "track||artist"
            const trackKey = `${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = trackDataMap[trackKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince >= parseInt(value, 10);
        },
        "track-days-since-last-max": (item, value) => {
            const trackKey = `${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`;
            const lastScrobble = trackDataMap[trackKey]?.lastscrobble;
            if (!lastScrobble) return false;
            const daysSince = Math.floor((Date.now() - lastScrobble) / (1000 * 60 * 60 * 24));
            return daysSince <= parseInt(value, 10);
        },

        // Filters based on detailed data

        "artist-listeners-min": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.listeners >= parseInt(value, 10),
        "artist-listeners-max": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.listeners <= parseInt(value, 10),
        "artist-global-scrobbles-min": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.playcount >= parseInt(value, 10),
        "artist-global-scrobbles-max": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.playcount <= parseInt(value, 10),
    
        "album-listeners-min": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners >= parseInt(value, 10),
        "album-listeners-max": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners <= parseInt(value, 10),
        "album-global-scrobbles-min": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount >= parseInt(value, 10),
        "album-global-scrobbles-max": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount <= parseInt(value, 10),
    
        "track-listeners-min": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners >= parseInt(value, 10),
        "track-listeners-max": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners <= parseInt(value, 10),
        "track-global-scrobbles-min": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount >= parseInt(value, 10),
        "track-global-scrobbles-max": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount <= parseInt(value, 10),
    
        "track-duration-min": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration / 1000 >= parseInt(value, 10),
        "track-duration-max": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration / 1000 <= parseInt(value, 10),

        "artist-tags": (item, value) => {
            const detailedArtist = artistDataMap[item.Artist.toLowerCase()];
            if (!detailedArtist) return false;  // or true if you want to ignore missing details
            return matchFilter(value, detailedArtist.tags || []);
            },

        // Time-based filters

        "year": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedYears = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            const date = new Date(parseInt(item.Date, 10));
            return selectedYears.length === 0 || selectedYears.includes(date.getFullYear());
        },
    
        "month": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedMonths = parseSerializedNumberList(value);
            const month = new Date(parseInt(item.Date, 10)).getMonth() + 1;
            return selectedMonths.length === 0 || selectedMonths.includes(month);
        },
    
        "day-of-month": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedDays = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            const day = new Date(parseInt(item.Date, 10)).getDate();
            return selectedDays.length === 0 || selectedDays.includes(day);
        },
    
        "weekday": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedWeekdays = parseSerializedNumberList(value);
            const weekday = new Date(parseInt(item.Date, 10)).getDay();
            return selectedWeekdays.length === 0 || selectedWeekdays.includes(weekday);
        },

        "time-of-day-start": (item, value) => {
            const endValue = document.getElementById("time-of-day-end")?.value || "";
            return isWithinTimeRange(item.Date, value, endValue);
        },

        "time-of-day-end": (item, value) => {
            const startValue = document.getElementById("time-of-day-start")?.value || "";
            return isWithinTimeRange(item.Date, startValue, value);
        },

        "session-starter-only": (item, value) => {
            if (value !== "use-gap") return true;
            const previousTimestamp = previousScrobbleTimestampByOrder[item.order];
            if (previousTimestamp === null || previousTimestamp === undefined) return true;
            const configuredGap = parseFloat(document.getElementById("day-starter-gap-hours")?.value);
            const gapHours = isNaN(configuredGap) ? 6 : configuredGap;
            const minGapMs = gapHours * 60 * 60 * 1000;
            return parseInt(item.Date, 10) - previousTimestamp >= minGapMs;
        },

        "day-starter-only": (item, value) => {
            if (!value) return true;

            const isDayStarter = isFirstScrobbleOfDayByOrder[item.order] === true;
            const previousTimestamp = previousScrobbleTimestampByOrder[item.order];
            const configuredGap = parseFloat(document.getElementById("day-starter-gap-hours")?.value);
            const gapHours = isNaN(configuredGap) ? 6 : configuredGap;
            const minGapMs = gapHours * 60 * 60 * 1000;
            const hasLongGap = previousTimestamp === null || previousTimestamp === undefined
                ? true
                : (parseInt(item.Date, 10) - previousTimestamp >= minGapMs);

            if (value === "first-day-literal") {
                return isDayStarter;
            }

            if (value === "first-day-smart") {
                return isDayStarter && hasLongGap;
            }

            return true;
        },

        "last-n-days": (item, value) => {
            const now = Date.now();
            return now - parseInt(item.Date) <= value * 86400000;
        },

        "date-range-start": (item, value) => {
            const startTime = new Date(value).getTime();
            return item.Date >= startTime;
        },
        "date-range-end": (item, value) => {
            const endTime = new Date(value).getTime() + 86400000; // Include the whole day
            return item.Date < endTime;
        },

        "scrobble-order-from": (item, value) => item.order >= parseInt(value, 10),
        "scrobble-order-to": (item, value) => item.order <= parseInt(value, 10)
    };

    const effectiveFilters = Array.isArray(filtersOverride) ? filtersOverride : activeFilters;

    const activePredicates = effectiveFilters
        .filter(filter => filterFunctions[filter.id])
        .map(filter => ({
            predicate: filterFunctions[filter.id],
            value: filter.value
        }));

    if (activePredicates.length === 0) {
        if (!filtersOverride && !sourceTracks) {
            filteredData = tracksSource;
        }
        return [...tracksSource];
    }

    const result = tracksSource.filter((item) => {
        for (let i = 0; i < activePredicates.length; i++) {
            const { predicate, value } = activePredicates[i];
            if (!predicate(item, value)) {
                return false;
            }
        }
        return true;
    });

    if (!filtersOverride && !sourceTracks) {
        filteredData = result;
    }

    return result;
}

function buildEntitiesFromTracks(sourceTracks, entityType, sortingBasis, xValue) {
    let entities = [...sourceTracks];

    if (entityType === 'scrobble') {
        entities.sort((a, b) => {
            const aDate = parseInt(a.Date, 10) || 0;
            const bDate = parseInt(b.Date, 10) || 0;
            if (sortingBasis === SCROBBLE_SORT_DESC) {
                return bDate - aDate;
            }
            return aDate - bDate;
        });
        return entities;
    }

    if (sortingBasis === 'scrobbles') {
        if (entityType === 'track') {
            const trackGroups = {};
            entities.forEach(track => {
                const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
                if (!trackGroups[key]) {
                    trackGroups[key] = { ...track, count: 0, albumCounts: {} };
                }
                trackGroups[key].count++;
                const albumName = track.Album;
                if (!trackGroups[key].albumCounts[albumName]) {
                    trackGroups[key].albumCounts[albumName] = 0;
                }
                trackGroups[key].albumCounts[albumName]++;
            });
            entities = Object.values(trackGroups);
        } else if (entityType === 'album') {
            const albumGroups = {};
            entities.forEach(track => {
                const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
                if (!albumGroups[key]) {
                    albumGroups[key] = { name: track.Album, artist: track.Artist, count: 0, tracks: [] };
                }
                albumGroups[key].count++;
                albumGroups[key].tracks.push(track);
            });
            entities = Object.values(albumGroups);
        } else if (entityType === 'artist') {
            const artistGroups = {};
            entities.forEach(track => {
                const key = track.Artist.toLowerCase();
                if (!artistGroups[key]) {
                    artistGroups[key] = { name: track.Artist, count: 0, tracks: [] };
                }
                artistGroups[key].count++;
                artistGroups[key].tracks.push(track);
            });
            entities = Object.values(artistGroups);
        }
        entities.sort((a, b) => (b.count || 0) - (a.count || 0));
    } else if (sortingBasis === 'separate-days') {
        entities = calculateSeparateScrobbles(entities, 'day', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'separate-weeks') {
        entities = calculateSeparateScrobbles(entities, 'week', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'separate-months') {
        entities = calculateSeparateScrobbles(entities, 'month', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'max-single-day') {
        entities = calculateMaxScrobblesInSinglePeriod(entities, 'day', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'max-single-week') {
        entities = calculateMaxScrobblesInSinglePeriod(entities, 'week', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'max-single-month') {
        entities = calculateMaxScrobblesInSinglePeriod(entities, 'month', entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (isRollingWindowSortingBasis(sortingBasis)) {
        const rollingWindowHours = getRollingWindowHoursForSortingBasis(sortingBasis, xValue);
        entities = calculateMaxScrobblesInRollingWindow(entities, rollingWindowHours || 24, entityType);
        entities.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'consecutive-scrobbles') {
        entities = calculateConsecutiveScrobbles(entities, entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-days') {
        entities = calculateConsecutivePeriods(entities, 'day', entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-weeks') {
        entities = calculateConsecutivePeriods(entities, 'week', entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-months') {
        entities = calculateConsecutivePeriods(entities, 'month', entityType);
        entities.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'highest-listening-percentage') {
        entities = calculateListeningPercentage(entities, entityType);
        entities.sort((a, b) => b.listeningPercentage - a.listeningPercentage);
    } else if (sortingBasis === 'time-spent-listening') {
        entities = calculateListeningDuration(entities, entityType);
        entities.sort((a, b) => b.listeningDuration - a.listeningDuration);
    } else if (sortingBasis === "first-n-scrobbles") {
        entities = calculateFirstToXScrobbles(entities, xValue, entityType);
        entities.sort((a, b) => (a.dateReached || 0) - (b.dateReached || 0));
    } else if (sortingBasis === "fastest-n-scrobbles") {
        entities = calculateFastestToXScrobbles(entities, xValue, entityType);
        entities.sort((a, b) => a.timeNeeded - b.timeNeeded);
    } else if (sortingBasis === "oldest-average-listening-time") {
        entities = calculateAverageListeningTime(entities, entityType, xValue);
        entities.sort((a, b) => a.averageListeningTimestamp - b.averageListeningTimestamp);
    } else if (sortingBasis === "newest-average-listening-time") {
        entities = calculateAverageListeningTime(entities, entityType, xValue);
        entities.sort((a, b) => b.averageListeningTimestamp - a.averageListeningTimestamp);
    }

    return entities;
}

function renderEntitiesToContainer(entities, entityType, targetDiv, sortingBasis) {
    if (entityType === "track") {
        displayTopTracks(entities, targetDiv, sortingBasis);
    } else if (entityType === "album") {
        displayTopAlbums(entities, targetDiv, sortingBasis);
    } else if (entityType === "artist") {
        displayTopArtists(entities, targetDiv, sortingBasis);
    } else if (entityType === "scrobble") {
        displayScrobbles(entities, targetDiv, sortingBasis === SCROBBLE_SORT_DESC ? "desc" : "asc");
    }
}

function normalizeEntitySorting(entityType, sortingBasis) {
    let normalizedEntityType = (entityType || "track").toLowerCase();
    let normalizedSortingBasis = sortingBasis || "scrobbles";

    const isScrobbleSort = normalizedSortingBasis === SCROBBLE_SORT_ASC || normalizedSortingBasis === SCROBBLE_SORT_DESC;

    if (normalizedEntityType !== "scrobble" && isScrobbleSort) {
        normalizedSortingBasis = "scrobbles";
    }

    if (normalizedEntityType === "scrobble" && !isScrobbleSort) {
        normalizedSortingBasis = SCROBBLE_SORT_ASC;
    }

    return {
        entityType: normalizedEntityType,
        sortingBasis: normalizedSortingBasis
    };
}

function dedupeOrderedTrackEntities(tracks) {
    const entitiesByKey = new Map();

    tracks.forEach(track => {
        const key = `${track.Artist?.toLowerCase() || ""} - ${track.Track?.toLowerCase() || ""}`;
        if (!key || key === " - ") return;

        if (!entitiesByKey.has(key)) {
            entitiesByKey.set(key, {
                ...track,
                count: 0,
                albumCounts: {}
            });
        }

        const entity = entitiesByKey.get(key);
        entity.count += 1;
        const albumName = track.Album || "Unknown";
        entity.albumCounts[albumName] = (entity.albumCounts[albumName] || 0) + 1;
    });

    return Array.from(entitiesByKey.values());
}

function resolveDisplayEntities(pipelineResult, entityType, sortingBasis, xValue, maxPerArtist) {
    let entities;
    if (pipelineResult.hasOrderingStep && entityType === "track") {
        const dedupedOrderedTracks = dedupeOrderedTrackEntities(pipelineResult.tracks);
        entities = applyTracksPerEntityFilter(dedupedOrderedTracks, maxPerArtist);
    } else {
        entities = buildEntitiesFromTracks(pipelineResult.tracks, entityType, sortingBasis, xValue);
        if (entityType === "track") {
            entities = applyTracksPerEntityFilter(entities, maxPerArtist);
        }
    }

    return entities;
}

function getSelectedDisplayMode() {
    const mode = (document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST).toLowerCase();
    if ([DISPLAY_MODE_LIST, DISPLAY_MODE_BAR_CHART, DISPLAY_MODE_BAR_RACE].includes(mode)) {
        return mode;
    }
    return DISPLAY_MODE_LIST;
}

function updateRaceControlsVisibility() {
    const chartControls = document.getElementById("chart-controls");
    const raceControls = document.getElementById("race-controls");
    const mode = getSelectedDisplayMode();
    const isChartMode = mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE;
    const isRaceMode = mode === DISPLAY_MODE_BAR_RACE;

    if (chartControls) {
        chartControls.style.display = isChartMode ? "block" : "none";
        chartControls.setAttribute("aria-hidden", isChartMode ? "false" : "true");
    }

    if (raceControls) {
        raceControls.style.display = isRaceMode ? "block" : "none";
        raceControls.setAttribute("aria-hidden", isRaceMode ? "false" : "true");
    }
}

function stopRacePlayback() {
    if (racePlaybackTimerId !== null) {
        clearInterval(racePlaybackTimerId);
        racePlaybackTimerId = null;
    }
}

function getRacePlaybackSpeedFromInput() {
    return Math.max(50, parseInt(document.getElementById("race-speed-ms")?.value, 10) || racePlaybackSpeedMs || 260);
}

function syncRacePlaybackSpeedFromInput() {
    racePlaybackSpeedMs = getRacePlaybackSpeedFromInput();
    if (raceSpeedReadoutElement) {
        raceSpeedReadoutElement.textContent = `${racePlaybackSpeedMs}ms/frame`;
    }
}

function startRacePlayback() {
    if (!activeRaceState || activeRaceState.totalFrames <= 1 || typeof activeRaceState.updateFrame !== "function") {
        return;
    }

    stopRacePlayback();
    syncRacePlaybackSpeedFromInput();
    racePlaybackTimerId = setInterval(() => {
        if (!activeRaceState || typeof activeRaceState.updateFrame !== "function") {
            stopRacePlayback();
            return;
        }

        const nextIndex = activeRaceState.frameIndex + 1;
        if (nextIndex >= activeRaceState.totalFrames) {
            stopRacePlayback();
            return;
        }

        activeRaceState.updateFrame(nextIndex);
    }, racePlaybackSpeedMs);
}

function jumpToRaceFrame(target) {
    if (!activeRaceState || typeof activeRaceState.updateFrame !== "function") return;
    if (target === "first") {
        activeRaceState.updateFrame(0);
        return;
    }
    if (target === "last") {
        activeRaceState.updateFrame(Math.max(0, activeRaceState.totalFrames - 1));
    }
}

function adjustRacePlaybackSpeed(multiplier) {
    const current = getRacePlaybackSpeedFromInput();
    const next = Math.max(50, Math.min(5000, Math.round(current * multiplier)));
    const speedInput = document.getElementById("race-speed-ms");
    if (speedInput) {
        speedInput.value = String(next);
    }
    syncRacePlaybackSpeedFromInput();

    if (racePlaybackTimerId !== null) {
        const currentFrame = activeRaceState?.frameIndex || 0;
        stopRacePlayback();
        if (activeRaceState) {
            activeRaceState.updateFrame(currentFrame);
            racePlaybackTimerId = setInterval(() => {
                if (!activeRaceState || typeof activeRaceState.updateFrame !== "function") {
                    stopRacePlayback();
                    return;
                }
                const nextIndex = activeRaceState.frameIndex + 1;
                if (nextIndex >= activeRaceState.totalFrames) {
                    stopRacePlayback();
                    return;
                }
                activeRaceState.updateFrame(nextIndex);
            }, racePlaybackSpeedMs);
        }
    }
}

function insertRacePlaybackToolbar(targetDiv) {
    if (!targetDiv) return;

    const toolbar = document.createElement("div");
    toolbar.className = "race-playback-toolbar";
    raceSpeedReadoutElement = null;

    const buttonConfigs = [
        { label: "⏮", title: "First frame", onClick: () => jumpToRaceFrame("first") },
        { label: "▶", title: "Play", onClick: () => startRacePlayback() },
        { label: "⏸", title: "Pause", onClick: () => stopRacePlayback() },
        { label: "⏭", title: "Last frame", onClick: () => jumpToRaceFrame("last") },
        { label: "⏪", title: "Slower", onClick: () => adjustRacePlaybackSpeed(1.25) },
        { label: "⏩", title: "Faster", onClick: () => adjustRacePlaybackSpeed(0.8) }
    ];

    buttonConfigs.forEach(config => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = config.label;
        button.title = config.title;
        button.setAttribute("aria-label", config.title);
        button.addEventListener("click", config.onClick);
        toolbar.appendChild(button);
    });

    const speedReadout = document.createElement("span");
    speedReadout.className = "race-speed-readout";
    speedReadout.textContent = `${getRacePlaybackSpeedFromInput()}ms/frame`;
    toolbar.appendChild(speedReadout);
    raceSpeedReadoutElement = speedReadout;

    targetDiv.appendChild(toolbar);
}

function destroyVisualizationState() {
    stopRacePlayback();
    chartInstances.forEach(chart => {
        try {
            chart.destroy();
        } catch {
            // Ignore stale chart instance errors
        }
    });
    chartInstances = [];
    activeRaceState = null;
}

function getSelectedChartOrientation() {
    const orientation = (document.getElementById("chart-axis")?.value || "horizontal").toLowerCase();
    return orientation === "vertical" ? "vertical" : "horizontal";
}

function getSelectedChartScale() {
    const scale = (document.getElementById("chart-scale")?.value || "linear").toLowerCase();
    return scale === "logarithmic" ? "logarithmic" : "linear";
}

function getListLengthLimit() {
    return Math.max(1, parseInt(document.getElementById("list-length")?.value, 10) || 10);
}

function escapeHTML(str) {
    if (typeof str !== "string") return str;
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getEntityLabel(entity, entityType) {
    if (!entity) return "Unknown";
    if (entityType === "track") {
        return `${entity.Artist || "Unknown Artist"} - ${entity.Track || "Unknown Track"}`;
    }
    if (entityType === "album") {
        return `${entity.artist || "Unknown Artist"} - ${entity.name || "Unknown Album"}`;
    }
    if (entityType === "artist") {
        return entity.name || "Unknown Artist";
    }
    const scrobbleDate = entity.Date ? new Date(parseInt(entity.Date, 10)).toLocaleString() : "Unknown time";
    return `${entity.Artist || "Unknown Artist"} - ${entity.Track || "Unknown Track"} (${scrobbleDate})`;
}

function getEntityMetricValue(entity, sortingBasis) {
    if (!entity) return 0;

    if (["scrobbles", "separate-days", "separate-weeks", "separate-months", "max-single-day", "max-single-week", "max-single-month"].includes(sortingBasis)
        || isRollingWindowSortingBasis(sortingBasis)) {
        return Number(entity.count || 0);
    }

    if (["consecutive-scrobbles", "consecutive-days", "consecutive-weeks", "consecutive-months"].includes(sortingBasis)) {
        return Number(entity.maxConsecutive || 0);
    }

    if (sortingBasis === "highest-listening-percentage") {
        return Number(entity.listeningPercentage || 0);
    }

    if (sortingBasis === "time-spent-listening") {
        return Number(entity.listeningDuration || 0);
    }

    if (sortingBasis === "first-n-scrobbles") {
        return Number(entity.dateReached || 0);
    }

    if (sortingBasis === "fastest-n-scrobbles") {
        return Number(entity.timeNeeded || 0);
    }

    if (sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") {
        return Number(entity.averageListeningTimestamp || 0);
    }

    if (sortingBasis === SCROBBLE_SORT_ASC || sortingBasis === SCROBBLE_SORT_DESC) {
        return Number(entity.Date || 0);
    }

    return Number(entity.count || 0);
}

function getChartMetricLabel(sortingBasis) {
    if (sortingBasis === "highest-listening-percentage") return "Percentage";
    if (sortingBasis === "time-spent-listening") return "Listening Time";
    if (sortingBasis === "first-n-scrobbles") return "Date Reached";
    if (sortingBasis === "fastest-n-scrobbles") return "Time Needed";
    if (sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") return "Average Listening Date";
    if (isRollingWindowSortingBasis(sortingBasis)) return "Scrobbles";
    return "Value";
}

function wrapChartLabel(label, maxLineLength = 25) {
    const text = (label ?? "").toString();
    if (text.length <= maxLineLength) return text;

    const lines = [];
    let currentLine = "";
    const words = text.split(" ");
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        
        if (currentLine.length + word.length + 1 <= maxLineLength) {
            currentLine += (currentLine.length === 0 ? "" : " ") + word;
        } else {
            if (currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = "";
            }
            
            if (word.length > maxLineLength) {
                let chunkedWord = word;
                while (chunkedWord.length > maxLineLength) {
                    lines.push(chunkedWord.slice(0, maxLineLength));
                    chunkedWord = chunkedWord.slice(maxLineLength);
                }
                currentLine = chunkedWord;
            } else {
                currentLine = word;
            }
        }
    }
    
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    
    return lines;
}

function formatMetricTickValue(value, sortingBasis) {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return "0";

    if (sortingBasis === "time-spent-listening" || sortingBasis === "fastest-n-scrobbles") {
        return formatDuration(numericValue) || "0 minutes";
    }

    if (sortingBasis === "first-n-scrobbles" || sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") {
        if (numericValue <= 0) return "";
        return new Date(numericValue).toISOString().slice(0, 10);
    }

    if (sortingBasis === "highest-listening-percentage") {
        return `${numericValue.toFixed(1)}%`;
    }

    return String(Math.round(numericValue));
}

function formatMetricTooltipValue(value, sortingBasis) {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return "0";

    if (sortingBasis === "time-spent-listening" || sortingBasis === "fastest-n-scrobbles") {
        return formatDuration(numericValue) || "0 minutes";
    }

    if (sortingBasis === "first-n-scrobbles" || sortingBasis === "oldest-average-listening-time" || sortingBasis === "newest-average-listening-time") {
        if (numericValue <= 0) return "N/A";
        return new Date(numericValue).toISOString().slice(0, 10);
    }

    if (sortingBasis === "highest-listening-percentage") {
        return `${numericValue.toFixed(2)}%`;
    }

    return String(Math.round(numericValue));
}

function parseHexToRgba(colorValue, alpha) {
    const color = (colorValue || "").trim();
    if (!color.startsWith("#")) {
        return color || `rgba(216, 144, 109, ${alpha})`;
    }

    const hex = color.slice(1);
    if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    return color;
}

function getChartThemeColors() {
    const bodyStyles = getComputedStyle(document.body);
    const rootStyles = getComputedStyle(document.documentElement);

    // Try body first, then root, then fallback
    const accent = bodyStyles.getPropertyValue("--primary-accent-color").trim() 
                || rootStyles.getPropertyValue("--primary-accent-color").trim() 
                || "#D8906D";
                
    const text = bodyStyles.getPropertyValue("--primary-text-color").trim() 
              || rootStyles.getPropertyValue("--primary-text-color").trim() 
              || "#3B2F24";

    return {
        accent,
        accentFill: parseHexToRgba(accent, 0.75),
        text
    };
}

function isDateMetricSorting(sortingBasis) {
    return sortingBasis === "first-n-scrobbles"
        || sortingBasis === "oldest-average-listening-time"
        || sortingBasis === "newest-average-listening-time";
}

function createBarChartInCanvas(canvas, labels, values, sortingBasis, chartTitle = "") {
    if (!canvas || typeof Chart === "undefined") return null;

    const orientation = getSelectedChartOrientation();
    const chartScale = getSelectedChartScale();
    const dateMetric = isDateMetricSorting(sortingBasis);
    const resolvedScale = dateMetric && chartScale === "logarithmic" ? "linear" : chartScale;
    const indexAxis = orientation === "vertical" ? "x" : "y";
    const valueAxisKey = orientation === "vertical" ? "y" : "x";
    const labelAxisKey = orientation === "vertical" ? "x" : "y";
    const chartColors = getChartThemeColors();
    const dataValues = resolvedScale === "logarithmic"
        ? (values || []).map(value => Math.max(1, Number(value) || 0))
        : values;

    const numericValues = (dataValues || []).map(value => Number(value)).filter(value => Number.isFinite(value));
    const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
    const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
    const datePadding = dateMetric ? Math.max(24 * 60 * 60 * 1000, Math.round((maxValue - minValue) * 0.03)) : 0;

    const playbackSpeed = typeof getRacePlaybackSpeedFromInput === "function" ? getRacePlaybackSpeedFromInput() : 260;

    const chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: getChartMetricLabel(sortingBasis),
                data: dataValues,
                backgroundColor: chartColors.accentFill,
                borderColor: chartColors.accent,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis,
            animation: {
                duration: dateMetric ? 0 : Math.max(100, playbackSpeed * 0.8),
                easing: "linear"
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: Boolean(chartTitle),
                    text: chartTitle,
                    color: chartColors.text
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const datasetLabel = context.dataset?.label || "Value";
                            return `${datasetLabel}: ${formatMetricTooltipValue(context.parsed?.[valueAxisKey], sortingBasis)}`;
                        }
                    }
                }
            },
            scales: {
                [valueAxisKey]: {
                    beginAtZero: !dateMetric,
                    type: resolvedScale,
                    min: dateMetric ? (minValue - datePadding) : undefined,
                    max: dateMetric ? (maxValue + datePadding) : undefined,
                    ticks: {
                        color: chartColors.text,
                        callback: (tickValue) => formatMetricTickValue(tickValue, sortingBasis)
                    }
                },
                [labelAxisKey]: {
                    ticks: {
                        color: chartColors.text,
                        callback: function (_tickValue, tickIndex) {
                            const fullLabel = this?.chart?.data?.labels?.[tickIndex];
                            return wrapChartLabel(fullLabel, 25);
                        }
                    }
                }
            }
        }
    });

    chartInstances.push(chart);
    return chart;
}

function renderBarChartEntities(entities, entityType, sortingBasis, targetDiv) {
    const listLength = Math.min(getListLengthLimit(), 100);
    const chartRows = (entities || []).slice(0, listLength);
    targetDiv.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";
    
    const minBarThickness = 30;
    const requiredHeight = Math.max(400, chartRows.length * minBarThickness);
    wrapper.style.height = requiredHeight + "px";

    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    targetDiv.appendChild(wrapper);

    const labels = chartRows.map(entity => getEntityLabel(entity, entityType));
    const values = chartRows.map(entity => getEntityMetricValue(entity, sortingBasis));
    createBarChartInCanvas(canvas, labels, values, sortingBasis, "");
}

function getRacePeriodStartTimestamp(timestamp, frequency) {
    const date = new Date(timestamp);
    if (frequency === "month") {
        return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    }
    if (frequency === "week") {
        const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const weekday = weekStart.getDay();
        const offset = (weekday + 6) % 7;
        weekStart.setDate(weekStart.getDate() - offset);
        weekStart.setHours(0, 0, 0, 0);
        return weekStart.getTime();
    }
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    dayStart.setHours(0, 0, 0, 0);
    return dayStart.getTime();
}

function formatRacePeriodLabel(periodStart, frequency) {
    const date = new Date(periodStart);
    if (frequency === "month") {
        const month = String(date.getMonth() + 1).padStart(2, "0");
        return `${date.getFullYear()}-${month}`;
    }
    if (frequency === "week") {
        const week = String(getWeekNumber(date)).padStart(2, "0");
        return `${date.getFullYear()}-W${week}`;
    }
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function getRaceEntityKeyAndLabel(track, entityType) {
    if (entityType === "album") {
        return {
            key: `${(track.Album || "").toLowerCase()}||${(track.Artist || "").toLowerCase()}`,
            label: `${track.Album || "Unknown Album"} – ${track.Artist || "Unknown Artist"}`
        };
    }
    if (entityType === "artist") {
        return {
            key: (track.Artist || "").toLowerCase(),
            label: track.Artist || "Unknown Artist"
        };
    }
    return {
        key: `${(track.Track || "").toLowerCase()}||${(track.Artist || "").toLowerCase()}`,
        label: `${track.Track || "Unknown Track"} – ${track.Artist || "Unknown Artist"}`
    };
}

function parseRaceBoundaryDate(dateValue, isEndBoundary) {
    if (!dateValue) return null;
    const date = new Date(`${dateValue}T00:00:00`);
    if (isNaN(date.getTime())) return null;
    if (isEndBoundary) {
        date.setHours(23, 59, 59, 999);
    }
    return date.getTime();
}

function resolveRaceTimeBounds(trackGroups) {
    const startInput = document.getElementById("race-start-date")?.value || "";
    const endInput = document.getElementById("race-end-date")?.value || "";
    let start = parseRaceBoundaryDate(startInput, false);
    let end = parseRaceBoundaryDate(endInput, true);

    if (start !== null && end !== null && start > end) {
        const swap = start;
        start = end;
        end = swap;
    }

    if (start !== null && end !== null) {
        return { start, end };
    }

    let minTimestamp = Number.POSITIVE_INFINITY;
    let maxTimestamp = Number.NEGATIVE_INFINITY;

    (trackGroups || []).forEach(group => {
        (group || []).forEach(track => {
            const timestamp = parseInt(track.Date, 10);
            if (isNaN(timestamp)) return;
            if (timestamp < minTimestamp) minTimestamp = timestamp;
            if (timestamp > maxTimestamp) maxTimestamp = timestamp;
        });
    });

    if (!isFinite(minTimestamp) || !isFinite(maxTimestamp)) {
        const now = Date.now();
        return { start: now, end: now };
    }

    return {
        start: start ?? minTimestamp,
        end: end ?? maxTimestamp
    };
}

function hasRaceSettingsReady() {
    const startInput = (document.getElementById("race-start-date")?.value || "").trim();
    const endInput = (document.getElementById("race-end-date")?.value || "").trim();
    const frequencyInput = (document.getElementById("race-frequency")?.value || "").trim();
    return Boolean(startInput && endInput && frequencyInput);
}

function formatDateInputValue(dateValue) {
    const date = new Date(dateValue);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getFirstScrobbleTimestamp() {
    let earliestTimestamp = Number.POSITIVE_INFINITY;
    (allTracks || []).forEach(track => {
        const timestamp = parseInt(track?.Date, 10);
        if (!isNaN(timestamp) && timestamp < earliestTimestamp) {
            earliestTimestamp = timestamp;
        }
    });
    return Number.isFinite(earliestTimestamp) ? earliestTimestamp : null;
}

function ensureRaceDateDefaults(force = false) {
    const raceStartInput = document.getElementById("race-start-date");
    const raceEndInput = document.getElementById("race-end-date");
    if (!raceStartInput || !raceEndInput) return;

    const firstScrobbleTimestamp = getFirstScrobbleTimestamp();
    const startDefault = formatDateInputValue(firstScrobbleTimestamp || Date.now());
    const endDefault = formatDateInputValue(Date.now());

    if (force || !raceStartInput.value) {
        raceStartInput.value = startDefault;
    }
    if (force || !raceEndInput.value) {
        raceEndInput.value = endDefault;
    }
}

function buildRaceTimeline(startTimestamp, endTimestamp, frequency) {
    const safeStart = getRacePeriodStartTimestamp(startTimestamp, frequency);
    const safeEnd = getRacePeriodStartTimestamp(endTimestamp, frequency);
    const timeline = [];

    let cursor = new Date(safeStart);
    const end = new Date(safeEnd);

    while (cursor.getTime() <= end.getTime()) {
        timeline.push(cursor.getTime());
        if (frequency === "month") {
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        } else if (frequency === "week") {
            cursor = new Date(cursor.getTime() + (7 * 24 * 60 * 60 * 1000));
        } else {
            cursor = new Date(cursor.getTime() + (24 * 60 * 60 * 1000));
        }
    }

    return timeline;
}

function buildBarRaceFramesFromTracks(tracks, entityType, sortingBasis, xValue, maxPerArtist, timeline, frequency, endTimestamp) {
    const listLength = Math.min(getListLengthLimit(), 100);
    const frames = [];
    const sortedTracks = [...(tracks || [])]
        .filter(track => {
            const timestamp = parseInt(track.Date, 10);
            return !isNaN(timestamp) && timestamp <= endTimestamp;
        })
        .sort((a, b) => (parseInt(a.Date, 10) || 0) - (parseInt(b.Date, 10) || 0));

    let pointer = 0;
    const cumulativeTracks = [];

    timeline.forEach(periodStart => {
        while (pointer < sortedTracks.length) {
            const candidate = sortedTracks[pointer];
            const timestamp = parseInt(candidate.Date, 10);
            const candidatePeriodStart = getRacePeriodStartTimestamp(timestamp, frequency);
            if (candidatePeriodStart > periodStart) break;
            cumulativeTracks.push(candidate);
            pointer += 1;
        }

        let entities = buildEntitiesFromTracks(cumulativeTracks, entityType, sortingBasis, xValue);
        if (entityType === "track") {
            entities = applyTracksPerEntityFilter(entities, maxPerArtist);
        }

        const chartRows = entities.slice(0, listLength);

        frames.push({
            periodStart,
            periodLabel: formatRacePeriodLabel(periodStart, frequency),
            labels: chartRows.map(entity => getEntityLabel(entity, entityType)),
            values: chartRows.map(entity => getEntityMetricValue(entity, sortingBasis))
        });
    });

    if (!frames.length) {
        frames.push({
            periodStart: timeline[0] || Date.now(),
            periodLabel: timeline[0] ? formatRacePeriodLabel(timeline[0], frequency) : "N/A",
            labels: [],
            values: []
        });
    }

    return frames;
}

function updateChartScaleForFrame(chart, sortingBasis) {
    if (!chart?.options?.scales) return;

    const orientation = chart.options.indexAxis === "x" ? "vertical" : "horizontal";
    const valueAxisKey = orientation === "vertical" ? "y" : "x";
    const valueAxis = chart.options.scales[valueAxisKey];
    if (!valueAxis) return;

    const dataValues = Array.isArray(chart.data?.datasets?.[0]?.data)
        ? chart.data.datasets[0].data.map(value => Number(value)).filter(Number.isFinite)
        : [];

    if (dataValues.length === 0) {
        valueAxis.min = undefined;
        valueAxis.max = undefined;
        return;
    }

    if (isDateMetricSorting(sortingBasis)) {
        const minValue = Math.min(...dataValues);
        const maxValue = Math.max(...dataValues);
        const datePadding = Math.max(24 * 60 * 60 * 1000, Math.round((maxValue - minValue) * 0.03));
        valueAxis.min = minValue - datePadding;
        valueAxis.max = maxValue + datePadding;
        valueAxis.beginAtZero = false;
        return;
    }

    valueAxis.min = undefined;
    valueAxis.max = undefined;
}

function applyRaceFrameToChart(chart, frame, labelElement, sortingBasis) {
    if (!chart || !frame) return;
    
    chart.data.labels = frame.labels;
    chart.data.datasets[0].data = frame.values;
    updateChartScaleForFrame(chart, sortingBasis);
    
    const wrapper = chart.canvas.parentNode;
    if (wrapper && wrapper.classList.contains("chart-wrapper")) {
        const minBarThickness = 30;
        const requiredHeight = Math.max(400, frame.labels.length * minBarThickness);
        wrapper.style.height = requiredHeight + "px";
    }

    chart.update();
    if (labelElement) {
        labelElement.textContent = `Period: ${frame.periodLabel}`;
    }
}

function mountRaceChart(targetDiv, titleText, initialFrame, sortingBasis) {
    targetDiv.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";

    const minBarThickness = 30;
    const requiredHeight = Math.max(400, (initialFrame?.labels?.length || 0) * minBarThickness);
    wrapper.style.height = requiredHeight + "px";

    const frameLabel = document.createElement("div");
    frameLabel.className = "race-frame-label";
    frameLabel.textContent = initialFrame ? `Period: ${initialFrame.periodLabel}` : "Period: N/A";
    wrapper.appendChild(frameLabel);

    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    targetDiv.appendChild(wrapper);

    const chart = createBarChartInCanvas(canvas, initialFrame?.labels || [], initialFrame?.values || [], sortingBasis, titleText || "");

    return { chart, frameLabel };
}

function renderBarRaceSingle(tracks, entityType, targetDiv, sortingBasis) {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    const xValue = parseInt(document.getElementById("x-value")?.value, 10) || 1;
    const maxPerArtist = parseInt(document.getElementById("max-per-artist")?.value, 10) || Infinity;
    const bounds = resolveRaceTimeBounds([tracks]);
    const timeline = buildRaceTimeline(bounds.start, bounds.end, frequency);
    const frames = buildBarRaceFramesFromTracks(tracks, entityType, sortingBasis, xValue, maxPerArtist, timeline, frequency, bounds.end);
    const initialFrame = frames[0] || {
        periodLabel: "N/A",
        labels: [],
        values: []
    };
    const mounted = mountRaceChart(targetDiv, `Bar Chart Race (${sortingBasis})`, initialFrame, sortingBasis);

    activeRaceState = {
        mode: "single",
        frameIndex: 0,
        totalFrames: frames.length,
        updateFrame: (frameIndex) => {
            const safeIndex = Math.max(0, Math.min(frames.length - 1, frameIndex));
            activeRaceState.frameIndex = safeIndex;
            applyRaceFrameToChart(mounted.chart, frames[safeIndex], mounted.frameLabel, sortingBasis);
        }
    };

    activeRaceState.updateFrame(0);
    if (raceRenderArmed) {
        startRacePlayback();
    }
}

function renderBarRaceComparison(leftTracks, rightTracks, leftEntityType, rightEntityType, leftSortingBasis, rightSortingBasis, leftXValue, rightXValue, leftMaxPerArtist, rightMaxPerArtist, leftTargetDiv, rightTargetDiv) {
    const frequency = (document.getElementById("race-frequency")?.value || "day").toLowerCase();
    const bounds = resolveRaceTimeBounds([leftTracks, rightTracks]);
    const timeline = buildRaceTimeline(bounds.start, bounds.end, frequency);
    const leftFrames = buildBarRaceFramesFromTracks(leftTracks, leftEntityType, leftSortingBasis, leftXValue, leftMaxPerArtist, timeline, frequency, bounds.end);
    const rightFrames = buildBarRaceFramesFromTracks(rightTracks, rightEntityType, rightSortingBasis, rightXValue, rightMaxPerArtist, timeline, frequency, bounds.end);

    const leftInitial = leftFrames[0] || {
        periodLabel: "N/A",
        labels: [],
        values: []
    };
    const rightInitial = rightFrames[0] || {
        periodLabel: "N/A",
        labels: [],
        values: []
    };

    const leftMounted = mountRaceChart(leftTargetDiv, `Left (${leftSortingBasis})`, leftInitial, leftSortingBasis);
    const rightMounted = mountRaceChart(rightTargetDiv, `Right (${rightSortingBasis})`, rightInitial, rightSortingBasis);

    const totalFrames = Math.max(leftFrames.length, rightFrames.length);
    activeRaceState = {
        mode: "comparison",
        frameIndex: 0,
        totalFrames,
        updateFrame: (frameIndex) => {
            const safeIndex = Math.max(0, Math.min(totalFrames - 1, frameIndex));
            activeRaceState.frameIndex = safeIndex;

            const leftFrame = leftFrames[Math.min(safeIndex, leftFrames.length - 1)] || leftInitial;
            const rightFrame = rightFrames[Math.min(safeIndex, rightFrames.length - 1)] || rightInitial;

            applyRaceFrameToChart(leftMounted.chart, leftFrame, leftMounted.frameLabel, leftSortingBasis);
            applyRaceFrameToChart(rightMounted.chart, rightFrame, rightMounted.frameLabel, rightSortingBasis);
        }
    };

    activeRaceState.updateFrame(0);
    if (raceRenderArmed) {
        startRacePlayback();
    }
}

function equalizeComparisonRowHeights(leftContainer, rightContainer) {
    if (!leftContainer || !rightContainer) return;

    const leftRows = Array.from(leftContainer.children);
    const rightRows = Array.from(rightContainer.children);
    const maxRows = Math.max(leftRows.length, rightRows.length);

    for (let index = 0; index < maxRows; index++) {
        const leftRow = leftRows[index] || null;
        const rightRow = rightRows[index] || null;

        if (leftRow) {
            leftRow.style.boxSizing = "border-box";
            leftRow.style.height = "";
        }
        if (rightRow) {
            rightRow.style.boxSizing = "border-box";
            rightRow.style.height = "";
        }

        const leftHeight = leftRow ? leftRow.offsetHeight : 0;
        const rightHeight = rightRow ? rightRow.offsetHeight : 0;
        const targetHeight = Math.max(leftHeight, rightHeight);

        if (leftRow) leftRow.style.height = `${targetHeight}px`;
        if (rightRow) rightRow.style.height = `${targetHeight}px`;
    }
}

function displayEntities() {
    destroyVisualizationState();
    ensureRaceDateDefaults();

    const initialEntityType = document.getElementById("entity-type").value;
    const initialSortingBasis = document.getElementById("sorting-basis").value;
    const normalizedMain = normalizeEntitySorting(initialEntityType, initialSortingBasis);
    const entityType = normalizedMain.entityType;
    const sortingBasis = normalizedMain.sortingBasis;
    const selectedDisplayMode = getSelectedDisplayMode();
    const supportsVisualization = entityType !== "scrobble";
    const effectiveDisplayMode = supportsVisualization ? selectedDisplayMode : DISPLAY_MODE_LIST;
    const renderMode = (effectiveDisplayMode !== DISPLAY_MODE_LIST && typeof Chart === "undefined")
        ? DISPLAY_MODE_LIST
        : effectiveDisplayMode;
    const raceReady = renderMode !== DISPLAY_MODE_BAR_RACE || hasRaceSettingsReady();
    const raceCanRender = renderMode !== DISPLAY_MODE_BAR_RACE || (raceReady && raceRenderArmed);

    if (entityType !== initialEntityType) {
        document.getElementById("entity-type").value = entityType;
    }
    if (sortingBasis !== initialSortingBasis) {
        document.getElementById("sorting-basis").value = sortingBasis;
    }

    const maxPerArtist = parseInt(document.getElementById("max-per-artist").value) || Infinity;
    const xValue = parseInt(document.getElementById("x-value").value) || 1;
    const comparisonButtonActive = isComparisonEnabled();

    const baseTracks = filterTracks(activeFilters, allTracks);
    const leftState = comparisonFilterStates.left || {};
    const rightState = comparisonFilterStates.right || {};
    const leftFilters = convertStateToFilterArray(leftState);
    const rightFilters = convertStateToFilterArray(rightState);

    const leftTracksBase = comparisonButtonActive ? filterTracks(leftFilters, allTracks) : baseTracks;
    const rightTracksBase = comparisonButtonActive ? filterTracks(rightFilters, allTracks) : baseTracks;

    const equationsLeft = comparisonButtonActive
        ? ((leftState.equations || "").trim())
        : ((document.getElementById("equations")?.value || "").trim());
    const equationsRight = comparisonButtonActive
        ? ((document.getElementById("equations-right")?.value || rightState.equations || "").trim())
        : "";

    const leftXValue = parseInt(leftState["x-value"], 10) || xValue;
    const rightXValue = parseInt(rightState["x-value"], 10) || xValue;
    const leftPipeline = applyEquationPipeline(leftTracksBase, equationsLeft, { xValue: leftXValue });
    const comparisonRequested = comparisonButtonActive || equationsRight !== "";

    if (comparisonRequested) {
        const rightPipeline = applyEquationPipeline(rightTracksBase, equationsRight, { xValue: rightXValue });
        const leftNormalized = normalizeEntitySorting((leftState["entity-type"] || entityType || "track").toLowerCase(), leftState["sorting-basis"] || sortingBasis);
        const rightNormalized = normalizeEntitySorting((rightState["entity-type"] || entityType || "track").toLowerCase(), rightState["sorting-basis"] || sortingBasis);
        const leftEntityType = leftNormalized.entityType;
        const rightEntityType = rightNormalized.entityType;
        const leftSortingBasis = leftNormalized.sortingBasis;
        const rightSortingBasis = rightNormalized.sortingBasis;
        const leftMaxPerArtist = parseInt(leftState["max-per-artist"], 10) || maxPerArtist;
        const rightMaxPerArtist = parseInt(rightState["max-per-artist"], 10) || maxPerArtist;

        const leftEntities = resolveDisplayEntities(leftPipeline, leftEntityType, leftSortingBasis, leftXValue, leftMaxPerArtist);
        const rightEntities = resolveDisplayEntities(rightPipeline, rightEntityType, rightSortingBasis, rightXValue, rightMaxPerArtist);

        const resultsDiv = document.getElementById("results");
        resultsDiv.innerHTML = "";

        const comparisonLayout = document.createElement("div");
        comparisonLayout.className = "comparison-results";

        const leftColumn = document.createElement("div");
        leftColumn.className = "comparison-column";
        const leftTitle = document.createElement("h3");
        leftTitle.textContent = "Left";
        const leftList = document.createElement("div");
        leftColumn.appendChild(leftTitle);
        leftColumn.appendChild(leftList);

        const rightColumn = document.createElement("div");
        rightColumn.className = "comparison-column";
        const rightTitle = document.createElement("h3");
        rightTitle.textContent = "Right";
        const rightList = document.createElement("div");
        rightColumn.appendChild(rightTitle);
        rightColumn.appendChild(rightList);

        comparisonLayout.appendChild(leftColumn);
        comparisonLayout.appendChild(rightColumn);
        resultsDiv.appendChild(comparisonLayout);

        if (renderMode === DISPLAY_MODE_BAR_CHART) {
            renderBarChartEntities(leftEntities, leftEntityType, leftSortingBasis, leftList);
            renderBarChartEntities(rightEntities, rightEntityType, rightSortingBasis, rightList);
        } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
            if (raceCanRender) {
                insertRacePlaybackToolbar(resultsDiv);
                renderBarRaceComparison(
                    leftPipeline.tracks,
                    rightPipeline.tracks,
                    leftEntityType,
                    rightEntityType,
                    leftSortingBasis,
                    rightSortingBasis,
                    leftXValue,
                    rightXValue,
                    leftMaxPerArtist,
                    rightMaxPerArtist,
                    leftList,
                    rightList
                );
            } else {
                renderBarChartEntities(leftEntities, leftEntityType, leftSortingBasis, leftList);
                renderBarChartEntities(rightEntities, rightEntityType, rightSortingBasis, rightList);
            }
        } else {
            renderEntitiesToContainer(leftEntities, leftEntityType, leftList, leftSortingBasis);
            renderEntitiesToContainer(rightEntities, rightEntityType, rightList, rightSortingBasis);
            equalizeComparisonRowHeights(leftList, rightList);
        }

        lastRenderedListState = {
            isComparison: true,
            current: { entities: leftEntities, entityType: leftEntityType },
            left: { entities: leftEntities, entityType: leftEntityType },
            right: { entities: rightEntities, entityType: rightEntityType }
        };

        const resultsHeader = document.querySelector("#results-section h2");
        if (renderMode === DISPLAY_MODE_BAR_CHART) {
            resultsHeader.textContent = "Comparison Bar Charts";
        } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
            resultsHeader.textContent = raceCanRender
                ? "Comparison Bar Chart Race"
                : "Comparison Bar Charts (Race settings pending or Apply Filters required)";
        } else {
            resultsHeader.textContent = "Comparison Results";
        }

        filteredData = leftEntities;
        updateActiveFilters();
        return;
    }

    const singleEntities = resolveDisplayEntities(leftPipeline, entityType, sortingBasis, xValue, maxPerArtist);
    filteredData = singleEntities;
    const resultsTarget = document.getElementById("results");

    if (renderMode === DISPLAY_MODE_BAR_CHART) {
        renderBarChartEntities(singleEntities, entityType, sortingBasis, resultsTarget);
    } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
        if (raceCanRender) {
            resultsTarget.innerHTML = "";
            insertRacePlaybackToolbar(resultsTarget);
            const raceChartContainer = document.createElement("div");
            resultsTarget.appendChild(raceChartContainer);
            renderBarRaceSingle(leftPipeline.tracks, entityType, raceChartContainer, sortingBasis);
        } else {
            renderBarChartEntities(singleEntities, entityType, sortingBasis, resultsTarget);
        }
    } else {
        renderEntitiesToContainer(singleEntities, entityType, resultsTarget, sortingBasis);
    }

    lastRenderedListState = {
        isComparison: false,
        current: { entities: singleEntities, entityType },
        left: { entities: [], entityType: "track" },
        right: { entities: [], entityType: "track" }
    };

    const resultsHeader = document.querySelector("#results-section h2");
    if (renderMode === DISPLAY_MODE_BAR_CHART) {
        resultsHeader.textContent = "Bar Chart";
    } else if (renderMode === DISPLAY_MODE_BAR_RACE) {
        resultsHeader.textContent = raceCanRender
            ? "Bar Chart Race"
            : "Bar Chart (Race settings pending or Apply Filters required)";
    } else if (leftPipeline.hasOrderingStep && entityType === "track") {
        resultsHeader.textContent = "Equation Results";
    } else if (entityType === "track") {
        resultsHeader.textContent = "Top Tracks";
    } else if (entityType === "album") {
        resultsHeader.textContent = "Top Albums";
    } else if (entityType === "artist") {
        resultsHeader.textContent = "Top Artists";
    } else if (entityType === "scrobble") {
        resultsHeader.textContent = "Scrobbles";
    }

    updateActiveFilters();
}

function displayScrobbles(scrobbles, targetDiv = null, order = "asc") {
    const resultsDiv = targetDiv || document.getElementById("results");
    const maxPerArtist = parseInt(document.getElementById("max-per-artist").value) || Infinity;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    let tracks = [...scrobbles];
    resultsDiv.innerHTML = "";
    const fragment = document.createDocumentFragment();

    tracks.sort((a, b) => {
        const aDate = parseInt(a.Date, 10) || 0;
        const bDate = parseInt(b.Date, 10) || 0;
        return order === "desc" ? bDate - aDate : aDate - bDate;
    });

    // Object to track how many scrobbles per artist have been added
    const artistCounts = {};

    tracks.slice(0, listLength).forEach((track) => {
        const artist = track.Artist;
        if (!artistCounts[artist]) artistCounts[artist] = 0;

        // Skip this track if the artist has already reached the max limit
        if (artistCounts[artist] >= maxPerArtist) return;

        artistCounts[artist]++; // Count this track for the artist

        const trackDiv = document.createElement("div");
        trackDiv.classList.add("track");

        // Format Date to YYYY-MM-DD HH:MM
        const date = new Date(Number(track.Date)); 
        const formattedDate = date.getFullYear() + "-" + 
            String(date.getMonth() + 1).padStart(2, "0") + "-" + 
            String(date.getDate()).padStart(2, "0") + " " + 
            String(date.getHours()).padStart(2, "0") + ":" + 
            String(date.getMinutes()).padStart(2, "0");

        trackDiv.innerHTML = `
            <strong>${track.Track}</strong> by ${artist}
            <br>Album: ${track.Album || "Unknown"}
            <br>Scrobbled on: ${formattedDate}
        `;

        fragment.appendChild(trackDiv);
    });
    resultsDiv.appendChild(fragment);
}

// Attach event listeners to filter inputs
document.querySelectorAll(".filters").forEach(filter => {
    const handleFilterInputEvent = (event) => {
        if (!event.target || !event.target.id) return;
        const value = serializeControlValue(event.target);

        if (isComparisonEnabled()) {
            if (event.target.id === "equations") {
                comparisonFilterStates.left.equations = value;
            } else if (event.target.id === "equations-right") {
                comparisonFilterStates.right.equations = value;
            } else if (GLOBAL_BASE_SETTING_IDS.has(event.target.id)) {
                addFilter(event.target.id, value);
            } else {
                const side = getComparisonEditTarget();
                comparisonFilterStates[side][event.target.id] = value;
            }
            updateActiveFilters();
            return;
        }

        if (event.target.id === "equations-right") {
            comparisonFilterStates.right.equations = value;
            updateActiveFilters();
            return;
        }

        addFilter(event.target.id, value);
    };

    filter.addEventListener("input", handleFilterInputEvent);
    filter.addEventListener("change", handleFilterInputEvent);
});

// Function to update the active filters display
function updateActiveFilters() {
    const activeFiltersDiv = document.getElementById("active-filters");
    activeFiltersDiv.innerHTML = ""; // Clear previous filters

    const filters = [

        // { id: "display-mode", label: "Display mode", isSelect: true }, // Removed as requested
        // { id: "list-length", label: "List length" },
        // { id: "unfiltered-stats", label: "Show unfiltered stats", isSelect: false },
        // { id: "chart-axis", label: "Chart orientation", isSelect: true }, // Removed as requested
        // { id: "chart-scale", label: "Chart scale", isSelect: true }, // Removed as requested
        { id: "race-start-date", label: "Race start date" },
        { id: "race-end-date", label: "Race end date" },
        { id: "race-frequency", label: "Race update frequency", isSelect: true },
        { id: "race-speed-ms", label: "Race speed (ms/frame)" },

        { id: "sorting-basis", label: "Sorting basis", isSelect: true },
        { id: "x-value", label: "X" },

        { id: "max-per-artist", label: "Displayed tracks per artist" },

        // Artist filters

        { id: "artist-initial", label: "Artist initial" },
        { id: "artist-name", label: "Artist name" },
        { id: "artist-includes", label: "Artist name includes" },
        { id: "artist-excludes", label: "Artist name excludes" },
        { id: "artist-name-length-min", label: "Artist min name length" },
        { id: "artist-name-length-max", label: "Artist max name length" },
        { id: "artist-word-count-min", label: "Artist min word count" },
        { id: "artist-word-count-max", label: "Artist max word count" },

        { id: "artist-scrobble-count-min", label: "Artist min user scrobbles" },
        { id: "artist-scrobble-count-max", label: "Artist max user scrobbles" },
        { id: "artist-rank-min", label: "Artist min rank" },
        { id: "artist-rank-max", label: "Artist max rank" },
        { id: "artist-track-count-min", label: "Artist min track count" },
        { id: "artist-track-count-max", label: "Artist max track count" },
        { id: "artist-first-scrobble-years", label: "Artist first scrobble years" },
        { id: "artist-days-since-last-min", label: "Min days since artist last scrobbled" },
        { id: "artist-days-since-last-max", label: "Max days since artist last scrobbled" },


        { id: "artist-listeners-min", label: "Artist min listeners" },
        { id: "artist-listeners-max", label: "Artist max listeners" },
        { id: "artist-global-scrobbles-min", label: "Artist min global playcount" },
        { id: "artist-global-scrobbles-max", label: "Artist max global playcount" },
        { id: "artist-tags", label: "Artist tags" },

        // Album filters

        { id: "album-initial", label: "Album initial" },
        { id: "album-name", label: "Album title" },
        { id: "album-includes", label: "Album title includes" },
        { id: "album-excludes", label: "Album title excludes" },       
        { id: "album-name-length-min", label: "Album min title length" },
        { id: "album-name-length-max", label: "Album max title length" },
        { id: "album-word-count-min", label: "Album min word count" },
        { id: "album-word-count-max", label: "Album max word count" },

        { id: "album-scrobble-count-min", label: "Album min user scrobbles" },
        { id: "album-scrobble-count-max", label: "Album max user scrobbles" },
        { id: "album-rank-min", label: "Album min rank" },
        { id: "album-rank-max", label: "Album max rank" },
        { id: "album-track-count-min", label: "Album min tracks scrobbled" },
        { id: "album-track-count-max", label: "Album max tracks scrobbled" },
        { id: "album-first-scrobble-years", label: "Album first scrobble years" },
        { id: "album-days-since-last-min", label: "Min days since album last scrobbled" },
        { id: "album-days-since-last-max", label: "Max days since album last scrobbled" },

        { id: "album-listeners-min", label: "Album min listeners" },
        { id: "album-listeners-max", label: "Album max listeners" },
        { id: "album-global-scrobbles-min", label: "Album min global playcount" },
        { id: "album-global-scrobbles-max", label: "Album max global playcount" },


        // Track filters

        { id: "track-initial", label: "Track initial" },
        { id: "track-name", label: "Track title" },
        { id: "track-includes", label: "Track title includes" },
        { id: "track-excludes", label: "Track title excludes" },
        { id: "track-name-length-min", label: "Track min title length" },
        { id: "track-name-length-max", label: "Track max title length" },
        { id: "track-word-count-min", label: "Track min word count" },
        { id: "track-word-count-max", label: "Track max word count" },

        { id: "track-scrobble-count-min", label: "Track min user scrobbles" },
        { id: "track-scrobble-count-max", label: "Track max user scrobbles" },
        { id: "track-rank-min", label: "Track min rank" },
        { id: "track-rank-max", label: "Track max rank" },
        { id: "track-first-scrobble-years", label: "Track first scrobble years" },
        { id: "track-days-since-last-min", label: "Min days since track last scrobbled" },
        { id: "track-days-since-last-max", label: "Max days since track last scrobbled" },

        { id: "track-listeners-min", label: "Track min listeners" },
        { id: "track-listeners-max", label: "Track max listeners" },
        { id: "track-global-scrobbles-min", label: "Track min global playcount" },
        { id: "track-global-scrobbles-max", label: "Track max global playcount" },
        { id: "track-duration-min", label: "Track minimum duration" },
        { id: "track-duration-max", label: "Track maximum duration" },

        // Time filters

        { id: "year", label: "Year" },
        { id: "month", label: "Month", isSelect: true },
        { id: "day-of-month", label: "Day of month" },
        { id: "weekday", label: "Weekday", isSelect: true },
        { id: "time-of-day-start", label: "Time of day (start)" },
        { id: "time-of-day-end", label: "Time of day (end)" },
        { id: "session-starter-only", label: "Session starter", isSelect: true },
        { id: "day-starter-only", label: "Day starter", isSelect: true },
        { id: "day-starter-gap-hours", label: "Session/day starter long gap (hours)" },
        { id: "date-range-start", label: "Date range start" },
        { id: "date-range-end", label: "Date range end" },
        { id: "last-n-days", label: "Last X days" },
        { id: "scrobble-order-from", label: "Scrobble order (min)" },
        { id: "scrobble-order-to", label: "Scrobble order (max)" },

        // Equation filters

        { id: "equations", label: "Equations" },
        { id: "equations-right", label: "Equations" }
    ];

    const labelById = {};
    const isSelectById = {};
    filters.forEach(filter => {
        labelById[filter.id] = filter.label;
        isSelectById[filter.id] = filter.isSelect === true;
    });

    const formatTagValue = (id, rawValue) => {
        const value = (rawValue ?? "").toString();
        if (value === "") return value;

        if (isSelectById[id]) {
            const element = document.getElementById(id);
            if (element?.multiple) {
                const selectedValues = new Set(
                    value
                        .split(",")
                        .map(item => item.trim())
                        .filter(Boolean)
                );
                return Array.from(element.options || [])
                    .filter(option => selectedValues.has(option.value))
                    .map(option => option.text)
                    .join(", ");
            }
            const option = element ? Array.from(element.options || []).find(item => item.value === value) : null;
            return option ? option.text : value;
        }

        return value;
    };

    const appendFilterLabel = (text) => {
        const filterLabel = document.createElement("div");
        filterLabel.classList.add("filter-label");
        filterLabel.textContent = text;
        activeFiltersDiv.appendChild(filterLabel);
    };

    if (isComparisonEnabled()) {
        const leftState = comparisonFilterStates.left || {};
        const rightState = comparisonFilterStates.right || {};
        const leftEquationValue = (document.getElementById("equations")?.value || leftState.equations || "").toString().trim();
        const rightEquationValue = (document.getElementById("equations-right")?.value || rightState.equations || rightState["equations-right"] || "").toString().trim();

        if (leftEquationValue) {
            appendFilterLabel(`Equations (left): ${leftEquationValue}`);
        }

        if (rightEquationValue) {
            appendFilterLabel(`Equations (right): ${rightEquationValue}`);
        }

        const ids = new Set([...Object.keys(leftState), ...Object.keys(rightState)]);
        ids.forEach(id => {
            if (id === "equations" || id === "equations-right") return;
            const canonicalId = id === "equations-right" ? "equations" : id;
            if (canonicalId === "entity-type") return;
            if (!labelById[canonicalId]) return;

            if (canonicalId === "x-value") {
                const leftSorting = (leftState["sorting-basis"] || document.getElementById("sorting-basis")?.value || "").toString();
                const rightSorting = (rightState["sorting-basis"] || document.getElementById("sorting-basis")?.value || "").toString();
                const usesX = (sortingValue) => isSortingBasisUsingXValue(sortingValue);
                if (!usesX(leftSorting) && !usesX(rightSorting)) return;
            }

            const leftValue = (leftState[canonicalId] ?? "").toString().trim();
            const rightValue = (rightState[canonicalId] ?? "").toString().trim();

            if (!leftValue && !rightValue) return;

            // Special handling for sorting-basis in comparison mode
            if (canonicalId === "sorting-basis") {
                // Default value for right is "scrobbles"
                const rightDefault = "scrobbles";
                if (leftValue === rightValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)}`);
                } else if (rightValue === rightDefault || !rightValue) {
                    // Only left is set or right is default, don't specify (Left)
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)}`);
                } else if (leftValue && rightValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)} (Left)`);
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, rightValue)} (Right)`);
                } else if (leftValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)} (Left)`);
                } else if (rightValue) {
                    appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, rightValue)} (Right)`);
                }
                return;
            }

            if (leftValue === rightValue) {
                appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)}`);
                return;
            }

            if (leftValue) {
                appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, leftValue)} (Left)`);
            }

            if (rightValue) {
                appendFilterLabel(`${labelById[canonicalId]}: ${formatTagValue(canonicalId, rightValue)} (Right)`);
            }
        });

        return;
    }

    filters.forEach(filter => {
        const element = document.getElementById(filter.id);
        if (!element) return; // Skip if element is not found

        const sortingBasisValue = document.getElementById("sorting-basis")?.value || "";
        const sessionStarterValue = document.getElementById("session-starter-only")?.value || "";
        const dayStarterValue = document.getElementById("day-starter-only")?.value || "";

        const rawValue = (element.value ?? "").toString().trim();
        const displayValue = filter.isSelect
            ? Array.from(element.selectedOptions).map(option => option.text).join(", ")
            : (element.type === "checkbox" ? (element.checked ? "Yes" : "No") : element.value);

        let shouldShow = rawValue !== "";

        if (filter.id === "session-starter-only" || filter.id === "day-starter-only") {
            shouldShow = rawValue !== "";
        }

        if (filter.id === "x-value") {
            const usesXValue = isSortingBasisUsingXValue(sortingBasisValue);
            shouldShow = usesXValue && rawValue !== "";
        }

        if (filter.id === "day-starter-gap-hours") {
            const longGapIsUsed = sessionStarterValue === "use-gap" || dayStarterValue === "first-day-smart";
            shouldShow = longGapIsUsed && rawValue !== "";
        }

        if (filter.id === "chart-axis" || filter.id === "chart-scale") {
            const mode = document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST;
            shouldShow = mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE;
        }

        if (filter.id === "race-start-date" || filter.id === "race-end-date" || filter.id === "race-frequency" || filter.id === "race-speed-ms") {
            const mode = document.getElementById("display-mode")?.value || DISPLAY_MODE_LIST;
            shouldShow = mode === DISPLAY_MODE_BAR_RACE && rawValue !== "";
        }

        if (filter.id === "unfiltered-stats") {
            shouldShow = element.checked === true;
        }

        if (shouldShow) {
            appendFilterLabel(`${filter.label}: ${displayValue}`);
        }
    });
}

function resetFilters() {
    destroyVisualizationState();
    raceRenderArmed = false;

    // Reset all input and select elements within #filters-section
    document.querySelectorAll("#filters-section input, #filters-section select, #filters-section textarea").forEach(element => {
        element.value = "";
    });
    
    // Clear the activeFilters array (using splice or reassigning an empty array)
    activeFilters.length = 0;
    comparisonFilterStates = { left: {}, right: {} };
    comparisonStateInitialized = false;
    
    // Set default values for sorting basis and entity type
    document.getElementById("sorting-basis").value = "scrobbles";
    document.getElementById("entity-type").value = "track";
    const displayModeSelect = document.getElementById("display-mode");
    if (displayModeSelect) {
        displayModeSelect.value = DISPLAY_MODE_LIST;
    }

    const raceFrequency = document.getElementById("race-frequency");
    if (raceFrequency) raceFrequency.value = "day";

    const raceSpeedInput = document.getElementById("race-speed-ms");
    if (raceSpeedInput) raceSpeedInput.value = "260";
    racePlaybackSpeedMs = 260;

    const chartAxis = document.getElementById("chart-axis");
    if (chartAxis) chartAxis.value = "horizontal";

    const chartScale = document.getElementById("chart-scale");
    if (chartScale) chartScale.value = "linear";

    const comparisonButton = document.getElementById("comparison-toggle");
    if (comparisonButton) {
        comparisonButton.dataset.active = "false";
        comparisonButton.textContent = "Comparison: Off";
    }

    const comparisonEditTarget = document.getElementById("comparison-edit-target");
    if (comparisonEditTarget) {
        comparisonEditTarget.value = "left";
    }

    const rightEquationsInput = document.getElementById("equations-right");
    if (rightEquationsInput) {
        rightEquationsInput.value = "";
    }

    ensureRaceDateDefaults(true);
    updateComparisonInteractionState();

    updateRaceControlsVisibility();
    
    // Display the full track list and update active filters display
    filterTracks();
    displayEntities();
    updateActiveFilters();
}

// Event listener for Apply Filters button
document.getElementById("apply-filters").addEventListener("click", () => {
    const mode = getSelectedDisplayMode();
    raceRenderArmed = mode === DISPLAY_MODE_BAR_RACE && hasRaceSettingsReady();

    if (isComparisonEnabled()) {
        displayEntities();
        return;
    }

    filterTracks();
    displayEntities(); // Displays tracks, albums, or artists based on sorting
});

// Event listener for Reset Filters button
document.getElementById("reset-filters").addEventListener("click", resetFilters);

document.getElementById("comparison-toggle").addEventListener("click", () => {
    const button = document.getElementById("comparison-toggle");
    const isActive = button.dataset.active === "true";
    const nextValue = !isActive;

    if (nextValue && !comparisonStateInitialized) {
        const snapshot = readCurrentFilterInputState();
        comparisonFilterStates.left = {
            ...snapshot,
            equations: (document.getElementById("equations")?.value || snapshot.equations || "").toString()
        };
        comparisonFilterStates.right = {
            equations: (document.getElementById("equations-right")?.value || "").toString()
        };
        comparisonStateInitialized = true;
    }

    if (isActive) {
        const currentSide = getComparisonEditTarget();
        const snapshot = readCurrentFilterInputState();
        if (currentSide === "right") {
            snapshot.equations = (document.getElementById("equations-right")?.value || comparisonFilterStates.right?.equations || "").toString();
        } else {
            snapshot.equations = (document.getElementById("equations")?.value || comparisonFilterStates.left?.equations || "").toString();
        }
        comparisonFilterStates[currentSide] = {
            ...(comparisonFilterStates[currentSide] || {}),
            ...snapshot
        };
    }

    button.dataset.active = nextValue ? "true" : "false";
    button.textContent = nextValue ? "Comparison: On" : "Comparison: Off";

    if (nextValue) {
        const target = getComparisonEditTarget();
        applyFilterInputState(comparisonFilterStates[target]);
    } else {
        activeFilters.length = 0;
        getManagedFilterElements().forEach(element => {
            const value = element.type === "checkbox"
                ? (element.checked ? "true" : "")
                : element.value;
            addFilter(element.id, value);
        });

        const rightEquationsInput = document.getElementById("equations-right");
        if (rightEquationsInput) {
            comparisonFilterStates.right.equations = rightEquationsInput.value;
        }
    }

    updateComparisonInteractionState();
    updateActiveFilters();
});

document.getElementById("comparison-edit-target").addEventListener("change", () => {
    if (!isComparisonEnabled()) return;

    const previousSide = getComparisonEditTarget() === "left" ? "right" : "left";
    const snapshot = readCurrentFilterInputState();
    if (previousSide === "right") {
        snapshot.equations = (document.getElementById("equations-right")?.value || comparisonFilterStates.right?.equations || "").toString();
    } else {
        snapshot.equations = (document.getElementById("equations")?.value || comparisonFilterStates.left?.equations || "").toString();
    }
    comparisonFilterStates[previousSide] = {
        ...(comparisonFilterStates[previousSide] || {}),
        ...snapshot
    };

    const currentSide = getComparisonEditTarget();
    applyFilterInputState(comparisonFilterStates[currentSide]);
    updateActiveFilters();
});

const displayModeSelect = document.getElementById("display-mode");
if (displayModeSelect) {
    displayModeSelect.addEventListener("change", () => {
        updateRaceControlsVisibility();
        if (getSelectedDisplayMode() !== DISPLAY_MODE_BAR_RACE) {
            raceRenderArmed = false;
        }
        displayEntities();
    });
}

["chart-axis", "chart-scale"].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    control.addEventListener("change", () => {
        const mode = getSelectedDisplayMode();
        if (mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE) {
            displayEntities();
        }
    });
});

["race-start-date", "race-end-date", "race-frequency"].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    control.addEventListener("change", () => {
        raceRenderArmed = false;
        if (getSelectedDisplayMode() === DISPLAY_MODE_BAR_RACE) {
            displayEntities();
        }
    });
});

const raceSpeedInput = document.getElementById("race-speed-ms");
if (raceSpeedInput) {
    raceSpeedInput.addEventListener("change", () => {
        syncRacePlaybackSpeedFromInput();
        if (racePlaybackTimerId !== null) {
            const currentFrame = activeRaceState?.frameIndex || 0;
            stopRacePlayback();
            if (activeRaceState) {
                activeRaceState.updateFrame(currentFrame);
                racePlaybackTimerId = setInterval(() => {
                    if (!activeRaceState || typeof activeRaceState.updateFrame !== "function") {
                        stopRacePlayback();
                        return;
                    }
                    const nextIndex = activeRaceState.frameIndex + 1;
                    if (nextIndex >= activeRaceState.totalFrames) {
                        stopRacePlayback();
                        return;
                    }
                    activeRaceState.updateFrame(nextIndex);
                }, racePlaybackSpeedMs);
            }
        }
    });
}

document.querySelectorAll('.dropdown').forEach(dropdown => {
    dropdown.addEventListener('click', function(event) {
        const content = this.querySelector('.dropdown-content');
        content.classList.toggle('open');
        
        // Prevent scrolling of the body when the dropdown is open
        if (content.classList.contains('open')) {
            document.body.classList.add('no-scroll');
        } else {
            document.body.classList.remove('no-scroll');
        }
        
        // Prevent the dropdown click from propagating and causing body scroll
        event.stopPropagation();
    });
});

function syncEntitySortingSelectors() {
    const entityElement = document.getElementById("entity-type");
    const sortingElement = document.getElementById("sorting-basis");
    if (!entityElement || !sortingElement) return;

    const normalized = normalizeEntitySorting(entityElement.value, sortingElement.value);
    entityElement.value = normalized.entityType;
    sortingElement.value = normalized.sortingBasis;

    const xInput = document.getElementById("x-value");
    if (xInput) {
        const usesX = isSortingBasisUsingXValue(normalized.sortingBasis);
        xInput.style.display = usesX ? "block" : "none";
    }

    if (isComparisonEnabled()) {
        const side = getComparisonEditTarget();
        comparisonFilterStates[side] = {
            ...(comparisonFilterStates[side] || {}),
            ...readCurrentFilterInputState(),
            equations: (comparisonFilterStates[side]?.equations ?? "").toString()
        };
    } else {
        addFilter("entity-type", normalized.entityType);
        addFilter("sorting-basis", normalized.sortingBasis);
    }
}

document.getElementById("sorting-basis").addEventListener("change", () => {
    syncEntitySortingSelectors();
    updateActiveFilters();
});

document.getElementById("entity-type").addEventListener("change", () => {
    syncEntitySortingSelectors();
    updateActiveFilters();
});

const themeToggleButton = document.getElementById("theme-toggle");
if (themeToggleButton) {
    themeToggleButton.addEventListener("click", () => {
        setTimeout(() => {
            const mode = getSelectedDisplayMode();
            if (mode === DISPLAY_MODE_BAR_CHART || mode === DISPLAY_MODE_BAR_RACE) {
                displayEntities();
            }
        }, 0);
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const openDropdown = document.querySelector('.dropdown-content.open');
    if (openDropdown && !openDropdown.contains(event.target)) {
        openDropdown.classList.remove('open');
        document.body.classList.remove('no-scroll');
    }
});

document.addEventListener("DOMContentLoaded", () => {
    initializeEquationControls();
    ensureRaceDateDefaults();
    updateRaceControlsVisibility();
    updateComparisonInteractionState();

    document.querySelectorAll(".dropdown-button").forEach(button => {
        button.addEventListener("click", (event) => {
            event.stopPropagation(); // Prevent immediate closing when clicking the button
            let dropdownContent = button.nextElementSibling;

            // Close other dropdowns before opening the current one
            document.querySelectorAll(".dropdown-content").forEach(menu => {
                if (menu !== dropdownContent) menu.style.display = "none";
            });

            // Toggle the clicked dropdown
            dropdownContent.style.display = dropdownContent.style.display === "block" ? "none" : "block";
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener("click", () => {
        document.querySelectorAll(".dropdown-content").forEach(menu => {
            menu.style.display = "none";
        });
    });
});

function syncSidebarLayoutState() {
    const sidebar = document.getElementById("filters-section");
    if (!sidebar) return;
    document.body.classList.toggle("sidebar-collapsed", sidebar.classList.contains("closed"));
}

document.getElementById("filters-section-toggle").addEventListener("click", function () {
    const sidebar = document.getElementById("filters-section");
    sidebar.classList.toggle("closed");
    syncSidebarLayoutState();

    // Change arrow direction
    this.innerHTML = sidebar.classList.contains("closed") ? "&#9654;" : "&#9664;";
});

syncSidebarLayoutState();
