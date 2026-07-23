# lastfmlists
A small project to create lists based on last.fm data

Version 2.1 changelog:

- Faster first load: history pages are now fetched in parallel instead of one at a time. Big accounts (hundreds of thousands of scrobbles) load much quicker.
- Bigger page requests when Last.fm allows them, with an automatic fall back to the safe size. The page count is worked out from what the server actually returns, so no scrobbles get dropped either way.
- Live preview while loading: your top tracks or artists start filling in from the scrobbles fetched so far, so you're not staring at a blank screen. The real filtered list replaces it once loading finishes.
- Top artist, album and track stats are fetched at the same time instead of one after another.
- Added a request rate limiter that keeps loading within Last.fm's limit of 5 requests per second (per IP), with automatic back off if the API returns a rate-limit error. Since everything runs in your browser, each user has their own budget.
- Filters and sorts that need detailed metadata (track length, tags, global listeners/playcount, time spent listening, percentage of global scrobbles) are now disabled until you load detailed data. Hovering a locked filter tells you how to turn it on.
- Reworded the Load Details and Load All Details buttons so hovering them explains what they download and which lists they turn on.

Version 2.0 changelog:

- Full UI rework: redesigned top panel, Base Settings, and responsive layout for desktop and mobile.
- Bar charts: integrated chart visualizations (single and comparison modes) for fast summary views.
- Bar chart race: animated race mode with playback controls, configurable frame speed, date range and frequency, plus GIF export.
- Comparison mode: independent left/right filters and equations so both sides render separate lists or charts.
- Equations pipeline: powerful per-side equations supporting `filter`, `sort`, `unique`, and comparison workflows.
- Exporting: PNG export for charts and full results via `html2canvas`, GIF export for race animations using an optimized encoder.
- Chart controls: axis orientation, linear/log scales, and theme-aware colors for consistent visuals in light/dark modes.
- Performance and stability: optimizations for heavy filters, race frame building, and large datasets.

Version 1.2 changelog:

- Added time-of-day filtering (start/end)
- Added session starter filter with configurable long-gap threshold
- Added day starter filter modes:
    - Off (default)
    - First of the day (literal)
    - First of the day (smart, uses long-gap threshold to filter out late-night listening sessions)
- Added sorting modes:
    - Most scrobbles in a single day/week/month
    - Most scrobbles within rolling 24h/168h windows
- Improved performance for heavy filters/sorting (especially streak-based modes)
- Improved active filter labels:
    - Session/day starter labels only show when enabled
    - X only shows when sorting mode uses it
    - Long-gap value only shows when a starter filter uses it

Version 1.1 changelog:

- Reworked UI
- Fixed timezone bugs (except DST)
- Added first to x and fastest to x sorting periods
- Added last scrobble filters
- Added option to show all scrobbles that pass the filters
