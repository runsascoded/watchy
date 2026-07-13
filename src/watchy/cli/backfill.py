"""Backfill subcommand: git history → D1-importable events SQL."""

import json
from dataclasses import asdict
from sys import stdout
from typing import Optional

from click import Choice, option, pass_context

from . import main, err
from ..backfill import backfill as compute_backfill, to_sql
from ..paths import paths


@main.command
@pass_context
@option("-C", "--repo-dir", default=None, help="Path to the .watchy data clone (default: $WATCHY_DIR / .watchy)")
@option("-f", "--fmt", type=Choice(["sql", "jsonl"]), default="sql", help="Output format (default: sql, importable via `wrangler d1 execute watchy --remote --file`)")
@option("-o", "--output", default=None, help="Output path (default: stdout)")
@option("-S", "--no-seed-state", is_flag=True, help="Skip the follows state-table seed (use on re-runs, once the live worker owns state)")
@option("-u", "--until", default=None, help="Exclude commits after this ISO timestamp (pass the worker's first-run time so re-runs can't duplicate live events)")
@option("-U", "--resolve-uids", is_flag=True, help="Also resolve uids for event logins (1 API call per distinct login); follows-state logins are always resolved")
@option("-x", "--emit-open", multiple=True, help="owner/repo whose open star intervals should be emitted (stale files whose repo the live worker can't fetch); repeatable")
def backfill(
    ctx,
    repo_dir: str,
    fmt: str,
    output: Optional[str],
    no_seed_state: bool,
    until: Optional[str],
    resolve_uids: bool,
    emit_open: tuple[str, ...],
):
    """Derive events from the .watchy data repo's git history.

    Emits SQL (or JSONL) for seeding the worker's D1 database:

    \b
    - unstar/unfollow events for every removal in history
    - star events for closed intervals only (open ones are left to the live
      worker's first sweep, which gets true starred_at timestamps)
    - follow events for every appearance
    - follows state-table seed from the HEAD snapshot (so the first live run
      doesn't re-emit current followers)

    Import BEFORE the worker's first run, e.g.:

        watchy backfill > backfill.sql
        wrangler d1 execute watchy --remote --file backfill.sql
    """
    client = ctx.obj["client"]
    if repo_dir is None:
        repo_dir = str(paths.root)
    events, head_follows = compute_backfill(repo_dir, emit_open=emit_open, until=until)
    seed_follows = None if no_seed_state else head_follows
    err(f"{len(events)} events, {sum(len(v) for v in head_follows.values())} HEAD follows across {len(head_follows)} targets")

    uid_cache: dict[str, Optional[int]] = {}

    def resolve_uid(login: str) -> Optional[int]:
        if login not in uid_cache:
            user = client.get_user(login)
            if user is None:
                err(f"  {login}: no longer resolves (deleted account?); skipping in state seed")
            uid_cache[login] = user["id"] if user else None
        return uid_cache[login]

    if resolve_uids:
        for e in events:
            e.uid = resolve_uid(e.login)

    if fmt == "jsonl":
        lines = [json.dumps(asdict(e)) for e in events]
        for target in sorted(seed_follows or {}):
            lines.append(json.dumps({"state": "follows", "target": target, "logins": sorted(seed_follows[target])}))
        out = "\n".join(lines) + "\n"
    else:
        stmts = to_sql(events, seed_follows, resolve_uid)
        out = "\n".join(stmts) + "\n"

    if output:
        with open(output, "w") as f:
            f.write(out)
        err(f"Wrote {output}")
    else:
        stdout.write(out)
