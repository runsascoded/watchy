import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(',') ?? []

// index.html is authored for the public flavor (watchy.rbw.sh); the internal
// build rewrites <title>/og: tags to its own identity + og-oa.jpg (both hosts
// serve both og images — only the reference differs)
const ogFlavor = (): Plugin => ({
  name: 'og-flavor',
  transformIndexHtml(html: string) {
    if (process.env.VITE_INTERNAL !== '1') return html
    return html
      .replaceAll('<title>watchy</title>', '<title>watchy · OA</title>')
      .replaceAll('content="watchy"', 'content="watchy · OA"')
      .replaceAll('https://watchy.rbw.sh/og.jpg', 'https://gh.oa.dev/og-oa.jpg')
  },
})

export default defineConfig({
  plugins: [react(), ogFlavor()],
  server: {
    port: 4199,
    host: true,
    allowedHosts,
    // Internal-build dev is same-origin ('' API base) — proxy to the prod worker.
    // /auth/sso has no dev equivalent (it's CF Access at the edge); use a grant
    // token (?key=) to test authed flows locally.
    proxy: {
      '/api': { target: 'https://watchy.ryan-0dc.workers.dev', changeOrigin: true },
    },
  },
})
