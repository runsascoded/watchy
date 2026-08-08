// The ONLY Access-gated path on watchy.oa.dev (see specs/auth-gate.md): CF
// Access authenticates at the edge and attaches Cf-Access-Jwt-Assertion (the
// friendly ...-Authenticated-User-Email header is NOT forwarded through Pages
// o2o proxying, so we verify the JWT ourselves — which is also sturdier: the
// identity stays trustworthy even if the edge gating is misconfigured). We
// convert that identity into the app's first-party session cookie and bounce.
import { sessionCookie, signSession, verifyAccessJwt } from '../../../cfw/src/gate'

const TEAM_DOMAIN = 'https://openathena-ai-pages.cloudflareaccess.com'

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
  const cookie = sessionCookie(await signSession(`e:${email}`, env.SESSION_SECRET, Date.now()), request)
  return new Response(null, { status: 302, headers: { location: next, 'set-cookie': cookie } })
}
