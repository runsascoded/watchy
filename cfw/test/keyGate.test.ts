// `/check`, `/weekly-refresh`, `/summary-preview` and `/test-pushover` act on the world:
// GitHub quota, D1 writes, a live Slack thread, a push notification. The gate used to wave
// everything through when MANUAL_CHECK_KEY was unset, and the OA worker was deployed
// without it — so all four answered the public internet on workers.dev. Unset now means
// unusable, not unguarded.
import { describe, expect, it } from 'vitest'
import { keyGate, type Env } from '../src/index'

const env = (MANUAL_CHECK_KEY?: string) => ({ MANUAL_CHECK_KEY }) as Env
const status = (e: Env, url: string) => keyGate(new Request(url), e)?.status ?? 'allowed'

const URL_NO_KEY = 'https://w.example/check'
const URL_GOOD = 'https://w.example/check?key=s3cret'
const URL_BAD = 'https://w.example/check?key=guess'

describe('keyGate', () => {
  it('refuses every request when no key is configured, rather than allowing them', () => {
    expect([status(env(), URL_NO_KEY), status(env(), URL_GOOD)]).toEqual([503, 503])
  })

  it('says why it refused, so an unconfigured worker is not mistaken for a broken one', async () => {
    const res = keyGate(new Request(URL_NO_KEY), env())!
    expect(await res.text()).toBe('manual endpoints are not configured (MANUAL_CHECK_KEY unset)\n')
  })

  it('admits the matching key and rejects the rest', () => {
    const e = env('s3cret')
    expect([status(e, URL_GOOD), status(e, URL_BAD), status(e, URL_NO_KEY)])
      .toEqual(['allowed', 403, 403])
  })
})
