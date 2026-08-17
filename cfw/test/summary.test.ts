import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRollup, renderSummary, weeklySummary, type WeekStats } from '../src/summary'
import type { Env } from '../src/collect'

const BASE: WeekStats = {
  weekStart: '2026-07-30',
  weekEnd: '2026-08-06',
  deltas: [
    { target: 'marin-community/marin', kind: 'stars', plus: 12, minus: 2, total: 1237 },
    { target: 'marin-community', kind: 'follows', plus: 4, minus: 0, total: 126 },
  ],
  notables: [
    { login: 'norvig', name: 'Peter Norvig', followers: 9784, company: 'Stanford' },
    { login: 'XILDLX', name: null, followers: 140, company: null },
  ],
  nEvents: 18,
  prevEvents: 13,
}

describe('renderSummary', () => {
  it('renders deltas, totals, and notables as mrkdwn shortcode lines', () => {
    expect(renderSummary(BASE).split('\n')).toEqual([
      ':calendar: *Weekly watch summary* · 2026-07-30 → 2026-08-06',
      ':star: <https://github.com/marin-community/marin|marin-community/marin>: +12 (−2) → *1,237*',
      ':bell: <https://github.com/marin-community|marin-community>: +4 → *126*',
      ':telescope: Notable new actors: <https://github.com/norvig|Peter Norvig (norvig)> · 9,784 followers, Stanford; <https://github.com/XILDLX|XILDLX> · 140 followers',
    ])
  })

  it('appends a dashboard footer when DASHBOARD_URL is configured', () => {
    expect(renderSummary(BASE, 'https://watchy.oa.dev').split('\n').slice(-1)).toEqual([
      ':bar_chart: <https://watchy.oa.dev|dashboard> · <https://watchy.oa.dev/actors|actors>',
    ])
  })

  it('renders a quiet week', () => {
    expect(renderSummary({ ...BASE, deltas: [], notables: [], nEvents: 0 }).split('\n')).toEqual([
      ':calendar: *Weekly watch summary* · 2026-07-30 → 2026-08-06',
      '_Quiet week — no new activity on watched targets._',
    ])
  })
})

describe('renderRollup', () => {
  it('leads with net movement and a week-over-week anchor; notables are bare logins', () => {
    expect(renderRollup(BASE, 'https://gh.oa.dev').split('\n')).toEqual([
      ':calendar: *Week of 7/30* closed · 2026-07-30 → 2026-08-06',
      '+12 (−2) :star: · +4 :bell: · 2 targets · 18 events (prev week 13)',
      ':telescope: <https://github.com/norvig|norvig> · <https://github.com/XILDLX|XILDLX>',
      ':bar_chart: <https://gh.oa.dev|dashboard> · <https://gh.oa.dev/actors|actors>',
    ])
  })

  it('caps notables at 3 and omits the dashboard footer when unconfigured', () => {
    const notables = ['a', 'b', 'c', 'd'].map(login => ({ login, name: null, followers: 100, company: null }))
    expect(renderRollup({ ...BASE, notables }).split('\n')).toEqual([
      ':calendar: *Week of 7/30* closed · 2026-07-30 → 2026-08-06',
      '+12 (−2) :star: · +4 :bell: · 2 targets · 18 events (prev week 13)',
      ':telescope: <https://github.com/a|a> · <https://github.com/b|b> · <https://github.com/c|c>',
    ])
  })

  it('drops the kind and singularizes when only one target moved', () => {
    expect(renderRollup({ ...BASE, deltas: [BASE.deltas[1]], notables: [], nEvents: 4, prevEvents: 0 }).split('\n')).toEqual([
      ':calendar: *Week of 7/30* closed · 2026-07-30 → 2026-08-06',
      '+4 :bell: · 1 target · 4 events (prev week 0)',
    ])
  })
})

/** Minimal D1 double: dispatches on distinctive SQL fragments. `thread` decides
 * whether the closing week ever opened a live thread. */
function fakeEnv(thread: string | null): { env: Env; posts: Record<string, any>[] } {
  const posts: Record<string, any>[] = []
  const prepare = (sql: string) => {
    const self: any = {
      bind: () => self,
      first: async () => {
        if (sql.includes('FROM summaries')) return null // never a dup, in these tests
        if (sql.includes('FROM weekly_threads')) return thread ? { ts: thread } : null
        if (sql.includes('FROM stars') || sql.includes('FROM follows')) return { n: 1264 }
        return null
      },
      all: async () => ({ results: [] }), // no slack_posts rows → updateWeeklyOp no-ops
      run: async () => ({}),
    }
    return self
  }
  const env = {
    DB: {
      prepare,
      batch: async () => [
        { results: [{ target: 'marin-community/marin', kind: 'star', n: 18 }] },
        { results: [] },
        { results: [{ n: 13 }] },
      ],
    },
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_ID: 'C1',
    SLACK_MATCHES: ['marin-community'],
    DASHBOARD_URL: 'https://gh.oa.dev',
  } as unknown as Env
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    posts.push(JSON.parse(init.body as string))
    return new Response(JSON.stringify({ ok: true, ts: '999.1' }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { env, posts }
}

describe('weeklySummary routing', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-16T14:00:00Z')) // the Monday cron, closing 8/9–8/16
  })
  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
  })

  it('posts the rollup as a broadcast reply under the closing week thread', async () => {
    const { env, posts } = fakeEnv('111.1')
    await weeklySummary(env)
    const [{ text, ...rest }] = posts
    expect(rest).toEqual({
      channel: 'C1',
      thread_ts: '111.1',
      reply_broadcast: true,
      unfurl_links: false,
      unfurl_media: false,
    })
    expect(text.split('\n')).toEqual([
      ':calendar: *Week of 8/9* closed · 2026-08-09 → 2026-08-16',
      '+18 :star: · 1 target · 18 events (prev week 13)',
      ':bar_chart: <https://gh.oa.dev|dashboard> · <https://gh.oa.dev/actors|actors>',
    ])
  })

  it('falls back to a standalone summary when the week never opened a thread', async () => {
    const { env, posts } = fakeEnv(null)
    await weeklySummary(env)
    const [{ text, ...rest }] = posts
    expect(rest).toEqual({ channel: 'C1', unfurl_links: false, unfurl_media: false })
    expect(text.split('\n')[0]).toBe(':calendar: *Weekly watch summary* · 2026-08-09 → 2026-08-16')
  })
})
