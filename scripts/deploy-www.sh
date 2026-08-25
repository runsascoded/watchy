#!/bin/bash
# Build + deploy the site's Pages project (watchy-internal, OA acct — see
# oa-wrangler.sh re creds). Deploys from www/ cwd so functions/ (auth gate +
# API proxy) IS bundled. Run under `direnv exec .`.
#
# `--branch main` is load-bearing: the Pages project's production branch is
# `main`, and gh.oa.dev serves production. Without it wrangler infers the
# branch from git — `oa` here — and every deploy lands as a preview nobody
# looks at, leaving the live site silently frozen.
set -euo pipefail
cd "$(dirname "$0")/../www"
pnpm build >/dev/null
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ADMIN_TOKEN"
export CLOUDFLARE_ACCOUNT_ID=74981a43be0de7712369306c7b19133d
npx wrangler pages deploy dist --project-name watchy-internal --branch main --commit-dirty=true
