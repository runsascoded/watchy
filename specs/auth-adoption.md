# Adopt `@open-athena/auth` (watchy is the first consumer)

Replace watchy's hand-rolled gate with the package extracted from it. Upstream ranking and rationale: [`Open-Athena/auth` `specs/adoption.md`](https://github.com/Open-Athena/auth/blob/main/specs/adoption.md) — watchy is #1 ("low cost, high value: it's the code this was extracted from").

## What collapses

| File | Lines | Becomes |
|---|---|---|
| `cfw/src/gate.ts` | 186 | `createGate({ store: d1GrantStore(env.DB), audit: d1AuditSink(env.DB), … })` |
| `cfw/src/auth.ts` | 99 | `authRoutes(gate, opts)` — whoami/exchange/logout/request-access/admin |
| `www/functions/auth/sso.ts` | 27 | `ssoHandler({ gate, teamDomain, aud })` from `/cf-access` |
| `www/src/auth.tsx` | 78 | `useWhoami` / `AuthGate` / `SignInPanel` / `WhoamiChip` from `/react` |

390 lines out, plus the package brings features watchy never had: request-access, access log with view dedupe, named/capped/expiring grants, `@open-athena/auth/testing` in-memory stores.

## The migration is free — verified, not assumed

The schema change is backwards-incompatible (INTEGER autoincrement → random base64url TEXT ids, ISO-text → epoch-second timestamps, `label`→`name`, `use_count`→`redeems`). That looked like the blocker until the tables were actually read (2026-08-16):

- **oa**: 2 grants, *both revoked* (`smoke test (mint+revoke verification)`, `CIC verification (temp)`).
- **rw**: 0 grants.

Nothing live to preserve → drop and recreate. Anyone holding an old watchy link already can't use it.

**Numbering collision to handle:** watchy is at `0013_li_urls.sql` and already has its own `0007_grants.sql`; the package ships `0001_grants.sql`…`0005_dedupe_by_event.sql`. D1 tracks applied migrations by filename, so the package's files get renumbered into watchy's sequence (`0014_auth_grants.sql`, …) rather than copied verbatim. Keep the package's *contents* byte-identical so a future `@open-athena/auth` migration can be diffed against what watchy applied.

## Behaviour deltas — port deliberately

- **Scopes.** watchy's `hasScope` returns true for *any* SSO identity; the package requires an explicit scope (`*` reserved for admins). Match it with `domainPolicy(['openathena.ai'], ['internal'])`.
- **Cookie name.** Pass `cookieName: 'watchy_auth'` to keep existing SSO sessions alive across the deploy; otherwise everyone re-logs in once.
- **`use_count` → `redeems`.** watchy counted every request; the package counts *sessions minted* and touches `last_used_at` at most once a minute. Intended (share-links §1) — but the `/access` admin column changes meaning, so relabel it rather than leave "uses" pointing at a different quantity.
- **Deny dedupe** (package `0005`): a revoked link's browser stops writing one `deny` row per page load; token-presented denials are never deduped, since repeats there are someone probing.

## Sequencing (branch model: code on `rw`, enablement on `oa`)

1. Pin the dep by dist SHA (`github:Open-Athena/auth#<sha>`) — done, `f754988`.
2. Backend: `gate.ts` → package; `auth.ts` → `authRoutes`. Keep the `/api/[[path]]` proxy hop for now — watchy's auth authority is a cross-account Worker, and collapsing that into Pages Functions is a separate change (upstream calls it watchy's "deployment wart").
3. Migrations: renumber + apply on `rw` (0 grants, zero risk), then `oa`.
4. FE: `www/src/auth.tsx` → `/react` primitives, keeping watchy's styling.
5. `oa`: verify a fresh SSO login *and* a freshly minted link before deleting the old path; the gate is only enabled on `oa`, so that's where the real test is.

**Rollback:** the old worker version stays deployable — no data to lose, since the only live rows are revoked grants.

## Status (2026-08-16)

Steps 1–4 **done and deployed** on both instances; migrations `0014`–`0019` applied to both D1s.

Verified without a login: `rw` reports auth-unconfigured (`/api/auth/whoami` 503, gated 401, public 200); `oa` reports configured (`whoami` 401 not 503) and serves the *package's* route payloads — `POST /auth/exchange` with a bad token returns `{"error":"invalid link","reason":"bad-token"}` (watchy's old handler had no `reason`), and `POST /auth/request` (an endpoint watchy never had) validates email. The sign-in wall renders with watchy's copy and class names. Session-format compatibility was checked at the source, not assumed: the package's claims (`{v:1,sub,exp}`, same b64url + HMAC-SHA256 over the body, same `e:`/`g:` prefixes) are byte-identical to what watchy minted, so existing SSO cookies verify unchanged.

**Left to verify by hand** (needs a CF Access login): complete an SSO bounce, then mint → open → revoke a link on `/access` to confirm the ported admin page against live data. Old *grant*-backed cookies are expected to fail — those grants were revoked and their table is gone.

## Deferred

- Moving the gate into Pages Functions (kills the proxy hop) — separate change, separate risk.
- Anonymous-traffic logging (upstream §4 open question): watchy's access log will start at identity, same as the package's other consumers.
- Vendoring the admin UI: watchy keeps its `/access` page; whether that becomes the vendored reference is upstream's open question.
