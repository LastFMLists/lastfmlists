# Games design doc

Three games built on the user's already-loaded scrobble library: **Higher-Lower**, **Fill the List**, and **Put Them In Order**. None of them make an API call. Everything runs on data the site has already fetched, so the games work the moment a library is loaded and never touch the rate budget.

## Where the games live

- A **Games tab** in the main UI, next to the lists view. It stays disabled until data is loaded, with a tooltip saying so (same gating pattern as Load Details).
- Switching between Games and Lists is one click, with no reload and no state lost on either side.
- Anything that needs extended metadata (durations, tags, global stats) only appears once `extendedDataLoaded` is true, the same flag the metadata filters use.
- Personal records are kept in `localStorage`: best Higher-Lower streak per entity type, best Fill the List score, and best Put Them In Order perfect-round streak.

---

## Game 1: Higher-Lower

Two items from your library. Guess which one you've scrobbled more. A correct answer extends the streak, a wrong one ends the run.

### Setup

The player picks **one entity type before the run** (artists, albums, or tracks) and the whole run stays on that type.

### Candidate pools

An item is fair game if it clears either bar:

| Type   | Qualifies if                        |
|--------|-------------------------------------|
| Artist | top 300 by rank, or 100+ scrobbles  |
| Album  | top 500 by rank, or 50+ scrobbles   |
| Track  | top 1000 by rank, or 10+ scrobbles  |

### Difficulty ramp

Difficulty is the **ratio** between the two counts, not the absolute gap. 500 vs 250 is easy, 500 vs 470 is brutal. The run opens with familiar items at generous ratios, then widens the pool and tightens the ratio:

| Rounds | Pool depth | Ratio band  |
|--------|------------|-------------|
| 1-3    | top 50     | 2.0 to 3.0  |
| 4-6    | top 100    | 1.6 to 2.2  |
| 7-10   | top 250    | 1.35 to 1.7 |
| 11-15  | top 500    | 1.15 to 1.4 |
| 16+    | full pool  | 1.01 to 1.15|

The bands overlap slightly so tier changes don't feel like a wall. Every number is a tuning knob.

### Pair selection

1. Pick a random **anchor** from the current tier's pool, skipping anything shown recently.
2. Roll a target ratio from the tier's band.
3. **Steer the direction by where the anchor sits.** An anchor near the top of the pool looks for a smaller partner, one near the bottom looks for a larger one. Without this, an anchor at the floor of the pool asks for a value that doesn't exist there and ends up matched with its nearest neighbour, which is a near-tie.
4. Find candidates closest to the target by ratio, and pick randomly among the nearest few so pairs don't get repetitive.
5. **Validate the result.** Compute the pair's actual ratio and retry (up to 16 times) if it falls outside the tier's band. Only if the library is too small or too tightly clustered to hit the band does it fall back to the closest available pair.
6. Randomize which side each item appears on, so position never hints at the answer.
7. Keep the last ~10 shown items excluded so the same names don't keep reappearing.

Steps 3 and 5 exist because of a real bug: a bottom-of-pool anchor once produced a 76 vs 77 pair on round 7, where the band called for 1.35 to 1.7.

### Edge cases

- **Ties:** if both counts are equal, accept either answer. Nobody should lose a 20-streak to a coin flip.
- **Small libraries:** if the pool doesn't reach a tier's depth, clamp to what exists and lean on the ratio band. The game should never stall because someone has 8k scrobbles.

---

## Game 2: Fill the List

The site rolls a random top-10 list from your library, shows the filter it used, and you type in as many of the 10 as you can. Score is hits out of 10 and order doesn't matter.

- One **random puzzle** at a time with a **"new list"** button to roll another. No daily puzzle, since every library is different and a shared daily makes no sense here.
- Optional **time limit** (off / 1 / 2 / 5 minutes). With the timer off you play until you give up and reveal.
- On reveal, missed entries are filled in and marked.
- **Nothing repeats in a session.** Every puzzle served is recorded by a signature of its facet, value, and entity type, so the same list cannot come back until the page is reloaded.

### Pre-game options

- **List types:** Artists / Albums / Tracks, any subset.
- **Puzzle categories:** Time / Names & words / Deep cuts / Streaks & sequences / By artist, any subset.
- **Hard mode** (off by default): hides the artist on track and album lists. The default view shows the artist, which is just the normal game, so it is never labelled "easy mode".

A facet is only in the pool if its entity type and its category are both enabled.

### The meta-filter

Every candidate list passes through this before it can become a puzzle:

1. Drop entries with fewer than 5 scrobbles.
2. If fewer than 10 entries remain, reject the puzzle and roll another.

This one rule removes most bad puzzles (too obscure, too short) before the player ever sees them.

### Facet catalog

One facet per puzzle. Combining two filters is deliberately not offered; it is almost always unfair.

**Time** *(artists / albums / tracks)*
- A specific year
- A month across all years ("every October")
- A specific year and month
- Last 7 / 30 / 90 / 180 / 365 days

Weekdays were tried and removed. They aren't guessable or interesting.

**Names & words** *(initial and word: all types; lengths as noted)*
- Starts with a given letter
- Name contains a common word, drawn from a list of about 90. Only words that actually yield a full list survive the meta-filter.
- Artist name of exactly N characters, N kept small (3 to 6)
- Track title of exactly N characters, N kept small (3 to 9)

Character counts exclude spaces, and the prompt says so, since "N letters" on its own is ambiguous.

**Deep cuts** *(recency: all types; one-hit: artists)*
- First scrobbled in year X (gap years never come up, since they fail the meta-filter)
- Not played in over a month
- Not played in over a year
- One-hit wonders: artists you've scrobbled exactly one track from

**Streaks & sequences** *(artists / albums / tracks)*
- First to reach 50 / 100 / 200 scrobbles
- Fastest to reach 50 / 100 / 200 scrobbles
- Most scrobbles in a single day
- Played across the most separate days
- Top entries from a 10,000-scrobble window of your history ("scrobbles 20,001 to 30,000")

**By artist** *(tracks / albums)*
- Top 10 tracks or albums by one artist. Eligible artists are **any** with at least 10 tracks (or albums) clearing the 5-scrobble floor, not just the top 25. The artist is the prompt, so it's always shown.

### Balanced randomization

Three layers keep it varied:

1. **Category deck.** Enabled categories are shuffled and dealt one per puzzle without replacement, reshuffling when empty. You cycle through every enabled category before any repeats.
2. **Facet cooldown.** Within the drawn category, facets are picked weighted-random, with a facet's weight dropping to near zero right after use and recovering over the next few puzzles. No "starts with H" followed by "starts with M".
3. **Value weighting.** The concrete value is chosen so it lands on something that produces a real list, and a value already served this session is skipped before the expensive answer list is even computed.

If a puzzle is rejected, the generator draws again, with an attempt cap and a fallback to an overall top-10 list. If genuinely everything has been played, it says so rather than repeating.

### Answer matching

You type into one box and it resolves as you go. Getting robbed of an answer you clearly knew is the fastest way to make someone quit, so the rules are generous, but they never complete a word for you.

**Normalization**, applied to both sides:
- Case-insensitive
- Punctuation and special characters ignored, unless the title is *entirely* punctuation (like "!!!"), which is matched as-is
- Diacritics folded, so "motorhead" matches "Motörhead"
- Trailing junk stripped: "- Remastered 2011", "(Deluxe Edition)", "feat. ..." and similar

**Non-Latin titles.** When the main title has no Latin letters, a parenthetical Latin gloss is also accepted, so 복합성 (Complexity) can be answered with "complexity". This does **not** apply when the parenthetical is a release qualifier. 桜月 (Special Edition) and 承認欲求 (Special Edition) must not both be answerable with "special edition", so any parenthetical containing a qualifier word (edition, deluxe, remastered, live, remix, and about 40 others) is ignored.

**When it completes.** Only when you have typed the whole thing:
- An exact normalized match, or
- A near-exact one within about 12% edit distance, **provided the typed text is at least as long as the answer**. That length floor is what makes a typo pass while a prefix cannot. Without it, "karma poli" completes "Karma Police", which is exactly the wrong feel.

**Feedback while typing.** Once 5 characters are in, the input tints greener as the typed text gets deeper into a matching answer. It is feedback only and never submits on its own.

**Enter** is optional. It accepts a full or near-full match like typing does, plus an unambiguous prefix once you're at least halfway through the title. A miss never clears the box, so a typo can just be edited.

### What the reveal shows

For a plain filtered list, each entry shows its scrobble count. For a list ranked by a metric, it shows **that metric instead**, since the total is not what the list was about:

| List | Shows |
|------|-------|
| Most in a single day | the count and the day, e.g. "42 on 3 Jun 2021" |
| First to X scrobbles | the date it crossed X |
| Fastest to X scrobbles | the elapsed time, e.g. "100 in 12 days" |
| Most separate days | the day count |

---

## Game 3: Put Them In Order

Five picks from your library and one thing to rank them by. Arrange them, then check.

### Setup

The player picks **one entity type** (artists, albums, or tracks) before playing. Each round then rolls a ranking criterion.

### Difficulty ramp

Like Higher-Lower, the game opens gently and tightens. Three things move together: how many items you have to order, how deep into the library they come from, and how close together their values are allowed to be.

| Rounds | Items | Pool depth | Min ratio between neighbours | Min date gap |
|--------|-------|------------|------------------------------|--------------|
| 1-2    | 3     | top 30     | 2.5x                         | 120 days     |
| 3-4    | 4     | top 60     | 2.0x                         | 90 days      |
| 5-7    | 4     | top 120    | 1.7x                         | 60 days      |
| 8-11   | 5     | top 250    | 1.5x                         | 35 days      |
| 12+    | 5     | full pool  | 1.35x                        | 21 days      |

So a first round is three of your most-played items with values miles apart, and a late round is five deeper cuts separated by a third.

### Keeping the questions varied

Criteria are queued with a cooldown rather than merely avoiding an immediate repeat. Anything used in the last 5 rounds is pushed to the back, and the builder walks the queue in order, taking the first criterion that can actually produce a fair board. Without this, two criteria that happen to build easily (dates always separate cleanly) will just alternate forever.

### Interaction

Rows can be **dragged**, and each row also has **up and down arrows**. The arrows are not a fallback afterthought: HTML5 drag doesn't work on touch, so they are what makes the game playable on a phone. The player's arrangement is read from the DOM order at check time, so both input paths share one source of truth.

### Criteria

| Criterion | Types | Ranked by |
|-----------|-------|-----------|
| Total scrobbles | all | most played first |
| First ever scrobble | all | earliest discovery first |
| Most recent scrobble | all | most recently played first |
| Scrobbles in a period | all | most played in that window first |
| Biggest single track | artists, albums | highest play count of any one track |
| Different tracks played | artists, albums | most distinct tracks |
| Longest run back to back | all | longest unbroken streak of consecutive plays |
| Most scrobbles in one day | all | biggest single day |
| Days played on | all | most separate days |

The period criterion picks a year, a specific month, or a recent window (30 / 90 / 180 / 365 days), and says which in the prompt.

### Candidate pools

Only recognisable items: entities with at least 5 scrobbles, capped to the top 200 artists / 300 albums / 600 tracks by play count, then narrowed further by the round's tier depth.

### Keeping rounds fair

The same discipline as Higher-Lower. A round where the values are nearly identical is a coin flip, not a puzzle, so candidates must be **clearly separated**:

- Separation is a **ratio**, not a flat gap. Neighbouring values must differ by at least the tier's factor, and by at least 2. A flat rule is worthless in the tail: an early version used "8% with a floor of 1", which let 5 vs 6 scrobbles count as separated and produced a genuinely unguessable board.
- Dates must be at least the tier's day gap apart.
- Each criterion also has a minimum value, so trivially small numbers never get ranked.
- Candidate selection is **biased toward the top** of the sorted list rather than starting anywhere in it, so rounds use items the player knows and numbers big enough to reason about.
- If a criterion cannot produce a separated set, the builder moves to the next criterion in the queue rather than serving a bad board. There is deliberately no evenly-spaced fallback, since that reintroduces the near-tie problem.

The shuffled starting order is also checked so the player is never handed an already-solved board.

### Scoring

On check, each row shows whether it landed in the right place, its actual value, and where it belonged. The score is how many of the five are in the correct position, and a **perfect-round streak** is tracked and saved.
