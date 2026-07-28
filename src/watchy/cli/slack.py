"""Slack subcommands: declarative posting of watch events (specs/slack-sync.md)."""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from click import option

from . import main, err

DEFAULT_API_BASE = "https://watchy.ryan-0dc.workers.dev"
PAGE_SIZE = 500


@main.group
def slack():
    """Post watch events to Slack (reconcile-style; idempotent)."""


def fetch_events(api_base: str, since: str) -> list[dict]:
    """Page /api/events (ts-desc) back until ``since``."""
    events: list[dict] = []
    offset = 0
    while True:
        resp = requests.get(f"{api_base}/api/events", params={"limit": PAGE_SIZE, "offset": offset})
        resp.raise_for_status()
        page = resp.json()["events"]
        events += [e for e in page if e["ts"] >= since]
        if len(page) < PAGE_SIZE or page[-1]["ts"] < since:
            return events
        offset += PAGE_SIZE


def get_client(channel: str):
    from thrds import SlackClient

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise SystemExit("SLACK_BOT_TOKEN not set")
    return SlackClient(token=token, channel=channel)


@slack.command
@option("-a", "--api-base", default=DEFAULT_API_BASE, help=f"Worker API base URL (default: {DEFAULT_API_BASE})")
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
@option("-m", "--match", multiple=True, required=True, help="Target prefix to post (e.g. `Open-Athena` covers the org's follows and all its repos' stars); repeatable")
@option("-M", "--max-msgs", default=None, type=int, help="Cap total desired messages this run (oldest-first; last day may be truncated — the next run completes it)")
@option("-n", "--dry-run", is_flag=True, help="Print would-be actions without posting")
@option("-p", "--pace", default=0.4, help="Seconds between Slack mutations (default: 0.4)")
@option("-s", "--since", default=None, help="Only reconcile events at/after this ISO timestamp (default: 7 days ago)")
def sync(
    api_base: str,
    channel: str,
    match: tuple[str, ...],
    max_msgs: Optional[int],
    dry_run: bool,
    pace: float,
    since: Optional[str],
):
    """Reconcile day-threads of matching events against the channel and post the diffs."""
    from ..slack import build_day_threads, fetch_day_threads, sync_days, truncate_days

    if since is None:
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")

    events = fetch_events(api_base, since)
    days = build_day_threads(events, match)
    err(f"{len(events)} events since {since}; {sum(len(d.messages) - 1 for d in days)} match → {len(days)} day(s)")
    if max_msgs is not None:
        days = truncate_days(days, max_msgs)
        err(f"capped at {max_msgs} messages → {len(days)} day(s)")

    client = get_client(channel)
    existing = fetch_day_threads(client, channel)
    results = sync_days(client, days, existing, dry_run=dry_run, pace=pace, log=err)
    for day, result in results:
        if any(a.type.name != "SKIP" for a in result.actions):
            err(result.format_preview(prefix=f"{day.date} "))


@slack.command("list")
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
def list_cmd(channel: str):
    """List posted day-threads (date + thread_ts + reply count), as JSONL on stdout."""
    import json

    from ..slack import fetch_day_threads

    client = get_client(channel)
    for date, ts in sorted(fetch_day_threads(client, channel).items()):
        n = len(client.list_messages(ts)) - 1
        print(json.dumps({"date": date, "ts": ts, "replies": n}))


@slack.command
@option("-a", "--all", "all_", is_flag=True, help="Delete all watchy day-threads (required if no -s/-u range given)")
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
@option("-f", "--force", is_flag=True, help="Delete OPs even if non-bot replies would be orphaned")
@option("-n", "--dry-run", is_flag=True, help="Print would-be deletions without deleting")
@option("-p", "--pace", default=0.4, help="Seconds between Slack mutations (default: 0.4)")
@option("-s", "--since", default=None, help="First day (YYYY-MM-DD, inclusive) to delete")
@option("-u", "--until", default=None, help="Last day (YYYY-MM-DD, inclusive) to delete")
@option("-y", "--yes", is_flag=True, help="Skip the confirmation prompt")
def rm(
    all_: bool,
    channel: str,
    force: bool,
    dry_run: bool,
    pace: float,
    since: Optional[str],
    until: Optional[str],
    yes: bool,
):
    """Delete posted day-threads (replies first, then OPs), by date range."""
    from click import confirm

    from ..slack import delete_day_threads, fetch_day_threads

    if not (all_ or since or until):
        raise SystemExit("pass -s/-u to bound the range, or -a to delete all day-threads")

    client = get_client(channel)
    existing = fetch_day_threads(client, channel)
    targets = {
        date: ts
        for date, ts in existing.items()
        if (since is None or date >= since) and (until is None or date <= until)
    }
    if not targets:
        err("no matching day-threads")
        return
    err(f"{len(targets)} day-thread(s): {', '.join(sorted(targets))}")
    if not (dry_run or yes) and not confirm(f"Delete {len(targets)} day-thread(s) and their bot replies?"):
        raise SystemExit("aborted")
    delete_day_threads(client, targets, dry_run=dry_run, force=force, pace=pace, log=err)
