// Exporting what is on screen: list or chart as PNG, race as GIF, album
// artwork as a collage grid.

import { fetchAlbumCoverUrl } from '../api/lastfm.js';
import { DISPLAY_MODE_BAR_RACE, EXPORT_MAX_ROWS_PER_COLUMN } from '../config.js';
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
    hasRaceSettingsReady
} from './charts.js';
import { getComparisonEditTarget } from './filters-panel.js';
import { getSelectedDisplayMode } from './lists.js';

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

    if (!state.activeRaceState || state.activeRaceState.totalFrames <= 0 || typeof state.activeRaceState.updateFrame !== 'function') {
        alert('Race frames are not ready yet. Apply filters in Bar Chart Race mode first.');
        return;
    }

    const captureTarget = document.getElementById('results-section');
    if (!captureTarget) {
        alert('Could not find chart section to export.');
        return;
    }

    const frameDelayMs = 260;
    const originalFrameIndex = state.activeRaceState.frameIndex || 0;

    if (state.racePlaybackTimerId !== null) {
        clearInterval(state.racePlaybackTimerId);
        state.racePlaybackTimerId = null;
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
        for (let frameIndex = 0; frameIndex < state.activeRaceState.totalFrames; frameIndex++) {
            state.activeRaceState.updateFrame(frameIndex);
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
        if (state.activeRaceState && typeof state.activeRaceState.updateFrame === 'function') {
            state.activeRaceState.updateFrame(originalFrameIndex);
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
