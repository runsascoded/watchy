import type { Env } from './collect'

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
    const unit = d.kind === 'stars' ? ':star:' : ':mega:'
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

/** Aggregate the trailing 7-day window for SLACK_MATCHES targets. */
export async function buildWeekStats(env: Env, now = new Date()): Promise<WeekStats> {
  const end = now.toISOString().slice(0, 10)
  const start = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const matches = env.SLACK_MATCHES ?? []
  const where = matches.map(() => '(e.target = ? OR e.target LIKE ?)').join(' OR ')
  const binds = matches.flatMap(m => [m, `${m}/%`])

  const [deltaRows, notableRows] = await env.DB.batch([
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
  return { weekStart: start, weekEnd: end, deltas, notables: notableRows.results as Notable[], nEvents }
}

/** Compose, post to Slack (if configured), and record the weekly summary. Idempotent per week. */
export async function weeklySummary(env: Env): Promise<string | null> {
  const stats = await buildWeekStats(env)
  const dup = await env.DB.prepare('SELECT id FROM summaries WHERE week_start = ?').bind(stats.weekStart).first()
  if (dup) return null
  const text = renderSummary(stats, env.DASHBOARD_URL)
  let slackTs: string | null = null
  if (env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID) {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, text, unfurl_links: false, unfurl_media: false }),
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
