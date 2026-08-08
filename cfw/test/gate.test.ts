import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, signSession, verifySession } from '../src/gate'

const SECRET = 'test-secret-0123456789abcdef'
const NOW = Date.parse('2026-08-08T00:00:00Z')

describe('session sign/verify', () => {
  it('round-trips a subject', async () => {
    const cookie = await signSession('e:a@openathena.ai', SECRET, NOW)
    expect(await verifySession(cookie, SECRET, NOW)).toBe('e:a@openathena.ai')
  })

  it('rejects a tampered payload', async () => {
    const cookie = await signSession('e:a@openathena.ai', SECRET, NOW)
    const [body, sig] = cookie.split('.')
    const forged = btoa(JSON.stringify({ v: 1, sub: 'e:evil@example.com', exp: 4102444800 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifySession(`${forged}.${sig}`, SECRET, NOW)).toBe(null)
    expect(await verifySession(`${body}.AAAA${sig!.slice(4)}`, SECRET, NOW)).toBe(null)
  })

  it('rejects the wrong secret', async () => {
    const cookie = await signSession('g:7', SECRET, NOW)
    expect(await verifySession(cookie, 'other-secret-0123456789abcdef', NOW)).toBe(null)
  })

  it('rejects an expired session', async () => {
    const cookie = await signSession('g:7', SECRET, NOW)
    expect(await verifySession(cookie, SECRET, NOW + 31 * 24 * 3600 * 1000)).toBe(null)
  })

  it('rejects malformed values', async () => {
    expect(await verifySession('no-dot-here', SECRET, NOW)).toBe(null)
  })
})

describe('tokens', () => {
  it('generates 24-byte urlsafe tokens with stable hashes', async () => {
    const t = generateToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(await hashToken(t)).toBe(await hashToken(t))
    expect(await hashToken(t)).not.toBe(await hashToken(generateToken()))
  })
})
