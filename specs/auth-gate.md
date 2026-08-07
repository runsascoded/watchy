# Auth gate: public watchy.oa.dev with app-level gating for AR (+ reusable pattern)

Goal (RW, 2026-08-08): make watchy.oa.dev publicly browsable, gating only the sensitive AR surface — and use the occasion to converge on a reusable auth flow for the many OA/personal apps with the same shape:

1. **SSO** for any `@openathena.ai` email (Google, via CF Access)
2. **Whitelisted externals** — "login with code" → upgraded to **magic links** (emailed nonce URLs)
3. **"Anyone with the link"** — configurable nonced share-URLs, admin-CRUDable

## Research inputs (2026-08-08)

- **`$c/rac/mortgage-viz`** — the nonce substrate, called *grants* there: `doc_grants(token_hash, perms, label, created_at, expires_at, revoked_at)`; 24-byte tokens shown once, only SHA-256 hashes stored (full-entropy input, so no argon2 needed); `POST …/session {token}` exchanges for an HttpOnly cookie; every authz check re-joins session→grant so **revocation is instant** with no blacklist. Magic-link explicitly sketched there as "short-TTL grant + recipient email + burn-on-exchange". Admin is secret-header + CLI (`scripts/mz.mjs`); the `/admin` UI was retired. Core lib `functions/_lib/doc-auth.ts` is clean and liftable.
- **`$oa/applitrack`** — HMAC-signed session cookie (~60 lines, node crypto only, no auth lib): `b64u(JSON{email,exp}) + "." + b64u(HMAC(body, SESSION_SECRET))`, constant-time compare; **live allowlist check on every verify** (revocation without session state); `allowed_users(email PK, role, added_at, added_by, name)` with bulk-paste admin UI, per-domain default roles, hard-coded owner protection; admin "preview as role" cookie. No share links, no magic links.
- **`$oa/marin-gcs-usage`** + **index.oa.dev/guide** + Slack `#eng` thread (Yael, 2026-08-06) — OA's blessed path: CF hosting, Access app per tool on `<tool>.oa.dev`, policy = emails ending `openathena.ai` (Google IdP + one-time-PIN both configured on ZT org `openathena-ai-pages.cloudflareaccess.com`), session ≥24h (short sessions break XHR with "Failed to fetch" — page loads can re-auth silently, background fetches can't), identity via the Access-injected `Cf-Access-Authenticated-User-Email` header, whoami chip via `/cdn-cgi/access/get-identity`, logout via `/cdn-cgi/access/logout`. Edge-only; no in-app JWT validation anywhere.

## Design: Access as IdP, app-level authz

Key insight: CF Access cannot validate nonces, so if Access is *the wall*, share-link holders can never get in. Invert it: **Access shrinks to an SSO IdP on one path** (`/auth/sso`); everything else is public at the edge, and authorization happens app-level where session-cookie and grant-token are peers.

```
watchy.oa.dev (CFP watchy-internal, OA acct — public at edge except /auth/sso)
├── static SPA (internal build; /actors shell is public, data is not)
├── functions/auth/sso.ts        ← the ONLY Access-gated path; reads
│     Cf-Access-Authenticated-User-Email (trustworthy: Access injects+strips it),
│     mints session cookie, 302 → ?next=
└── functions/api/[[path]].ts    ← same-origin proxy → personal worker /api/*
      (forwards Cookie; relays Set-Cookie)

watchy worker (personal acct, workers.dev) — single auth authority
├── gate.ts: verify cookie (HMAC, shared SESSION_SECRET) | Bearer token | ?key=
├── D1 `grants` table; admin CRUD; /auth/exchange|whoami|logout
└── /api/actors requires scope `internal` (closes the open workers.dev hole)
```

- **Session cookie** `watchy_auth` = `b64u(JSON{v:1, sub, exp}) + "." + b64u(HMAC-SHA256)`, HttpOnly, SameSite=Lax, 30d. `sub` = `e:<email>` (SSO) or `g:<grant_id>` (link). Minted by the sso Pages Function (SSO) or the worker (grant exchange); verified by the worker. SESSION_SECRET shared between the two (pages secret + worker secret).
- **Authorization** (worker `gate.ts`):
  - `e:<email>` → allowed iff `endsWith('@openathena.ai')`; admin iff in `ADMIN_EMAILS` (wrangler var). (External SSO emails deliberately NOT supported — externals get grants/magic links instead; one mechanism, no CF-dashboard edits per person.)
  - `g:<id>` → re-fetch grant row per request: reject if revoked/expired (instant revocation, mortgage-viz pattern); bump `last_used_at`/`use_count`.
  - Raw token also accepted as `Authorization: Bearer <token>` or `?key=<token>` (hash → lookup) — curl/scripts need no cookie jar.
- **Grants** (migration 0007): `grants(id, token_hash UNIQUE, label, email NULL, scopes DEFAULT 'internal', created_by, created_at, expires_at NULL, revoked_at NULL, last_used_at, use_count)`. Token = 24 random bytes b64url, shown once at mint. **Magic link ≡ grant with `email` set** — same table, same URL shape, the email is provenance/labeling (v1: no burn-on-first-use; revocable + audited instead).
- **Share URL shape**: `https://watchy.oa.dev/actors?key=<token>` — FE exchanges via `POST /api/auth/exchange`, then `history.replaceState` strips the param (mortgage-viz forgot this; we don't).
- **SPA auth UX** (no Access-302-vs-XHR problem by construction): `/actors` shell is public; `/api/actors` 401s → panel with "Sign in — Open Athena" (`location.href='/auth/sso?next=/actors'`) and "have an access link?" hint. Whoami chip (email or grant label) + sign-out in header when authed.
- **Admin UI**: `/access` route (internal build): list grants (label/email/scopes/created/expiry/last-used/status), mint (label, optional email, optional TTL) → one-time link display with copy + `mailto:` prefill ("email me a magic link" v1 delivery; real sending — Resend or similar — is a later add), revoke. Admin = SSO session with email in `ADMIN_EMAILS`.
- **Access app change** (CF dashboard/CIC, AFTER app-level gate is deployed): destinations `watchy.oa.dev` → **`watchy.oa.dev/auth/sso`**; keep `watchy-internal.pages.dev` + wildcard fully gated (non-canonical hosts stay OA-only, and their previews were never public).

### Sensitivity boundaries (v1)

- Gated (`internal` scope): `/api/actors` (+ future deep-AR fields, prospect scoring, notes).
- Public: events/series/targets/counts/health/runs/summaries (aggregate, already-public GH data). watchy.rbw.sh unaffected (public build never had /actors).

### Reuse path

Worker-side `gate.ts` + the `grants` migration + the two Pages Functions are deliberately app-agnostic (Env deps: `DB`, `SESSION_SECRET`, `ADMIN_EMAILS`; one scope string). Next consumer should lift them as-is; if a third consumer appears, extract to a package/template repo (mortgage-viz's `specs/live-sync.md` already plans the same split — coordinate then). Candidate name: `cf-gate`.

## Status

- [x] Research (mortgage-viz / applitrack / marin-gcs-usage / OA guide + Slack thread)
- [ ] Worker: migration 0007, `gate.ts`, auth routes, gate `/api/actors`
- [ ] Pages Functions: `auth/sso`, `api/[[path]]` proxy
- [ ] FE: same-origin API (internal build), Actors sign-in panel, `?key=` exchange, whoami chip, `/access` admin
- [ ] Secrets: `SESSION_SECRET` (worker + pages project), `ADMIN_EMAILS` var
- [ ] Deploy + migrate; CIC verify SSO, grant mint/revoke, share link
- [ ] Narrow Access app to `/auth/sso`; verify public browse + gated AR
