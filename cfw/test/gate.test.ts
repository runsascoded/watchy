// The crypto/session primitives live in `@open-athena/auth` now and are tested
// there; what's watchy-specific — and what can regress — is the *configuration*:
// which SSO identities are let in, what scopes they get, and the cookie name that
// keeps existing sessions alive across the swap (specs/auth-adoption.md).
import { describe, expect, it } from 'vitest'
import { memoryAudit, memoryGrantStore, memoryRequestStore } from '@open-athena/auth/testing'
import { COOKIE, gateFor, hasScope, type GateEnv } from '../src/gate'

const ENV: GateEnv = {
  DB: null as unknown as D1Database, // unused: stores are injected below
  SESSION_SECRET: 'test-secret-0123456789abcdef',
  ADMIN_EMAILS: ['ryan.williams@openathena.ai'],
  AUTH_DOMAINS: ['openathena.ai'],
}

const gate = (env: GateEnv = ENV) =>
  gateFor(env, { store: memoryGrantStore(), requests: memoryRequestStore(), audit: memoryAudit() })

const REQ = new Request('https://gh.oa.dev/api/actors')

/** Sign in, then read back what an authenticated request resolves to. */
async function signedIn(email: string, env: GateEnv = ENV) {
  const g = gate(env)!
  const res = await g.signIn(email, REQ)
  if (!res) return null
  const cookie = res.cookie.split(';')[0]
  return g.authenticate(new Request(REQ.url, { headers: { Cookie: cookie } }))
}

describe('gateFor', () => {
  it('is null without a session secret — the public flavor runs open', () => {
    expect(gate({ ...ENV, SESSION_SECRET: undefined })).toBe(null)
  })

  it('keeps the pre-package cookie name, so existing SSO sessions survive', () => {
    expect([COOKIE, gate()!.cookieName]).toEqual(['watchy_auth', 'watchy_auth'])
  })

  it('gives a configured-domain identity `internal`, not admin', async () => {
    const auth = await signedIn('someone@openathena.ai')
    expect(auth && { kind: auth.kind, scopes: auth.scopes, admin: auth.admin }).toEqual({
      kind: 'sso',
      scopes: ['internal'],
      admin: false,
    })
    expect(hasScope(auth!, 'internal')).toBe(true)
  })

  it('gives an admin the wildcard scope', async () => {
    const auth = await signedIn('ryan.williams@openathena.ai')
    expect(auth && { kind: auth.kind, scopes: auth.scopes, admin: auth.admin }).toEqual({
      kind: 'sso',
      scopes: ['*'],
      admin: true,
    })
    expect(hasScope(auth!, 'internal')).toBe(true)
  })

  it('refuses an identity outside the configured domains', async () => {
    expect(await signedIn('stranger@example.com')).toBe(null)
  })

  it('admits admins even with no domains configured — a misconfig cannot lock them out', async () => {
    const noDomains = { ...ENV, AUTH_DOMAINS: undefined }
    expect([
      (await signedIn('ryan.williams@openathena.ai', noDomains))?.admin,
      await signedIn('someone@openathena.ai', noDomains),
    ]).toEqual([true, null])
  })
})

describe('share links', () => {
  it('mints a redeemable link, and revoking it kills the session it minted', async () => {
    const g = gate()!
    const { grant, token } = await g.mint({ name: 'Bob Smith (donor)', scopes: ['internal'], createdBy: 'ryan.williams@openathena.ai' })
    const redeemed = await g.redeem(token, REQ)
    expect(redeemed.ok).toBe(true)

    const cookie = (redeemed as { cookie: string }).cookie.split(';')[0]
    const asBob = () => g.authenticate(new Request(REQ.url, { headers: { Cookie: cookie } }))
    const before = await asBob()
    expect(before && [before.kind, hasScope(before, 'internal')]).toEqual(['grant', true])

    await g.revoke(grant.id)
    expect(await asBob()).toBe(null) // re-joined per request, so revocation is instant
  })
})
