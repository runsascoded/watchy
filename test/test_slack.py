"""Tests for the declarative Slack sync (src/watchy/slack.py)."""

import pytest
from thrds import OrphanedRepliesError

from watchy.slack import EventMsg, Posted, build_messages, delete_events, event_metadata, matches, render_event, sync_flat


def ev(id: int, ts: str, kind: str, target: str, login: str) -> dict:
    return {"id": id, "ts": ts, "kind": kind, "target": target, "login": login}


def test_render_event_kinds():
    assert render_event(ev(1, "2026-07-28T16:01:43Z", "star", "Open-Athena/Kelp", "postylem")) == (
        ":star: <https://github.com/postylem|postylem> starred <https://github.com/Open-Athena/Kelp|Open-Athena/Kelp> · 2026-07-28 16:01Z"
    )
    assert render_event(ev(2, "2026-07-13T02:18:21Z", "unstar", "ryan-williams/git-helpers", "zhangkejiang")) == (
        ":broken_heart: <https://github.com/zhangkejiang|zhangkejiang> unstarred <https://github.com/ryan-williams/git-helpers|ryan-williams/git-helpers> · 2026-07-13 02:18Z"
    )
    assert render_event(ev(3, "2026-07-24T01:00:28Z", "follow", "ryan-williams", "chrisipanaque")) == (
        ":mega: <https://github.com/chrisipanaque|chrisipanaque> followed <https://github.com/ryan-williams|ryan-williams> · 2026-07-24 01:00Z"
    )
    assert render_event(ev(4, "2026-07-20T22:00:00Z", "unfollow", "Open-Athena", "electricmoss")) == (
        ":mute: <https://github.com/electricmoss|electricmoss> unfollowed <https://github.com/Open-Athena|Open-Athena> · 2026-07-20 22:00Z"
    )


def test_matches():
    match = ("Open-Athena", "marin-community")
    assert matches("Open-Athena", match) is True
    assert matches("Open-Athena/Kelp", match) is True
    assert matches("marin-community/levanter", match) is True
    assert matches("Open-AthenaX", match) is False
    assert matches("runsascoded/watchy", match) is False


def test_build_messages_filters_and_orders_by_ts():
    events = [
        # ts-desc as the API returns them; note id 30 was *inserted* after id 20 but has an earlier ts
        # (bootstrap batches insert repo-by-repo) — ts order wins
        ev(40, "2026-07-28T16:01:43Z", "star", "Open-Athena/Kelp", "postylem"),
        ev(35, "2026-07-28T12:00:00Z", "star", "runsascoded/watchy", "someone"),  # no match
        ev(30, "2026-07-27T01:00:00Z", "star", "marin-community/marin", "backdated"),
        ev(20, "2026-07-27T22:52:57Z", "star", "Open-Athena/marin-dna", "alxmrs"),
    ]
    assert build_messages(events, ("Open-Athena", "marin-community")) == [
        EventMsg(id=30, date="2026-07-27", content=":star: <https://github.com/backdated|backdated> starred <https://github.com/marin-community/marin|marin-community/marin> · 2026-07-27 01:00Z"),
        EventMsg(id=20, date="2026-07-27", content=":star: <https://github.com/alxmrs|alxmrs> starred <https://github.com/Open-Athena/marin-dna|Open-Athena/marin-dna> · 2026-07-27 22:52Z"),
        EventMsg(id=40, date="2026-07-28", content=":star: <https://github.com/postylem|postylem> starred <https://github.com/Open-Athena/Kelp|Open-Athena/Kelp> · 2026-07-28 16:01Z"),
    ]


def test_event_metadata():
    assert event_metadata(EventMsg(id=42, date="2026-07-28", content="x")) == {
        "event_type": "watchy_event",
        "event_payload": {"id": 42, "date": "2026-07-28"},
    }


DESIRED = [
    EventMsg(id=1, date="2026-07-22", content="a"),
    EventMsg(id=2, date="2026-07-22", content="b"),
    EventMsg(id=3, date="2026-07-23", content="c"),
]


def test_sync_flat_posts_only_missing_in_id_order():
    posted = []
    logs = []
    result = sync_flat(posted.append, DESIRED, posted_ids={2}, log=logs.append, sleep=lambda s: None)
    assert posted == [DESIRED[0], DESIRED[2]]
    assert result == [DESIRED[0], DESIRED[2]]
    assert logs == [
        "posting [1] a",
        "posting [3] c",
        "2 posted, 1 already present",
    ]


def test_sync_flat_max_msgs():
    posted = []
    logs = []
    result = sync_flat(posted.append, DESIRED, posted_ids=set(), max_msgs=2, log=logs.append, sleep=lambda s: None)
    assert posted == [DESIRED[0], DESIRED[1]]
    assert result == [DESIRED[0], DESIRED[1]]
    assert logs == [
        "posting [1] a",
        "posting [2] b",
        "2 posted, 0 already present, 1 deferred by cap",
    ]


def test_sync_flat_dry_run():
    posted = []
    logs = []
    sync_flat(posted.append, DESIRED, posted_ids=set(), dry_run=True, log=logs.append, sleep=lambda s: None)
    assert posted == []
    assert logs == [
        "would post [1] a",
        "would post [2] b",
        "would post [3] c",
        "3 posted, 0 already present (dry-run)",
    ]


def test_sync_flat_all_present():
    posted = []
    logs = []
    sync_flat(posted.append, DESIRED, posted_ids={1, 2, 3}, log=logs.append, sleep=lambda s: None)
    assert posted == []
    assert logs == ["0 posted, 3 already present"]


class FakeDeleteClient:
    def __init__(self, orphaned: set = ()):
        self.orphaned = set(orphaned)
        self.deleted = []

    def delete(self, message_id, orphans_ok=False):
        if message_id in self.orphaned and not orphans_ok:
            raise OrphanedRepliesError(message_id, 2)
        self.deleted.append((message_id, orphans_ok))


TARGETS = [
    Posted(id=2, date="2026-07-22", ts="1.2", content="b"),
    Posted(id=1, date="2026-07-22", ts="1.1", content="a"),
]


def test_delete_events_id_order():
    client = FakeDeleteClient()
    logs = []
    delete_events(client, TARGETS, log=logs.append, sleep=lambda s: None)
    assert client.deleted == [("1.1", False), ("1.2", False)]
    assert logs == [
        "deleting [1] a",
        "deleting [2] b",
    ]


def test_delete_events_keeps_orphaned_unless_force():
    client = FakeDeleteClient(orphaned={"1.1"})
    logs = []
    delete_events(client, TARGETS, log=logs.append, sleep=lambda s: None)
    assert client.deleted == [("1.2", False)]
    assert logs == [
        "deleting [1] a",
        "keeping [1] (2 thread replies would be orphaned; -f to force)",
        "deleting [2] b",
    ]
    client = FakeDeleteClient(orphaned={"1.1"})
    delete_events(client, TARGETS, force=True, sleep=lambda s: None)
    assert client.deleted == [("1.1", True), ("1.2", True)]


def test_delete_events_dry_run():
    client = FakeDeleteClient()
    logs = []
    delete_events(client, TARGETS, dry_run=True, log=logs.append, sleep=lambda s: None)
    assert client.deleted == []
    assert logs == [
        "would delete [1] a",
        "would delete [2] b",
    ]


def test_orphaned_replies_error_shape():
    with pytest.raises(OrphanedRepliesError):
        FakeDeleteClient(orphaned={"x"}).delete("x")
