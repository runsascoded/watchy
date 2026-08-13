# Worker split: standalone per-account instances (rbw + OA)

## Motivation

The data plane is currently **not** siloed: one worker + D1 on the personal CF account polls all 8 owners (personal + OA), holds the single event log, stores OA's Slack bot token / user map / admin emails, and serves both sites' APIs. The Pages deployments are per-account (`watchy-www` personal, `watchy-internal` OA), but OA's production Slack posting and internal dashboard depend on personal-account infra — a governance/continuity problem (not a confidentiality one; the data is public GH data).

Larger goal: watchy should be **easily reusable** — anyone points an instance at their own repos/orgs. Two standalone instances (personal, OA) prove the reusability story and double as docs examples.

## Target architecture

One codebase; per-instance config = a [wrangler environment](https://developers.cloudflare.com/workers/wrangler/environments/):

| | top-level env (personal) | `env.oa` |
|---|---|---|
| worker | `watchy` @ personal acct | `watchy` @ OA acct (`…43be`) |
| D1 | `watchy` (existing) | `watchy` (new, OA acct) |
| `TARGETS` | personal owners only | `Open-Athena`, `marin-community` |
| Slack vars/secrets | none | all (`SLACK_*`, bot token) |
| auth gate | unused (public site) | `SESSION_SECRET`, `ADMIN_EMAILS`, grants |
| FE | watchy.rbw.sh (Pages) + workers.dev assets | gh.oa.dev (Pages) + workers.dev assets |
| crons | `*/5` collect | `*/5` collect + Monday weekly summary |

Instance-specific knobs all live in the env's `vars` block — the "config file per deploy" surface. Non-inheritable wrangler keys (`vars`, `d1_databases`, `triggers`, `assets`) are spelled out per env, which is exactly what makes each env standalone.

The FE `VITE_INTERNAL` complement-scoping (`inScope`) becomes unnecessary post-split (each worker only returns its own targets) — remove it at cutover; the flavor bit then only governs branding + authed routes.

## Migration plan

Phase 1 — no credentials needed (this commit):
- [x] `cfw/wrangler.jsonc`: add `env.oa` (account_id, vars, crons, D1 binding with `database_id` TBD); top-level stays the **combined** prod config until cutover (must keep serving OA Slack + gh.oa.dev)
- [x] `scripts/split-oa-db.py`: dump OA-scoped rows from the live D1 as an importable `.sql` (events/stars/counts by owner prefix; follows by target; `actors`/`grants`/`slack_posts`/`summaries`/`weekly_threads` wholesale — all Slack/auth features are OA-side; `runs` starts fresh)
- [x] `www/functions/api/[[path]].ts`: proxy origin from Pages env var `WORKER_ORIGIN` (fallback: current personal worker) so cutover is a Pages setting, not a deploy
- [x] `cfw/package.json`: `deploy:oa` / `migrate:oa` scripts
- [x] README: "Run your own instance" section (the two envs as worked examples)

Phase 2 — needs an upgraded OA token (`CLOUDFLARE_ADMIN_TOKEN` + Workers Scripts:Edit, D1:Edit) and an OA-owned GH token (collaborator on OA/marin repos, for stargazer access):
- [ ] `wrangler d1 create watchy` on OA acct → fill `database_id`; `pnpm migrate:oa`
- [ ] Import phase-1 dump; spot-check counts vs. live
- [ ] Secrets on `env.oa`: `WATCHY_TOKEN` (fine-grained PAT, resource owner Open-Athena) + `WATCHY_TOKEN_MARIN_COMMUNITY` (second fine-grained PAT — one resource owner per token; `tokenFor()` in collect.ts resolves per owner), `SLACK_BOT_TOKEN`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`
- [ ] `pnpm deploy:oa`; verify `/check`, collect run, Slack post, `/api/*`

Phase 3 — cutover + trim:
- [ ] `watchy-internal` Pages: set `WORKER_ORIGIN` → OA worker URL; verify gh.oa.dev (API + auth cookie flow relays through the proxy unchanged)
- [ ] Top-level env: drop OA targets + all `SLACK_*`/`ADMIN_EMAILS`; delete Slack/session/Anthropic secrets from the personal worker; redeploy
- [ ] Delete migrated OA rows from personal D1 (same predicates as the dump)
- [ ] FE: remove `inScope` complement filtering (+ `owners`/`exclude` API params can stay for generality)
