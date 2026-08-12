// og:image capture (dev server up; `-i og-oa` against a `VITE_INTERNAL=1` dev
// server for the internal flavor): `scrns -h 4199 -o tmp-shots -i '^og$'`, then
// `sips -s format jpeg -s formatOptions 85 tmp-shots/<name>.png --out public/<name>.jpg`
const og = {
  query: 'og',
  width: 1200,
  height: 630,
  selector: '.og-page[data-ready]',
}

export default {
  og,        // public flavor → og.jpg
  'og-oa': og,  // internal flavor → og-oa.jpg
}
