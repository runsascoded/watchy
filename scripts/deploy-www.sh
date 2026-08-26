#!/bin/bash
# Build + deploy the site's Pages project (watchy-internal, OA acct — see
# oa-wrangler.sh re creds). Deploys from www/ cwd so functions/ (auth gate +
# API proxy) IS bundled. Run under `direnv exec .`.
#
#   deploy-www.sh              → production, gh.oa.dev
#   deploy-www.sh -s           → staging, staging.watchy-internal.pages.dev
#
# The branch flag is load-bearing: the Pages project's production branch is
# `main`, and gh.oa.dev serves production. Without it wrangler infers the
# branch from git — `oa` here — and every deploy lands as a preview nobody
# looks at, leaving the live site silently frozen. Staging inverts that on
# purpose: any branch but `main` is a preview, so `--branch staging` gets a
# stable alias without touching production.
#
# Staging is Access-gated for free — the `watchy` Access app already lists
# `*.watchy-internal.pages.dev` — but preview deployments read the *Preview*
# env vars, a separate set from production's. Run `session-secret.py
# sync-preview` once to populate them, or /auth/sso 503s and /api/* proxies to
# the wrong worker.
set -euo pipefail
branch=main
case "${1:-}" in
  -s|--staging) branch=staging ;;
  '') ;;
  *) echo "usage: $(basename "$0") [-s|--staging]" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../www"
pnpm build >/dev/null
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ADMIN_TOKEN"
export CLOUDFLARE_ACCOUNT_ID=74981a43be0de7712369306c7b19133d
npx wrangler pages deploy dist --project-name watchy-internal --branch "$branch" --commit-dirty=true
[ "$branch" = main ] || echo "staging: https://$branch.watchy-internal.pages.dev"
