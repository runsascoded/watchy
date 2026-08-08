import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(',') ?? []

export default defineConfig({
  plugins: [react()],
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
