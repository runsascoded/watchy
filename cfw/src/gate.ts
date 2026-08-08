/**
 * App-level auth gate (see specs/auth-gate.md): CF Access acts only as an SSO
 * IdP on /auth/sso; authorization happens here, where SSO session cookies and
 * grant tokens (share links / magic links) are peers.
 *
 * Deliberately app-agnostic — Env deps are DB + SESSION_SECRET + ADMIN_EMAILS.
 * Lift as-is into the next project that needs the same flow.
 */

export interface GateEnv {
  DB: D1Database
  SESSION_SECRET?: string
  ADMIN_EMAILS?: string[]
}

export const COOKIE = 'watchy_auth'
const SESSION_TTL_S = 30 * 24 * 3600
const OA_DOMAIN = '@openathena.ai'

export interface Grant {
  id: number
  label: string
  email: string | null
  scopes: string
  created_by: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  use_count: number
}

export type Auth =
  | { kind: 'sso'; email: string; admin: boolean }
  | { kind: 'grant'; grant: Grant }

const enc = new TextEncoder()

export const b64u = (buf: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function b64uDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signSession(sub: string, secret: string, nowMs: number): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify({ v: 1, sub, exp: Math.floor(nowMs / 1000) + SESSION_TTL_S })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${b64u(sig)}`
}

/** Returns the `sub` claim (`e:<email>` | `g:<grant_id>`) or null. */
export async function verifySession(value: string, secret: string, nowMs: number): Promise<string | null> {
  const i = value.indexOf('.')
  if (i < 0) return null
  const body = value.slice(0, i)
  const sigBytes = Uint8Array.from(b64uDecode(value.slice(i + 1)), c => c.charCodeAt(0))
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(body))
  if (!ok) return null
  const payload = JSON.parse(b64uDecode(body))
  if (payload.v !== 1 || typeof payload.sub !== 'string') return null
  if (payload.exp * 1000 < nowMs) return null
  return payload.sub
}

export async function hashToken(token: string): Promise<string> {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(token)))
}

export function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return b64u(bytes)
}

export function sessionCookie(value: string, req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? ' Secure;' : ''
  return `${COOKIE}=${value}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_S}`
}

export function clearCookie(req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? ' Secure;' : ''
  return `${COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`
}

function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** Active = not revoked, not expired. */
async function activeGrantById(env: GateEnv, id: number, nowIso: string): Promise<Grant | null> {
  const g = await env.DB
    .prepare(`SELECT * FROM grants WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(id, nowIso)
    .first<Grant>()
  return g ?? null
}

export async function activeGrantByToken(env: GateEnv, token: string, nowIso: string): Promise<Grant | null> {
  const g = await env.DB
    .prepare(`SELECT * FROM grants WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(await hashToken(token), nowIso)
    .first<Grant>()
  return g ?? null
}

async function touchGrant(env: GateEnv, id: number, nowIso: string): Promise<void> {
  await env.DB.prepare(`UPDATE grants SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?`).bind(nowIso, id).run()
}

export function isAdmin(email: string, env: GateEnv): boolean {
  return (env.ADMIN_EMAILS ?? []).includes(email)
}

/**
 * Resolve the request's identity: session cookie, `Authorization: Bearer <token>`,
 * or `?key=<token>` (the latter two let curl/scripts skip the cookie exchange).
 * Grant-backed identities re-check the grant row per request — revocation is instant.
 */
export async function authenticate(req: Request, env: GateEnv, now = new Date()): Promise<Auth | null> {
  const nowIso = now.toISOString()
  const bearer = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? new URL(req.url).searchParams.get('key')
  if (bearer) {
    const grant = await activeGrantByToken(env, bearer, nowIso)
    if (grant) {
      await touchGrant(env, grant.id, nowIso)
      return { kind: 'grant', grant }
    }
  }
  const secret = env.SESSION_SECRET
  if (!secret) return null
  const cookie = getCookie(req, COOKIE)
  if (!cookie) return null
  const sub = await verifySession(cookie, secret, now.getTime())
  if (!sub) return null
  if (sub.startsWith('e:')) {
    const email = sub.slice(2)
    if (!email.endsWith(OA_DOMAIN) && !isAdmin(email, env)) return null
    return { kind: 'sso', email, admin: isAdmin(email, env) }
  }
  if (sub.startsWith('g:')) {
    const grant = await activeGrantById(env, parseInt(sub.slice(2), 10), nowIso)
    if (!grant) return null
    await touchGrant(env, grant.id, nowIso)
    return { kind: 'grant', grant }
  }
  return null
}

export function hasScope(auth: Auth, scope: string): boolean {
  if (auth.kind === 'sso') return true
  return auth.grant.scopes.split(/[\s,]+/).includes(scope)
}

/**
 * Verify a `Cf-Access-Jwt-Assertion` RS256 JWT against the Zero Trust team's
 * public certs and return the authenticated email. Full verification (not just
 * decode) so the identity stays trustworthy even if the edge gating is ever
 * misconfigured. `aud` is checked when expectedAud is provided.
 */
export async function verifyAccessJwt(jwt: string, teamDomain: string, expectedAud?: string, nowMs = Date.now()): Promise<string | null> {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  const header = JSON.parse(b64uDecode(h))
  const certs = await fetch(`${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } } as RequestInit).then(r => r.json<{ keys: (JsonWebKey & { kid: string })[] }>())
  const jwk = certs.keys.find(k => k.kid === header.kid)
  if (!jwk) return null
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const sig = Uint8Array.from(b64uDecode(s), c => c.charCodeAt(0))
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, enc.encode(`${h}.${p}`))
  if (!ok) return null
  const payload = JSON.parse(b64uDecode(p))
  if (payload.iss !== teamDomain) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null
  if (expectedAud && !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(expectedAud)) return null
  return typeof payload.email === 'string' ? payload.email : null
}
