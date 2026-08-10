"""Declarative Slack sync of watch events (see specs/slack-sync.md).

Flat layout: one channel message per event, posted in event-``id`` order
(append-only; events are immutable, so the reconcile is pure set-difference —
no edits, no deletes). Posted-state lives in Slack itself, recovered from
per-message metadata ``{event_type: watchy_event, event_payload: {id, date}}``.
"""

import re
from dataclasses import dataclass
from typing import Callable, Optional

EVENT_TYPE = "watchy_event"

# Shortcodes, not literal emoji: Slack normalizes literals to shortcodes in stored
# message text, so literals would make read-back never match desired (perma-diff).
# The event kind is carried by the per-message avatar (icon_url), not a leading emoji;
# ``unit`` is the running-total suffix's emoji (repo star count vs org follower count).
KINDS = {
    "star": ("starred", ":star:"),
    "unstar": ("unstarred", ":star:"),
    "follow": ("followed", ":mega:"),
    "unfollow": ("unfollowed", ":mega:"),
}


def matches(target: str, match: tuple[str, ...]) -> bool:
    """One prefix token covers both org follows (``target == m``) and org-repo stars (``m/...``)."""
    return any(target == m or target.startswith(f"{m}/") for m in match)


def render_event(
    e: dict,
    count: Optional[int] = None,
    slack_user: Optional[str] = None,
    dashboard_url: Optional[str] = None,
    org_emoji: Optional[str] = None,
) -> str:
    """Mirrors cfw/src/slack.ts renderEvent — keep byte-identical for same inputs."""
    from urllib.parse import quote

    verb, unit = KINDS[e["kind"]]
    login, target, ts = e["login"], e["target"], e["ts"]
    date, hhmm = ts[:10], ts[11:16]
    who = f"<https://github.com/{login}|{login}>" + (f" (<@{slack_user}>)" if slack_user else "")
    # Repo short-name only — the org rides as a workspace-emoji prefix when configured,
    # and the per-message avatar carries org+kind regardless.
    short = target.split("/", 1)[1] if "/" in target else target
    tgt = (f":{org_emoji}: " if org_emoji else "") + f"<https://github.com/{target}|{short}>"
    base = f"{who} {verb} {tgt} · {date} {hhmm}Z"
    if count is None:
        return base
    total = f"{count:,} {unit}"
    if dashboard_url:
        return f"{base} · <{dashboard_url}/?t={quote(target, safe='')}|{total}>"
    return f"{base} · {total}"


@dataclass
class EventMsg:
    id: int
    date: str
    content: str


def event_metadata(m: EventMsg) -> dict:
    return {"event_type": EVENT_TYPE, "event_payload": {"id": m.id, "date": m.date}}


def build_messages(
    events: list[dict],
    match: tuple[str, ...],
    counts: Optional[dict[str, int]] = None,
    user_map: Optional[dict[str, str]] = None,
) -> list[EventMsg]:
    """Matching events as desired messages, in event-time order.

    Flat messages never reposition, so the sort key only shapes each batch's
    posting order — ``(ts, id)`` reads chronologically (``id`` alone would
    replay insertion order, e.g. bootstrap batches grouped repo-by-repo).

    ``counts`` maps target → current total (repo stars / org followers) for the
    running-total suffix; targets absent from it render without the suffix.
    ``user_map`` maps GH login → Slack user id: known actors get an ``(<@U…>)``
    mention appended to their GH link.
    """
    return [
        EventMsg(
            id=e["id"],
            date=e["ts"][:10],
            content=render_event(e, (counts or {}).get(e["target"]), (user_map or {}).get(e["login"])),
        )
        for e in sorted((e for e in events if matches(e["target"], match)), key=lambda e: (e["ts"], e["id"]))
    ]


@dataclass
class Posted:
    """A previously-posted event message, read back from channel history."""
    id: int
    date: str
    ts: str
    content: str


ACTOR_RE = re.compile(r"<https://github\.com/([^/|>]+)\|")


def actor_login(content: str) -> Optional[str]:
    """The acting user's GH login — the first slashless github.com link in any format era."""
    m = ACTOR_RE.search(content)
    return m.group(1) if m else None


def add_mention(content: str, login: str, user_id: str) -> Optional[str]:
    """Insert ``(<@user_id>)`` after the actor's GH link; None if already mentioned or no link."""
    if "(<@" in content:
        return None
    link = f"<https://github.com/{login}|{login}>"
    if link not in content:
        return None
    return content.replace(link, f"{link} (<@{user_id}>)", 1)


def sync_flat(
    post: Callable[[EventMsg], None],
    desired: list[EventMsg],
    posted_ids: set[int],
    max_msgs: Optional[int] = None,
    dry_run: bool = False,
    pace: float = 0.4,
    log: Optional[Callable[[str], None]] = None,
    sleep: Callable[[float], None] = None,
) -> list[EventMsg]:
    """Post desired messages whose event ``id`` isn't already in the channel, oldest-first."""
    if sleep is None:
        from time import sleep as sleep_
        sleep = sleep_
    missing = [m for m in desired if m.id not in posted_ids]
    capped = missing if max_msgs is None else missing[:max_msgs]
    for m in capped:
        if log:
            log(f"{'would post' if dry_run else 'posting'} [{m.id}] {m.content}")
        if not dry_run:
            post(m)
            sleep(pace)
    if log:
        deferred = len(missing) - len(capped)
        log(
            f"{len(capped)} posted, {len(desired) - len(missing)} already present"
            + (f", {deferred} deferred by cap" if deferred else "")
            + (" (dry-run)" if dry_run else "")
        )
    return capped


def delete_events(
    client,
    targets: list[Posted],
    dry_run: bool = False,
    force: bool = False,
    pace: float = 0.4,
    log: Optional[Callable[[str], None]] = None,
    sleep: Callable[[float], None] = None,
) -> None:
    """Delete posted event messages. Messages with (non-bot) thread replies are kept unless ``force``."""
    from thrds import OrphanedRepliesError

    if sleep is None:
        from time import sleep as sleep_
        sleep = sleep_
    for p in sorted(targets, key=lambda p: p.id):
        if log:
            log(f"{'would delete' if dry_run else 'deleting'} [{p.id}] {p.content}")
        if not dry_run:
            try:
                client.delete(p.ts, orphans_ok=force)
            except OrphanedRepliesError as e:
                if log:
                    log(f"keeping [{p.id}] ({e.reply_count} thread replies would be orphaned; -f to force)")
                continue
            sleep(pace)


def post_event(client, channel: str, m: EventMsg) -> None:
    """chat.postMessage with metadata (thrds ``post`` has no metadata param; use its ``_request``)."""
    client._request(
        "chat.postMessage",
        {
            "channel": channel,
            "text": m.content,
            "metadata": event_metadata(m),
            "unfurl_links": False,
            "unfurl_media": False,
        },
    )


def fetch_posted(client, channel: str, max_recs: int = 5000) -> list[Posted]:
    """Read back this bot's event messages (id, date, ts, content) from channel history.

    Uses thrds ``SlackClient``'s private ``_request`` (no public history API yet — same
    gap ``$hccs/path`` works around).
    """
    user_id, bot_id = client.bot_ids
    posted: list[Posted] = []
    cursor = None
    seen = 0
    while seen < max_recs:
        params = {"channel": channel, "limit": min(200, max_recs - seen), "include_all_metadata": True}
        if cursor:
            params["cursor"] = cursor
        resp = client._request("conversations.history", params, method="GET")
        msgs = resp.get("messages", [])
        seen += len(msgs)
        for msg in msgs:
            if not (msg.get("user") == user_id or (bot_id and msg.get("bot_id") == bot_id)):
                continue
            md = msg.get("metadata") or {}
            if md.get("event_type") == EVENT_TYPE:
                payload = md.get("event_payload") or {}
                if "id" in payload:
                    posted.append(Posted(id=int(payload["id"]), date=payload.get("date", ""), ts=msg["ts"], content=msg.get("text", "")))
        cursor = (resp.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            break
    return posted
