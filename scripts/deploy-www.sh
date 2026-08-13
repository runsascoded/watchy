#!/bin/bash
# Build + deploy a www flavor's Pages project: `deploy-www.sh rbw|oa`.
# rbw → watchy-www (personal acct, ambient .envrc creds), deployed from dist/
# cwd so the internal-only functions/ (auth gate) is NOT bundled.
# oa → watchy-internal (OA acct via CLOUDFLARE_ADMIN_TOKEN), deployed from www/
# cwd so functions/ IS bundled. Run under `direnv exec .`.
set -euo pipefail
cd "$(dirname "$0")/../www"
case "${1:?usage: deploy-www.sh rbw|oa}" in
  rbw)
    pnpm build >/dev/null
    (cd dist && npx wrangler pages deploy . --project-name watchy-www --commit-dirty=true)
    ;;
  oa)
    VITE_INTERNAL=1 pnpm build >/dev/null
    export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ADMIN_TOKEN"
    export CLOUDFLARE_ACCOUNT_ID=74981a43be0de7712369306c7b19133d
    npx wrangler pages deploy dist --project-name watchy-internal --branch main --commit-dirty=true
    ;;
  *) echo "usage: deploy-www.sh rbw|oa" >&2; exit 1 ;;
esac
