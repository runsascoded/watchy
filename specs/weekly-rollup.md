# Weekly rollup: close the live thread instead of duplicating it

## Problem

Two mechanisms grew independently and now say the same thing twice:

1. **The live weekly OP** (`cfw/src/weekly.ts`, from [`actor-intel.md`](./done/actor-intel.md) v9) — one "Week of M/D" top-level message per ISO week, created **lazily on the first event of that week** (`slack.ts` → `ensureWeeklyThread`), with every event posting as a reply beneath it. The OP is `chat.update`d on each collect to carry a running scoreboard: per-target `before → after` (dashboard-linked) plus "Notable:" actors, each with a `↳` permalink to the reply that introduced them.
2. **The weekly summary** (`cfw/src/summary.ts`, cron `0 14 * * 1`) — a *separate top-level* post with per-target `+N (−M) → total`, notable actors with follower counts, and dashboard links.

Neither knows the other exists. The summary lands in-channel immediately below the thread it duplicates, and its content is a strict subset of the OP's except for three things: the explicit date range, the `+N (−M)` split (the OP's `before → after` hides intra-week churn), and the dashboard/actors links.

## Design

**The live thread is the record.** It already is one structurally — it accumulated the week's events, and its OP is the only artifact linking each notable actor to the moment they appeared. It just never gets a closing gesture. So:

### 1. Finalize the OP at week close

One last `chat.update` that appends a **closed footer** to the OP's blocks:

```
Closed · 2026-08-09 → 2026-08-16 · +31 ⭐ · +3 🔔 · dashboard · actors
```

That folds in everything the standalone summary had that the OP lacked. `chat.update` can't alter `username`/`icon_emoji` (they're bound at post time), so the "closed" marker has to live in the blocks — which is fine, since the footer is where a reader looks for the wrap-up anyway.

### 2. The rollup becomes a broadcast reply, not a standalone post

Post it **into the closing week's thread** with `reply_broadcast: true`, which surfaces it in-channel exactly once. This keeps the one thing the standalone post was actually for — a `chat.update` is silent, so without a new message a channel-only reader never learns the week closed — while removing the duplicated block.

Trimmed to what the OP *can't* say, which is mostly week-over-week movement:

```
:calendar: *Week of 8/9* closed · 2026-08-09 → 2026-08-16
+18 :star: · +3 :bell: · 5 targets · 21 events (prev week 13)
:telescope: richardliaw · MzeroMiko · IamPhytan
:bar_chart: dashboard · actors
```

Notable actors appear as **bare linked logins** (cap 3) — the follower counts, affiliations, and top repos stay in the OP, one screen up. The rollup's job is "here's the shape of the week, click through for detail", not a restatement.

### 3. Quiet weeks fall back to standalone

If no OP exists for the closing week (no events at all → `ensureWeeklyThread` never fired), there's no thread to reply into, so the existing `renderSummary` "Quiet week" post goes out top-level as before. `renderSummary` is kept for exactly this path (and `/summary-preview`).

### 4. Week keys must agree — and didn't

Found while verifying against live D1, before this shipped: the two mechanisms keyed weeks **differently**, so the thread lookup could never have matched.

- `weekly_threads.week_start` comes from `weekStartOf` — always a **Monday** (UTC).
- `buildWeekStats` used a *trailing 7-day* window ending "today", so its `week_start` was whatever day the cron happened to fire.

And the cron fired **Sundays**, not Mondays: both existing `summaries` rows (`2026-08-09`, `2026-08-02`, each posted 14:00:51Z) are Sundays, despite the trigger reading `0 14 * * 1`. Whatever the cause — CF's day-of-week indexing is the suspect — the schedule expression is not something to build correctness on.

So the window is now derived **from the clock, not the schedule**: `weekEnd = weekStartOf(now)`, `weekStart = weekEnd − 7d` — i.e. *the most recently completed ISO week*, whose key matches `weekly_threads` by construction. The cron becomes **daily** (`0 14 * * *`): the first run after a week boundary closes it, and every later run that day short-circuits on the `summaries` dup-check. That also makes the job self-healing — a missed or failed run just closes the week a day late instead of never.

### 5. New-thread timing is unchanged (deliberately)

A new "Week of M/D" OP begins **whenever the first event of that ISO week arrives** — 00:05 Monday in a busy week, Thursday in a quiet one. Pre-creating on a schedule would leave empty OPs in quiet weeks that then need deleting, so laziness stays.

~~Consequence worth knowing: the cron fires 14 hours *into* the new week, so if anything landed Monday morning UTC, the new week's OP already sits above the closing week's rollup.~~ **Superseded** (2026-08-24) — see §6/§7. The trade-off that made 14:00Z worth its ordering cost was "00:05 Monday lands 8pm ET Sunday". Moving the *boundary* off UTC removes that cost, so the close-out now fires at the boundary.

### 6. The boundary is 23:00 Sunday Pacific (2026-08-24)

Midnight UTC is 8pm ET / 5pm PT Sunday — mid-evening, with the channel still being read and the day's stars still landing. Weeks turn over at **23:00 America/Los_Angeles** instead: 2am ET, quiet on both coasts, and late enough that a whole US Sunday is done.

DST-aware, not a fixed offset — the boundary is 06:00Z in PDT and 07:00Z in PST. "The week turns over at 11pm Pacific" is the invariant worth keeping; a frozen offset would drift an hour twice a year.

That makes the week window an **instant range, not a date prefix**. `weekBounds(key)` returns `{ start, end }`, and every query that compared `events.ts >= '2026-08-24'` now binds those. `buildWeeklyOp` takes a `Week` (`{ key, start, end }`) rather than a date string, so the base-count cutoff can't silently fall back to string-prefix comparison against midnight UTC.

Week *keys* are unchanged (still the Monday), so `weekly_threads` and `summaries` need no migration. One wrinkle, accepted rather than migrated: which thread a past event was posted under was decided by the old rule, so rebuilding a pre-08-24 week shifts its window 6–8h and can move a Sunday-evening event between weeks. Nothing re-posts; only a forced rebuild would show it.

### 7. Close-out fires at the boundary, not on the cron (2026-08-24)

`weeklySummary` now runs from `runCollection` — every tick, ahead of `syncSlack` — with its `summaries` dup-check moved *before* the aggregation so the common path costs one indexed lookup. The first tick after 23:00 PT Sunday closes the week; the new week's OP can only be created by a later `syncSlack`, so the rollup is guaranteed to land above it. `0 14 * * *` stays as a backstop for a week where collection was down at the boundary.

`/weekly-refresh?week=&closed=` (key-gated) force-rebuilds a week's OP from D1. A week only rebuilds when it sees new events, so without this a week whose updates failed stays wrong forever — which is exactly what happened in §8.

### 8. What actually broke it: D1's 100-bind cap (2026-08-24)

`updateWeeklyOp` binds one `?` per distinct actor of the week. D1 rejects a statement with >100 bound parameters (`too many SQL variables … SQLITE_ERROR [code: 7500]`), so the first update past 100 actors threw — and so did every one after it, including the end-of-week finalize.

| week | froze at | showing | actual at close |
|---|---|---|---|
| 8/17 | 08-22T23:35Z, actor #101 | `marin 1,265 → 1,350` | 1,528 |
| 8/24 | 08-24T07:15Z, actor #99 | `marin 1,528 → 1,620` | 1,700+ |

Symptoms that looked like three separate bugs: a scoreboard whose "after" was smaller than the next week's "before"; a summary whose totals (`1,693`) disagreed with both (it counts `stars` rows — no IN-list, so it was never wrong); and an 8/17 rollup that arrived as the **standalone** `renderSummary` with no closed footer, because `finalizeWeeklyOp` threw and `weeklySummary` fell back.

Fixed in `d1.ts`: `chunkedAll` runs an IN-list query per ≤100-bind chunk. Applied to all four sites — both in `updateWeeklyOp`, `/api/actors/cards`, and `/api/runs`.

## Not doing (yet)
- **Deeper WoW analytics** (new-vs-returning actors, per-target trends). The one-number comparison is there to prove the rollup has an independent job; richer trends belong on the dashboard, not in Slack.

## Implementation

- `weekly.ts`: `weekStartOf`/`weekBounds`/`week` (23:00 PT boundary), `getWeeklyThread` (lookup without create), `buildWeeklyOp(week, ..., { closed })` → closed footer, `updateWeeklyOp(..., { closed })`, `finalizeWeeklyOp(env, weekStart)` → returns the OP ts or `null`.
- `d1.ts`: `chunkedAll` — every `IN (…)` over a runtime-length list must go through it.
- `summary.ts`: `WeekStats.prevEvents`, `renderRollup()`, and `weeklySummary()` routing between reply-broadcast and standalone.
- Idempotency is unchanged: the `summaries` row keyed on `week_start` still short-circuits a second run.
- No schema change.
