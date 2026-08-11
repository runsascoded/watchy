import type { Env } from './collect'
import { companyKeywords } from './slack'

// Weekly thread OPs (specs/actor-intel.md v9): one "Week of M/D" OP per ISO week;
// event msgs are replies under it, and this scoreboard is chat.update'd per batch.

const NOTABLE_MIN_FOLLOWERS = 50
const NOTABLE_MIN_STAR_SUM = 500
const TOP_REPO_MIN = 200
const NOTABLE_CAP = 6

/** Monday (UTC) of the week containing `ts`, as an ISO date. */
export function weekStartOf(ts: string): string {
  const d = new Date(ts)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function weekLabel(weekStart: string): string {
  return `Week of ${parseInt(weekStart.slice(5, 7), 10)}/${parseInt(weekStart.slice(8, 10), 10)}`
}

interface WeekEvent {
  id: number
  ts: string
  kind: string
  target: string
  login: string
}

interface WeekActor {
  login: string
  followers: number | null
  star_sum: number | null
  top_repos: string | null
  company: string | null
  location: string | null
}

export interface WeeklyData {
  events: WeekEvent[]
  counts: Array<{ target: string; ts: string; count: number }>
  actors: WeekActor[]
  replyLink: (login: string) => string | null
}

export interface WeeklyOpts {
  dashboardUrl?: string
  orgEmoji?: Record<string, string>
}

const txt = (text: string) => ({ type: 'text', text })
const lnk = (url: string, text: string) => ({ type: 'link', url, text })
const emo = (name: string) => ({ type: 'emoji', name })
const sect = (...elements: unknown[]) => ({ type: 'rich_text_section', elements })
const fmt = (n: number) => n.toLocaleString('en-US')

const SELF_LOCATING = /\b(University|Université|Universität|Institute|College|Polytechnic)\b/i

/** Abbreviated affiliation: cleaned company (LI-company-search-linked) + (city);
 * city dropped for self-locating institutions ("Tsinghua University" needs no Beijing). */
function affil(a: WeekActor): { text: string; url: string | null } | null {
  let co = a.company?.trim() || null
  if (co?.startsWith('@')) co = null
  else if (co) co = companyKeywords(co) || null
  const city = a.location?.split(',')[0].trim() || null
  if (co) {
    const url = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(co)}`
    const text = city && !SELF_LOCATING.test(co) && !co.toLowerCase().includes(city.toLowerCase()) ? `${co} (${city})` : co
    return { text, url }
  }
  return city ? { text: city, url: null } : null
}

/** Pure scoreboard builder: org-grouped deltas (org header + repo bullets when the
 * org itself saw follows; flat lines otherwise) + Notable actor bullets. */
export function buildWeeklyOp(weekStart: string, data: WeeklyData, opts: WeeklyOpts = {}): { blocks: unknown[]; text: string } {
  const { dashboardUrl, orgEmoji = {} } = opts
  const base = new Map<string, number>()
  const cur = new Map<string, number>()
  for (const r of data.counts) {
    if (r.ts < weekStart || !base.has(r.target)) base.set(r.target, r.count)
    cur.set(r.target, r.count)
  }
  const nEvents = new Map<string, number>()
  const orgs = new Map<string, { orgLevel: boolean; repos: Set<string> }>()
  for (const e of data.events) {
    nEvents.set(e.target, (nEvents.get(e.target) ?? 0) + 1)
    const org = e.target.split('/')[0]
    let o = orgs.get(org)
    if (!o) orgs.set(org, (o = { orgLevel: false, repos: new Set() }))
    if (e.target.includes('/')) o.repos.add(e.target)
    else o.orgLevel = true
  }

  const deltaEls = (target: string, unit: string): unknown[] => {
    const short = target.split('/').pop()!
    const b = base.get(target)
    const total = `${fmt(cur.get(target) ?? 0)} ${unit}`
    return [
      lnk(`https://github.com/${target}`, short),
      txt(b != null ? ` · ${fmt(b)} → ` : ' · '),
      dashboardUrl ? lnk(`${dashboardUrl}/?t=${encodeURIComponent(target)}`, total) : txt(total),
    ]
  }

  const elements: unknown[] = []
  const lines: string[] = []
  const orgActivity = (org: string) => [org, ...orgs.get(org)!.repos].reduce((s, t) => s + (nEvents.get(t) ?? 0), 0)
  for (const org of [...orgs.keys()].sort((a, b) => orgActivity(b) - orgActivity(a))) {
    const o = orgs.get(org)!
    const repos = [...o.repos].sort((a, b) => (nEvents.get(b) ?? 0) - (nEvents.get(a) ?? 0))
    const oe: unknown[] = orgEmoji[org] ? [emo(orgEmoji[org]), txt(' ')] : []
    if (o.orgLevel) {
      elements.push(sect(...oe, ...deltaEls(org, '🔔')))
      lines.push(`${org} ${base.get(org) ?? '?'} → ${cur.get(org) ?? '?'}`)
      if (repos.length) {
        elements.push({ type: 'rich_text_list', style: 'bullet', indent: 0, elements: repos.map(t => sect(...deltaEls(t, '⭐'))) })
        lines.push(...repos.map(t => `• ${t.split('/').pop()} ${base.get(t) ?? '?'} → ${cur.get(t) ?? '?'}`))
      }
    } else {
      for (const t of repos) {
        elements.push(sect(...oe, ...deltaEls(t, '⭐')))
        lines.push(`${t.split('/').pop()} ${base.get(t) ?? '?'} → ${cur.get(t) ?? '?'}`)
      }
    }
  }

  const notable = data.actors
    .filter(a => (a.followers ?? 0) >= NOTABLE_MIN_FOLLOWERS || (a.star_sum ?? 0) >= NOTABLE_MIN_STAR_SUM)
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
    .slice(0, NOTABLE_CAP)
  if (notable.length) {
    elements.push(sect(txt('Notable:')))
    const items = notable.map(a => {
      const els: unknown[] = [lnk(`https://github.com/${a.login}`, a.login), txt(` — ${fmt(a.followers ?? 0)} followers`)]
      const af = affil(a)
      if (af) els.push(txt(' · '), af.url ? lnk(af.url, af.text) : txt(af.text))
      const tops: Array<{ n: string; s: number }> = a.top_repos ? JSON.parse(a.top_repos) : []
      if (tops.length && tops[0].s >= TOP_REPO_MIN) {
        const t = tops[0]
        els.push(txt(' · '), lnk(`https://github.com/${t.n}`, `${t.n.split('/').pop()} ${fmt(t.s)} ⭐`))
      } else if ((a.star_sum ?? 0) >= NOTABLE_MIN_STAR_SUM) {
        els.push(txt(` · ${fmt(a.star_sum!)} ⭐`))
      }
      const rl = data.replyLink(a.login)
      if (rl) els.push(txt(' · '), lnk(rl, '↳'))
      return sect(...els)
    })
    elements.push({ type: 'rich_text_list', style: 'bullet', indent: 0, elements: items })
    lines.push('Notable: ' + notable.map(a => a.login).join(' · '))
  }

  return { blocks: [{ type: 'rich_text', elements }], text: lines.join('\n') }
}

async function slackApi(env: Env, method: string, payload: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  })
  const body = await resp.json<{ ok: boolean; error?: string }>()
  if (!body.ok) throw new Error(`${method}: ${body.error}`)
  return body
}

/** Get (or create + record) the weekly OP for `weekStart`. */
export async function ensureWeeklyThread(env: Env, weekStart: string): Promise<string> {
  const row = await env.DB.prepare('SELECT ts FROM weekly_threads WHERE week_start = ?').bind(weekStart).first<{ ts: string }>()
  if (row) return row.ts
  const label = weekLabel(weekStart)
  const body = await slackApi(env, 'chat.postMessage', {
    channel: env.SLACK_CHANNEL_ID,
    text: label,
    username: label,
    icon_emoji: ':date:',
    metadata: { event_type: 'watchy_weekly', event_payload: { week_start: weekStart } },
    unfurl_links: false,
    unfurl_media: false,
  })
  await env.DB.prepare('INSERT INTO weekly_threads (week_start, ts) VALUES (?, ?)').bind(weekStart, body.ts).run()
  return body.ts
}

/** Rebuild + chat.update the weekly OP scoreboard from D1. */
export async function updateWeeklyOp(env: Env, weekStart: string, opTs: string): Promise<void> {
  const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)
  const { results: events } = await env.DB
    .prepare(
      `SELECT e.id, e.ts, e.kind, e.target, e.login FROM events e
       JOIN slack_posts sp ON sp.event_id = e.id
       WHERE e.ts >= ? AND e.ts < ? ORDER BY e.ts, e.id`,
    )
    .bind(weekStart, weekEnd)
    .all<WeekEvent>()
  if (!events.length) return
  const targets = [...new Set(events.map(e => e.target))]
  const logins = [...new Set(events.map(e => e.login))]
  const { results: counts } = await env.DB
    .prepare(`SELECT target, ts, count FROM counts WHERE target IN (${targets.map(() => '?').join(',')}) ORDER BY target, ts`)
    .bind(...targets)
    .all<{ target: string; ts: string; count: number }>()
  const { results: actors } = await env.DB
    .prepare(`SELECT login, followers, star_sum, top_repos, company, location FROM actors WHERE login IN (${logins.map(() => '?').join(',')})`)
    .bind(...logins)
    .all<WeekActor>()
  const { results: replyRows } = await env.DB
    .prepare(
      `SELECT e.login, MIN(sp.ts) ts FROM slack_posts sp JOIN events e ON e.id = sp.event_id
       WHERE e.ts >= ? AND e.ts < ? GROUP BY e.login`,
    )
    .bind(weekStart, weekEnd)
    .all<{ login: string; ts: string }>()
  const replyTs = new Map(replyRows.map(r => [r.login, r.ts]))
  const replyLink = (login: string): string | null => {
    const ts = replyTs.get(login)
    if (!ts || !env.SLACK_WORKSPACE_URL) return null
    return `${env.SLACK_WORKSPACE_URL}/archives/${env.SLACK_CHANNEL_ID}/p${ts.replace('.', '')}?thread_ts=${opTs}&cid=${env.SLACK_CHANNEL_ID}`
  }
  const { blocks, text } = buildWeeklyOp(weekStart, { events, counts, actors, replyLink }, {
    dashboardUrl: env.DASHBOARD_URL,
    orgEmoji: env.SLACK_ORG_EMOJI,
  })
  await slackApi(env, 'chat.update', { channel: env.SLACK_CHANNEL_ID, ts: opTs, blocks, text })
}
