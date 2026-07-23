# Games — design doc

Two games built on the user's already-loaded scrobble library: **Higher-Lower** and **Fill the List**. Neither needs any extra API calls — everything runs on the data the site has already fetched, so the games work the moment a library is loaded and don't touch the rate budget.

## Where the games live

- A **Games tab** inside the current UI, next to the lists view. Prominent button, but disabled until the user has loaded their data (same gating pattern as Load Details). Hovering the disabled tab says you need to load your data first.
- Switching between Games and Lists is one click, no reload, no losing state on either side.
- Facets that need extended metadata (time spent listening, percentage of global scrobbles) only enter the game pools when `extendedDataLoaded` is true, same flag the filters use.

---

## Game 1: Higher-Lower

Two items from your library, guess which one you've scrobbled more. Correct answer extends the streak, wrong answer ends the run. Show current streak and best streak.

### Setup

The player picks **one entity type before the run** — artists, albums, or tracks — and the whole run stays on that type. No mixing types mid-run.

### Candidate pools

Same qualification idea as the detailed-data selection. An item is fair game if it clears either bar:

| Type   | Qualifies if                        |
|--------|-------------------------------------|
| Artist | top 300 by rank, or ≥ 100 scrobbles |
| Album  | top 500 by rank, or ≥ 50 scrobbles  |
| Track  | top 1000 by rank, or ≥ 10 scrobbles |

### Difficulty ramp

Difficulty is the **ratio** between the two counts, not the absolute gap. 500 vs 250 is easy, 500 vs 470 is brutal. The run starts with warmup rounds from the most familiar items at generous ratios, then widens the pool and tightens the ratio:

| Rounds | Pool depth | Ratio band   |
|--------|-----------|--------------|
| 1–3    | top 50    | 2.0 – 3.0    |
| 4–6    | top 100   | 1.6 – 2.2    |
| 7–10   | top 250   | 1.35 – 1.7   |
| 11–15  | top 500   | 1.15 – 1.4   |
| 16+    | full pool | 1.01 – 1.15  |

Bands overlap a little on purpose so tier jumps don't feel like a wall. All numbers are tuning knobs.

### Pair selection

1. Pick a random **anchor** from the current tier's pool.
2. Roll a target ratio from the tier's band.
3. Find candidates whose count is closest to `anchor / ratio`, pick randomly among the nearest few (not always the single closest, or pairs get repetitive).
4. Randomize which side each item is shown on so position never hints at the answer.
5. Keep the last ~10 shown items in an exclusion list so the same names don't keep coming back.

### Edge cases

- **Ties / near-ties:** if both counts are equal (or within 1), accept either answer as correct. Nobody should lose a 20-streak to a coin flip.
- **Small libraries:** if the pool doesn't reach a tier's depth, clamp to what exists and rely on the ratio band for difficulty. The game should never stall because someone has 8k scrobbles.

---

## Game 2: Fill the List

The site rolls a random top-10 list from your library, shows you the filter it used, and you type in as many of the 10 entries as you can. Sporcle-style. Score is hits out of 10, order doesn't matter.

- One **random puzzle** at a time, with a **"new list" button** to roll another whenever you want. No daily puzzle — every library is different, so a shared daily doesn't make sense here.
- Optional **time limit** (off / 1 min / 2 min / 5 min), counting down Sporcle-style. With the timer off you play until you give up and reveal.
- On reveal, show the full list with the ones you got highlighted.

### Pre-game options

Three small groups of toggles, so people play only what they care about:

- **List types:** Artists / Albums / Tracks — any subset. Album-haters untick albums, album-lovers untick everything else.
- **Puzzle categories:** Sorting / Time / Names & words / Deep cuts — any subset. This is also the filter-vs-sorting split: untick Sorting and you only get filter-based puzzles.
- **Hard mode** (off by default): hides the artist name on track and album puzzles. The default view shows the artist — that's just the normal game, it isn't labeled "easy".

A facet is in the active pool only if its entity type and its category are both enabled (and its data exists).

### The meta-filter

Every candidate list passes through this before it's allowed to become a puzzle:

1. Drop entries with fewer than 5 scrobbles.
2. If fewer than 10 entries remain, reject the whole puzzle and roll a new one.

This one rule kills most bad puzzles (too obscure, too short) before the player ever sees them.

### Facet catalog

One facet per puzzle. (A "combine two filters" toggle could be added later for people who want pain, but it's off the table for v1.)

**Sorting** *(artists / albums / tracks)*
- Most scrobbles in a single day
- Max consecutive scrobbles
- First to 50 / 100 / 200 scrobbles
- Fastest to 50 / 100 / 200 scrobbles
- Most separate days / weeks / months scrobbled
- Longest listening streak

**Time** *(artists / albums / tracks)*
- A specific year
- A month across all years ("your Octobers")
- A specific year + month
- A weekday
- Last 7 / 30 / 90 / 180 / 365 days

**Names & words** *(initial and word: all types; length: artists)*
- Starts with a given letter
- Name contains a common word (love, black, night, home, time, …) — only words that actually appear often enough in the user's library
- Artist name exactly N letters, N kept small (3–6). Nobody wants to count to 14.

**Deep cuts** *(recency: all types; one-hit: artists)*
- First scrobbled in year X — any year after the account's first scrobble (the meta-filter naturally skips gap years)
- Not played in the last 30+ days
- Not played in the last 365+ days
- One-hit wonders: artists with exactly 1 track scrobbled

**By artist** *(tracks / albums)*
- Top 10 tracks (or albums) of a specific artist, drawn from the user's top 25 — only artists that themselves pass the meta-filter (at least 10 tracks with ≥ 5 scrobbles). The artist is always shown here since it's the prompt itself.

### Balanced randomization

Three layers keep it varied without feeling random-for-random's-sake:

1. **Category deck.** Enabled categories go into a deck, shuffled, dealt one per puzzle without replacement, reshuffled when empty. Guarantees you cycle through all enabled categories before any repeats — never the same category twice in a row (unless only one is enabled).
2. **Facet cooldown.** Within the drawn category, pick a facet weighted-random, but a facet's weight drops to near zero right after it's used and recovers over the next several puzzles. No "starts with H" followed by "starts with M".
3. **Value weighting.** The concrete value (which year, which letter, which word) is sampled weighted by how many qualifying entries it yields, so the roll lands on values that produce real lists. Years you didn't listen, letters with two songs, words that barely appear — all effectively never come up.

Then the meta-filter runs. If the puzzle is rejected, draw again — with a cap on attempts and a guaranteed fallback (overall top 10 of an enabled type) so the game never hangs searching for a puzzle.

### Answer matching

Typed answers are normalized on both sides before comparison, Sporcle-style. Getting robbed of an answer you clearly knew is the fastest way to make someone quit, so matching is generous:

- Case-insensitive.
- Punctuation and special characters ignored — unless the title is *entirely* punctuation (e.g. "!!!"), in which case it's matched as-is.
- Diacritics folded (motorhead matches Motörhead).
- Suffix junk stripped from the target: "- Remastered 2011", "(Deluxe Edition)", "feat. …" and the like.
- Partial titles accepted when unambiguous within the answer list; if a typed prefix matches two answers, it fills the exact one only.

Score: X/10, order-independent. A ranking bonus (extra points for also knowing the positions) can come later; it's not in v1.
