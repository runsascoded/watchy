#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click", "requests"]
# ///
"""Set or rotate one Cloudflare Worker secret, recording it in 1Password.

Worker secrets are write-only — Cloudflare will confirm a name exists but never hand back
a value — so a secret that reaches a worker without being recorded can only ever be
replaced, not read. Everything here writes 1Password first, for that reason.

For `SESSION_SECRET` use `session-secret.py` instead: that one value has to agree across a
worker and two Pages environments at once, which this does not model.

Neither subcommand takes the secret as an argument, so it stays out of argv and history.

  worker-secret.py set MANUAL_CHECK_KEY       # paste a value you already have
  worker-secret.py rotate MANUAL_CHECK_KEY    # mint a fresh one
"""
from getpass import getpass
from secrets import token_urlsafe

from click import argument, group, option

from cfsec import OP_VAULT, err, op_put, put_worker, token

SCRIPT = 'watchy'


def item_title(script: str, key: str) -> str:
    """1Password title, matching the `watchy SESSION_SECRET` item already in the vault."""
    return f'{script} {key}'


def record(tok: str, script: str, key: str, secret: str, no_1password: bool) -> None:
    if not no_1password:
        op_put(item_title(script, key), secret)
    put_worker(tok, script, key, secret)


@group
def main() -> None:
    """Manage a worker secret across 1Password and Cloudflare."""


@main.command('set')
@option('-P', '--no-1password', is_flag=True, help="don't record the value in 1Password")
@option('-s', '--script', default=SCRIPT, help="worker script name")
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
@argument('key')
def set_(no_1password: bool, script: str, token_var: str, key: str) -> None:
    """Store a value you already have as KEY on the worker."""
    tok = token(token_var)
    secret = getpass(f'{key}: ')
    if not secret:
        raise SystemExit('empty secret, aborting')
    record(tok, script, key, secret, no_1password)


@main.command
@option('-P', '--no-1password', is_flag=True, help="don't record the value in 1Password")
@option('-s', '--script', default=SCRIPT, help="worker script name")
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
@argument('key')
def rotate(no_1password: bool, script: str, token_var: str, key: str) -> None:
    """Mint a fresh value for KEY and write it to the worker."""
    tok = token(token_var)
    record(tok, script, key, token_urlsafe(32), no_1password)
    err(f'\nRotated. Anything holding the old {key} — a bookmark, a cron, a script — now fails;')
    err(f'read the new value from 1Password ({OP_VAULT}/{item_title(script, key)}).')


if __name__ == '__main__':
    main()
