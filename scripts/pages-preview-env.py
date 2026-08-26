#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click", "requests"]
# ///
"""Populate a Pages project's *Preview* environment variables.

Preview deployments (`deploy-www.sh -s`) read a different env-var set than
production, and wrangler's `pages secret put` only targets production — so the
staging site would otherwise 503 on /auth/sso (no SESSION_SECRET) and proxy
/api/* to the default worker origin, i.e. the personal account's.

SESSION_SECRET must be *byte-identical* to production's: the sso Pages Function
mints the session cookie with it and the worker's gate verifies with its own
copy (specs/auth-gate.md). Cloudflare won't disclose a stored secret, so this
prompts for it rather than copying — paste the value from wherever it's kept.
It's read via getpass and sent in the request body, so it never lands in argv,
shell history, or a transcript.
"""
import os
import sys
from functools import partial
from getpass import getpass

import requests
from click import command, option

err = partial(print, file=sys.stderr)

ACCOUNT = '74981a43be0de7712369306c7b19133d'
API = 'https://api.cloudflare.com/client/v4'


@command
@option('-o', '--worker-origin', default='https://watchy.open-athena.workers.dev', help="/api/* proxy target for preview deploys")
@option('-p', '--project', default='watchy-internal', help="Pages project name")
@option('-t', '--token-var', default='CLOUDFLARE_ADMIN_TOKEN', help="env var holding the CF API token")
def main(worker_origin: str, project: str, token_var: str) -> None:
    """Set SESSION_SECRET + WORKER_ORIGIN on <project>'s Preview environment."""
    token = os.environ.get(token_var)
    if not token:
        raise SystemExit(f"${token_var} unset — run under `direnv exec .`")
    secret = getpass('SESSION_SECRET (same value as production): ')
    if not secret:
        raise SystemExit('empty secret, aborting')
    url = f'{API}/accounts/{ACCOUNT}/pages/projects/{project}'
    headers = {'Authorization': f'Bearer {token}'}
    body = {
        'deployment_configs': {
            'preview': {
                'env_vars': {
                    'SESSION_SECRET': {'type': 'secret_text', 'value': secret},
                    'WORKER_ORIGIN': {'type': 'plain_text', 'value': worker_origin},
                },
            },
        },
    }
    res = requests.patch(url, headers=headers, json=body)
    res.raise_for_status()
    got = res.json()['result']['deployment_configs']['preview']['env_vars']
    err(f"{project} preview env_vars: {({k: v['type'] for k, v in got.items()})}")


if __name__ == '__main__':
    main()
