"""Slack subcommands: declarative posting of watch events (specs/slack-sync.md)."""

import os
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Optional

import requests
from click import option

from . import main, err

DEFAULT_API_BASE = "https://watchy.ryan-0dc.workers.dev"
PAGE_SIZE = 500


@main.group
def slack():
    """Post watch events to Slack (reconcile-style; idempotent)."""


def get_client(channel: str):
    from thrds import SlackClient

    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise SystemExit("SLACK_BOT_TOKEN not set")
    return SlackClient(token=token, channel=channel)


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
@option("-M", "--max-msgs", default=None, type=int, help="Cap posts this run (oldest-first; the next run picks up where this one stopped)")
@option("-n", "--dry-run", is_flag=True, help="Print would-be posts without posting")
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
    """Post one message per matching event not already in the channel (id order)."""
    from ..slack import build_messages, fetch_posted, post_event, sync_flat

    if since is None:
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")

    events = fetch_events(api_base, since)
    desired = build_messages(events, match)
    err(f"{len(events)} events since {since}; {len(desired)} match")

    client = get_client(channel)
    posted_ids = {p.id for p in fetch_posted(client, channel)}
    sync_flat(
        partial(post_event, client, channel),
        desired,
        posted_ids,
        max_msgs=max_msgs,
        dry_run=dry_run,
        pace=pace,
        log=err,
    )


def load_user_map(path: str) -> dict:
    """SLACK_USER_MAP from wrangler.jsonc (comments stripped — full-line `//` only)."""
    import json
    from pathlib import Path

    text = "\n".join(line for line in Path(path).read_text().splitlines() if not line.lstrip().startswith("//"))
    return json.loads(text)["vars"]["SLACK_USER_MAP"]


@slack.command
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
@option("-f", "--map-file", default="cfw/wrangler.jsonc", help="wrangler config with vars.SLACK_USER_MAP (default: cfw/wrangler.jsonc)")
@option("-n", "--dry-run", is_flag=True, help="Print would-be edits without editing")
@option("-p", "--pace", default=0.4, help="Seconds between Slack mutations (default: 0.4)")
def retag(channel: str, map_file: str, dry_run: bool, pace: float):
    """Edit posted messages whose actor is in SLACK_USER_MAP to add the ``(<@U…>)`` mention.

    Idempotent (already-mentioned messages are skipped); edits re-send the watchy_event
    metadata so posted-state recovery is unaffected. Slack does not notify on
    mention-adding edits.
    """
    from time import sleep

    from ..slack import actor_login, add_mention, event_metadata, EventMsg, fetch_posted

    user_map = load_user_map(map_file)
    client = get_client(channel)
    posted = sorted(fetch_posted(client, channel), key=lambda p: p.id)
    n_edited = n_skipped = 0
    for p in posted:
        login = actor_login(p.content)
        uid = user_map.get(login) if login else None
        new = add_mention(p.content, login, uid) if uid else None
        if new is None:
            n_skipped += 1
            continue
        err(f"{'would edit' if dry_run else 'editing'} [{p.id}] {new}")
        if not dry_run:
            client._request(
                "chat.update",
                {
                    "channel": channel,
                    "ts": p.ts,
                    "text": new,
                    "metadata": event_metadata(EventMsg(id=p.id, date=p.date, content=new)),
                },
            )
            sleep(pace)
        n_edited += 1
    err(f"{n_edited} edited, {n_skipped} skipped{' (dry-run)' if dry_run else ''}")


@slack.command("list")
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
def list_cmd(channel: str):
    """List posted event messages (id, date, ts, content), as JSONL on stdout."""
    import json

    from ..slack import fetch_posted

    client = get_client(channel)
    for p in sorted(fetch_posted(client, channel), key=lambda p: p.id):
        print(json.dumps({"id": p.id, "date": p.date, "ts": p.ts, "content": p.content}))


@slack.command
@option("-a", "--all", "all_", is_flag=True, help="Delete all watchy event messages (required if no -s/-u range given)")
@option("-c", "--channel", envvar="SLACK_CHANNEL_ID", required=True, help="Slack channel ID (default: $SLACK_CHANNEL_ID)")
@option("-f", "--force", is_flag=True, help="Delete messages even if thread replies would be orphaned")
@option("-n", "--dry-run", is_flag=True, help="Print would-be deletions without deleting")
@option("-p", "--pace", default=0.4, help="Seconds between Slack mutations (default: 0.4)")
@option("-s", "--since", default=None, help="First event date (YYYY-MM-DD, inclusive) to delete")
@option("-u", "--until", default=None, help="Last event date (YYYY-MM-DD, inclusive) to delete")
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
    """Delete posted event messages, by event-date range."""
    from click import confirm

    from ..slack import delete_events, fetch_posted

    if not (all_ or since or until):
        raise SystemExit("pass -s/-u to bound the range, or -a to delete all event messages")

    client = get_client(channel)
    targets = [
        p
        for p in fetch_posted(client, channel)
        if (since is None or p.date >= since) and (until is None or p.date <= until)
    ]
    if not targets:
        err("no matching event messages")
        return
    err(f"{len(targets)} message(s), events {min(p.id for p in targets)}..{max(p.id for p in targets)}")
    if not (dry_run or yes) and not confirm(f"Delete {len(targets)} message(s)?"):
        raise SystemExit("aborted")
    delete_events(client, targets, dry_run=dry_run, force=force, pace=pace, log=err)
