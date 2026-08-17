// The ONLY Access-gated path on this site (see specs/auth-gate.md): CF Access
// authenticates at the edge and attaches Cf-Access-Jwt-Assertion (the friendly
// ...-Authenticated-User-Email header is NOT forwarded through Pages o2o
// proxying, so we verify the JWT ourselves — which is also sturdier: the
// identity stays trustworthy even if the edge gating is misconfigured). We
// convert that identity into the app's first-party session cookie and bounce.
//
// Deliberately *not* `@open-athena/auth`'s `ssoHandler`: that takes a whole gate
// (hence a D1 binding), while this Pages project has none — watchy's auth
// authority is the cross-account Worker (specs/auth-adoption.md, "deployment
// wart"). The session primitives below are the package's, so the cookie this
// mints is byte-compatible with what the Worker's gate verifies.
import { emailSub, isSecureRequest, sessionCookie, signSession } from '@open-athena/auth'
import { verifyAccessJwt } from '@open-athena/auth/cf-access'

const TEAM_DOMAIN = 'https://openathena-ai-pages.cloudflareaccess.com'
const COOKIE = 'watchy_auth'

interface Ctx {
  request: Request
  env: { SESSION_SECRET?: string; ACCESS_AUD?: string }
}

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwt) return new Response('no Access JWT — is this path still gated?\n', { status: 401 })
  const email = await verifyAccessJwt(jwt, TEAM_DOMAIN, env.ACCESS_AUD)
  if (!email) return new Response('Access JWT failed verification\n', { status: 401 })
  if (!env.SESSION_SECRET) return new Response('SESSION_SECRET not configured\n', { status: 503 })
  const url = new URL(request.url)
  let next = url.searchParams.get('next') ?? '/'
  if (!next.startsWith('/') || next.startsWith('//')) next = '/'
  const value = await signSession(emailSub(email), env.SESSION_SECRET, Date.now())
  const cookie = sessionCookie(value, { name: COOKIE, secure: isSecureRequest(request) })
  return new Response(null, { status: 302, headers: { location: next, 'set-cookie': cookie } })
}
