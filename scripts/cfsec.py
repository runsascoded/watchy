"""Shared plumbing for Cloudflare secrets that are recorded in 1Password.

Imported by the `*-secret.py` scripts beside it (a `uv run --script` shebang puts this
directory on `sys.path`, so a plain `import cfsec` resolves). Every write goes through a
piped JSON template or a request body, never an assignment statement or an argv element —
`op`'s own advice, and the same reason nothing here takes a secret as a CLI argument.
"""
import json
import os
import sys
from functools import partial
from subprocess import run

import requests

err = partial(print, file=sys.stderr)

ACCOUNT = '74981a43be0de7712369306c7b19133d'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}'
OP_VAULT = 'Employee'
OP_FIELD = {'id': 'password', 'type': 'CONCEALED', 'purpose': 'PASSWORD', 'label': 'password'}


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


def op(*args: str, **kw) -> tuple[int, str, str]:
    res = run(['op', *args], capture_output=True, text=True, **kw)
    return res.returncode, res.stdout, res.stderr


def op_get(item: str) -> str | None:
    """The stored secret, or None if 1Password has no item by that title."""
    code, out, _ = op('item', 'get', item, '--vault', OP_VAULT, '--format', 'json', '--reveal')
    if code != 0:
        return None
    values = [f['value'] for f in json.loads(out)['fields'] if f.get('id') == 'password']
    return values[0] if values else None


def op_put(item: str, secret: str) -> None:
    """Create or update a 1Password item, via a piped JSON template (`op`'s own advice for
    sensitive values: assignment statements land in argv)."""
    code, out, _ = op('item', 'get', item, '--vault', OP_VAULT, '--format', 'json')
    if code == 0:
        existing = json.loads(out)
        fields = [f for f in existing['fields'] if f.get('id') == 'password']
        if fields:
            fields[0]['value'] = secret
        else:
            existing['fields'].append(OP_FIELD | {'value': secret})
        cmd, payload = ['item', 'edit', existing['id'], '--vault', OP_VAULT], existing
    else:
        cmd = ['item', 'create', '-', '--vault', OP_VAULT, '--title', item]
        payload = {'title': item, 'category': 'PASSWORD', 'fields': [OP_FIELD | {'value': secret}]}
    code, _, stderr = op(*cmd, input=json.dumps(payload))
    if code != 0:
        raise SystemExit(f"1Password: {stderr.strip()[:300]}")
    err(f'  ✓ 1Password {OP_VAULT}/{item}')


def put_worker(tok: str, script: str, key: str, secret: str) -> None:
    res = requests.put(
        f'{API}/workers/scripts/{script}/secrets',
        headers={'Authorization': f'Bearer {tok}'},
        json={'name': key, 'text': secret, 'type': 'secret_text'},
    )
    check(res, f'worker {script}: {key}')


def put_pages(tok: str, project: str, env: str, env_vars: dict[str, dict[str, str]]) -> None:
    res = requests.patch(
        f'{API}/pages/projects/{project}',
        headers={'Authorization': f'Bearer {tok}'},
        json={'deployment_configs': {env: {'env_vars': env_vars}}},
    )
    check(res, f'pages {project} {env}: {", ".join(sorted(env_vars))}')
