// watchy.oa.dev → gh.oa.dev (2026-08 rename): the old domain stays attached to
// this Pages project purely to catch already-shared links; 301 preserves
// path + query so old Slack count/dashboard links land on the same view.
const OLD_HOST = 'watchy.oa.dev'
const NEW_ORIGIN = 'https://gh.oa.dev'

export const onRequest = async ({ request, next }: { request: Request; next: () => Promise<Response> }): Promise<Response> => {
  const url = new URL(request.url)
  if (url.host === OLD_HOST) return Response.redirect(`${NEW_ORIGIN}${url.pathname}${url.search}`, 301)
  return next()
}
