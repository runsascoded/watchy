"""Derive star/follow events from a `.watchy` data-repo's git history.

Walks commits chronologically, diffing consecutive snapshots of
``github/stars/<owner>/<repo>.txt`` and ``github/follows/<user>.txt`` files.

Event-emission policy (see ``specs/d1-worker.md``):

- **stars**: emit ``unstar`` for every removal, and ``star`` only for *closed*
  intervals (appearances later removed). Open intervals (logins still present at
  HEAD) are left to the worker's first live sweep, which gets true ``starred_at``
  timestamps from the API. ``emit_open`` overrides per-repo, for stale files whose
  repos the live worker can no longer fetch (deleted/renamed/inaccessible).
- **follows**: emit ``follow``/``unfollow`` for every change, including each
  file's initial content (there is no API timestamp source to defer to). The HEAD
  snapshot additionally seeds the ``follows`` state table so the worker's first
  live run doesn't re-emit current followers.
"""

from dataclasses import dataclass
from datetime import timezone
from pathlib import PurePosixPath
from typing import Callable, Optional

from git import Commit, Repo

from .paths import infer_path_type

SHORT_SHA_LEN = 8


@dataclass
class Event:
    ts: str
    kind: str  # 'star' | 'unstar' | 'follow' | 'unfollow'
    target: str
    login: str
    sha: str
    uid: Optional[int] = None


@dataclass
class Interval:
    """One login's presence stretch in a stars file."""
    login: str
    added_ts: str
    added_sha: str
    removed_ts: Optional[str] = None
    removed_sha: Optional[str] = None


def commit_ts(commit: Commit) -> str:
    """UTC, `Z`-suffixed — lexicographically comparable with the worker's live-event timestamps."""
    return commit.committed_datetime.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def blob_logins(commit: Commit, path: str) -> set[str]:
    """Logins in ``path`` at ``commit`` (empty set if absent)."""
    try:
        blob = commit.tree / path
    except KeyError:
        return set()
    lines = blob.data_stream.read().decode("utf-8").splitlines()
    return {line.strip() for line in lines if line.strip()}


def txt_paths(commit: Commit) -> set[str]:
    """All ``github/{stars,follows}/**.txt`` paths in ``commit``'s tree."""
    out = set()
    for blob in commit.tree.traverse():
        if blob.type != "blob":
            continue
        path = blob.path
        if PurePosixPath(path).suffix == ".txt" and infer_path_type(path)[0]:
            out.add(path)
    return out


def backfill(
    repo_dir: str,
    emit_open: tuple[str, ...] = (),
) -> tuple[list[Event], dict[str, set[str]]]:
    """Compute events from git history.

    Returns ``(events, head_follows)`` where ``head_follows`` maps each follows
    target to its login set at HEAD (for state seeding). Events are ordered
    chronologically (by commit, then stars before follows within a commit).
    """
    repo = Repo(repo_dir)
    commits = list(repo.iter_commits("HEAD"))[::-1]

    # stars: target -> login -> list[Interval] (last may be open)
    star_intervals: dict[str, dict[str, list[Interval]]] = {}
    follow_events: list[Event] = []
    prev_contents: dict[str, set[str]] = {}

    for commit in commits:
        ts = commit_ts(commit)
        sha = commit.hexsha[:SHORT_SHA_LEN]
        paths = txt_paths(commit)
        for path in sorted(paths):
            path_type, md = infer_path_type(path)
            cur = blob_logins(commit, path)
            prv = prev_contents.get(path, set())
            if cur == prv:
                continue
            added = sorted(cur - prv)
            removed = sorted(prv - cur)
            if path_type == "stars":
                target = md["repo_key"]
                intervals = star_intervals.setdefault(target, {})
                for login in added:
                    intervals.setdefault(login, []).append(Interval(login, ts, sha))
                for login in removed:
                    iv = intervals[login][-1]
                    iv.removed_ts = ts
                    iv.removed_sha = sha
            else:
                target = md["user"]
                for login in added:
                    follow_events.append(Event(ts, "follow", target, login, sha))
                for login in removed:
                    follow_events.append(Event(ts, "unfollow", target, login, sha))
            prev_contents[path] = cur

    events: list[Event] = []
    for target, intervals in star_intervals.items():
        for login, ivs in intervals.items():
            for iv in ivs:
                closed = iv.removed_ts is not None
                if closed or target in emit_open:
                    events.append(Event(iv.added_ts, "star", target, login, iv.added_sha))
                if closed:
                    events.append(Event(iv.removed_ts, "unstar", target, login, iv.removed_sha))
    events.extend(follow_events)
    events.sort(key=lambda e: (e.ts, e.kind, e.target, e.login))

    head = commits[-1]
    head_follows: dict[str, set[str]] = {}
    for path in sorted(txt_paths(head)):
        path_type, md = infer_path_type(path)
        if path_type == "follows":
            head_follows[md["user"]] = blob_logins(head, path)

    return events, head_follows


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def to_sql(
    events: list[Event],
    head_follows: dict[str, set[str]],
    resolve_uid: Callable[[str], Optional[int]],
    chunk_size: int = 500,
) -> list[str]:
    """Render events + follows-state seed as SQL statements.

    Idempotent on re-import: git-sourced events and the follows state table are
    cleared before inserting. ``resolve_uid`` maps login -> uid (None if the
    account no longer resolves; those logins are skipped in state seeding, since
    the live worker keys state by uid).
    """
    stmts = ["DELETE FROM events WHERE source = 'git';"]
    for i in range(0, len(events), chunk_size):
        rows = [
            f"({sql_quote(e.ts)}, {sql_quote(e.kind)}, {sql_quote(e.target)}, "
            f"{e.uid if e.uid is not None else 'NULL'}, {sql_quote(e.login)}, 'git', {sql_quote(e.sha)})"
            for e in events[i:i + chunk_size]
        ]
        stmts.append(
            "INSERT INTO events (ts, kind, target, uid, login, source, sha) VALUES\n"
            + ",\n".join(rows) + ";"
        )

    stmts.append("DELETE FROM follows;")
    state_rows = []
    for target in sorted(head_follows):
        for login in sorted(head_follows[target]):
            uid = resolve_uid(login)
            if uid is None:
                continue
            state_rows.append(f"({sql_quote(target)}, {uid}, {sql_quote(login)})")
    for i in range(0, len(state_rows), chunk_size):
        stmts.append(
            "INSERT INTO follows (target, uid, login) VALUES\n"
            + ",\n".join(state_rows[i:i + chunk_size]) + ";"
        )
    return stmts
