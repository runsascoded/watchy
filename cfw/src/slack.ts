import type { Env } from './collect'

// Mirrors src/watchy/slack.py (render_event / event metadata) — keep in sync.
// Shortcodes, not literal emoji: Slack normalizes literals in stored text.
const KIND_VERBS: Record<string, [string, string]> = {
  star: [':star:', 'starred'],
  unstar: [':broken_heart:', 'unstarred'],
  follow: [':mega:', 'followed'],
  unfollow: [':mute:', 'unfollowed'],
}

const PER_RUN_CAP = 25
const PACE_MS = 1000 // Slack chat.postMessage sustained rate is ~1/s/channel

interface EventRow {
  id: number
  ts: string
  kind: string
  target: string
  login: string
}

export function renderEvent(e: EventRow): string {
  const [emoji, verb] = KIND_VERBS[e.kind]
  const date = e.ts.slice(0, 10)
  const hhmm = e.ts.slice(11, 16)
  return `${emoji} <https://github.com/${e.login}|${e.login}> ${verb} <https://github.com/${e.target}|${e.target}> · ${date} ${hhmm}Z`
}

/** Post unledgered matching events to Slack (oldest event-time first), recording each in `slack_posts`. */
export async function syncSlack(env: Env): Promise<number> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID || !env.SLACK_MATCHES_JSON) return 0
  const matches: string[] = JSON.parse(env.SLACK_MATCHES_JSON)
  if (!matches.length) return 0

  const where = matches.map(() => '(e.target = ? OR e.target LIKE ?)').join(' OR ')
  const binds = matches.flatMap(m => [m, `${m}/%`])
  const { results } = await env.DB
    .prepare(
      `SELECT e.id, e.ts, e.kind, e.target, e.login FROM events e
       LEFT JOIN slack_posts sp ON sp.event_id = e.id
       WHERE sp.event_id IS NULL AND (${where})
       ORDER BY e.ts, e.id LIMIT ${PER_RUN_CAP}`,
    )
    .bind(...binds)
    .all<EventRow>()

  let posted = 0
  for (const e of results) {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        text: renderEvent(e),
        metadata: { event_type: 'watchy_event', event_payload: { id: e.id, date: e.ts.slice(0, 10) } },
        unfurl_links: false,
        unfurl_media: false,
      }),
    })
    const body = await resp.json<{ ok: boolean; ts?: string; error?: string }>()
    if (!body.ok) {
      // Leave the event unledgered — next run retries; don't block later events on a
      // transient failure, but stop this batch to preserve chronological posting order
      console.error(`slack post failed for event ${e.id}: ${body.error}`)
      break
    }
    await env.DB.prepare('INSERT INTO slack_posts (event_id, ts) VALUES (?, ?)').bind(e.id, body.ts).run()
    posted++
    if (posted < results.length) await new Promise(r => setTimeout(r, PACE_MS))
  }
  return posted
}
