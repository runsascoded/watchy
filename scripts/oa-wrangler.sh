#!/bin/bash
# wrangler against the Open Athena CF account (worker-split env.oa):
# CLOUDFLARE_ADMIN_TOKEN has Workers/D1/Pages/Access/DNS there. Run under
# `direnv exec .` so the token env var is loaded.
set -euo pipefail
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ADMIN_TOKEN"
export CLOUDFLARE_ACCOUNT_ID=74981a43be0de7712369306c7b19133d
cd "$(dirname "$0")/../cfw"
exec npx wrangler "$@"
