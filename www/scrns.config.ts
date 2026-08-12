// og:image capture: `pnpm dlx scrns -h 4199 -o tmp-shots` (dev server up), then
// `sips -s format jpeg -s formatOptions 85 tmp-shots/og.png --out public/og.jpg`
export default {
  og: {
    query: 'og',
    width: 1200,
    height: 630,
    selector: '.og-page[data-ready]',
  },
}
