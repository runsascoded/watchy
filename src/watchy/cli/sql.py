"""SQL subcommand: query the worker's D1 database, rows out as JSONL."""

import json
from pathlib import Path
from shutil import which
from subprocess import run
from sys import exit
from typing import Optional

from click import argument, option

from . import main, err


@main.command
@option("-d", "--database", default="watchy", help="D1 database name (default: watchy)")
@option("-f", "--file", "file_", default=None, help="Execute SQL from a file instead of the SQL argument")
@option("-l", "--local", is_flag=True, help="Execute against the local dev database instead of remote")
@argument("sql", required=False)
def sql(database: str, file_: Optional[str], local: bool, sql: Optional[str]):
    """Execute SQL against the worker's D1 database; print result rows as JSONL.

    Wraps `wrangler d1 execute`, unwrapping its JSON envelope so output is
    directly pipeable (e.g. to jq). Log/meta output goes to stderr.

    \b
        watchy sql "SELECT kind, count(*) c FROM events GROUP BY kind"
        watchy sql -f backfill.sql
    """
    if bool(sql) == bool(file_):
        err("Provide exactly one of SQL argument or -f/--file")
        exit(1)
    wrangler = which("wrangler")
    if not wrangler:
        for candidate in [Path("cfw/node_modules/.bin/wrangler"), Path("node_modules/.bin/wrangler")]:
            if candidate.exists():
                wrangler = str(candidate)
                break
    if not wrangler:
        err("wrangler not found (PATH, cfw/node_modules/.bin, node_modules/.bin)")
        exit(1)
    cmd = [wrangler, "d1", "execute", database, "--json", "-y"]
    cmd += ["--local"] if local else ["--remote"]
    cmd += ["--file", file_] if file_ else ["--command", sql]
    res = run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        err(res.stderr.strip() or res.stdout.strip())
        exit(res.returncode)
    # wrangler prefixes progress lines to stdout (esp. with --file); JSON starts
    # at the first line that opens an array/object
    lines = res.stdout.splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith(("[", "{"))), None)
    if start is None:
        err(f"No JSON found in wrangler output:\n{res.stdout}")
        exit(1)
    for result in json.loads("\n".join(lines[start:])):
        for row in result.get("results", []):
            print(json.dumps(row))
