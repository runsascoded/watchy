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

All three are write-only: Cloudflare returns `''` for a stored secret, so
nothing here can read the live value back. The 1Password item is therefore the
only durable copy — without it, adding a fourth consumer later (a `.dev.vars`
for `wrangler pages dev`, another worker, another Pages project) means another
rotation, and another forced re-login for everyone.

Writing either Pages environment is only half the job: a Pages Function binds
its env vars at deploy time, so the change lands when you next deploy that
environment. The worker reads its secret per request, so between the two the
site is signing with one value and verifying against another — /auth/sso keeps
returning 200 and every session it mints is rejected. Deploy right after.

It deliberately does NOT live in `.envrc`: nothing local consumes it as an env
var, and that file gets read wholesale often enough that adding a secret to it
is pure exposure.

`rotate` mints a new value and writes all four. `sync-preview` fills in just the
preview env from the stored value (or a prompt). Neither takes the secret as an
argument, so it stays out of argv and shell history.
"""
from getpass import getpass
from secrets import token_urlsafe

from click import group, option

from cfsec import OP_VAULT, err, op_get, op_put, put_pages, put_worker, token

PROJECT = 'watchy-internal'
SCRIPT = 'watchy'
KEY = 'SESSION_SECRET'
OP_ITEM = 'watchy SESSION_SECRET'


def write_pages(tok: str, env: str, secret: str, worker_origin: str | None = None) -> None:
    """Write the secret (and optionally WORKER_ORIGIN) into one Pages environment."""
    env_vars: dict[str, dict[str, str]] = {KEY: {'type': 'secret_text', 'value': secret}}
    if worker_origin:
        env_vars['WORKER_ORIGIN'] = {'type': 'plain_text', 'value': worker_origin}
    put_pages(tok, PROJECT, env, env_vars)


@group
def main() -> None:
    """Manage SESSION_SECRET across 1Password, the worker, and both Pages envs."""


@main.command('sync-preview')
@option('-o', '--worker-origin', default='https://watchy.open-athena.workers.dev', help="/api/* proxy target for preview deploys")
@option('-P', '--no-1password', is_flag=True, help="prompt for the secret instead of reading 1Password")
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
def sync_preview(worker_origin: str, no_1password: bool, token_var: str) -> None:
    """Copy the stored SESSION_SECRET into the Preview environment."""
    tok = token(token_var)
    secret = None if no_1password else op_get(OP_ITEM)
    if secret:
        err(f'  ✓ read {OP_VAULT}/{OP_ITEM}')
    else:
        secret = getpass(f'{KEY} (must match production): ')
    if not secret:
        raise SystemExit('empty secret, aborting')
    write_pages(tok, 'preview', secret, worker_origin)


@main.command
@option('-P', '--no-1password', is_flag=True, help="don't record the new value in 1Password")
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
@option('-y', '--yes', is_flag=True, help="skip the confirmation prompt")
def rotate(no_1password: bool, token_var: str, yes: bool) -> None:
    """Mint a new SESSION_SECRET and write it everywhere it's needed."""
    tok = token(token_var)
    if not yes:
        err('Rotating logs every session out: 30d cookies are signed with the old value,')
        err('and share-link holders must re-open their link to re-exchange.')
        if input('rotate? [y/N] ').strip().lower() != 'y':
            raise SystemExit('aborted')
    secret = token_urlsafe(32)
    # 1Password first: the three Cloudflare targets are all write-only, so a
    # value that reaches them without being recorded is one only a further
    # rotation can replace. Among those three the order is moot — logins fail
    # until all agree, and that window is a couple of seconds.
    if not no_1password:
        op_put(OP_ITEM, secret)
    put_worker(tok, SCRIPT, KEY, secret)
    write_pages(tok, 'production', secret)
    write_pages(tok, 'preview', secret, 'https://watchy.open-athena.workers.dev')
    err('\nRotated. Now REDEPLOY both Pages environments:')
    err('  scripts/deploy-www.sh       # production, gh.oa.dev')
    err('  scripts/deploy-www.sh -s    # staging')
    err('A Pages Function binds its env vars at deploy time, so a deployment that predates')
    err('the rotation keeps signing cookies with the old value, while the worker — which')
    err('reads its secret per request — rejects every one of them. /auth/sso still returns')
    err('200, so the only symptom is that logging in leaves you logged out.')
    err('Existing sessions are dead regardless — visit /auth/sso for a fresh one.')


if __name__ == '__main__':
    main()
