# Games design doc

The site has five games that use the scrobble library the user has already loaded: Higher or Lower, Fill the List, Put Them In Order, Odd One Out and Common Thread. They make no API calls, so they work as soon as a library is loaded and do not use any of the Last.fm request budget.

## Where the games live

- A Games tab sits next to the Lists tab. It stays disabled until data is loaded, and its tooltip says so (the same gating as Load Details).
- Switching between Games and Lists takes one click. Nothing reloads and neither side loses its state.
- Anything that needs extended metadata (durations, tags, global stats) only appears once `extendedDataLoaded` is true, the same flag the metadata filters use.
- Personal records are kept in `localStorage`: the best Higher or Lower streak per entity type, the best Fill the List score, and the best Put Them In Order, Odd One Out and Common Thread streaks.
- Every right answer shows a green "Correct!" confirmation in the middle of the screen. It springs in, settles and fades out, and it restarts on each answer, so quick answers in Fill the List each get their own. With reduced motion turned on, it appears and disappears without moving.

---

## Game 1: Higher or Lower

The player sees two items from their library, each with its album cover, and picks the one they have scrobbled more. A right answer adds one to the streak. A wrong answer ends the run.

### Setup

The player picks one entity type (artists, albums or tracks) before the run, and the whole run uses that type.

### Candidate pools

An item can appear if it clears either bar:

| Type   | Qualifies if                        |
|--------|-------------------------------------|
| Artist | top 300 by rank, or 100+ scrobbles  |
| Album  | top 500 by rank, or 50+ scrobbles   |
| Track  | top 1000 by rank, or 10+ scrobbles  |

### Difficulty ramp

Difficulty depends on the ratio between the two counts. 500 against 250 (a ratio of 2.0) is easy, and 500 against 470 (1.06) is hard. The ratio matters more than the gap: 50 against 100 is as easy as 500 against 1,000.

Difficulty rises smoothly with the streak. Over the first 20 wins:

- the pool grows from the top 45 items to the top 600, and
- the ratio the pair aims for shrinks from 2.4 to 1.1.

After 20 wins both stay at their final values.

### Pair selection

1. Shuffle the pool at the current depth.
2. Score every pairing of the first 30 shuffled items with the first 60. A pair's score is how far its ratio is from the target, measured as the absolute log of actual ratio divided by target ratio.
3. Add 0.38 to the score for each item in the pair that was shown in the last 12 items. Recently shown items can still come back in a small library, but they are less likely to.
4. Skip the exact pair from the previous round, unless the pool only has two items.
5. Keep the pair with the lowest score and put its items on random sides, so position never hints at the answer.

Scoring many pairs replaced an older approach that picked one anchor and searched for a partner. That approach could match an item at the bottom of the pool with its nearest neighbour and produce a near-tie such as 76 against 77.

### Edge cases

- Ties: if both counts are equal, either answer is right. A tie should not end a run.
- Small libraries: if the pool is smaller than the current depth, the whole pool is used. The game still starts with a library of a few thousand scrobbles.

---

## Game 2: Fill the List

The site picks a top 10 list from the user's library, shows what the list is (for example "Top albums of 2021"), and the player types as many of the ten as they can. The score is how many they found, and the order does not matter.

- One puzzle at a time, with a New list button for the next one. There is no daily puzzle, because every library is different.
- An optional time limit of 1, 2 or 5 minutes. Without one, the round lasts until the player asks to see the answers.
- Showing the answers fills in the missed entries and marks them.
- A Back to menu button during a round ends it and goes back to the setup screen.

### Setup screen

- Answer types: artists, albums and tracks, as toggle chips. At least one is needed.
- List categories: Time, Names and words, Deep cuts, Streaks and milestones, and By artist, each a card with a one-line description. At least one is needed.
- Hard mode, a switch that is off by default. It hides the artist on track and album answers. The default shows the artist and is not called "easy mode".
- Time limit, as a row of choices.

A puzzle type is used only if its entity type and its category are both turned on.

### The minimum-scrobble rule

Every candidate list goes through this check before it can become a puzzle:

1. Drop entries with fewer than 5 scrobbles.
2. If fewer than 10 entries remain, reject the list and try another.

This rule removes most lists that are too obscure or too short before the player sees them.

### Puzzle types

Each puzzle uses one filter. Combining two filters is not offered, because combined lists are usually too hard to guess.

Time (artists, albums, tracks):
- a specific year
- a month across all years ("every October")
- a specific year and month
- the last 7, 30, 90, 180 or 365 days

Weekdays were tried and removed, because top lists for a single weekday are hard to guess.

Names and words (first letter and word: all types; lengths as noted):
- names starting with a given letter
- names containing a common word, from a list of about 90 words. Only words that give a full list pass the minimum-scrobble rule.
- artist names of exactly N characters, with N between 3 and 6
- track titles of exactly N characters, with N between 3 and 9

Character counts leave out spaces, and the prompt says so, because "N letters" alone is unclear.

Deep cuts (first played and not played recently: all types; one track only: artists):
- first scrobbled in a given year. Years with few plays fail the minimum-scrobble rule and never come up.
- not played for over a month
- not played for over a year
- artists the user has scrobbled exactly one track from

Streaks and milestones (artists, albums, tracks):
- first to reach 50, 100 or 200 scrobbles
- fastest to reach 50, 100 or 200 scrobbles
- most scrobbles in a single day
- played on the most separate days
- top entries from a 10,000-scrobble stretch of the history ("scrobbles 20,001 to 30,000")

By artist (tracks, albums):
- the top 10 tracks or albums of one artist. Any artist with at least 10 tracks (or albums) above the 5-scrobble minimum can come up, including artists outside the top 25. The artist is part of the prompt, so it is always shown.

### Variety

Three rules keep the puzzles varied.

1. Category deck. The enabled categories are shuffled and dealt one per puzzle without replacement, and reshuffled when the deck is empty. Every enabled category comes up before any category repeats.
2. Puzzle type cooldown. Within the drawn category, puzzle types are picked at random with weights. A type's weight drops close to zero right after it is used and recovers over the next few puzzles, so "starts with H" is not followed by "starts with M".
3. Recent lists. The last 20 lists played are skipped. A list is identified by its type, value and entity type, such as "year 2021, albums". The check happens before the answers are worked out, so a skipped list costs almost nothing.

If a draw is rejected, the generator tries again: up to 25 times per category, across every enabled category. If nothing new turns up, it uses the overall top 10 of an enabled type. If that was also played recently, it allows lists from the recent 20 again, except the list from the round just played. This means the game keeps going for as long as the player wants, and the same list never comes up twice in a row.

The memory of recent lists is kept when the player goes back to the menu and starts again, so changing a setting does not bring back the lists just played. Reloading the page clears it.

### Answer matching

The player types into one box and answers are accepted as they type. The matching is lenient, so an answer the player clearly knew is not refused for a small typo, but it never completes a word for the player.

Normalization, applied to both the typed text and the answer:
- case is ignored
- punctuation and special characters are ignored, unless the whole title is punctuation (like "!!!"), which is matched as it is
- accents are removed, so "motorhead" matches "Motörhead"
- trailing release details are removed: "- Remastered 2011", "(Deluxe Edition)", "feat. ..." and similar

Non-Latin titles. When the main title has no Latin letters, a Latin translation in parentheses is also accepted, so 복합성 (Complexity) can be answered with "complexity". This does not apply when the parentheses hold a release detail. 桜月 (Special Edition) and 承認欲求 (Special Edition) must not both be answered by "special edition", so parentheses containing a release word (edition, deluxe, remastered, live, remix and about 40 others) are ignored.

When an answer is accepted, only after the whole answer is typed:
- an exact match after normalization, or
- a near match within about 12% edit distance, as long as the typed text is at least as long as the answer. This length rule lets a typo through but not a partial title. Without it, "karma poli" would be accepted as "Karma Police".

Feedback while typing. Once 5 characters are typed, the box turns greener as the text gets further into a matching answer. The colour is only a hint and never submits anything.

Enter is optional. It accepts a full or near-full match like typing does, and also a partial title that only one answer starts with, once the player is at least halfway through it. A miss never clears the box, so a typo can be corrected.

### What the reveal shows

For a list filtered by time, name or artist, each entry shows its scrobble count. For a list ranked by something else, each entry shows that value instead, because the scrobble total is not what the list ranked:

| List | Shows |
|------|-------|
| Most in a single day | the count and the day, for example "42 on 3 Jun 2021" |
| First to X scrobbles | the date it reached X |
| Fastest to X scrobbles | the time it took, for example "100 in 12 days" |
| Most separate days | the number of days |

---

## Game 3: Put Them In Order

The player gets a few items from their library and one statistic to sort them by, puts them in order, and checks. One item in the wrong place ends the run.

### Setup

The player picks one entity type (artists, albums or tracks) before playing. Each round then picks a statistic.

### Difficulty ramp

The game starts easy and gets harder with each win. Three things change together: how many items there are, how deep into the library they come from, and how close their values can be.

The number of items is 3 for the first three rounds, 4 until the ninth win, and 5 after that. Over the first 18 wins:

- the pool grows from the top 35 items to the top 600,
- the smallest allowed ratio between neighbouring values shrinks from 2.4 to 1.35, and
- the smallest allowed gap between neighbouring dates shrinks from 120 days to 21.

A first round has three of the player's most-played items with values far apart. A late round has five less familiar items, each at least 1.35 times its neighbour.

### Keeping the questions varied

Statistics are queued with a cooldown. Anything used in the last 5 rounds goes to the back of the queue, and the round builder takes the first statistic in the queue that can make a fair round. Without the cooldown, two statistics that are easy to build (dates usually separate cleanly) would alternate.

The same set of items is never used in two rounds in a row.

### Interaction

Rows can be dragged, and each row also has up and down arrows. HTML5 drag does not work on touch screens, so the arrows are what make the game playable on a phone. The order is read from the page when the player checks it, so both ways of moving rows give the same result.

### Statistics

| Statistic | Types | Sorted by |
|-----------|-------|-----------|
| Total scrobbles | all | most played first |
| First ever scrobble | all | earliest first play first |
| Most recent scrobble | all | most recently played first |
| Scrobbles in a period | all | most played in that period first |
| Biggest single track | artists, albums | highest play count of one track |
| Different tracks played | artists, albums | most different tracks |
| Longest run back to back | all | longest run of consecutive plays |
| Most scrobbles in one day | all | biggest single day |
| Days played on | all | most separate days |

The period statistic uses a year, a specific month or a recent window (30, 90, 180 or 365 days), and the prompt says which.

### Candidate pools

Only familiar items are used: entities with at least 5 scrobbles, limited to the top 200 artists, 300 albums or 600 tracks by play count, then narrowed further by the current pool depth.

### Keeping rounds fair

Values that are nearly identical cannot be put in order by reasoning, so the items in a round must be clearly separated:

- Separation is measured as a ratio. Neighbouring values must differ by at least the current minimum ratio, and by at least 2. A flat gap fails for small numbers: an early version used "8% with a minimum of 1", which counted 5 against 6 scrobbles as separated and produced rounds that could not be solved.
- Dates must be at least the current minimum gap apart.
- Each statistic has a minimum value, so very small numbers are never ranked.
- Items are picked starting near the top of the sorted list, so rounds use items the player knows and numbers large enough to compare.
- If a statistic cannot produce a separated set, the builder moves to the next statistic in the queue. There is no evenly spaced fallback, because that would bring near-ties back.

The shuffled starting order is also checked, so the player never gets a round that is already solved.

### Scoring

When the player checks, each row shows whether it is in the right place, its actual value, and where it belongs. A round counts only if every row is right, and the best streak of such rounds is saved.

---

## Games 4 and 5: Odd One Out and Common Thread

The two games are mirror images built on one set of facts (`js/games/facts.js`).

- Odd One Out shows one statement and four items. The statement is true for three of them, and the player picks the one it isn't true for.
- Common Thread shows four items and four statements. One statement is true for all four, and the player picks it.

Both are streaks: a wrong answer ends the run. The player picks one entity type (artists, albums or tracks) before the run, and the whole run uses that type. There is no mode with a hidden statement, because four items almost always differ in several ways, and a player who found a different valid reason would be marked wrong.

### How a round is built

Both games start from the statement, never from the items.

Odd One Out:
1. Take the next criterion from the queue (see Variety).
2. Pick one of its statements, such as "have more than 100 scrobbles", with a round number as the line.
3. Draw three items that clearly pass it and one that clearly fails it.

Common Thread:
1. Take the next criterion and pick a statement that holds for at most 40% of the current pool, so the answer is a real feature of the four items and not something nearly everything has. Ranges and single years ("between 100 and 150 scrobbles", "first played in 2021") pass this easily.
2. Draw four items that clearly pass it.
3. Build three wrong statements around those four items, each from a different criterion. A wrong statement holds for most of the four and clearly fails for one or two of them. For "more than N" this means putting N between the values.
4. Check every statement against every item: exactly one statement is true for all four.

### Statement forms

Number criteria use "more than N", "fewer than N" and "between N and M", with N and M taken from a list of round numbers (5, 10, 25, 50, 100, 250, 500, 1,000 and so on). Dates use a year ("first played in 2021"), "before 2020", "in 2022 or later", and windows such as "played in the last 30 days". Category criteria name a value ("were played most in 2021", "have a most played track starting with H").

### Margins

No item may sit close to the line, so that every answer can be reasoned out. Distance is measured as a ratio for counts and in days for dates.

- The floor shrinks over the first 20 wins: from 1.3x to 1.1x for counts, and from 120 days to 21 for dates. For "more than 100" at the start of a run, a passing item has at least 130 and a failing one at most 77.
- The floor is the only hard limit on difficulty. Above it, items are drawn on a curve that favours values near the floor but allows larger gaps, so the same items don't come up for every statement of the same kind. A round can come out easier than the floor, never harder.
- There is also a cap: no item further than 2.5x (or three years) from the line. This keeps the odd one from being an obvious outlier, such as 12 scrobbles against three items with 150.
- Counts also need a gap of at least 2, as in Put Them In Order, so "5+ in a row" never comes down to 4 against 5.
- Inside a range with two ends ("between 100 and 200", "in 2021"), the room is shared: the square root of the floor from each end for counts, half the days for dates.
- A window statement such as "played in the last 30 days" asks for at most half the window as its margin.
- In Common Thread, the floor applies to every item of the true statement and to the items a wrong statement fails for. Items a wrong statement holds for need no margin, because misreading them only makes the player rule it out, which is right anyway.

The pool also widens over the first 20 wins, from the top 50 items to the top 600 (limited to the top 250 artists, 400 albums or 600 tracks with at least 5 scrobbles).

In Common Thread, each wrong statement fails for two of the four items until the fifth win and for one after that. If the four items can't support three wrong statements at that count, the builder accepts more failing items, which only makes the round easier.

### Criteria

Every criterion must be something a player who knows their library can reason about. Weekdays and time of day are left out for that reason. Facts about names are allowed only when the name is not on screen: "their most played track starts with H" is fine, "their name starts with H" is not.

| Criterion | Group | Types | Statements |
|-----------|-------|-------|------------|
| Total scrobbles | counts | all | more than, fewer than, between |
| Scrobbles in a given year | counts | all | more than, fewer than |
| Most plays in one day | counts | all | more than, never as many as |
| Days played on | counts | all | more than, fewer than, between |
| Longest run back to back | counts | all | more than, never as many as |
| Different tracks played | counts | artists, albums | more than, fewer than |
| Plays of the most played track | counts | artists, albums | more than, fewer than, between |
| Different albums played | counts | artists | more than, fewer than |
| All-time rank | counts | all | in your top 10, 25, 50, 100, 200 or 300 |
| First scrobble | dates | all | in a year, before a year, in a year or later |
| Last scrobble | dates | all | in the last 30, 90, 180 or 365 days or not, in a year, not since a year |
| Peak year | dates | all | played most in a year |
| Played in every year since a year | shape | all | true for three or four |
| Share of plays in their best year | shape | all | more than, never as much as (30% to 90%) |
| A comeback | shape | all | came back after a break of more than six months to three years |
| Days to reach 50 or 100 plays | shape | all | within a week to two years, or took longer |
| First letter of the most played track | names | artists, albums | starts with a letter |
| Most played track has a one-word title | names | artists, albums | true for three or four |
| Most played album is self-titled | names | artists | true for three or four |
| Your most played track by its artist | relations | tracks | true for three or four |
| The most played track on its album | relations | tracks | true for three or four |
| Your most played album by its artist | relations | albums | true for three or four |

A category is only used for an item when it is clear. A most played track or album must beat the next one by the round's floor, a peak year must beat the next year by the floor, and "every year since" needs at least two plays in each of those years. The relation criteria compare an item's plays with the best of the rest, so the floor applies to them like a count: a track that is #1 by a hair never decides a round.

Rare criteria, such as a self-titled top album, only come up when the library has enough items that fit.

### Variety

- Criteria sit in a queue. One used in the last 5 rounds goes to the back, and so does any criterion from the group (counts, dates, shape, names, relations) used in the last round or, less strongly, the round before. A run doesn't ask about counts three times in a row.
- In Common Thread the four statements come from four different criteria and at least three groups. Each wrong statement tries a group not yet in the round first.
- Items shown in the last 12 cards are drawn with a quarter of their usual weight, so they can still come back in a small library but rarely do. The same set of four items never comes up twice in a row.
- Play again after a miss keeps this memory, so a new run doesn't open with the items and criteria just seen.

### The reveal

After an answer, every card or statement shows the real values behind it. In Odd One Out each card shows its value for the statement, with the odd one in green and a wrong pick in red. In Common Thread each statement lists the four items with their values and a tick or a cross, so the player sees which item breaks each wrong statement. The reveal stays on screen until the player moves on, because reading it is how the player learns their library.
