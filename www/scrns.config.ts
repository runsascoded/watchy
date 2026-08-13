// og:image capture (dev server up): `scrns -h 4201 -o tmp-shots -i '^og$'`, then
// `sips -s format jpeg -s formatOptions 85 tmp-shots/og.png --out public/og.jpg`
export default {
  og: {
    query: 'og',
    width: 1200,
    height: 630,
    selector: '.og-page[data-ready]',
  },
}
