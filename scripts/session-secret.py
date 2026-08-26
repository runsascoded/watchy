#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click", "requests"]
# ///
"""Manage the `SESSION_SECRET` that ties the site's auth together.

One value has to be identical in three places (specs/auth-gate.md): the sso
Pages Function signs the `watchy_auth` cookie with it, the worker's gate
verifies it, and preview deployments read a *separate* env-var set from
production's — so staging needs its own copy of the same value.

  worker `watchy` secret            (OA acct)  — verifies
  pages `watchy-internal` production           — signs, gh.oa.dev
  pages `watchy-internal` preview              — signs, staging.*.pages.dev

`sync-preview` fills in the third from a value you already have. If you don't
have it — Cloudflare never discloses a stored secret, and this one was
generated straight into CF — `rotate` is the way out: it mints a new value and
writes all three at once. Everyone re-does SSO once (30d cookies are signed with
the old value); share-link holders re-open their link to re-exchange.

Neither path takes the secret as an argument, so it stays out of argv and shell
history.
"""
import os
import sys
from functools import partial
from getpass import getpass
from secrets import token_urlsafe

import requests
from click import group, option

err = partial(print, file=sys.stderr)

ACCOUNT = '74981a43be0de7712369306c7b19133d'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}'
PROJECT = 'watchy-internal'
SCRIPT = 'watchy'
KEY = 'SESSION_SECRET'


def token(token_var: str) -> str:
    tok = os.environ.get(token_var)
    if not tok:
        raise SystemExit(f"${token_var} unset — run under `direnv exec .`")
    return tok


def check(res: requests.Response, what: str) -> dict:
    if not res.ok:
        raise SystemExit(f"{what}: HTTP {res.status_code} {res.text[:300]}")
    err(f"  ✓ {what}")
    return res.json()['result']


def put_pages(tok: str, env: str, secret: str, worker_origin: str | None = None) -> None:
    """Write the secret (and optionally WORKER_ORIGIN) into one Pages environment."""
    env_vars: dict[str, dict[str, str]] = {KEY: {'type': 'secret_text', 'value': secret}}
    if worker_origin:
        env_vars['WORKER_ORIGIN'] = {'type': 'plain_text', 'value': worker_origin}
    res = requests.patch(
        f'{API}/pages/projects/{PROJECT}',
        headers={'Authorization': f'Bearer {tok}'},
        json={'deployment_configs': {env: {'env_vars': env_vars}}},
    )
    check(res, f'pages {PROJECT} {env}: {", ".join(sorted(env_vars))}')


def put_worker(tok: str, secret: str) -> None:
    res = requests.put(
        f'{API}/workers/scripts/{SCRIPT}/secrets',
        headers={'Authorization': f'Bearer {tok}'},
        json={'name': KEY, 'text': secret, 'type': 'secret_text'},
    )
    check(res, f'worker {SCRIPT}: {KEY}')


@group
def main() -> None:
    """Manage SESSION_SECRET across the worker and both Pages environments."""


@main.command('sync-preview')
@option('-o', '--worker-origin', default='https://watchy.open-athena.workers.dev', help="/api/* proxy target for preview deploys")
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
def sync_preview(worker_origin: str, token_var: str) -> None:
    """Copy a SESSION_SECRET you already have into the Preview environment."""
    tok = token(token_var)
    secret = getpass(f'{KEY} (must match production): ')
    if not secret:
        raise SystemExit('empty secret, aborting')
    put_pages(tok, 'preview', secret, worker_origin)


@main.command
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
@option('-y', '--yes', is_flag=True, help="skip the confirmation prompt")
def rotate(token_var: str, yes: bool) -> None:
    """Mint a new SESSION_SECRET and write it to all three places."""
    tok = token(token_var)
    if not yes:
        err('Rotating logs every session out: 30d cookies are signed with the old value,')
        err('and share-link holders must re-open their link to re-exchange.')
        if input('rotate? [y/N] ').strip().lower() != 'y':
            raise SystemExit('aborted')
    secret = token_urlsafe(32)
    # Order barely matters — logins fail either way until all three agree, and
    # the window is a couple of seconds. Worker last would keep existing
    # sessions alive marginally longer, but they're dead once it flips anyway.
    put_worker(tok, secret)
    put_pages(tok, 'production', secret)
    put_pages(tok, 'preview', secret, 'https://watchy.open-athena.workers.dev')
    err('\nRotated. Redeploy is NOT required (both read the value at request time),')
    err('but existing sessions are dead — visit /auth/sso to mint a fresh one.')


if __name__ == '__main__':
    main()
