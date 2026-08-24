import type { Env } from './collect'
import { finalizeWeeklyOp, weekLabel, weekStartOf } from './weekly'

export interface TargetDelta {
  target: string
  kind: 'stars' | 'follows'
  plus: number
  minus: number
  total: number
}

export interface Notable {
  login: string
  name: string | null
  followers: number
  company: string | null
}

export interface WeekStats {
  weekStart: string // ISO date, window [weekStart, weekStart+7d)
  weekEnd: string
  deltas: TargetDelta[]
  notables: Notable[]
  nEvents: number
  /** Events in the preceding 7d window — the rollup's week-over-week anchor */
  prevEvents: number
}

const fmt = (n: number) => n.toLocaleString('en-US')

/** Pure mrkdwn composer — mirrors the channel's shortcode conventions. */
export function renderSummary(s: WeekStats, dashboardUrl?: string): string {
  const lines = [`:calendar: *Weekly watch summary* · ${s.weekStart} → ${s.weekEnd}`]
  if (!s.nEvents) {
    lines.push('_Quiet week — no new activity on watched targets._')
    return lines.join('\n')
  }
  for (const d of s.deltas) {
    const unit = d.kind === 'stars' ? ':star:' : ':bell:'
    const minus = d.minus ? ` (−${d.minus})` : ''
    lines.push(`${unit} <https://github.com/${d.target}|${d.target}>: +${d.plus}${minus} → *${fmt(d.total)}*`)
  }
  if (s.notables.length) {
    const who = s.notables.map(n => {
      const label = n.name ? `${n.name} (${n.login})` : n.login
      const co = n.company ? `, ${n.company}` : ''
      return `<https://github.com/${n.login}|${label}> · ${fmt(n.followers)} followers${co}`
    })
    lines.push(`:telescope: Notable new actors: ${who.join('; ')}`)
  }
  if (dashboardUrl) {
    lines.push(`:bar_chart: <${dashboardUrl}|dashboard> · <${dashboardUrl}/actors|actors>`)
  }
  return lines.join('\n')
}

/** Compact broadcast reply closing a week's live thread (specs/weekly-rollup.md).
 * Deliberately *not* a restatement of the OP: headline movement, a week-over-week
 * anchor, and bare notable logins — detail stays one screen up in the thread. */
export function renderRollup(s: WeekStats, dashboardUrl?: string): string {
  const lines = [`:calendar: *${weekLabel(s.weekStart)}* closed · ${s.weekStart} → ${s.weekEnd}`]
  const net = { stars: [0, 0], follows: [0, 0] } as Record<TargetDelta['kind'], [number, number]>
  for (const d of s.deltas) {
    net[d.kind][0] += d.plus
    net[d.kind][1] += d.minus
  }
  const moved = ([kind, [plus, minus]]: [string, [number, number]]) =>
    `+${plus}${minus ? ` (−${minus})` : ''} ${kind === 'stars' ? ':star:' : ':bell:'}`
  const parts = Object.entries(net).filter(([, [p, m]]) => p || m).map(moved)
  const targets = `${s.deltas.length} target${s.deltas.length === 1 ? '' : 's'}`
  lines.push(`${parts.join(' · ')} · ${targets} · ${s.nEvents} events (prev week ${s.prevEvents})`)
  if (s.notables.length) {
    lines.push(`:telescope: ${s.notables.slice(0, 3).map(n => `<https://github.com/${n.login}|${n.login}>`).join(' · ')}`)
  }
  if (dashboardUrl) {
    lines.push(`:bar_chart: <${dashboardUrl}|dashboard> · <${dashboardUrl}/actors|actors>`)
  }
  return lines.join('\n')
}

/** Aggregate the most recently *completed* ISO week for SLACK_MATCHES targets.
 * Window is `[Monday, next Monday)` — the same key `weekly_threads` uses, so the
 * rollup can find its live thread. Deriving the week from the clock (rather than
 * from "7 days back from now") makes the job day-agnostic: it runs daily and
 * short-circuits on the `summaries` dup-check until a new week has closed. */
export async function buildWeekStats(env: Env, now = new Date()): Promise<WeekStats> {
  const end = weekStartOf(now.toISOString())
  const start = new Date(new Date(end).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const matches = env.SLACK_MATCHES ?? []
  const where = matches.map(() => '(e.target = ? OR e.target LIKE ?)').join(' OR ')
  const binds = matches.flatMap(m => [m, `${m}/%`])

  const prevStart = new Date(new Date(start).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)

  const [deltaRows, notableRows, prevRow] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.target, e.kind, COUNT(*) n FROM events e
       WHERE e.ts >= ? AND e.ts < ? AND (${where})
       GROUP BY e.target, e.kind`,
    ).bind(`${start}T00:00:00Z`, `${end}T00:00:00Z`, ...binds),
    // Insiders (OA / marin-community members) starring our own repos aren't notable —
    // exclude by org membership and company string ("@Open-Athena" / "Open Athena").
    env.DB.prepare(
      `SELECT a.login, a.name, a.followers, a.company FROM actors a
       WHERE a.followers >= 100
       AND (a.orgs IS NULL OR (a.orgs NOT LIKE '%"Open-Athena"%' AND a.orgs NOT LIKE '%"marin-community"%'))
       AND (a.company IS NULL OR a.company NOT LIKE '%open%athena%')
       AND EXISTS (
         SELECT 1 FROM events e WHERE e.login = a.login
         AND e.kind IN ('star', 'follow') AND e.ts >= ? AND e.ts < ? AND (${where}))
       ORDER BY a.followers DESC LIMIT 5`,
    ).bind(`${start}T00:00:00Z`, `${end}T00:00:00Z`, ...binds),
    env.DB.prepare(
      `SELECT COUNT(*) n FROM events e WHERE e.ts >= ? AND e.ts < ? AND (${where})`,
    ).bind(`${prevStart}T00:00:00Z`, `${start}T00:00:00Z`, ...binds),
  ])

  const byTarget = new Map<string, TargetDelta>()
  let nEvents = 0
  for (const r of deltaRows.results as { target: string; kind: string; n: number }[]) {
    nEvents += r.n
    const kind = r.kind === 'star' || r.kind === 'unstar' ? 'stars' : 'follows'
    let d = byTarget.get(r.target)
    if (!d) byTarget.set(r.target, (d = { target: r.target, kind, plus: 0, minus: 0, total: 0 }))
    if (r.kind === 'star' || r.kind === 'follow') d.plus += r.n
    else d.minus += r.n
  }
  for (const d of byTarget.values()) {
    const cur = d.kind === 'stars'
      ? await env.DB.prepare('SELECT COUNT(*) n FROM stars WHERE repo = ?').bind(d.target).first<{ n: number }>()
      : await env.DB.prepare('SELECT COUNT(*) n FROM follows WHERE target = ?').bind(d.target).first<{ n: number }>()
    d.total = cur?.n ?? 0
  }
  const deltas = [...byTarget.values()].sort((a, b) => b.plus - a.plus)
  const prevEvents = (prevRow.results[0] as { n: number } | undefined)?.n ?? 0
  return { weekStart: start, weekEnd: end, deltas, notables: notableRows.results as Notable[], nEvents, prevEvents }
}

/** Close out the week: stamp its live thread as closed and post the rollup as a
 * broadcast reply under it; fall back to a standalone post when the week never
 * opened a thread (specs/weekly-rollup.md). Idempotent per week. */
export async function weeklySummary(env: Env, now = new Date()): Promise<string | null> {
  // Dup-check *before* aggregating: this runs every tick (runCollection calls it ahead
  // of syncSlack, so the close-out lands above the new week's OP rather than at the next
  // cron hours later), and the common case must cost one indexed lookup, not a week's
  // worth of GROUP BYs.
  const weekEnd = weekStartOf(now.toISOString())
  const weekStart = new Date(new Date(weekEnd).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const dup = await env.DB.prepare('SELECT id FROM summaries WHERE week_start = ?').bind(weekStart).first()
  if (dup) return null
  const stats = await buildWeekStats(env, now)
  const slack = env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID
  // A finalize failure must not cost us the rollup — fall back to standalone
  const opTs = slack
    ? await finalizeWeeklyOp(env, stats.weekStart).catch(e => {
      console.error('finalizeWeeklyOp failed:', e)
      return null
    })
    : null
  const text = opTs ? renderRollup(stats, env.DASHBOARD_URL) : renderSummary(stats, env.DASHBOARD_URL)
  let slackTs: string | null = null
  if (slack) {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        text,
        ...(opTs ? { thread_ts: opTs, reply_broadcast: true } : {}),
        unfurl_links: false,
        unfurl_media: false,
      }),
    })
    const body = await resp.json<{ ok: boolean; ts?: string; error?: string }>()
    if (body.ok) slackTs = body.ts ?? null
    else console.error(`weekly summary post failed: ${body.error}`)
  }
  await env.DB
    .prepare('INSERT INTO summaries (week_start, created_at, text, stats, slack_ts) VALUES (?, ?, ?, ?, ?)')
    .bind(stats.weekStart, new Date().toISOString(), text, JSON.stringify(stats), slackTs)
    .run()
  return text
}
