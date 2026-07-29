# `watchy slack sync` — declarative Slack posting of watch events

Post watch activity (stars/follows on selected targets, e.g. OA + marin orgs) to a Slack channel, **reconcile-style**: look at the activity log (D1 `events`, via the worker's public API), look at what's already been posted (read back from Slack itself), and post the diffs. Modeled on `$hccs/crashes` (`njsp slack sync`) / `$hccs/path` (`gha_update`); uses [`thrds`]' `SlackClient` transport (429/`Retry-After` handling, orphan-guarded deletes).

## Design

**Sources of truth**
- *Activity*: the worker's `/api/events` (public; no CF auth needed — the CLI runs anywhere with just a Slack token). Events are immutable and `id`-monotonic.
- *Posted state*: **Slack itself** — no local ledger (crashes pattern, not ctbk's R2-state pattern). Each posted message carries metadata `{event_type: 'watchy_event', event_payload: {id, date}}`; one `conversations.history` read (with `include_all_metadata`) rebuilds the posted-`id` set.

**Layout** — flat: **one channel message per event**, posted in event-`id` (insertion) order. No threading: the worker polls every 10 minutes (`*/10 * * * *`), so Slack's own message timestamps carry the temporal context; each message also renders the event's true `ts` (`· YYYY-MM-DD HH:MMZ`), which matters for backdated events (bootstrap `starred_at`, private→public repos). Since events are immutable, the reconcile is pure set-difference — no edits or repositioning ever (v1 day-threading + `thrds.sync` was replaced by this; see git history).

Message shape (emoji as **shortcodes** — Slack normalizes literal emoji in stored text, which would break read-back equality):

```
:star: <https://github.com/postylem|postylem> starred <https://github.com/Open-Athena/Kelp|Open-Athena/Kelp> · 2026-07-28 16:01Z
```

`:star:` star, `:broken_heart:` unstar, `:mega:` follow, `:mute:` unfollow.

**Matching** — `-m/--match <prefix>` (repeatable): event matches if `target == m` or `target.startswith(m + '/')`, so one token (`Open-Athena`) covers both org follows and org-repo stars.

**Windowing / capping** — `-s/--since` (default 7 days) bounds the reconcile window; `-M/--max-msgs` caps posts per run (oldest-`id`-first; the next run continues where it stopped). Idempotent: re-runs post nothing (`N already present`). `-n/--dry-run` previews.

## CLI

```
watchy slack sync -m Open-Athena -m marin-community [-n] [-M 20] [-s <iso-ts>] [-p 1.0]
watchy slack list                     # posted messages (id, date, ts, content) as JSONL
watchy slack rm -s 2026-07-22 -u 2026-07-24 [-n] [-y] [-f]   # or -a for all
```

- `SLACK_BOT_TOKEN` (bot `xoxb-`) + `SLACK_CHANNEL_ID` from env (`-c` overrides).
- App scopes: `chat:write`, `channels:history` (private: `groups:history`). App manifest lives in the Slack dashboard (app `watchy`, OA workspace).
- `rm` deletes by event-date range, keeps messages whose thread replies would be orphaned unless `-f`, prompts unless `-y`.
- Pace note: thrds' 0.4s default exceeds Slack's documented sustained `chat.postMessage` rate (~1 msg/s/channel, special tier); use `-p 1.0` for large backfills. Slack's post-2025-05 non-Marketplace limits on `conversations.history` (~1 req/min, 15/page for new apps) haven't bitten at our volume but would degrade gracefully (`Retry-After`).

## Live posting (worker-native) — ✅ 2026-07-28

The worker posts new matching events after each 10-minute `collect()` (`cfw/src/slack.ts`), gated on `SLACK_BOT_TOKEN` (secret) + `SLACK_CHANNEL_ID`/`SLACK_MATCHES_JSON` (vars). Posted-state for the worker is the **`slack_posts` D1 ledger** (`event_id → slack ts`; `ts NULL` = seeded/handled) — cheap set-difference per run, no Slack history reads at 144 runs/day. ≤25 posts/run at 1s pace; a post failure halts the batch (chronology preserved; retried next tick). Same message metadata as the CLI.

Cutover history: 6-month backfill (631 events, ts-ordered) via CLI; ledger then seeded with **all** matching event ids (2,365 — the pre-window ~1,700 are marked handled-never-post); CLI catch-up pass confirmed 0 stragglers; then secret set + deploy.

The CLI remains the audit/backfill/repair tool: it reconciles against *actual Slack content* (metadata read-back), so it can detect/fix drift the ledger can't see (e.g. hand-deleted messages). Note the two stores can disagree: `rm` deletes from Slack but not the ledger (the worker won't repost — usually what you want); to make the worker repost an event, also delete its `slack_posts` row.

## Files

- `src/watchy/slack.py` — pure logic: `render_event`, `build_messages`, `sync_flat`, `delete_events` (+ thin `fetch_posted`/`post_event` over thrds' `_request`)
- `src/watchy/cli/slack.py` — `watchy slack {sync,list,rm}`
- `test/test_slack.py` — rendering / matching / reconcile / deletion tests, exact-equality assertions

[`thrds`]: https://github.com/runsascoded/thrds
[`@rdub/thrds`]: https://www.npmjs.com/package/@rdub/thrds
