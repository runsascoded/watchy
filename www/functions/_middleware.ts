// Pages middleware: legacy-host 301s + per-route OG/title tags for the SPA
// shell (specs/og-routes.md). Crawlers don't run JS, so the SPA's
// document.title effect never reaches them — inject at the edge instead; also
// adds twitter:card + a meta description globally. Deployed only where the
// Pages project bundles functions/ (internal flavor).

// watchy.oa.dev → gh.oa.dev (2026-08 rename): the old domain stays attached to
// this Pages project purely to catch already-shared links; 301 preserves
// path + query so old Slack count/dashboard links land on the same view.
const OLD_HOST = 'watchy.oa.dev'
const NEW_ORIGIN = 'https://gh.oa.dev'

interface OgRoute {
  title: string
  description?: string
  /** Absolute-path override for og:image (e.g. a per-page card under public/) */
  image?: string
}

const ROUTES: Record<string, OgRoute> = {
  '/graphs': { title: 'Graphs', description: 'Stars-over-time history per repo' },
  '/health': { title: 'Health', description: 'Collector pipeline health: runs, events, current state' },
  '/actors': { title: 'Actors', description: 'Who is starring + following — enriched, interest-ranked', image: '/og-actors.jpg' },
}

interface Ctx {
  request: Request
  next: () => Promise<Response>
}

export const onRequest = async ({ request, next }: Ctx): Promise<Response> => {
  const url = new URL(request.url)
  if (url.host === OLD_HOST) return Response.redirect(`${NEW_ORIGIN}${url.pathname}${url.search}`, 301)
  const res = await next()
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res
  const route = ROUTES[url.pathname]
  let description: string | undefined
  return new HTMLRewriter()
    .on('title', {
      text(t) {
        if (route && t.text) t.replace(`${t.text} · ${route.title}`)
      },
    })
    .on('meta[property="og:title"]', {
      element(e) {
        if (route) e.setAttribute('content', `${e.getAttribute('content')} · ${route.title}`)
      },
    })
    .on('meta[property="og:description"]', {
      element(e) {
        if (route?.description) e.setAttribute('content', route.description)
        description = e.getAttribute('content') ?? undefined
      },
    })
    .on('meta[property="og:image"]', {
      element(e) {
        if (route?.image) e.setAttribute('content', `${url.origin}${route.image}`)
      },
    })
    .on('head', {
      element(e) {
        e.onEndTag(end => {
          end.before('<meta name="twitter:card" content="summary_large_image" />', { html: true })
          if (description) end.before(`<meta name="description" content="${description.replaceAll('"', '&quot;')}" />`, { html: true })
        })
      },
    })
    .transform(res)
}
