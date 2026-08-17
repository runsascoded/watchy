/**
 * App-level auth gate, built on `@open-athena/auth` — the package this file's
 * previous hand-rolled contents were extracted into (see specs/auth-adoption.md).
 * CF Access acts only as an SSO IdP on /auth/sso; authorization happens here,
 * where SSO session cookies and grant tokens (share links) are peers.
 */
import { createGate, domainPolicy, type Gate, type GateOptions } from '@open-athena/auth'
import { d1AuditQuery, d1AuditSink, d1GrantStore, d1RequestStore } from '@open-athena/auth/d1'

export { hasScope, type Auth } from '@open-athena/auth'

export interface GateEnv {
  DB: D1Database
  SESSION_SECRET?: string
  ADMIN_EMAILS?: string[]
  /** SSO domains granted `internal`. Unset = admins only (the base instance). */
  AUTH_DOMAINS?: string[]
}

/** Cookie name predates the package; kept so existing SSO sessions survive the swap. */
export const COOKIE = 'watchy_auth'

/** Store wiring, overridable so tests can exercise this config against the
 * package's real logic with `@open-athena/auth/testing`'s in-memory stores. */
type Stores = Pick<GateOptions, 'store' | 'requests' | 'audit'>

/** The gate, or null when auth isn't configured (the public flavor runs open). */
export function gateFor(env: GateEnv, stores?: Stores): Gate | null {
  if (!env.SESSION_SECRET) return null
  return createGate({
    store: stores?.store ?? d1GrantStore(env.DB),
    requests: stores?.requests ?? d1RequestStore(env.DB),
    audit: stores?.audit ?? d1AuditSink(env.DB),
    secret: env.SESSION_SECRET,
    adminEmails: env.ADMIN_EMAILS ?? [],
    // Package requires an explicit scope; watchy's old `hasScope` passed any SSO
    // identity, so grant the same `internal` the API checks for
    policy: domainPolicy(env.AUTH_DOMAINS ?? [], ['internal']),
    cookieName: COOKIE,
  })
}

export const auditFor = (env: GateEnv) => d1AuditQuery(env.DB)
