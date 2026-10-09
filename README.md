# lastfmlists

Lists, charts, statistics and games made from your Last.fm scrobbles. The site runs in your browser, and your data stays there.

## Project layout

The site is plain HTML, CSS and JavaScript with no build step. `index.html`
loads `js/main.js` as an ES module; the browser resolves the rest.

    js/config.js          tuning constants, API key, UI copy shared with index.html
    js/state.js           the mutable state every module reads and writes
    js/dom.js             long-lived element handles, HTML escaping, modals, control values
    js/time.js            local-calendar day, week and duration helpers
    js/api/               rate limiter and the Last.fm endpoint wrappers
    js/data/              history loading, IndexedDB storage, metrics, equations, filtering
    js/ui/                shell, lists, charts and the race, filter panel and its controls,
                          entity pages, exporting, the support banner
    js/games/             shared scrobble index, records, the right-answer confirmation,
                          and the three games
    js/main.js            entry point: loads a user's data and wires the flows that span modules

Because it uses ES modules, opening `index.html` straight off disk will not
work. Serve the folder over HTTP instead (`python3 -m http.server`).

Unreleased:

- Album covers in lists. Last.fm sends a cover with every scrobble, so most covers need no extra requests. Covers are saved with the rest of your data, and any that are missing are looked up when their row scrolls into view. Tracks use the cover of the album you played them from most, and artists use the cover of their most-played album.
- Every artist, album and track has its own page. Click a row in a list to open it. The page shows your scrobbles, your library rank, the rank among that artist's tracks or albums, your first and last play, a link to the Last.fm page, and up to three high placements. It also has a graph of your plays over time, and, behind "Show all lists", your rank in every year, month and week, the last 7 to 365 days, the play milestones, the streak rankings and the other rankings. Clicking any ranking opens that list with the entity's row highlighted, so the position on the page always matches the list. The browser's Back button returns to the page as you left it.
- The filter panel is easier to use. Minimum and maximum boxes sit together in one card with a Clear button. Months, weekdays, days of the month and years are toggle chips. Name filters and tags show their word groups as chips. List length, recent days, the long-gap setting and tracks per artist have common choices plus Custom. X is named after what it means for the chosen sort and only shows when that sort uses it. Clicking a filter chip above the list opens that filter.
- Higher or Lower raises the difficulty smoothly over the first 20 wins, shows album covers, and does not repeat the same pair twice in a row. Put Them In Order goes from three items to four after three wins and to five after nine, and does not reuse the same set of items twice in a row. Fill the List skips the last 20 lists instead of refusing to repeat any list for the whole visit, which used to end the game once everything had been played. A green confirmation appears for every right answer.
- The Fill the List setup uses toggle chips and cards with short descriptions, and a round has an Options button that returns to it.
- A small banner asks for a donation after you have viewed five different lists or spent ten minutes on the site. It has "Not now", "I already donated" and "Don't show again", and it does not return after the last two or after you follow a Ko-fi link.
- Date range filters use your local midnight. They used UTC midnight, which put late-evening plays into the wrong day for anyone outside UTC.
- A list length of 0, or the "All" choice, shows every row.
- Plainer wording across the site and in this README.
- Failed loads now say what went wrong. A misspelled username, an empty account or an unreachable API used to drop you on an empty page with the reason only in the browser console; you now get a message on the welcome screen and the form back to try again.
- Fixed the week grouping. "Different weeks" and the bar race could put one calendar day into two different weeks depending on what time you scrobbled, and "max consecutive weeks" merged the last week of a year with the first week of the next, which cut streaks short.
- Fixed day grouping across daylight saving. Day-based streaks used the current UTC offset for every historic scrobble, so late-evening plays from the other half of the year landed on the wrong day.
- The "show all scrobbles" list respects both settings at once. With a per-artist cap set, it returned fewer rows than the list length you asked for.
- Track, artist and album names are escaped everywhere they are shown, so a name containing HTML renders as text instead of being interpreted by the browser.
- Your light/dark choice is remembered between visits, and the page starts in your system theme instead of always starting light.
- Escape closes the export dialogs.
- Usernames with characters that need URL encoding are handled correctly.
- Split the single 8,400-line script.js into modules under `js/`. No behaviour
  change; the page now loads `js/main.js` as an ES module.

Version 2.1 changelog:

- Faster first load: history pages are now fetched in parallel instead of one at a time, so accounts with hundreds of thousands of scrobbles load faster.
- Bigger page requests when Last.fm allows them, with an automatic fall back to the safe size. The page count is worked out from what the server actually returns, so no scrobbles get dropped either way.
- Live preview while loading: your top tracks or artists fill in from the scrobbles fetched so far. The filtered list replaces the preview once loading finishes.
- Top artist, album and track stats are fetched at the same time instead of one after another.
- Added a request rate limiter that keeps loading within Last.fm's limit of 5 requests per second (per IP), with automatic back off if the API returns a rate-limit error. Since everything runs in your browser, each user has their own budget.
- Filters and sorts that need detailed metadata (track length, tags, global listeners/playcount, time spent listening, percentage of global scrobbles) are now disabled until you load detailed data. Hovering a locked filter tells you how to turn it on.
- Reworded the Load Details and Load All Details buttons so hovering them explains what they download and which lists they turn on.

Version 2.0 changelog:

- New design: redesigned top panel and Base Settings, and a layout that works on desktop and mobile.
- Bar charts: single and comparison modes.
- Bar chart race: animated race mode with playback controls, configurable frame speed, date range and frequency, plus GIF export.
- Comparison mode: independent left/right filters and equations so both sides render separate lists or charts.
- Equations pipeline: separate equations for each side of a comparison, supporting `filter`, `sort` and `unique`.
- Exporting: PNG export for charts and full results via `html2canvas`, GIF export for race animations using an optimized encoder.
- Chart controls: axis orientation, linear or log scale, and colours that follow the light or dark theme.
- Faster heavy filters, race frame building and large datasets.

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
