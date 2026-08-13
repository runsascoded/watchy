#!/bin/bash
# wrangler with Open Athena account creds: ambient (.envrc) CF creds are the
# personal account's; this instance lives on the OA account. Run under
# `direnv exec .` so $CLOUDFLARE_ADMIN_TOKEN is set. Also the entrypoint for
# instance secrets: `oa-wrangler.sh secret put WATCHY_TOKEN`, etc.
set -euo pipefail
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ADMIN_TOKEN"
export CLOUDFLARE_ACCOUNT_ID=74981a43be0de7712369306c7b19133d
cd "$(dirname "$0")/../cfw"
exec npx wrangler "$@"
