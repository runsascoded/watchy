import type { Env } from './collect'

// Mirrors src/watchy/slack.py (render_event / event metadata) — keep in sync.
// Shortcodes, not literal emoji: Slack normalizes literals in stored text.
// The event kind is carried by the per-message avatar (icon_url), not a leading emoji;
// `unit` is the running-total suffix's emoji (repo star count vs org follower count).
const KINDS: Record<string, { verb: string; unit: string }> = {
  star: { verb: 'starred', unit: ':star:' },
  unstar: { verb: 'unstarred', unit: ':star:' },
  follow: { verb: 'followed', unit: ':mega:' },
  unfollow: { verb: 'unfollowed', unit: ':mega:' },
}

const ICON_BASE = 'https://watchy.rbw.sh/icons'
// Orgs with generated `<org>-<kind>.png` icons — keep in sync with AVATAR_ORGS in scripts/gen-pfp.py.
const ICON_ORGS = new Set(['open-athena', 'marin-community'])

const PER_RUN_CAP = 25
const PACE_MS = 1000 // Slack chat.postMessage sustained rate is ~1/s/channel

interface EventRow {
  id: number
  ts: string
  kind: string
  target: string
  login: string
}

export function renderEvent(e: EventRow, count?: number, slackUser?: string, dashboardUrl?: string, orgEmoji?: string): string {
  const { verb, unit } = KINDS[e.kind]
  const date = e.ts.slice(0, 10)
  const hhmm = e.ts.slice(11, 16)
  const who = `<https://github.com/${e.login}|${e.login}>` + (slackUser ? ` (<@${slackUser}>)` : '')
  // Repo short-name only — the org rides as a workspace-emoji prefix when configured
  // (SLACK_ORG_EMOJI), and the per-message avatar carries org+kind regardless.
  const slash = e.target.indexOf('/')
  const short = slash < 0 ? e.target : e.target.slice(slash + 1)
  const tgt = `${orgEmoji ? `:${orgEmoji}: ` : ''}<https://github.com/${e.target}|${short}>`
  const base = `${who} ${verb} ${tgt} · ${date} ${hhmm}Z`
  if (count == null) return base
  // Running total links to the always-current dashboard view of this target,
  // rather than denorming more world-state into each message
  const total = `${count.toLocaleString('en-US')} ${unit}`
  return dashboardUrl ? `${base} · <${dashboardUrl}/?t=${encodeURIComponent(e.target)}|${total}>` : `${base} · ${total}`
}

export function iconUrl(target: string, kind: string): string {
  const org = target.split('/')[0].toLowerCase()
  // ?v busts Slack's per-URL image-proxy cache; bump when icon content changes
  return `${ICON_BASE}/${ICON_ORGS.has(org) ? org : 'gh'}-${kind}.png?v=3`
}

/** Post unledgered matching events to Slack (oldest event-time first), recording each in `slack_posts`. */
export async function syncSlack(env: Env): Promise<number> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID || !env.SLACK_MATCHES) return 0
  const matches = env.SLACK_MATCHES
  if (!matches.length) return 0
  const userMap = env.SLACK_USER_MAP ?? {}

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
    const cnt = await env.DB
      .prepare('SELECT count FROM counts WHERE target = ? ORDER BY ts DESC LIMIT 1')
      .bind(e.target)
      .first<{ count: number }>()
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        text: renderEvent(e, cnt?.count, userMap[e.login], env.DASHBOARD_URL, (env.SLACK_ORG_EMOJI ?? {})[e.target.split('/')[0]]),
        icon_url: iconUrl(e.target, e.kind),
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

const REPLY_CAP = 10

export interface ActorBits {
  login: string
  name: string | null
  company: string | null
  location: string | null
  bio: string | null
  blog: string | null
  twitter: string | null
  followers: number | null
  public_repos: number | null
  gh_created_at: string | null
  orgs: string | null
  research: string | null
}

/** Thread-reply body with the actor's interesting bits, or null when there's nothing worth saying.
 * The actor's name rides as the reply's author (chat.postMessage username override), not in the body. */
export function renderActorReply(a: ActorBits, dashboardUrl?: string): string | null {
  if (!a.name && !a.company && !a.bio && (a.followers ?? 0) < 50) return null
  const fmt = (n: number) => n.toLocaleString('en-US')
  const lines: string[] = []
  const head = [a.company, a.location].filter(Boolean).join(' · ')
  if (head) lines.push(head)
  const stats = [
    a.followers != null && `${fmt(a.followers)} followers`,
    a.public_repos != null && `${fmt(a.public_repos)} repos`,
    a.gh_created_at && `joined ${a.gh_created_at.slice(0, 4)}`,
  ].filter(Boolean)
  if (stats.length) lines.push(stats.join(' · '))
  if (a.bio) lines.push(`_${a.bio}_`)
  const orgs: string[] = a.orgs ? JSON.parse(a.orgs) : []
  if (orgs.length) lines.push(`orgs: ${orgs.slice(0, 6).join(', ')}${orgs.length > 6 ? ` +${orgs.length - 6}` : ''}`)
  const links = [
    a.twitter && `<https://x.com/${a.twitter}|@${a.twitter}>`,
    a.blog && `<${a.blog.startsWith('http') ? a.blog : `https://${a.blog}`}|${a.blog.replace(/^https?:\/\//, '')}>`,
  ].filter(Boolean)
  if (links.length) lines.push(links.join(' · '))
  if (a.research) lines.push(`:mag: ${a.research}`)
  if (dashboardUrl) lines.push(`<${dashboardUrl}/actors|all actors →>`)
  return lines.join('\n')
}

/**
 * Post one threaded reply per event message with the actor's enriched-profile bits
 * (specs/actor-intel.md). Waits for `enrichActors`; when research is configured
 * (ANTHROPIC_API_KEY), research-eligible actors additionally wait for their cached
 * blurb. Low-info actors get the `''` sentinel — processed, no noise reply.
 */
export async function syncActorReplies(env: Env): Promise<number> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) return 0
  const researchOn = !!env.ANTHROPIC_API_KEY
  const minF = parseInt(env.RESEARCH_MIN_FOLLOWERS ?? '100', 10)
  const { results } = await env.DB
    .prepare(
      `SELECT sp.event_id, sp.ts AS thread_ts, e.login, a.name, a.company, a.location, a.bio, a.blog,
              a.twitter, a.followers, a.public_repos, a.gh_created_at, a.orgs, a.research, a.research_at
       FROM slack_posts sp
       JOIN events e ON e.id = sp.event_id
       JOIN actors a ON a.login = e.login
       WHERE sp.reply_ts IS NULL AND a.fetched_at IS NOT NULL
       ORDER BY sp.ts LIMIT ${REPLY_CAP}`,
    )
    .all<ActorBits & { event_id: number; thread_ts: string; research_at: string | null }>()

  let replied = 0
  for (const row of results) {
    // Research pending for a notable actor: leave unprocessed, pick it up next tick
    if (researchOn && (row.followers ?? 0) >= minF && !row.research_at) continue
    const text = renderActorReply(row, env.DASHBOARD_URL)
    let replyTs = ''
    if (text) {
      const resp = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        // The reply speaks as the actor: their GH avatar + display name
        body: JSON.stringify({
          channel: env.SLACK_CHANNEL_ID,
          thread_ts: row.thread_ts,
          text,
          username: row.name ?? row.login,
          icon_url: `https://github.com/${row.login}.png?size=96`,
          unfurl_links: false,
          unfurl_media: false,
        }),
      })
      const body = await resp.json<{ ok: boolean; ts?: string; error?: string }>()
      if (!body.ok) {
        console.error(`slack reply failed for event ${row.event_id}: ${body.error}`)
        break
      }
      replyTs = body.ts ?? ''
      replied++
      await new Promise(r => setTimeout(r, PACE_MS))
    }
    await env.DB.prepare('UPDATE slack_posts SET reply_ts = ? WHERE event_id = ?').bind(replyTs, row.event_id).run()
  }
  return replied
}
