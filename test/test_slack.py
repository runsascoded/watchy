"""Tests for the declarative Slack sync (src/watchy/slack.py)."""

from thrds import Action, ActionType, Message, SyncResult, Thread

from watchy.slack import DayThread, build_day_threads, delete_day_threads, matches, op_metadata, render_event, sync_days, truncate_days


def ev(id: int, ts: str, kind: str, target: str, login: str) -> dict:
    return {"id": id, "ts": ts, "kind": kind, "target": target, "login": login}


def test_render_event_kinds():
    assert render_event(ev(1, "2026-07-28T16:01:43Z", "star", "Open-Athena/Kelp", "postylem")) == (
        "⭐️ <https://github.com/postylem|postylem> starred <https://github.com/Open-Athena/Kelp|Open-Athena/Kelp> 16:01Z"
    )
    assert render_event(ev(2, "2026-07-13T02:18:21Z", "unstar", "ryan-williams/git-helpers", "zhangkejiang")) == (
        "💔 <https://github.com/zhangkejiang|zhangkejiang> unstarred <https://github.com/ryan-williams/git-helpers|ryan-williams/git-helpers> 02:18Z"
    )
    assert render_event(ev(3, "2026-07-24T01:00:28Z", "follow", "ryan-williams", "chrisipanaque")) == (
        "📣 <https://github.com/chrisipanaque|chrisipanaque> followed <https://github.com/ryan-williams|ryan-williams> 01:00Z"
    )
    assert render_event(ev(4, "2026-07-20T22:00:00Z", "unfollow", "Open-Athena", "electricmoss")) == (
        "🔇 <https://github.com/electricmoss|electricmoss> unfollowed <https://github.com/Open-Athena|Open-Athena> 22:00Z"
    )


def test_matches():
    match = ("Open-Athena", "marin-community")
    assert matches("Open-Athena", match) is True
    assert matches("Open-Athena/Kelp", match) is True
    assert matches("marin-community/levanter", match) is True
    assert matches("Open-AthenaX", match) is False
    assert matches("runsascoded/watchy", match) is False


def test_build_day_threads_groups_filters_and_orders_by_id():
    events = [
        # ts-desc as the API returns them; note id 30 has an earlier ts than id 20 (backdated starred_at)
        ev(40, "2026-07-28T16:01:43Z", "star", "Open-Athena/Kelp", "postylem"),
        ev(39, "2026-07-28T16:00:22Z", "star", "Open-Athena/Kelp", "shepardxia"),
        ev(35, "2026-07-28T12:00:00Z", "star", "runsascoded/watchy", "someone"),  # no match
        ev(30, "2026-07-27T01:00:00Z", "star", "marin-community/marin", "backdated"),
        ev(20, "2026-07-27T22:52:57Z", "star", "Open-Athena/marin-dna", "alxmrs"),
    ]
    assert build_day_threads(events, ("Open-Athena", "marin-community")) == [
        DayThread(
            date="2026-07-27",
            messages=[
                ":calendar: *2026-07-27*",
                "⭐️ <https://github.com/alxmrs|alxmrs> starred <https://github.com/Open-Athena/marin-dna|Open-Athena/marin-dna> 22:52Z",
                "⭐️ <https://github.com/backdated|backdated> starred <https://github.com/marin-community/marin|marin-community/marin> 01:00Z",
            ],
        ),
        DayThread(
            date="2026-07-28",
            messages=[
                ":calendar: *2026-07-28*",
                "⭐️ <https://github.com/shepardxia|shepardxia> starred <https://github.com/Open-Athena/Kelp|Open-Athena/Kelp> 16:00Z",
                "⭐️ <https://github.com/postylem|postylem> starred <https://github.com/Open-Athena/Kelp|Open-Athena/Kelp> 16:01Z",
            ],
        ),
    ]


class FakeClient:
    """Records thrds-SlackClient-shaped sync calls; existing threads all-SKIP, new threads all-POST."""

    def __init__(self):
        self.calls = []

    def sync(self, thread: Thread, thread_ts=None, dry_run=False, pace=0.4, metadata=None) -> SyncResult:
        self.calls.append({"messages": thread.messages, "thread_ts": thread_ts, "dry_run": dry_run, "metadata": metadata})
        action_type = ActionType.SKIP if thread_ts else ActionType.POST
        return SyncResult(
            thread_id=thread_ts or "ts-new",
            message_ids=[f"m{i}" for i in range(len(thread.messages))],
            actions=[Action(type=action_type, index=i, content=m) for i, m in enumerate(thread.messages)],
        )


def test_sync_days_threads_ts_metadata_and_log():
    days = [
        DayThread(date="2026-07-27", messages=[":calendar: *2026-07-27*", "line a"]),
        DayThread(date="2026-07-28", messages=[":calendar: *2026-07-28*", "line b", "line c"]),
    ]
    client = FakeClient()
    logs = []
    results = sync_days(client, days, existing={"2026-07-27": "1721.001"}, log=logs.append)

    assert client.calls == [
        {
            "messages": [":calendar: *2026-07-27*", "line a"],
            "thread_ts": "1721.001",
            "dry_run": False,
            "metadata": {":calendar: *2026-07-27*": op_metadata("2026-07-27")},
        },
        {
            "messages": [":calendar: *2026-07-28*", "line b", "line c"],
            "thread_ts": None,
            "dry_run": False,
            "metadata": {":calendar: *2026-07-28*": op_metadata("2026-07-28")},
        },
    ]
    assert logs == [
        "2026-07-27: 0 posted, 2 skipped",
        "2026-07-28: 3 posted, 0 skipped",
    ]
    assert [(day.date, result.thread_id) for day, result in results] == [
        ("2026-07-27", "1721.001"),
        ("2026-07-28", "ts-new"),
    ]


DAYS = [
    DayThread(date="2026-07-22", messages=["op22", "a", "b"]),
    DayThread(date="2026-07-23", messages=["op23", "c", "d", "e"]),
    DayThread(date="2026-07-24", messages=["op24", "f"]),
]


def test_truncate_days_exact_boundary():
    assert truncate_days(DAYS, 7) == [
        DayThread(date="2026-07-22", messages=["op22", "a", "b"]),
        DayThread(date="2026-07-23", messages=["op23", "c", "d", "e"]),
    ]


def test_truncate_days_mid_day():
    assert truncate_days(DAYS, 5) == [
        DayThread(date="2026-07-22", messages=["op22", "a", "b"]),
        DayThread(date="2026-07-23", messages=["op23", "c"]),
    ]


def test_truncate_days_drops_bare_op():
    # budget 4 leaves 1 slot after day 1 — a bare OP is useless, so day 2 is dropped
    assert truncate_days(DAYS, 4) == [
        DayThread(date="2026-07-22", messages=["op22", "a", "b"]),
    ]


def test_truncate_days_no_cap_needed():
    assert truncate_days(DAYS, 100) == DAYS


class FakeDeleteClient:
    """Thread listing + delete recorder for delete_day_threads tests."""

    def __init__(self, threads: dict):
        self.threads = threads
        self.deleted = []

    def list_messages(self, thread_id):
        return self.threads[thread_id]

    def delete(self, message_id, orphans_ok=False):
        self.deleted.append((message_id, orphans_ok))


def test_delete_day_threads_replies_newest_first_then_op():
    client = FakeDeleteClient({
        "1.0": [Message(id="1.0", content="op"), Message(id="1.1", content="a"), Message(id="1.2", content="b")],
    })
    logs = []
    delete_day_threads(client, {"2026-07-22": "1.0"}, log=logs.append, sleep=lambda s: None)
    assert client.deleted == [("1.2", False), ("1.1", False), ("1.0", False)]
    assert logs == [
        "2026-07-22: deleting reply 1.2: b",
        "2026-07-22: deleting reply 1.1: a",
        "2026-07-22: deleting OP 1.0: op",
    ]


def test_delete_day_threads_keeps_op_over_foreign_replies():
    client = FakeDeleteClient({
        "1.0": [Message(id="1.0", content="op"), Message(id="1.1", content="a"), Message(id="1.2", content="human!", editable=False)],
    })
    logs = []
    delete_day_threads(client, {"2026-07-22": "1.0"}, log=logs.append, sleep=lambda s: None)
    assert client.deleted == [("1.1", False)]
    assert logs == [
        "2026-07-22: deleting reply 1.1: a",
        "2026-07-22: keeping OP 1.0 (1 non-bot replies would be orphaned; -f to force)",
    ]


def test_delete_day_threads_force_orphans():
    client = FakeDeleteClient({
        "1.0": [Message(id="1.0", content="op"), Message(id="1.1", content="human!", editable=False)],
    })
    delete_day_threads(client, {"2026-07-22": "1.0"}, force=True, sleep=lambda s: None)
    assert client.deleted == [("1.0", True)]


def test_delete_day_threads_dry_run():
    client = FakeDeleteClient({
        "1.0": [Message(id="1.0", content="op"), Message(id="1.1", content="a")],
    })
    logs = []
    delete_day_threads(client, {"2026-07-22": "1.0"}, dry_run=True, log=logs.append, sleep=lambda s: None)
    assert client.deleted == []
    assert logs == [
        "2026-07-22: would delete reply 1.1: a",
        "2026-07-22: would delete OP 1.0: op",
    ]
