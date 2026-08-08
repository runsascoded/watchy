/**
 * /api/auth/* routes: grant exchange, whoami, logout, admin grant CRUD.
 * SSO cookie minting lives in the Pages Function (www/functions/auth/sso.ts),
 * which shares SESSION_SECRET; everything else is here.
 */
import {
  authenticate,
  activeGrantByToken,
  clearCookie,
  generateToken,
  hashToken,
  isAdmin,
  sessionCookie,
  signSession,
  type Auth,
  type GateEnv,
} from './gate'

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function whoamiBody(auth: Auth) {
  return auth.kind === 'sso'
    ? { kind: 'sso', email: auth.email, admin: auth.admin }
    : { kind: 'grant', label: auth.grant.label, email: auth.grant.email, scopes: auth.grant.scopes, admin: false }
}

async function requireAdmin(req: Request, env: GateEnv): Promise<Extract<Auth, { kind: 'sso' }> | Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ error: 'unauthenticated' }, 401)
  if (auth.kind !== 'sso' || !auth.admin) return json({ error: 'admin only' }, 403)
  return auth
}

export async function handleAuth(req: Request, url: URL, env: GateEnv): Promise<Response> {
  const path = url.pathname
  const now = new Date()

  if (path === '/api/auth/whoami' && req.method === 'GET') {
    const auth = await authenticate(req, env, now)
    if (!auth) return json({ error: 'unauthenticated' }, 401)
    return json(whoamiBody(auth))
  }

  if (path === '/api/auth/exchange' && req.method === 'POST') {
    if (!env.SESSION_SECRET) return json({ error: 'auth not configured' }, 503)
    const { token } = await req.json<{ token?: string }>().catch(() => ({ token: undefined }))
    if (!token) return json({ error: 'token required' }, 400)
    const grant = await activeGrantByToken(env, token, now.toISOString())
    if (!grant) return json({ error: 'invalid or expired link' }, 401)
    const cookie = sessionCookie(await signSession(`g:${grant.id}`, env.SESSION_SECRET, now.getTime()), req)
    return json(whoamiBody({ kind: 'grant', grant }), 200, { 'set-cookie': cookie })
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie(req) })
  }

  if (path === '/api/auth/grants') {
    const gate = await requireAdmin(req, env)
    if (gate instanceof Response) return gate

    if (req.method === 'GET') {
      const { results } = await env.DB
        .prepare(`SELECT id, label, email, scopes, created_by, created_at, expires_at, revoked_at, last_used_at, use_count
                  FROM grants ORDER BY id DESC`)
        .all()
      return json({ grants: results })
    }

    if (req.method === 'POST') {
      type MintBody = { label?: string; email?: string; scopes?: string; ttl_days?: number }
      const body = await req.json<MintBody>().catch((): MintBody => ({}))
      if (!body.label?.trim()) return json({ error: 'label required' }, 400)
      const token = generateToken()
      const expires = body.ttl_days ? new Date(now.getTime() + body.ttl_days * 86_400_000).toISOString() : null
      const res = await env.DB
        .prepare(`INSERT INTO grants (token_hash, label, email, scopes, created_by, created_at, expires_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
        .bind(await hashToken(token), body.label.trim(), body.email?.trim() || null, body.scopes?.trim() || 'internal', gate.email, now.toISOString(), expires)
        .first<{ id: number }>()
      // Token is returned exactly once; only its hash is stored.
      return json({ id: res!.id, token, label: body.label.trim(), email: body.email ?? null, expires_at: expires })
    }

    if (req.method === 'DELETE') {
      const id = parseInt(url.searchParams.get('id') ?? '', 10)
      if (!Number.isFinite(id)) return json({ error: 'id required' }, 400)
      await env.DB.prepare(`UPDATE grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(now.toISOString(), id).run()
      return json({ ok: true })
    }
  }

  return json({ error: 'not found' }, 404)
}
