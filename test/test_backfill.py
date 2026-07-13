"""Tests for `watchy.backfill` — git history → events."""

from datetime import datetime, timezone
from pathlib import Path

import pytest
from git import Actor, Repo

from watchy.backfill import Event, backfill, to_sql

ACTOR = Actor("Test", "test@example.com")

T1 = "2025-01-01T00:00:00Z"
T2 = "2025-01-02T00:00:00Z"
T3 = "2025-01-03T00:00:00Z"


def mk_commit(repo: Repo, files: dict[str, str], msg: str, ts: str) -> str:
    """Write `files`, commit at `ts`; returns the 8-char sha."""
    root = Path(repo.working_dir)
    for relpath, content in files.items():
        path = root / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        repo.index.add([relpath])
    dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    commit = repo.index.commit(msg, author=ACTOR, committer=ACTOR, author_date=dt, commit_date=dt)
    return commit.hexsha[:8]


@pytest.fixture
def data_repo(tmp_path: Path) -> tuple[Repo, list[str]]:
    """Synthetic .watchy history:

    c1: o/r stars = {alice, bob};        u follows = {carol}
    c2: o/r stars = {bob, dave};         u follows = {carol, erin}   (alice unstarred)
    c3: o/r stars = {alice, bob, dave};  u follows = {erin}          (alice re-starred, carol unfollowed)
        o/r2 stars = {frank}                                         (new file)
    """
    repo = Repo.init(tmp_path / "data")
    shas = [
        mk_commit(repo, {
            "github/stars/o/r.txt": "alice\nbob\n",
            "github/follows/u.txt": "carol\n",
        }, "c1", T1),
        mk_commit(repo, {
            "github/stars/o/r.txt": "bob\ndave\n",
            "github/follows/u.txt": "carol\nerin\n",
        }, "c2", T2),
        mk_commit(repo, {
            "github/stars/o/r.txt": "alice\nbob\ndave\n",
            "github/follows/u.txt": "erin\n",
            "github/stars/o/r2.txt": "frank\n",
        }, "c3", T3),
    ]
    return repo, shas


def test_backfill_default(data_repo):
    repo, (sha1, sha2, sha3) = data_repo
    events, head_follows = backfill(repo.working_dir)
    # Open star intervals (bob, dave, frank, and alice's re-star) are omitted:
    # the live worker's first sweep covers them with true starred_at timestamps.
    assert events == [
        Event(T1, "follow", "u", "carol", sha1),
        Event(T1, "star", "o/r", "alice", sha1),
        Event(T2, "follow", "u", "erin", sha2),
        Event(T2, "unstar", "o/r", "alice", sha2),
        Event(T3, "unfollow", "u", "carol", sha3),
    ]
    assert head_follows == {"u": {"erin"}}


def test_backfill_emit_open_new_file(data_repo):
    repo, (sha1, sha2, sha3) = data_repo
    events, _ = backfill(repo.working_dir, emit_open=("o/r2",))
    assert events == [
        Event(T1, "follow", "u", "carol", sha1),
        Event(T1, "star", "o/r", "alice", sha1),
        Event(T2, "follow", "u", "erin", sha2),
        Event(T2, "unstar", "o/r", "alice", sha2),
        Event(T3, "star", "o/r2", "frank", sha3),
        Event(T3, "unfollow", "u", "carol", sha3),
    ]


def test_backfill_emit_open_intervals(data_repo):
    repo, (sha1, sha2, sha3) = data_repo
    events, _ = backfill(repo.working_dir, emit_open=("o/r",))
    # alice gets both her closed interval [c1, c2] AND her open re-star at c3
    assert events == [
        Event(T1, "follow", "u", "carol", sha1),
        Event(T1, "star", "o/r", "alice", sha1),
        Event(T1, "star", "o/r", "bob", sha1),
        Event(T2, "follow", "u", "erin", sha2),
        Event(T2, "star", "o/r", "dave", sha2),
        Event(T2, "unstar", "o/r", "alice", sha2),
        Event(T3, "star", "o/r", "alice", sha3),
        Event(T3, "unfollow", "u", "carol", sha3),
    ]


def test_to_sql(data_repo):
    repo, (sha1, sha2, sha3) = data_repo
    events, head_follows = backfill(repo.working_dir)
    uids = {"erin": 5}
    stmts = to_sql(events, head_follows, resolve_uid=lambda login: uids.get(login))
    assert stmts == [
        "DELETE FROM events WHERE source = 'git';",
        "INSERT INTO events (ts, kind, target, uid, login, source, sha) VALUES\n"
        f"('{T1}', 'follow', 'u', NULL, 'carol', 'git', '{sha1}'),\n"
        f"('{T1}', 'star', 'o/r', NULL, 'alice', 'git', '{sha1}'),\n"
        f"('{T2}', 'follow', 'u', NULL, 'erin', 'git', '{sha2}'),\n"
        f"('{T2}', 'unstar', 'o/r', NULL, 'alice', 'git', '{sha2}'),\n"
        f"('{T3}', 'unfollow', 'u', NULL, 'carol', 'git', '{sha3}');",
        "DELETE FROM follows;",
        "INSERT INTO follows (target, uid, login) VALUES\n"
        "('u', 5, 'erin');",
    ]


def test_to_sql_skips_unresolved_state_logins(data_repo):
    repo, _ = data_repo
    _, head_follows = backfill(repo.working_dir)
    stmts = to_sql([], head_follows, resolve_uid=lambda login: None)
    assert stmts == [
        "DELETE FROM events WHERE source = 'git';",
        "DELETE FROM follows;",
    ]
