import type { Env } from './collect'
import { chunkedAll } from './d1'
import { companyKeywords } from './slack'

// Weekly thread OPs (specs/actor-intel.md v9): one "Week of M/D" OP per ISO week;
// event msgs are replies under it, and this scoreboard is chat.update'd per batch.

const NOTABLE_MIN_FOLLOWERS = 50
const NOTABLE_MIN_STAR_SUM = 500
const TOP_REPO_MIN = 200
const NOTABLE_CAP = 6

// Weeks turn over at 23:00 Sunday Pacific, not midnight UTC. Midnight UTC is 8pm ET /
// 5pm PT Sunday — mid-evening, when the channel is still being read and the day's stars
// are still landing, so a week's worth of activity got split across two threads and the
// close-out posted into prime time. 23:00 PT is 2am ET: quiet on both coasts.
//
// DST-aware by design (07:00 UTC in PDT, 06:00 in PST) — a fixed UTC offset would drift
// an hour twice a year, and "the week turns over at 11pm" is the thing to keep true.
const WEEK_TZ = 'America/Los_Angeles'
/** Minutes the boundary sits *before* local midnight. */
const WEEK_SHIFT_MIN = 60

const TZ_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: WEEK_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** An instant's WEEK_TZ wall clock, as a Date whose *UTC* fields read as the local ones. */
function wallClock(ts: string | Date): Date {
  const p: Record<string, string> = {}
  for (const { type, value } of TZ_PARTS.formatToParts(new Date(ts))) p[type] = value
  // en-CA renders local midnight as hour 24 in some ICU builds
  const hour = p.hour === '24' ? '00' : p.hour
  return new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}Z`)
}

/** The instant at which `local` ("YYYY-MM-DDTHH:mm:ss", WEEK_TZ) occurs. */
function instantOf(local: string): string {
  // Read the zone's offset *at* the guessed instant, then correct. Only ambiguous inside
  // the repeated hour of a fall-back, which 23:00 PT is not (the repeat is 01:00–02:00).
  const guess = new Date(`${local}Z`)
  const offset = guess.getTime() - wallClock(guess).getTime()
  return new Date(guess.getTime() + offset).toISOString()
}

/** Week key (the Monday whose week `ts` falls in) as an ISO date. */
export function weekStartOf(ts: string): string {
  const d = wallClock(ts)
  d.setUTCMinutes(d.getUTCMinutes() + WEEK_SHIFT_MIN) // 23:00 Sun → 00:00 Mon
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** ISO date `n` days after `date`, both plain dates. */
export function addDays(date: string, n: number): string {
  return new Date(new Date(date).getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

/** The half-open instant range `[start, end)` a week key covers — what SQL must compare
 * `events.ts` against. Not `${weekStart}T00:00:00Z`: the boundary is a wall-clock time in
 * another zone, so it lands 7 or 8 hours later depending on the season. */
export function weekBounds(weekStart: string): { start: string; end: string } {
  const boundary = (monday: string) => instantOf(`${addDays(monday, -1)}T23:00:00`)
  return { start: boundary(weekStart), end: boundary(addDays(weekStart, 7)) }
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
  li_company_url?: string | null
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
  /** Week is over: append the closed footer (specs/weekly-rollup.md) */
  closed?: boolean
}

/** A week, in both forms the scoreboard needs: the `YYYY-MM-DD` key it's labelled and
 * stored by, and the instants it actually spans (23:00 PT Sunday → 23:00 PT Sunday). */
export interface Week {
  key: string
  start: string
  end: string
}

/** Both forms of a week, from its key. */
export function week(key: string): Week {
  return { key, ...weekBounds(key) }
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
    const url = a.li_company_url ?? `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(co)}`
    // A curated company URL implies the org is unambiguous — no "(city)" needed
    // (nor for self-locating institutions, or when the city is already in the name)
    const text = city && !a.li_company_url && !SELF_LOCATING.test(co) && !co.toLowerCase().includes(city.toLowerCase()) ? `${co} (${city})` : co
    return { text, url }
  }
  return city ? { text: city, url: null } : null
}

/** Pure scoreboard builder: org-grouped deltas (org header + repo bullets when the
 * org itself saw follows; flat lines otherwise) + Notable actor bullets. */
export function buildWeeklyOp(wk: Week, data: WeeklyData, opts: WeeklyOpts = {}): { blocks: unknown[]; text: string } {
  const { dashboardUrl, orgEmoji = {}, closed } = opts
  const base = new Map<string, number>()
  const cur = new Map<string, number>()
  for (const r of data.counts) {
    if (r.ts < wk.start || !base.has(r.target)) base.set(r.target, r.count)
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

  // Closed footer: the range + net movement + dashboard links — everything the
  // standalone summary carried that `before → after` alone can't say
  if (closed) {
    const net = { '⭐': [0, 0], '🔔': [0, 0] } as Record<string, [number, number]>
    for (const e of data.events) {
      const unit = e.kind === 'star' || e.kind === 'unstar' ? '⭐' : '🔔'
      net[unit][e.kind === 'star' || e.kind === 'follow' ? 0 : 1] += 1
    }
    const parts = Object.entries(net)
      .filter(([, [p, m]]) => p || m)
      .map(([unit, [p, m]]) => `+${p}${m ? ` (−${m})` : ''} ${unit}`)
    const head = `Closed · ${wk.key} → ${addDays(wk.key, 7)}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
    const footer: unknown[] = [txt(head)]
    if (dashboardUrl) {
      footer.push(txt(' · '), lnk(dashboardUrl, 'dashboard'), txt(' · '), lnk(`${dashboardUrl}/actors`, 'actors'))
    }
    elements.push(sect(...footer))
    lines.push(head)
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

/** The weekly OP's ts for `weekStart`, or null if no event ever opened one. */
export async function getWeeklyThread(env: Env, weekStart: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT ts FROM weekly_threads WHERE week_start = ?').bind(weekStart).first<{ ts: string }>()
  return row?.ts ?? null
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
export async function updateWeeklyOp(env: Env, weekStart: string, opTs: string, opts: { closed?: boolean } = {}): Promise<void> {
  // The week's *instants*, not `${weekStart}T00:00:00Z` — the boundary is 23:00 Pacific
  const wk = week(weekStart)
  const { start, end } = wk
  const { results: events } = await env.DB
    .prepare(
      `SELECT e.id, e.ts, e.kind, e.target, e.login FROM events e
       JOIN slack_posts sp ON sp.event_id = e.id
       WHERE e.ts >= ? AND e.ts < ? ORDER BY e.ts, e.id`,
    )
    .bind(start, end)
    .all<WeekEvent>()
  if (!events.length) return
  const targets = [...new Set(events.map(e => e.target))]
  const logins = [...new Set(events.map(e => e.login))]
  // Both lists are unbounded in the number of actors/targets a week sees, so both must
  // chunk — `logins` crossing 100 is what froze the 8/17 and 8/24 scoreboards (see d1.ts).
  // `ts < end` also keeps a *closed* week's totals at what they were when it closed,
  // rather than drifting to today's count on any later rebuild.
  const counts = (await chunkedAll<{ target: string; ts: string; count: number }>(
    env.DB,
    targets,
    ph => `SELECT target, ts, count FROM counts WHERE ts < ? AND target IN (${ph}) ORDER BY target, ts`,
    [end],
  )).sort((a, b) => a.target.localeCompare(b.target) || a.ts.localeCompare(b.ts))
  const actors = await chunkedAll<WeekActor>(
    env.DB,
    logins,
    ph => `SELECT login, followers, star_sum, top_repos, company, location, li_company_url FROM actors WHERE login IN (${ph})`,
  )
  const { results: replyRows } = await env.DB
    .prepare(
      `SELECT e.login, MIN(sp.ts) ts FROM slack_posts sp JOIN events e ON e.id = sp.event_id
       WHERE e.ts >= ? AND e.ts < ? GROUP BY e.login`,
    )
    .bind(start, end)
    .all<{ login: string; ts: string }>()
  const replyTs = new Map(replyRows.map(r => [r.login, r.ts]))
  const replyLink = (login: string): string | null => {
    const ts = replyTs.get(login)
    if (!ts || !env.SLACK_WORKSPACE_URL) return null
    return `${env.SLACK_WORKSPACE_URL}/archives/${env.SLACK_CHANNEL_ID}/p${ts.replace('.', '')}?thread_ts=${opTs}&cid=${env.SLACK_CHANNEL_ID}`
  }
  const { blocks, text } = buildWeeklyOp(wk, { events, counts, actors, replyLink }, {
    dashboardUrl: env.DASHBOARD_URL,
    orgEmoji: env.SLACK_ORG_EMOJI,
    closed: opts.closed,
  })
  await slackApi(env, 'chat.update', { channel: env.SLACK_CHANNEL_ID, ts: opTs, blocks, text })
}

/** Stamp the week's OP as closed. Returns its ts, or null if the week never opened
 * a thread (a quiet week — the caller then posts a standalone summary). */
export async function finalizeWeeklyOp(env: Env, weekStart: string): Promise<string | null> {
  const opTs = await getWeeklyThread(env, weekStart)
  if (!opTs) return null
  await updateWeeklyOp(env, weekStart, opTs, { closed: true })
  return opTs
}
