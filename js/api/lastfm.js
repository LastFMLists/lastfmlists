// Thin wrappers over the Last.fm endpoints the app uses. Each returns plain
// data or null; none of them touch the DOM beyond progress messages.

import { API_KEY } from '../config.js';
import { loadingDiv, mapWithConcurrency } from '../dom.js';
import { albumCoverCache } from '../state.js';
import { fetchJsonWithRetry, rateLimitedFetch } from './rate-limit.js';

// Last.fm answers errors with HTTP 200 and a JSON body like
// { error: 6, message: "User not found" }, so a successful fetch says nothing
// about whether the request worked. Returns the message, or null when fine.
export function getLastfmErrorMessage(data) {
    if (!data || typeof data !== "object") return null;
    if (data.error === undefined || data.error === null) return null;
    const code = parseInt(data.error, 10);
    if (code === 6) return "That Last.fm username doesn't exist. Check the spelling and try again.";
    if (code === 8 || code === 16 || code === 29) return "Last.fm is busy or rate-limiting requests right now. Please try again in a minute.";
    return data.message ? `Last.fm returned an error: ${data.message}` : "Last.fm returned an error.";
}

// Which account the avatar on screen belongs to. The load flow marks the app as
// loaded more than once, and without this each pass costs another user.getInfo.
let avatarLoadedFor = null;

export async function updateSessionAvatar(username) {
    const avatar = document.getElementById('session-avatar');
    const avatarFallback = document.getElementById('session-avatar-fallback');
    if (!avatar || !avatarFallback || !username) {
        return;
    }
    if (avatarLoadedFor === username) {
        return;
    }
    avatarLoadedFor = username;

    avatar.style.display = 'none';
    avatar.removeAttribute('src');
    avatarFallback.style.display = 'inline';

    try {
        const response = await rateLimitedFetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json&autocorrect=0`);
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
        // Let a later load try again after a network blip.
        avatarLoadedFor = null;
        console.warn('Could not load profile image:', error);
    }
}

export async function fetchAlbumCoverUrl(albumName, artistName) {
    const cacheKey = `${albumName.toLowerCase()}||${artistName.toLowerCase()}`;
    if (albumCoverCache.has(cacheKey)) {
        return albumCoverCache.get(cacheKey);
    }

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&album=${encodeURIComponent(albumName)}&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&autocorrect=0`;
        const response = await rateLimitedFetch(url);
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

  
// Map a raw Last.fm recenttracks entry to our internal shape.
export function mapRecentTrack(track) {
    return {
        Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
        Album: track.album?.["#text"] || "Unknown",
        Track: track.name || "Unknown",
        Date: track.date?.uts ? parseInt(track.date.uts) * 1000 : null
    };
}

// Fetch the user's top artists from Last.fm
export async function fetchTopArtists(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json&limit=200&autocorrect=0`;
    
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
        const response = await rateLimitedFetch(url);
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

export async function fetchAllArtistDetails(artists, limit) {
    const limitedArtists = artists.slice(0, limit);
    const results = await mapWithConcurrency(
        limitedArtists,
        (artist) => fetchArtistDetails(artist.name),
        4
    );
    return results.filter(result => result !== null);
}

  
// Fetch the user's top albums from Last.fm
export async function fetchTopAlbums(username) {
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
        const response = await rateLimitedFetch(url);
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

export async function fetchAllAlbumDetails(albums, limit) {
    const limitedAlbums = albums.slice(0, limit);
    const results = await mapWithConcurrency(
        limitedAlbums,
        (album) => fetchAlbumDetails(album),
        4
    );
    return results.filter(result => result !== null);
}

  
// Fetch the user's top tracks from Last.fm
export async function fetchTopTracks(username) {
    const limit = 200; // Define limit explicitly for math
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getTopTracks&api_key=${API_KEY}&user=${encodeURIComponent(username)}&limit=${limit}&format=json&autocorrect=0`;
  
    try {
        const firstData = await fetchJsonWithRetry(baseUrl);
        if (!firstData || !firstData.toptracks) return [];
  
        const totalTracks = parseInt(firstData.toptracks['@attr'].total, 10) || 0;
        const totalPages = parseInt(firstData.toptracks['@attr'].totalPages, 10) || 1;
        
        // Start with the tracks from the first page
        let allTracksFetched = [...firstData.toptracks.track];
        
        // Accurate UI update for Page 1
        loadingDiv.innerHTML = `<p>Loading top tracks... ${allTracksFetched.length} of ${totalTracks}</p>`;
        console.log(`Top Tracks: Page 1/${totalPages} fetched (${allTracksFetched.length} tracks).`);

        if (totalPages > 1) {
            const pageNumbers = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
            
            // Fetch remaining pages with concurrency
            const pagesData = await mapWithConcurrency(
                pageNumbers,
                (page) => fetchJsonWithRetry(`${baseUrl}&page=${page}`),
                3
            );

            pagesData.forEach((pageData, idx) => {
                if (pageData && pageData.toptracks && pageData.toptracks.track) {
                    allTracksFetched.push(...pageData.toptracks.track);
                    
                    // Logic: Current track count is simply the array length
                    const currentCount = allTracksFetched.length;
                    loadingDiv.innerHTML = `<p>Loading top tracks... ${currentCount} of ${totalTracks}</p>`;
                    console.log(`Top Tracks: Page ${idx + 2}/${totalPages} fetched (${currentCount}/${totalTracks}).`);
                }
            });
        }
        
        return allTracksFetched.map(track => ({
          name: track.name,
          artist: track.artist.name,
          user_scrobbles: parseInt(track.playcount, 10)
        }));

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
			const response = await rateLimitedFetch(url);
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

export async function fetchAllTrackDetails(tracks, limit) {
    const limitedTracks = tracks.slice(0, limit);
    const results = await mapWithConcurrency(
        limitedTracks,
        (track) => fetchTrackDetails(track),
        3
    );
    return results.filter(result => result !== null);
}
