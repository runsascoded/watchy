#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click"]
# ///
"""Dump one instance's rows from the live (combined) D1 as an importable .sql.

Part of specs/worker-split.md: events/stars/counts are filtered by owner prefix,
follows by target; actors/grants/slack_posts/summaries/weekly_threads go wholesale
(Slack + auth features live entirely on the OA instance); runs starts fresh.

Run under direnv (wrangler needs CLOUDFLARE_API_TOKEN):
    direnv exec . scripts/split-oa-db.py
Import (once the target D1 exists):
    npx wrangler d1 execute watchy -e oa --remote --file tmp/oa-dump.sql
"""
import json
import subprocess
import sys
from functools import partial
from pathlib import Path

from click import command, option

err = partial(print, file=sys.stderr)

CFW = Path(__file__).parent.parent / "cfw"
PAGE = 1000
CHUNK = 50  # rows per INSERT statement

OWNER_TABLES = {"events": "target", "stars": "repo", "counts": "target"}
WHOLESALE = ["actors", "grants", "slack_posts", "summaries", "weekly_threads"]


def d1(database: str, sql: str) -> list[dict]:
    proc = subprocess.run(
        ["npx", "wrangler", "d1", "execute", database, "--remote", "--json", "--command", sql],
        cwd=CFW, capture_output=True, text=True,
    )
    if proc.returncode:
        raise SystemExit(f"wrangler failed: {proc.stderr[-500:]}")
    return json.loads(proc.stdout)[0]["results"]


def rows(database: str, table: str, where: str) -> list[dict]:
    out: list[dict] = []
    while True:
        page = d1(database, f"SELECT * FROM {table} {where} LIMIT {PAGE} OFFSET {len(out)}")
        out += page
        if len(page) < PAGE:
            return out


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def inserts(table: str, rs: list[dict]) -> list[str]:
    if not rs:
        return []
    cols = list(rs[0])
    stmts = []
    for i in range(0, len(rs), CHUNK):
        vals = ",\n  ".join("(" + ", ".join(lit(r[c]) for c in cols) + ")" for r in rs[i:i + CHUNK])
        stmts.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n  {vals};")
    return stmts


@command
@option("-d", "--database", default="watchy", help="Source D1 database name (default: watchy)")
@option("-o", "--output", default="tmp/oa-dump.sql", help="Output .sql path (default: tmp/oa-dump.sql)")
@option("-w", "--owner", "owners", multiple=True, default=("Open-Athena", "marin-community"), help="Owner(s) whose rows move (repeatable)")
def main(database: str, output: str, owners: tuple[str, ...]):
    """Dump OA-scoped rows from the combined D1 into an importable .sql file."""
    preds = " OR ".join(f"{{col}} = '{o}' OR {{col}} LIKE '{o}/%'" for o in owners)
    out: list[str] = [f"-- split-oa-db.py dump: owners={','.join(owners)} from D1 {database!r}"]
    for table, col in OWNER_TABLES.items():
        where = "WHERE " + preds.format(col=col)
        rs = rows(database, table, where)
        err(f"{table}: {len(rs)} rows")
        out += inserts(table, rs)
    in_list = ", ".join(f"'{o}'" for o in owners)
    rs = rows(database, "follows", f"WHERE target IN ({in_list})")
    err(f"follows: {len(rs)} rows")
    out += inserts("follows", rs)
    for table in WHOLESALE:
        rs = rows(database, table, "")
        err(f"{table}: {len(rs)} rows (wholesale)")
        out += inserts(table, rs)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n")
    err(f"wrote {path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
