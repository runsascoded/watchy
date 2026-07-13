# `watchy` CFW + D1: event pipeline, alerting, and web view

Replace the [`ryan-williams/.watchy`] daily-GHA-commit pipeline with a Cloudflare Worker
cron that polls GitHub, diffs against current state in D1, and appends **events**
(star/unstar/follow/unfollow) — plus Pushover alerting on failures and a small web app at
**watchy.rbw.sh** for browsing changes without reading git history.

Motivation / background:
- GitHub restricted the stargazers API (2026-06-30 [changelog][gh-changelog]) to repo
  admins/collaborators; the `.watchy` GHA now runs on a PAT (`WATCHY_TOKEN` secret).
- GHA cron is imprecise (observed 40-105min late) and gets disabled after 60d of repo
  inactivity; commits-as-ledger requires a derived index to query (cf. `nj-crashes`
  `crash-log.parquet` + its `fsck` tooling for SHA drift). Diff-at-poll-time + append-only
  events table skips that whole layer.
- Prior art: `~/c/awair/cfw/monitor` (CFW cron + KV state + tiered Pushover alerts),
  `~/c/awair/cfw/serve` (CFW + D1 serving), `~/c/hccs/crashes` (D1 import lessons —
  write deltas, never full replays).

## Repo layout

New top-level dirs in this repo (`runsascoded/watchy`), awair-style:

```
cfw/            # single worker: cron collect + API + static FE assets
  src/index.ts
  migrations/   # D1 schema migrations (wrangler d1 migrations)
  wrangler.toml
www/            # Vite + TS + React + SASS FE (dev port 4199)
src/watchy/     # existing py lib: gains `backfill` subcommand (git history → events)
```

One worker (not split collect/serve): volume is tiny, and a single deploy keeps
cron + API + FE on one domain.

## D1 schema

Database: `watchy`. All timestamps ISO-8601 UTC (`TEXT`).

```sql
-- Current state (what we diff new polls against)
CREATE TABLE stars (
  repo       TEXT NOT NULL,             -- "owner/name"
  uid        INTEGER NOT NULL,          -- GitHub user id (rename-proof)
  login      TEXT NOT NULL,             -- login at last observation
  starred_at TEXT,                      -- from star+json accept header
  PRIMARY KEY (repo, uid)
);
CREATE TABLE follows (
  target TEXT NOT NULL,                 -- followed user/org
  uid    INTEGER NOT NULL,
  login  TEXT NOT NULL,
  PRIMARY KEY (target, uid)
);

-- Append-only ledger
CREATE TABLE events (
  id     INTEGER PRIMARY KEY,
  ts     TEXT NOT NULL,                 -- starred_at for 'star' (when available), else observation time
  kind   TEXT NOT NULL CHECK (kind IN ('star','unstar','follow','unfollow')),
  target TEXT NOT NULL,                 -- "owner/repo" for star kinds, user/org for follow kinds
  uid    INTEGER NOT NULL,
  login  TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live',  -- 'live' | 'git' (backfill)
  sha    TEXT                           -- .watchy commit sha, backfill provenance only
);
CREATE INDEX events_ts ON events (ts);
CREATE INDEX events_target_ts ON events (target, ts);

-- Per-repo star counts observed on each run (cheap: comes free with repo listing);
-- powers count-delta optimization + FE sparklines without full event replay
CREATE TABLE counts (
  ts     TEXT NOT NULL,
  target TEXT NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (target, ts)
);

-- Heartbeat / run history (also backs /api/status + dead-man's switch)
CREATE TABLE runs (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,                  -- 1/0
  n_events    INTEGER,
  error       TEXT
);
```

Notes:
- **`uid` not `login` as identity**: logins are mutable; ids aren't. A rename shows up as
  a `login` update on the state row, not a spurious unstar+star.
- **Backfilled events** keep crash-log-style `(sha)` provenance, but only for the
  git-history import; live events never reference git — no `fsck` class of problems.

## Collection (worker `scheduled()`)

Cron: hourly (`0 * * * *`).

Targets via `TARGETS_JSON` var (awair `DEVICES_JSON` pattern):

```jsonc
{
  "stars":   ["runsascoded", "ryan-williams", "hudcostreets", "bikejc", "embankmentjc", "neighbor-ryan", "Open-Athena"],
  "follows": ["runsascoded", "ryan-williams", "hudcostreets", "bikejc", "embankmentjc", "neighbor-ryan", "Open-Athena"]
}
```

Per run:
1. For each stars target: list repos (`?type=public`, paginated; private repos excluded to
   match current `.watchy` behavior). Record `stargazers_count` → `counts` rows.
2. **Count-delta gate**: only fetch full stargazer lists for repos whose observed count
   differs from `SELECT count(*) FROM stars WHERE repo = ?`. Steady-state runs are
   ~#targets + a handful of calls. Caveat: an unstar+star pair between polls with net-zero
   count is missed by the gate — so one run per day (the 08:00 UTC one, preserving the
   current daily cadence) skips the gate and sweeps every repo.
3. Stargazer fetches use `Accept: application/vnd.github.star+json` → `{starred_at, user}`;
   `star` events get true timestamps regardless of poll cadence. `unstar`/`unfollow` get
   observation time (this is what hourly cadence improves).
4. Followers per target (no timestamp equivalent; plain diff).
5. Diff each fetched set against state table by `uid`; batch-write per target:
   `INSERT` events + state upserts/deletes in one `db.batch()`. Writes are deltas only
   (d1-import lesson: never replay unchanged rows).
6. Write `runs` row (started/finished/ok/n_events/error).

Constraints checked:
- **Subrequests**: full-sweep runs are ~350-400 GitHub calls (7 targets, ~300 repos).
  Over the free plan's 50/invocation; fine under Workers Paid (1000). Assumes the CF
  account is on paid (it is — crashes D1 usage). Count-delta hourly runs are ~15-30 calls.
- **Rate limit**: PAT allows 5000/hr; worst case ~400/run is comfortable.
- **CPU**: I/O-bound; no issue.

### Secrets / config

| name | kind | notes |
|---|---|---|
| `WATCHY_TOKEN` | secret | GitHub PAT. Use a **dedicated** classic PAT (not the `gh` CLI keyring token currently in the `.watchy` GHA secret — that one dies if `gh` re-auths) |
| `PUSHOVER_TOKEN` / `PUSHOVER_USER` | secrets | same app/user as awair-monitor (or a new "watchy" Pushover app for distinct icon) |
| `MANUAL_CHECK_KEY` | secret | gates `/check`, `/test-pushover` (awair pattern) |
| `TARGETS_JSON` | var | targets, above |

## Alerting (Pushover, awair-monitor pattern)

Simplified from awair's tier ladder (hourly cadence, not per-minute):

- **Failure**: alert on the **2nd consecutive** failed run (1 transient GitHub 5xx
  shouldn't page), then back off: next alerts at 6h, 24h, then daily. State = consecutive
  failure count + last-alerted tier, derivable from `runs` (no KV needed).
- **Recovery**: one ✅ ping when a run succeeds after ≥1 alert was sent, with outage duration.
- `fetch()` endpoints: `/check` (run collection now, return JSON), `/test-pushover` —
  both `?key=`-gated, lifted from `awair/cfw/monitor/src/index.ts`.
- **Dead-man's switch**: the worker can't alert if cron stops firing entirely. Keep a
  minimal GHA in `.watchy` (or this repo) running daily: `curl watchy.rbw.sh/api/status`
  and fail unless `last_ok_run < 3h` ago — GHA emails on red, and its own unreliability
  doesn't matter at daily granularity. (GHA is good at *this* job; just not at being the
  pipeline.)

## Web app — watchy.rbw.sh

Vite + TS + React + SASS in `www/`; dev port **4199**, wrangler dev **4200**
(hash-derived). Built assets served by the worker via `[assets]` binding, SPA fallback;
domain via `routes = [{ pattern = "watchy.rbw.sh", custom_domain = true }]` (zone
`rbw.sh` already on the CF account — cf. air.rbw.sh).

v1 views (TSQ for data fetching; use-kbd SpeedDial per house style):
1. **Event feed** (home): reverse-chron, grouped by day — the at-a-glance replacement for
   reading `GHA: ⭐️+1` commits. Row = kind emoji, login (→ github profile), target,
   relative time. Filters: kind, target, login substring.
2. **Target detail** `/r/<owner>/<repo>`, `/u/<login>`: cumulative star/follower count
   chart (from `counts` + events), current member list, per-target event history.
3. **Movers** (v1.5): biggest Δ over trailing 7/30d.

API (worker `fetch()`):
- `GET /api/events?target=&kind=&login=&before=&limit=` — paginated feed
- `GET /api/targets` — targets + current counts + last-event ts
- `GET /api/counts?target=` — count time series
- `GET /api/status` — last runs, consecutive-failure state (dead-man's switch reads this)

**Open question — public vs gated**: GitHub restricted stargazer lists platform-wide;
republishing logins publicly at watchy.rbw.sh partially undoes that. Options:
(a) fully public, (b) public counts/charts + CF Access-gated logins, (c) CF Access on the
whole site (free ≤50 seats). Recommend **(c)** to start — it's one dashboard toggle, and
loosening later is easier than unpublishing.

## Backfill (`watchy backfill`, py)

Subcommand in the existing CLI (house rule: CLI subcommand over ad-hoc script):

```
watchy backfill [-C <.watchy-clone>] [-f sql|jsonl] [-o <path>] [-S] [-u <iso-ts>] [-U] [-x <owner/repo>]...
```

- Walks `.watchy` history (`Repo.iter_commits`, chronological), diffing consecutive
  `github/{stars,follows}/**.txt` snapshots.
- **Stars**: emits `unstar` for every removal, `star` for *closed* intervals only —
  open intervals (still-starred at HEAD) are left to the worker's first live sweep,
  which gets true `starred_at` timestamps (observed span: 2011→2026, far richer than
  git's daily resolution). `-x/--emit-open <owner/repo>` overrides per-repo, for stale
  files whose repos the live worker can't fetch.
- **Follows**: emits every change (no API timestamp source to defer to), and seeds the
  `follows` state table from the HEAD snapshot (uid-resolved via `GET /users/{login}`;
  unresolvable logins are skipped — deleted accounts won't appear in live fetches
  either). Event `uid`s stay NULL unless `-U/--resolve-uids`.
- **Re-runs**: SQL import is idempotent (`DELETE FROM events WHERE source='git'` first).
  `-u/--until <iso-ts>` (pass the worker's first-run time) excludes later commits so git
  events can't duplicate live ones; `-S/--no-seed-state` skips the follows seed (and its
  `DELETE FROM follows`, which would wipe live-owned state).
- Import via `watchy sql -f backfill.sql` (below). **Order matters**: import (with state
  seed) before the worker's first run, else current followers re-emit as spurious
  live events at observation time.

## `watchy sql` (py)

`watchy sql [-d <db>] [-l] [-f <file> | <sql>]` — wraps `wrangler d1 execute watchy
--remote --json`, strips wrangler's progress-line preamble, emits result rows as
pipeable JSONL. Used for backfill import, parity checks, and ad-hoc queries of the
events DB.

## Rollout

1. **Phase 1 — pipeline** ✅ (2026-07-12): schema migrations, worker collect path,
   backfill, deploy. D1 db `0ea16a24-…`; worker at `watchy.ryan-0dc.workers.dev`;
   first full sweep: 430 repos, 225 bootstrap star events (starred_at 2011→2026),
   484 events total after backfill import + overlap dedupe. `.watchy` GHA continues
   in parallel; parity-check daily (`.watchy` commit diffs ≡ `source='live'` events).
   - Deploy-window overlap handling (learned the hard way — an unstar landed between
     backfill-clone and bootstrap and was invisible to both): re-run backfill with
     `-S -u <bootstrap-ts>` from an updated clone, then delete live `follow` events
     duplicated by git events in the overlap window.
2. **Phase 2 — alerting**: Pushover wiring (worker code ✅; secrets pending — reuse
   awair-monitor's app or create a "watchy" one), `/api/status` ✅, dead-man GHA ✅
   (daily, fails unless `lastOk` < 3h old; lives in **this** repo, not `.watchy` —
   scheduled workflows are auto-disabled after 60d of repo inactivity, and `.watchy`
   goes quiet post-decommission).
3. **Phase 3 — FE**: ✅ (2026-07-13) `www/` Vite+React+SASS app: `/` event feed
   (day-grouped, kind/target/login filters), `/health` pipeline snapshot backed by
   one-round-trip `/api/health` (ctbk pattern). Served by the worker via `[assets]`
   (SPA fallback, `run_worker_first` for API paths); dev: `pnpm dev` in `www/`
   (port 4199, hits prod API by default; `VITE_API_BASE` overrides).
   Remaining: watchy.rbw.sh custom domain + CF Access — **gate before (or with)
   the domain**; the workers.dev URL already serves logins publicly.
4. **Phase 4 — decommission** (after ~1wk parity, target ~2026-07-20):
   - [ ] parity check: `.watchy` GHA commit diffs ≡ `source='live'` events over the
     parallel window (`watchy backfill -S -u <bootstrap-ts>`-style walk vs
     `watchy sql` query)
   - [ ] remove the `schedule:` trigger from `.watchy` `update.yml` (keep
     `workflow_dispatch` for manual snapshots); final `watchy commit`
   - [ ] delete the `WATCHY_TOKEN` secret from `ryan-williams/.watchy` (worker has
     its own copy)
   - [ ] `.watchy` README: mark as frozen archive, link watchy.rbw.sh / the worker
   - [ ] optional: archive the repo (Settings → read-only; preserves history,
     kills all workflows — deadman already moved out)
   - Optional: periodic `events → parquet` export to R2 for pandas analysis,
     *as export, not ledger*.

## Non-goals (v1)

- Watching repos beyond stargazers/followers (subscribers API is restricted the same way;
  add later if wanted).
- Multi-user / non-Ryan tenancy.
- Historical login-rename tracking (state row just updates in place).

[`ryan-williams/.watchy`]: https://github.com/ryan-williams/.watchy
[gh-changelog]: https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/
