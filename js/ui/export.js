// Exporting what is on screen: list or chart as PNG, race as GIF, album
// artwork as a collage grid.

import { fetchAlbumCoverUrl } from '../api/lastfm.js';
import { EXPORT_MAX_ROWS_PER_COLUMN } from '../config.js';
import {
    closeExportModalButton,
    closeGridExportModalButton,
    closeModal,
    confirmExportButton,
    confirmGridExportButton,
    exportModal,
    exportOptionsPanel,
    exportOptionsToggle,
    gridExportModal,
    loadingDiv,
    openGridExportButton,
    openModal,
    waitForNextPaint
} from '../dom.js';
import { state } from '../state.js';
import {
    applyColorsToChartInstances,
    getChartThemeColors,
    stopRacePlayback
} from './charts.js';
import { getComparisonEditTarget } from './filters-panel.js';

let gifWorkerBlobUrl = null;

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
    // A race on screen exports as a GIF; anything else (a list, or the bar
    // chart shown until a race is applied) as a PNG.
    if (state.raceBuilding) {
        alert('The race is still being built. Try again in a moment.');
        return;
    }
    if (state.activeRaceState) {
        await exportCurrentRaceAsGif();
        return;
    }

    if (typeof html2canvas === 'undefined') {
        alert('Export library is not loaded. Please refresh and try again.');
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
    captureRoot.style.fontFamily = 'var(--font-stack)';

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
    // The color legend keeps its swatches but not the editing controls.
    resultsClone.querySelectorAll('.race-legend-tools, .race-legend-reset, .race-swatch input, .comparison-switch').forEach(el => el.remove());
    // An image of a comparison shows both lists, even when the page shows one at a time.
    resultsClone.querySelectorAll('.comparison-results').forEach(el => el.classList.remove('is-one-at-a-time'));
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

// 20 by 20 is 400 covers; past that the image is too big to share and the
// cover lookups take minutes.
const GRID_MAX_SIDE = 20;

// GIFs top out around this many frames before files get too big to share.
const RACE_GIF_MAX_FRAMES = 400;
// In-between frames per race step, so the GIF moves like the page does.
const RACE_GIF_SUBSTEPS = 6;

// Runs fn with the page set to the export theme. It all happens before the
// browser paints again, so the page never visibly flips.
function withExportTheme(fn) {
    const exportTheme = document.getElementById('export-theme')?.value || 'current';
    const pageTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const theme = exportTheme === 'current' ? pageTheme : exportTheme;
    if (theme === pageTheme) return fn();
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    try {
        return fn();
    } finally {
        document.documentElement.setAttribute('data-theme', pageTheme);
        document.body.setAttribute('data-theme', pageTheme);
    }
}

// One GIF frame: the race chart (two side by side when comparing) on the
// page background, with the site name underneath.
function composeRaceFrame(race, position) {
    return withExportTheme(() => {
        const parts = race.charts.map(chart => chart.snapshot(position));
        const gap = 12;
        const footer = 26;
        const width = parts.reduce((sum, part) => sum + part.width, 0) + gap * (parts.length - 1);
        const height = Math.max(...parts.map(part => part.height)) + footer;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const styles = getComputedStyle(document.documentElement);
        ctx.fillStyle = styles.getPropertyValue('--background-color').trim() || '#FFFCF8';
        ctx.fillRect(0, 0, width, height);
        let x = 0;
        parts.forEach(part => {
            ctx.drawImage(part, x, 0);
            x += part.width + gap;
        });
        ctx.fillStyle = styles.getPropertyValue('--secondary-text-color').trim() || '#6C5A4B';
        ctx.font = `500 12px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
        ctx.textAlign = 'right';
        ctx.fillText('created with lastfmlists.com', width - 12, height - 10);
        return canvas;
    });
}

async function exportCurrentRaceAsGif() {
    if (typeof GIF === 'undefined') {
        alert('GIF export library is not loaded. Please refresh and try again.');
        return;
    }

    const race = state.activeRaceState;
    if (!race || race.totalFrames <= 0 || !Array.isArray(race.charts)) {
        alert('Race frames are not ready yet. Apply filters in Bar Chart Race mode first.');
        return;
    }

    stopRacePlayback();
    const startPosition = race.position || 0;
    const steps = Math.max(0, race.totalFrames - 1);
    const frameCount = Math.max(1, Math.min(RACE_GIF_MAX_FRAMES, steps * RACE_GIF_SUBSTEPS + 1));
    const speedMs = state.racePlaybackSpeedMs || 260;
    // GIF delays below 20ms get slowed down by most viewers, so a long race
    // plays faster by dropping in-between frames rather than shortening them.
    const delay = Math.max(20, Math.round((speedMs * steps) / Math.max(1, frameCount - 1) / 10) * 10);

    const first = composeRaceFrame(race, 0);
    const workerScriptUrl = await getGifWorkerScriptUrl();
    const gif = new GIF({
        workers: 2,
        quality: 10,
        width: first.width,
        height: first.height,
        workerScript: workerScriptUrl
    });

    try {
        for (let index = 0; index < frameCount; index++) {
            const position = frameCount === 1 ? steps : (index * steps) / (frameCount - 1);
            const frame = index === 0 ? first : composeRaceFrame(race, position);
            // Hold the last frame so the final standings can be read.
            gif.addFrame(frame, { copy: true, delay: index === frameCount - 1 ? 3000 : delay });
            if (index % 40 === 39) await waitForNextPaint();
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
        if (state.activeRaceState === race) race.drawAt(startPosition);
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
    state.allTracks.forEach(track => {
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
    if (!state.lastRenderedListState.isComparison) {
        return state.lastRenderedListState.current;
    }

    const target = getComparisonEditTarget();
    return target === "right" ? state.lastRenderedListState.right : state.lastRenderedListState.left;
}

function getAlbumSeedsFromCurrentList() {
    const listState = getGridBaseListState();
    const entities = Array.isArray(listState?.entities) ? listState.entities : [];
    const entityType = listState?.entityType || "track";

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

async function exportCurrentListAsGrid() {
    if (typeof html2canvas === 'undefined') {
        alert('Export library is not loaded. Please refresh and try again.');
        return;
    }

    const gridX = Math.min(GRID_MAX_SIDE, Math.max(1, parseInt(document.getElementById('grid-size-x')?.value, 10) || 1));
    const gridY = Math.min(GRID_MAX_SIDE, Math.max(1, parseInt(document.getElementById('grid-size-y')?.value, 10) || 1));
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
    captureRoot.style.fontFamily = 'var(--font-stack)';
    
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

if (exportOptionsToggle && exportOptionsPanel) {
    exportOptionsToggle.addEventListener("click", () => {
        // A race on screen exports as a GIF, which has no line of filters.
        const race = Boolean(state.activeRaceState);
        const title = document.getElementById("export-modal-title");
        if (title) title.textContent = race ? "Export as GIF" : "Export as image";
        if (confirmExportButton) confirmExportButton.innerHTML = `<i class="fas fa-download" aria-hidden="true"></i>${race ? "Download GIF" : "Download PNG"}`;
        const filtersOption = document.getElementById("export-include-filters")?.closest("label");
        if (filtersOption) filtersOption.hidden = race;
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
