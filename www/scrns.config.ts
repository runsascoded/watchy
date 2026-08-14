// og:image captures (dev server up): `scrns -h 4199 -o tmp-shots -i og`, then
// `sips -s format jpeg -s formatOptions 85 tmp-shots/<name>.png --out public/<name>.jpg`
// (/actors/og is auth-gated — captured from an authed browser instead; see specs/og-routes.md)
const card = {
  width: 1200,
  height: 630,
  selector: '.og-page[data-ready]',
}

export default {
  og: { ...card, query: 'og' },
  'og-graphs': { ...card, query: 'graphs/og' },
}
