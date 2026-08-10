#!/usr/bin/env -S uv run
# /// script
# dependencies = ["click", "requests"]
# ///
"""Backfill actors' following/star_sum/bsky columns directly (bypassing the worker's
10-actors-per-tick enrichment cadence). Reads targets from D1, hits GitHub via `gh api`
(authed CLI) and Bluesky's public API, and applies batched UPDATEs via wrangler.

One-off-ish but rerunnable: only touches rows still missing a value.
"""
import json
import subprocess
import sys
from functools import partial
from pathlib import Path

import requests
from click import command, option

err = partial(print, file=sys.stderr)
ROOT = Path(__file__).parent.parent
CFW = ROOT / "cfw"


def d1(sql: str) -> list[dict]:
    out = subprocess.check_output(
        ["npx", "wrangler", "d1", "execute", "watchy", "--remote", "--json", "--command", sql],
        cwd=CFW,
        stderr=subprocess.DEVNULL,
    )
    return json.loads(out)[0]["results"]


def gh_api(path: str) -> dict | list | None:
    res = subprocess.run(["gh", "api", path], capture_output=True)
    if res.returncode != 0:
        return None
    return json.loads(res.stdout)


def star_sum(login: str) -> int | None:
    total = 0
    for page in (1, 2):
        repos = gh_api(f"users/{login}/repos?per_page=100&type=owner&page={page}")
        if repos is None:
            return None if page == 1 else total
        total += sum(r.get("stargazers_count") or 0 for r in repos)
        if len(repos) < 100:
            break
    return total


BSKY = "https://public.api.bsky.app/xrpc"


def bsky_get(path: str) -> dict | None:
    try:
        r = requests.get(f"{BSKY}/{path}", timeout=10)
        return r.json() if r.ok else None
    except requests.RequestException:
        return None


def find_bsky(login: str, twitter: str | None, name: str | None) -> tuple[str, int] | None:
    """Mirrors cfw/src/actors.ts findBsky: handle guesses, then exact display-name search."""
    for guess in filter(None, [twitter, login]):
        p = bsky_get(f"app.bsky.actor.getProfile?actor={guess.lower()}.bsky.social")
        if p and p.get("handle"):
            return p["handle"], p.get("followersCount") or 0
    if name:
        res = bsky_get(f"app.bsky.actor.searchActors?q={requests.utils.quote(name)}&limit=3")
        for a in (res or {}).get("actors", []):
            if (a.get("displayName") or "").strip().lower() == name.strip().lower():
                p = bsky_get(f"app.bsky.actor.getProfile?actor={a['handle']}")
                if p and p.get("handle"):
                    return p["handle"], p.get("followersCount") or 0
                break
    return None


def q(s: str | None) -> str:
    return "NULL" if s is None else "'" + s.replace("'", "''") + "'"


@command()
@option("-b", "--batch-size", default=50, help="UPDATE statements per wrangler d1 execute call")
@option("-n", "--dry-run", is_flag=True, help="Fetch + print, don't write to D1")
@option("-B", "--no-bsky", is_flag=True, help="Skip Bluesky lookups")
def main(
    batch_size: int,
    dry_run: bool,
    no_bsky: bool,
) -> None:
    rows = d1(
        "SELECT login, twitter, name, following, star_sum, bsky_handle FROM actors "
        "WHERE followers IS NOT NULL AND (following IS NULL OR star_sum IS NULL)"
    )
    err(f"{len(rows)} actors to backfill")
    updates: list[str] = []
    for i, a in enumerate(rows):
        login = a["login"]
        sets: list[str] = []
        if a["following"] is None:
            u = gh_api(f"users/{login}")
            if u:
                sets.append(f"following = {u.get('following') or 0}")
                sets.append(f"followers = {u.get('followers') or 0}")
        if a["star_sum"] is None:
            ss = star_sum(login)
            if ss is not None:
                sets.append(f"star_sum = {ss}")
        if not no_bsky and a["bsky_handle"] is None:
            hit = find_bsky(login, a["twitter"], a["name"])
            if hit:
                handle, count = hit
                sets.append(f"bsky_handle = {q(handle)}")
                sets.append(f"bsky_followers = {count}")
        if sets:
            updates.append(f"UPDATE actors SET {', '.join(sets)} WHERE login = {q(login)};")
        if (i + 1) % 25 == 0:
            err(f"  fetched {i + 1}/{len(rows)}")
    err(f"{len(updates)} UPDATEs")
    if dry_run:
        print("\n".join(updates))
        return
    for i in range(0, len(updates), batch_size):
        chunk = updates[i : i + batch_size]
        sql_file = ROOT / "tmp" / f"backfill-{i}.sql"
        sql_file.parent.mkdir(exist_ok=True)
        sql_file.write_text("\n".join(chunk) + "\n")
        subprocess.check_call(
            ["npx", "wrangler", "d1", "execute", "watchy", "--remote", "-y", "--file", str(sql_file)],
            cwd=CFW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        err(f"  applied {min(i + batch_size, len(updates))}/{len(updates)}")


if __name__ == "__main__":
    main()
