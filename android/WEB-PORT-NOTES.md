# Android implementation handoff (0.2–0.4)

## 0.4 additions (supersede conflicting behaviour below)

### Detail-page priority and disclosure

Summary highlights now prefer useful, populated ranking pools. Eligible sources are yearly, monthly, weekly winners, streaks, then other top-10 rankings. Sort first by rank, then by the number of entries in the ranking pool, and use that source order only as a tie-breaker. Initial-letter and equal-name-length lists never occupy the three summary slots because a unique character can create a meaningless one-entry #1.

The expanded detail view opens with nonempty yearly positions. Month, week, milestone, streak and other groups are separately collapsed. Omit zero-play months and weeks. Weekly positions always require a deliberate expansion, even if every week is nonempty. Initial-letter and name-length positions live at the end of Other rankings. An empty streak or other group explains that the entity has no top-100 or top-10 placement in that section.

Milestones have an editable positive play count. Recalculate First to X and Fastest to X for that X, retaining the established definition of fastest. If the entity has not reached X, explain why it has no position and still provide buttons to open both complete milestone lists.

### Listening graph

The graph has a numeric y-axis at 0, half the peak and the peak. A pointer opens a period list only when it lands within a nonzero bar rectangle; space above a bar and zero bars are inert. Previous/next buttons move through nonempty buckets, show the chosen dates/count and expose an Open list action. Month and year buckets link through `year`/`month`; day and week buckets use inclusive date ranges.

### Lists, ordering, export and profile

Ordering uses a 220 ms hold and compact rows when a round has more than three entries. Up/down buttons share one row so four- and five-item rounds fit without list scrolling on common phone heights.

The type selector is centered. Comparison remains left of the centered Filters button; Reset, using a restart icon and explicit accessibility label, is right. List/Chart and full-library positions moved into the Display filter group. The result header shows rank basis plus all active filters in one ellipsized line. Expanding it shows individual chips; selecting a chip opens the exact filter group and focuses text fields when applicable.

PNG export always opens the Android Sharesheet with URI clip data and a native image preview. Android 14+ receives a leading Save to Downloads custom action. No file picker opens before the Sharesheet. Filenames use content type plus a readable local date/time; a same-second collision adds `-2`, `-3`, and so on instead of a long opaque number. The save action writes to `Downloads/lastfmlists`.

Refresh `user.getInfo` on every library sync, store a returned non-placeholder avatar, and show it in the Lists header and Library card. A letter fallback remains when Last.fm supplies no usable image.

The support prompt follows the Material dialog hierarchy: centered icon, short title, supporting copy, full-width primary Ko-fi action, then two quiet secondary choices. Keep the trigger and persistence rules from 0.3.

## 0.3 additions (supersede conflicting 0.2 behaviour below)

### Detail-page summary and rankings

The default page is now a summary: overall library rank, rank within the artist (for tracks/albums), first/last listen, a Last.fm link, and at most three high placements. Eligible highlights are top-10 yearly, initial-letter, equal-name-length, streak and other rankings; **weekly highlights are eligible only at #1**. Sort highlights by rank ascending, then play count descending, and keep three so the graph is not pushed far down. “Show all lists” expands the previous yearly/monthly/streak/miscellaneous breakdown plus the new weekly, name-length and milestone lists. Toggling it does not change the underlying rankings. On phones the detail page hides the global app header and bottom tabs to make room for the graph; retain a visible Back to list action and system back navigation.

Artist-relative ranking uses the same entity type, exact `artist-name`, `limit=0`, and scrobble-count ordering. Include the whole artist library, not the currently filtered list. The displayed ordinal rank must equal the entity's position in the linked list.

Name-length ranking means **ranking by play count among names with the same character count**, analogous to initial-letter lists. Use `<entity>-name-length-min = N` and `...-max = N` with no result cap. N follows the existing engine's string-length convention (UTF-16 code units, including spaces/punctuation); do not silently substitute grapheme counting in the web port.

For First to X and Fastest to X, X is now 100 when the downloaded library contains at least ten distinct tracks with 100+ plays; otherwise X is 50. Count qualified tracks across the entire downloaded library, even when the selected page is an artist or album. This threshold is shared by both milestone links. These two lists remain available in the expanded view regardless of rank; an entity that has not qualified has no invented rank, and the page still offers links to the qualifying lists. Summary highlights require top 10. Other X-based sorts retain X=10. Preserve the existing engine's definition of Fastest to X: elapsed time from first listen to reaching X, not the fastest arbitrary rolling run of X plays.

Weeks are local-calendar Monday–Sunday, including weeks that cross December/January. Group all plays by the Monday date. A weekly link uses inclusive `date-range-start` and `date-range-end` for that exact seven-day period, same entity type and unlimited results. Keep empty weeks with zero plays/no rank in the expanded display. Its year selector includes a week if either endpoint is in that year; cross-year weeks therefore appear in both relevant year views, but each is a single seven-day ranking. Use the existing stable ordinal tie ordering, not shared ranks.

Keep direct Last.fm links, encoding each path segment independently: artist `/music/<artist>`, album `/music/<artist>/<album>`, track `/music/<artist>/_/<track>`.

### Listening bar graph

Implementation: `ListeningTimeline.kt` and `EntityTimeline.kt`. Place it after summary rankings and before the expansion button/detailed lists. Default to **All time / Monthly**. All time spans the earliest through latest downloaded scrobble across the library, so newly discovered items have honest zero periods before discovery. Presets include the last year and last three months ending at the latest downloaded day, plus custom inclusive start/end dates.

Offer Daily, Weekly, Monthly, Yearly and Automatic. Daily is available only for a range of at most one calendar year, including leap-year handling (`end <= start.plusYears(1).minusDays(1)`). If a previously selected Daily range becomes longer, use Automatic. Automatic selects daily through 90 days, weekly through 730 days, monthly through 7300 days, and yearly above that. Invalid/reversed dates show an error. Android bounds custom ranges below 200 years to avoid pathological allocations.

Include every bucket, even zero-count buckets. Weeks start Monday; months and years use calendar boundaries. Clip first/last buckets to the chosen range and count only plays within it. Use the full entity key, including artist for albums/tracks. The sum of bar counts must equal that entity's plays in the requested range for every resolution.

Draw narrow bars in one chart width with a zero baseline and heights relative to the largest bucket. Display start/end dates, total and peak count. A tap inspects a bucket's dates and count. Android's chart is 130dp high; use a similarly compact responsive layout on the website. This is a static listening-count graph, not the removed animated race chart.

### Fill the List and ordering

The Games menu no longer contains Fill the List settings. Selecting its card opens a setup screen with a short explanation, Answer types, List categories, Hard mode and Time limit, followed by Start game. At least one type and one category are required. Inside a round, Options returns to setup; starting from setup creates a new round. The main Games type selector is labelled for Higher or Lower / Ordering only, because Fill the List has its own type selection.

Ordering drag now belongs to the **list container**, not per-row handlers that restart as rows move. Track the dragged entity by stable key and its center in viewport coordinates. Render its translation relative to its current measured row position; change the array when that center crosses a neighbouring row midpoint. Use measured row heights, not a fixed 64dp threshold. Disable user scrolling while a row is held so the list scroll detector cannot cancel the drag. Account for content padding when converting touch positions to item offsets. Keep the gesture alive through index changes, bring the dragged row above neighbours, and auto-scroll near the viewport edges. Clear drag state on drop/cancel. Retain up/down buttons as an accessible alternative. The gesture test moves an item down multiple positions and back up.

### Support prompt

Use kinder copy explaining that the project is independently maintained, donations are appreciated, and all features remain free. Replace the former export-triggered prompt with a prompt after **five distinct successfully viewed list queries**. Android waits 1.5 seconds on the list screen after nonempty results finish, so fleeting navigation, empty results and errors do not count. Query identity includes type, sort, X, limits, filters and equations; ignore blank filters and serialize filter keys consistently. Track account + query identity locally using SHA-256. Repeated views of the same query count once; distinct comparison sides can count separately.

Only show the prompt on the list screen when no detail page or filter/export/history dialog is open. Include Support on Ko-fi, Not now and Hide forever. Record that it was shown immediately; this version shows it at most once per installation. Hide forever persists and also respects the existing `hideSupportPrompt` setting. No tracking is sent to a server. Release builds still follow the existing external-tip feature flag. Do not remove the voluntary support card when a user disables prompts.

### List history

Add a history button next to export. Save up to 50 recent successful viewed list configurations **per account**. Record history immediately when results finish on the list screen; the 1.5-second delay applies only to the support prompt. A snapshot includes complete left/right queries, comparison enabled state and timestamp. Deduplicate identical visible configurations and move a revisited entry to the front. Failed calculations and unviewed filter drafts are not history entries. History stores configuration, not result data; restoring reruns it against the current saved library, so counts can change after downloading more history.

Restore both sides, comparison state, type, sort, X, result limit, per-artist cap, filters and equations exactly; return to Lists and reset scroll through the existing query/result reset logic. Persist history locally across restarts. Do not mix accounts or restore someone else's data. Android uses `ListSnapshot`, `QueryJson` and `ListHistory`; the same schema can use IndexedDB/local storage on the web.

Additional acceptance checks: artist/name-length/weekly links reproduce displayed ranks; weekly boundaries survive year changes; the 9/10-qualified-track milestone threshold switches correctly; all graph resolutions preserve totals and include zero periods; daily is disallowed beyond a calendar year; history round-trips comparison settings without crossing accounts; repeated queries do not trigger the support prompt; Hide forever survives restart; long-press dragging down and back up preserves the gesture.

Only the Android project was changed. This document describes the two larger refactors and their contracts so a web implementation can use equivalent behaviour without copying Android UI code.

## Entity pages

Implementation: `core/.../EntityPages.kt` (calculations) and `app/.../EntityPage.kt` (UI).

Open a dedicated page when a ranked artist, album or track is selected. A raw scrobble opens its track page. Keep the full entity identity: artist names are case-insensitive keys; album and track keys include the artist plus the name. Never merge identically named albums or tracks by different artists. Preserve original display names.

The page uses the entire downloaded library, regardless of filters on the list that opened it. Show:

- Total plays, overall ordinal rank, first listen and last listen.
- Total plays of the artist, including other albums/tracks; links to all of that artist's tracks and albums with no result limit.
- Initial-letter ranking: compare names starting with the same first Unicode code point, case-insensitively. **Initial means first letter, not first appearance in the library.** Preserve punctuation/digits; do not strip “The” or other prefixes. Label the letter explicitly. A track named “Alpha” compares against all tracks starting with A, across artists.
- A year row for every year between the earliest and latest downloaded scrobble, including years with zero plays. Each row has count and rank among all entities of the same type in that year. Zero plays has no rank, displayed as a dash.
- All 12 months for a selected year, with the same count/rank semantics. The year selector spans the whole history; the last downloaded year is selected initially.
- Consecutive-scrobble, day, week and month streak rankings only when the entity is in the top 100.
- Other existing sort rankings only when in the top 10. Android currently uses X=10 for X-based rankings and states 10 in their labels. Exclude raw chronological-scrobble sorts and duplicate overall play-count rankings. Metadata-dependent rankings with an unavailable/zero metric are omitted.

Dates use the user's local calendar. Rankings use stable descending count ordering and the existing engine's ordinal ties: equal counts retain first-appearance order within the period, rather than sharing a rank. Other sorts use their existing ascending/descending semantics. Do not rank within the artist unless the link explicitly says it is an artist list.

### Navigation contract

Every ranking row carries a complete list query, not just a display label. Opening it replaces the current list, disables comparison and resets scroll to the top. Use `limit=0` and no per-artist cap. Year links set only `year`; month links set `year` and `month`; initial links set `<entity>-initial`; artist-track/album links set exact `artist-name`. **Do not add the selected entity's name to a year/month/initial query**—the destination must show the full ranking that produced the displayed position. Streak/miscellaneous links carry the corresponding sort and X value.

Counts and ranks must agree with the linked list. The core tests compare those links to normal engine results, including missing years, empty months, duplicate album names and initial-letter ranking. Label partial downloads so their ranks are not mistaken for a complete account history.

### Performance

Compute yearly/monthly counts with grouped counts over chronological plays and stable sorting; do not rerun a complete analysis once per entity. Android computes the overview, selected year's months, and special rankings off the UI thread. Cache by history revision + entity type/key in a web implementation. Invalidate when history/metadata changes. Only compute detailed sort rankings once per page/revision, not on each render.

## Visual equations editor

Implementation: `core/.../EquationPlan.kt` defines the model and codec; `app/.../EquationEditor.kt` renders controls. The existing `Equations.kt` executor is retained. There is no `eval` or executable user code.

### Step model

A pipeline is an ordered array of steps. The visual operation names map to existing syntax:

| Visual operation | Existing syntax | Meaning |
| --- | --- | --- |
| Keep matching plays | `filter <left> <comparison> <right>` | Retain matching scrobbles |
| Order plays | `sort <field> asc/desc` | Order surviving scrobbles |
| Keep first per value | `unique <field> <limit>` | Keep the first N surviving scrobbles for each value |
| Show value | `show <field>` | Add a field to displayed result rows |

Rules run after normal filters and before grouping/ranking. Full-library fields (counts, ranks, first listen etc.) retain full-library semantics. `unique` limits plays, **not distinct tracks**; it can therefore change grouped counts. Multiple filter steps are AND. This editor does not add OR groups or change the executor's language.

Expose fields using a shared ID-to-readable-label catalogue. For example `track-scrobble-count` becomes “Track play count”, `artist-rank` becomes “Artist library rank”, and `track-duration` includes the seconds unit. Backend IDs are visible only in the optional advanced text editor. Use the same labels for extra displayed columns.

### Operand tree

Each side of a comparison can be:

1. A library field.
2. A number (validated as finite).
3. Literal text.
4. A calculation with a left operand, operation and right operand. Children may themselves be calculations.

Operations are add, subtract, multiply, divide and remainder. Serialize every calculation group with parentheses so nesting is unambiguous. Text compares only with text and supports equals/not-equals. Arithmetic requires numeric operands. Blank/invalid numbers, invalid keep limits and incomplete comparisons block Apply with a plain-language error. Missing metadata and division by zero retain the executor's existing non-match behaviour.

Steps can be added, removed and moved up/down. Preserve a visual draft while editing; serialize valid edits into the existing equation pipeline on Apply. Reset must clear both the rendered draft and its serialized value. The Android UI currently serializes valid draft edits locally before Apply but does not affect the active list until Apply.

### Existing queries and advanced mode

Decode existing pipelines into the step/operand model, respecting arithmetic precedence, parentheses, negative numbers, case-insensitive field names, quoted names, and semicolons inside quotes. Round-trip through the codec without changing the resulting list. When a query cannot be decoded, keep its original text and show the advanced editor with an error; do not erase or silently replace it. No migration of stored website queries should be destructive.

The executor does not provide quote escaping. Android selects a quote style not present in the literal and rejects a literal containing both quote styles. A web implementation can extend the grammar deliberately if needed, with parser and round-trip tests.

### Tutorial examples

The optional guide explains step order and the difference between filtering, ordering, limiting plays and adding columns. Example buttons explicitly replace the draft:

```text
filter track-scrobble-count >= 10

filter (track-scrobble-count / artist-scrobble-count) >= 0.1

sort scrobble-order desc;
unique artist-name 3;
show artist-rank
```

Labels: “Tracks with at least 10 plays”; “Tracks with at least 10% of their artist's plays”; “Last 3 plays per artist, with library rank”. The second example is a share of artist plays, not a global percentage.

## Related Android behaviour changes

- Plain labels replace promotional headings and game descriptions.
- Fixed scrolling dialogs replace draggable filter/export sheets. Internal scrolling no longer hands bottom-edge flings to a sheet drag animation.
- Changed queries/results create fresh list/chart scroll state.
- Comparison shows both panels on phones too; portrait displays a rotate suggestion. Landscape reduces header content to leave room for rows.
- Name includes/excludes syntax help appears only after text is entered in that field.
- Filters are a labelled primary button. Library and Settings are separate destinations.
- Canonical account keys remain lowercase for storage/API identity; a separate per-account display name preserves entered capitalization.
- The root layout consumes scaffold insets and then applies keyboard insets; bottom navigation hides while the keyboard is visible. Dialogs also handle keyboard insets.
- Race charts, race controls and GIF export have been removed. Static charts remain.
- PNG exports offer Save on device (default) and Share. Save uses Android's document picker, with a save/cancel result; no broad storage permission is needed.

## Port acceptance checks

1. A track's displayed yearly/monthly/initial rank equals its position in the destination list.
2. Zero periods stay visible without invented ranks. Same-name entities from different artists stay separate.
3. Top-100 and top-10 sections enforce their cutoffs and omit unavailable metadata rankings.
4. Old equation pipelines produce the same results after visual editing/serialization.
5. Nested arithmetic, quoted semicolons, step order and invalid intermediate input are tested.
6. Reset clears the draft, and cancelling the editor leaves the active query unchanged.
7. No website source changes are required to consume this document; implement the port separately.



