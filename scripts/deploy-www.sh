#!/bin/bash
# Build + deploy the site's Pages project (watchy-www). Deploys from dist/ cwd
# so the auth-gate functions/ (unused on this public instance) is not bundled.
#
# `--branch main` is load-bearing: the Pages project's production branch is
# `main`, and watchy.rbw.sh serves production. Without it wrangler infers the
# branch from git — `rw` here — and every deploy lands as a preview nobody
# looks at, leaving the live site silently frozen.
set -euo pipefail
cd "$(dirname "$0")/../www"
pnpm build >/dev/null
(cd dist && npx wrangler pages deploy . --project-name watchy-www --branch main --commit-dirty=true)
