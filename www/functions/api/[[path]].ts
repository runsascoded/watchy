// Same-origin /api/* proxy to the watchy worker (personal CF account — a
// cross-account Worker can't be routed onto oa.dev directly). Same-origin
// matters because the auth session cookie is scoped to the serving host (gh.oa.dev); the
// worker sets/reads it through this hop (Set-Cookie relays untouched).
const WORKER_ORIGIN = 'https://watchy.ryan-0dc.workers.dev'

interface Ctx {
  request: Request
}

export const onRequest = async ({ request }: Ctx): Promise<Response> => {
  const url = new URL(request.url)
  return fetch(new Request(`${WORKER_ORIGIN}${url.pathname}${url.search}`, request))
}
