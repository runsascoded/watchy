import { describe, expect, it } from 'vitest'
import { buildWeeklyOp, week, weekBounds, weekLabel, weekStartOf } from '../src/weekly'

// The boundary is 23:00 Sunday *Pacific*, so the instant it lands on moves with DST and
// every one of these would be off by 6-8h under the old midnight-UTC scheme.
describe('weekStartOf', () => {
  it('maps any ts to its week key', () => {
    expect(weekStartOf('2026-08-10T12:00:00Z')).toBe('2026-08-10') // Monday midday UTC
    expect(weekStartOf('2026-08-11T14:00:00Z')).toBe('2026-08-10') // Tuesday
    expect(weekStartOf('2026-08-16T23:59:59Z')).toBe('2026-08-10') // Sunday 4:59pm PDT
  })
  it('turns the week over at 23:00 Pacific Sunday, not midnight UTC', () => {
    expect(weekStartOf('2026-08-17T05:59:59Z')).toBe('2026-08-10') // Sun 10:59pm PDT
    expect(weekStartOf('2026-08-17T06:00:00Z')).toBe('2026-08-17') // Sun 11:00pm PDT
    // Monday 00:00-06:00 UTC is still Sunday evening in PT — the old scheme's worst case
    expect(weekStartOf('2026-08-17T00:00:00Z')).toBe('2026-08-10') // Sun 5pm PDT
  })
  it('tracks DST rather than a fixed offset', () => {
    // PST (UTC-8): 23:00 local is 07:00Z; PDT (UTC-7): 06:00Z
    expect(weekBounds('2026-08-17')).toEqual({ start: '2026-08-17T06:00:00.000Z', end: '2026-08-24T06:00:00.000Z' })
    expect(weekBounds('2026-12-14')).toEqual({ start: '2026-12-14T07:00:00.000Z', end: '2026-12-21T07:00:00.000Z' })
    // Fall-back is 02:00 Sun Nov 1, so that night's 23:00 boundary is already PST
    expect(weekBounds('2026-11-02')).toEqual({ start: '2026-11-02T07:00:00.000Z', end: '2026-11-09T07:00:00.000Z' })
    // ...while the Sunday before it is still PDT: the two ends of that week differ
    expect(weekBounds('2026-10-26')).toEqual({ start: '2026-10-26T06:00:00.000Z', end: '2026-11-02T07:00:00.000Z' })
  })
  it('labels without the year', () => {
    expect(weekLabel('2026-08-10')).toBe('Week of 8/10')
  })
})

describe('buildWeeklyOp', () => {
  const ev = (id: number, ts: string, kind: string, target: string, login: string) => ({ id, ts, kind, target, login })
  const data = {
    events: [
      ev(1, '2026-08-10T09:00:00Z', 'star', 'marin-community/marin', 'MzeroMiko'),
      ev(2, '2026-08-10T15:00:00Z', 'follow', 'marin-community', 'mobinasalavati'),
      ev(3, '2026-08-11T07:00:00Z', 'star', 'Open-Athena/marin-dna', 'TaoDFang'),
    ],
    counts: [
      { target: 'marin-community', ts: '2026-08-09T00:00:00Z', count: 128 },
      { target: 'marin-community', ts: '2026-08-10T15:00:00Z', count: 129 },
      { target: 'marin-community/marin', ts: '2026-08-09T00:00:00Z', count: 1248 },
      { target: 'marin-community/marin', ts: '2026-08-10T09:00:00Z', count: 1249 },
      { target: 'Open-Athena/marin-dna', ts: '2026-08-11T07:00:00Z', count: 19 },
    ],
    actors: [
      {
        login: 'MzeroMiko', followers: 173, star_sum: 3663, company: 'UCAS', location: 'Beijing, China',
        top_repos: '[{"n":"MzeroMiko/VMamba","s":3217}]',
      },
      { login: 'mobinasalavati', followers: 0, star_sum: 0, company: null, location: null, top_repos: null },
      { login: 'TaoDFang', followers: 20, star_sum: 10, company: null, location: null, top_repos: null },
    ],
    replyLink: (login: string) => (login === 'MzeroMiko' ? 'https://openathena.slack.com/archives/C1/p123?thread_ts=100&cid=C1' : null),
  }

  it('groups org-first with repo bullets, flat lines for orgs without org-level activity, then Notable', () => {
    const { blocks, text } = buildWeeklyOp(week('2026-08-10'), data, {
      dashboardUrl: 'https://watchy.oa.dev',
      orgEmoji: { 'marin-community': 'marin-community', 'Open-Athena': 'open-athena' },
    })
    expect(text.split('\n')).toEqual([
      'marin-community 128 → 129',
      '• marin 1248 → 1249',
      'marin-dna 19 → 19', // no pre-week snapshot: first row stands in as baseline
      'Notable: MzeroMiko',
    ])
    const els = (blocks[0] as any).elements
    expect(els.map((e: any) => e.type)).toEqual([
      'rich_text_section', // marin-community org line
      'rich_text_list',    // its repos
      'rich_text_section', // marin-dna flat
      'rich_text_section', // "Notable:"
      'rich_text_list',    // notable bullets
    ])
    // org header: emoji + org link + delta with 🔔 inside the dashboard link
    expect(els[0].elements).toEqual([
      { type: 'emoji', name: 'marin-community' },
      { type: 'text', text: ' ' },
      { type: 'link', url: 'https://github.com/marin-community', text: 'marin-community' },
      { type: 'text', text: ' · 128 → ' },
      { type: 'link', url: 'https://watchy.oa.dev/?t=marin-community', text: '129 🔔' },
    ])
    // notable bullet: login, followers, affil (acronym keeps city), top repo, ↳ permalink
    expect(els[4].elements[0].elements).toEqual([
      { type: 'link', url: 'https://github.com/MzeroMiko', text: 'MzeroMiko' },
      { type: 'text', text: ' — 173 followers' },
      { type: 'text', text: ' · ' },
      { type: 'link', url: 'https://www.linkedin.com/search/results/companies/?keywords=UCAS', text: 'UCAS (Beijing)' },
      { type: 'text', text: ' · ' },
      { type: 'link', url: 'https://github.com/MzeroMiko/VMamba', text: 'VMamba 3,217 ⭐' },
      { type: 'text', text: ' · ' },
      { type: 'link', url: 'https://openathena.slack.com/archives/C1/p123?thread_ts=100&cid=C1', text: '↳' },
    ])
  })

  it('appends a closed footer with the range, net movement, and dashboard links', () => {
    const withChurn = { ...data, events: [...data.events, ev(4, '2026-08-12T07:00:00Z', 'unstar', 'marin-community/marin', 'quitter')] }
    const { blocks, text } = buildWeeklyOp(week('2026-08-10'), withChurn, {
      dashboardUrl: 'https://gh.oa.dev',
      closed: true,
      weekEnd: '2026-08-17',
    })
    expect(text.split('\n').at(-1)).toBe('Closed · 2026-08-10 → 2026-08-17 · +2 (−1) ⭐ · +1 🔔')
    expect((blocks[0] as any).elements.at(-1).elements).toEqual([
      { type: 'text', text: 'Closed · 2026-08-10 → 2026-08-17 · +2 (−1) ⭐ · +1 🔔' },
      { type: 'text', text: ' · ' },
      { type: 'link', url: 'https://gh.oa.dev', text: 'dashboard' },
      { type: 'text', text: ' · ' },
      { type: 'link', url: 'https://gh.oa.dev/actors', text: 'actors' },
    ])
  })

  it('omits the closed footer while the week is live', () => {
    const { text } = buildWeeklyOp(week('2026-08-10'), data, { dashboardUrl: 'https://gh.oa.dev' })
    expect(text.split('\n').at(-1)).toBe('Notable: MzeroMiko')
  })

  it('drops the city for self-locating institutions', () => {
    const d2 = {
      ...data,
      actors: [{ login: 'drdh', followers: 66, star_sum: 66, company: 'IIIS, Tsinghua University', location: 'Beijing, China', top_repos: null }],
      events: [ev(1, '2026-08-10T09:00:00Z', 'star', 'marin-community/marin', 'drdh')],
      replyLink: () => null,
    }
    const { blocks } = buildWeeklyOp(week('2026-08-10'), d2, {})
    const bullets = (blocks[0] as any).elements.at(-1).elements
    expect(bullets[0].elements).toEqual([
      { type: 'link', url: 'https://github.com/drdh', text: 'drdh' },
      { type: 'text', text: ' — 66 followers' },
      { type: 'text', text: ' · ' },
      { type: 'link', url: 'https://www.linkedin.com/search/results/companies/?keywords=Tsinghua%20University', text: 'Tsinghua University' },
    ])
  })
})
