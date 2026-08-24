/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(',') ?? []

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4201,
    host: true,
    allowedHosts,
    // Dev is same-origin ('' API base) — proxy to this instance's prod worker.
    // /auth/sso has no dev equivalent (it's CF Access at the edge); use a grant
    // token (?key=) to test authed flows locally.
    proxy: {
      '/api': { target: 'https://watchy.open-athena.workers.dev', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
})
