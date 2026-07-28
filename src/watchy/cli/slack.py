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


@slack.command
@option("-a", "--api-base", default=DEFAULT_API_BASE, help=f"Worker API base URL (default: {DEFAULT_API_BASE})")
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
@option("-m", "--match", multiple=True, required=True, help="Target prefix to post (e.g. `Open-Athena` covers the org's follows and all its repos' stars); repeatable")
@option("-n", "--dry-run", is_flag=True, help="Print would-be actions without posting")
@option("-p", "--pace", default=0.4, help="Seconds between Slack mutations (default: 0.4)")
@option("-s", "--since", default=None, help="Only reconcile events at/after this ISO timestamp (default: 7 days ago)")
def sync(
    api_base: str,
    channel: str,
    match: tuple[str, ...],
    dry_run: bool,
    pace: float,
    since: Optional[str],
):
    """Reconcile day-threads of matching events against the channel and post the diffs."""
    from thrds import SlackClient

    from ..slack import build_day_threads, fetch_day_threads, sync_days

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise SystemExit("SLACK_BOT_TOKEN not set")
    if since is None:
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")

    events = fetch_events(api_base, since)
    days = build_day_threads(events, match)
    err(f"{len(events)} events since {since}; {sum(len(d.messages) - 1 for d in days)} match → {len(days)} day(s)")

    client = SlackClient(token=token, channel=channel)
    existing = fetch_day_threads(client, channel)
    results = sync_days(client, days, existing, dry_run=dry_run, pace=pace, log=err)
    for day, result in results:
        if any(a.type.name != "SKIP" for a in result.actions):
            err(result.format_preview(prefix=f"{day.date} "))
