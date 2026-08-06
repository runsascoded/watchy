import { describe, expect, it } from 'vitest'
import { renderSummary, type WeekStats } from '../src/summary'

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
}

describe('renderSummary', () => {
  it('renders deltas, totals, and notables as mrkdwn shortcode lines', () => {
    expect(renderSummary(BASE).split('\n')).toEqual([
      ':calendar: *Weekly watch summary* · 2026-07-30 → 2026-08-06',
      ':star: <https://github.com/marin-community/marin|marin-community/marin>: +12 (−2) → *1,237*',
      ':mega: <https://github.com/marin-community|marin-community>: +4 → *126*',
      ':telescope: Notable new actors: <https://github.com/norvig|Peter Norvig (norvig)> · 9,784 followers, Stanford; <https://github.com/XILDLX|XILDLX> · 140 followers',
    ])
  })

  it('renders a quiet week', () => {
    expect(renderSummary({ ...BASE, deltas: [], notables: [], nEvents: 0 }).split('\n')).toEqual([
      ':calendar: *Weekly watch summary* · 2026-07-30 → 2026-08-06',
      '_Quiet week — no new activity on watched targets._',
    ])
  })
})
