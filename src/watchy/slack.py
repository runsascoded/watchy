"""Declarative Slack sync of watch events (see specs/slack-sync.md).

Day-per-thread layout, reconciled via ``thrds``: OPs are static date headers
(never edited); replies are one line per event, ordered by event ``id`` so
threads are append-only even when backdated events (old ``starred_at``) arrive.
Posted-state lives in Slack itself, recovered from OP message metadata.
"""

from dataclasses import dataclass
from typing import Callable, Optional

from thrds import SyncResult, Thread

DAY_EVENT_TYPE = "watchy_day"

KIND_VERBS = {
    "star": ("⭐️", "starred"),
    "unstar": ("💔", "unstarred"),
    "follow": ("📣", "followed"),
    "unfollow": ("🔇", "unfollowed"),
}


def matches(target: str, match: tuple[str, ...]) -> bool:
    """One prefix token covers both org follows (``target == m``) and org-repo stars (``m/...``)."""
    return any(target == m or target.startswith(f"{m}/") for m in match)


def render_event(e: dict) -> str:
    emoji, verb = KIND_VERBS[e["kind"]]
    login, target, ts = e["login"], e["target"], e["ts"]
    hhmm = ts[11:16]
    return f"{emoji} <https://github.com/{login}|{login}> {verb} <https://github.com/{target}|{target}> {hhmm}Z"


def day_op(date: str) -> str:
    return f":calendar: *{date}*"


def op_metadata(date: str) -> dict:
    return {"event_type": DAY_EVENT_TYPE, "event_payload": {"date": date}}


@dataclass
class DayThread:
    date: str
    messages: list[str]  # [op, *event lines]


def build_day_threads(events: list[dict], match: tuple[str, ...]) -> list[DayThread]:
    """Group matching events into per-UTC-day desired threads, event lines in ``id`` order."""
    by_date: dict[str, list[dict]] = {}
    for e in events:
        if not matches(e["target"], match):
            continue
        by_date.setdefault(e["ts"][:10], []).append(e)
    return [
        DayThread(date=date, messages=[day_op(date)] + [render_event(e) for e in sorted(es, key=lambda e: e["id"])])
        for date, es in sorted(by_date.items())
    ]


def truncate_days(days: list[DayThread], max_msgs: int) -> list[DayThread]:
    """Cap total desired messages (OPs + lines) across days, oldest-first.

    The last included day may be truncated mid-thread — safe because threads are
    append-only: the next un-capped run completes it. A day is dropped entirely
    rather than posting a bare OP with no events.
    """
    out: list[DayThread] = []
    budget = max_msgs
    for day in days:
        if budget < 2:
            break
        if len(day.messages) <= budget:
            out.append(day)
            budget -= len(day.messages)
        else:
            out.append(DayThread(date=day.date, messages=day.messages[:budget]))
            budget = 0
    return out


def sync_days(
    client,
    days: list[DayThread],
    existing: dict[str, str],
    dry_run: bool = False,
    pace: float = 0.4,
    log: Optional[Callable[[str], None]] = None,
) -> list[tuple[DayThread, SyncResult]]:
    """Reconcile each desired day-thread against Slack.

    ``client`` needs a thrds-``SlackClient``-shaped ``.sync(thread, thread_ts=, dry_run=, pace=, metadata=)``;
    ``existing`` maps date → thread_ts for already-posted day OPs (absent → create).
    """
    results = []
    for day in days:
        op = day.messages[0]
        result = client.sync(
            Thread(messages=day.messages),
            thread_ts=existing.get(day.date),
            dry_run=dry_run,
            pace=pace,
            metadata={op: op_metadata(day.date)},
        )
        if log:
            posted = sum(1 for a in result.actions if a.type.name == "POST")
            skipped = sum(1 for a in result.actions if a.type.name == "SKIP")
            log(f"{day.date}: {posted} posted, {skipped} skipped" + (" (dry-run)" if dry_run else ""))
        results.append((day, result))
    return results


def delete_day_threads(
    client,
    targets: dict[str, str],
    dry_run: bool = False,
    force: bool = False,
    pace: float = 0.4,
    log: Optional[Callable[[str], None]] = None,
    sleep: Callable[[float], None] = None,
) -> None:
    """Delete day-threads (replies newest-first, then the OP).

    Only the bot's own (``editable``) messages are deleted. If foreign replies
    remain, the OP is kept (they'd be orphaned) unless ``force``.
    """
    if sleep is None:
        from time import sleep as sleep_
        sleep = sleep_
    for date, ts in sorted(targets.items()):
        msgs = client.list_messages(ts)  # OP first, then replies
        op, replies = msgs[0], msgs[1:]
        foreign = [m for m in replies if not m.editable]
        for m in reversed([m for m in replies if m.editable]):
            if log:
                log(f"{date}: {'would delete' if dry_run else 'deleting'} reply {m.id}: {m.content}")
            if not dry_run:
                client.delete(m.id)
                sleep(pace)
        if foreign and not force:
            if log:
                log(f"{date}: keeping OP {op.id} ({len(foreign)} non-bot replies would be orphaned; -f to force)")
            continue
        if log:
            log(f"{date}: {'would delete' if dry_run else 'deleting'} OP {op.id}: {op.content}")
        if not dry_run:
            client.delete(op.id, orphans_ok=force)
            sleep(pace)


def fetch_day_threads(client, channel: str, max_recs: int = 1000) -> dict[str, str]:
    """date → thread_ts for this bot's day-OP messages, read back from channel history.

    Uses thrds ``SlackClient``'s private ``_request`` (no public history API yet — same
    gap ``$hccs/path`` works around).
    """
    user_id, bot_id = client.bot_ids
    existing: dict[str, str] = {}
    cursor = None
    seen = 0
    while seen < max_recs:
        params = {"channel": channel, "limit": min(200, max_recs - seen), "include_all_metadata": True}
        if cursor:
            params["cursor"] = cursor
        resp = client._request("conversations.history", params, method="GET")
        msgs = resp.get("messages", [])
        seen += len(msgs)
        for m in msgs:
            if not (m.get("user") == user_id or (bot_id and m.get("bot_id") == bot_id)):
                continue
            md = m.get("metadata") or {}
            if md.get("event_type") == DAY_EVENT_TYPE:
                date = (md.get("event_payload") or {}).get("date")
                if date:
                    existing[date] = m["ts"]
        cursor = (resp.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            break
    return existing
