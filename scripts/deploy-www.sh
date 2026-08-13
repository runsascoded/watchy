#!/bin/bash
# Build + deploy the site's Pages project (watchy-www). Deploys from dist/ cwd
# so the auth-gate functions/ (unused on this public instance) is not bundled.
set -euo pipefail
cd "$(dirname "$0")/../www"
pnpm build >/dev/null
(cd dist && npx wrangler pages deploy . --project-name watchy-www --commit-dirty=true)
