/**
 * /api/auth/* — mounted straight from the package's route surface (whoami,
 * exchange, logout, request-access, admin grant/request/log routes).
 * SSO cookie minting lives in the Pages Function (www/functions/auth/sso.ts),
 * which shares SESSION_SECRET.
 */
import { authRoutes } from '@open-athena/auth'
import { auditFor, gateFor, type GateEnv } from './gate'

export async function handleAuth(req: Request, env: GateEnv): Promise<Response> {
  const gate = gateFor(env)
  if (!gate) return new Response(JSON.stringify({ error: 'auth not configured' }) + '\n', {
    status: 503,
    headers: { 'content-type': 'application/json' },
  })
  const routes = authRoutes(gate, { audit: auditFor(env) })
  return (await routes(req)) ?? new Response(JSON.stringify({ error: 'not found' }) + '\n', {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}
