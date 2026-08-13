// Same-origin /api/* proxy to the watchy worker (a cross-account Worker can't
// be routed onto oa.dev directly). Same-origin matters because the auth session
// cookie is scoped to the serving host (gh.oa.dev); the worker sets/reads it
// through this hop (Set-Cookie relays untouched).
// WORKER_ORIGIN Pages env var overrides the default — worker-split cutover
// (specs/worker-split.md) repoints this at the OA-account worker via a Pages
// setting, no redeploy needed.
const DEFAULT_ORIGIN = 'https://watchy.ryan-0dc.workers.dev'

interface Ctx {
  request: Request
  env: { WORKER_ORIGIN?: string }
}

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  const url = new URL(request.url)
  return fetch(new Request(`${env.WORKER_ORIGIN ?? DEFAULT_ORIGIN}${url.pathname}${url.search}`, request))
}
