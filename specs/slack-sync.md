# `watchy slack sync` — declarative Slack posting of watch events

Post watch activity (stars/follows on selected targets, e.g. OA + marin orgs) to a Slack channel, **reconcile-style**: look at the activity log (D1 `events`, via the worker's public API), look at what's already been posted (read back from Slack itself), and post the diffs. Modeled on `$hccs/crashes` (`njsp slack sync`) and `$hccs/path` (`gha_update`), built on [`thrds`] (same 3-phase reconcile: SKIP/EDIT/POST/DELETE; idempotent re-runs are all-SKIP).

## Design

**Sources of truth**
- *Activity*: the worker's `/api/events` (public; no CF auth needed — the CLI runs anywhere with just a Slack token). Events are immutable and `id`-monotonic.
- *Posted state*: **Slack itself** — no local ledger (crashes pattern, not ctbk's R2-state pattern). Day-thread OPs carry Slack message metadata `{event_type: 'watchy_day', event_payload: {date}}`; one `conversations.history` read (with `include_all_metadata`) rebuilds the `date → thread_ts` map.

**Thread layout** — one thread per UTC day (only days with matching events):
- OP: `:calendar: *YYYY-MM-DD*` — **static, never edited** (path learned Slack rejects `chat.update` on old OPs; a static OP means thrds never tries).
- Replies: one line per event, ordered by **event `id`** (insertion order), not `ts`. This makes threads append-only: a backdated event (e.g. a private→public repo's old `starred_at`) lands in an old day's thread as an appended reply — allowed by Slack — rather than a mid-thread insert that would force edits.
- Line format mirrors the FE feed: `⭐️ <login> starred <target> HH:MMZ` (mrkdwn profile/repo links; 💔 unstar, 📣 follow, 🔇 unfollow).

**Matching** — `-m/--match <prefix>` (repeatable): event matches if `target == m` or `target.startswith(m + '/')`, so one token (`Open-Athena`) covers both org follows and org-repo stars. Full repo paths also work as exact matches.

**Windowing** — `-s/--since` (default 7 days, crashes' lookback): bounds which days are reconciled each run. First run in an empty channel posts only the window (no historical flood); widen `--since` deliberately to backfill more.

**Idempotency** — re-running is a no-op (thrds content-equality → SKIP). `-n/--dry-run` prints the would-be actions as a colored diff without mutating.

## CLI

```
watchy slack sync -m Open-Athena -m marin-community [-n] [-s 2026-07-21] \
    [-c CHANNEL] [-a API_BASE] [-p PACE]
```

- `SLACK_BOT_TOKEN` (bot `xoxb-` token) and `SLACK_CHANNEL_ID` from env (crashes/path convention; `-c` overrides the latter).
- Slack app needs scopes: `chat:write`, `channels:history` (private: `groups:history`), plus `channels:read` if channel is given as `#name`.
- `-a/--api-base` defaults to the prod worker.

## Scheduling (later)

v1 is CLI-invoked (manual / ad-hoc). Options once proven: GHA cron in this repo (deadman workflow already lives here), or fold into the worker itself via the TS port ([`@rdub/thrds`] — ctbk's `gbfs/api/alerts.ts` already runs it inside a CF Worker). The declarative design makes the runner interchangeable.

## Files

- `src/watchy/slack.py` — pure logic: `render_event`, `build_day_threads`, `sync_days` (takes any client with a thrds-`SlackClient`-shaped `.sync`; tests use a fake)
- `src/watchy/cli/slack.py` — `watchy slack sync` (click group, room for e.g. `slack list` later)
- `test/test_slack.py` — rendering / grouping / matching / reconcile-call tests, exact-equality assertions

[`thrds`]: https://github.com/runsascoded/thrds
[`@rdub/thrds`]: https://www.npmjs.com/package/@rdub/thrds
