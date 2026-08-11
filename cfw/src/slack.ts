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

// Sender-line verbs for actor-voiced OPs — literal emoji (Slack usernames don't render shortcodes)
const OP_VERB: Record<string, string> = {
  star: "⭐'d",
  unstar: "💔 un-⭐'d",
  follow: '📣 followed',
  unfollow: '🔇 unfollowed',
}

function shortTarget(target: string): string {
  const i = target.indexOf('/')
  return i < 0 ? target : target.slice(i + 1)
}

export interface ActorOpMsg {
  username: string
  icon_url: string
  text: string
}

/**
 * Actor-voiced OP (specs/actor-intel.md v5-v7): the event rides the sender line
 * ("Naveen Nagarajan ⭐'d marin", their GH avatar); the body is the actor's bits
 * + a compact event-ref line. Low-info actors get just the event ref. No action
 * timestamp — the Slack post ts is close enough at the 5-minute cron cadence.
 */
export function renderActorOp(
  e: EventRow,
  a: ActorBits | null,
  count?: number,
  slackUser?: string,
  dashboardUrl?: string,
  orgEmoji?: string,
): ActorOpMsg {
  const { unit } = KINDS[e.kind]
  const short = shortTarget(e.target)
  let username = `${a?.name ?? e.login} ${OP_VERB[e.kind]} ${short}`
  if (username.length > 80) username = `${e.login} ${OP_VERB[e.kind]} ${short}`
  const fmt = (n: number) => n.toLocaleString('en-US')
  const lines: string[] = []
  const gh = `<https://github.com/${e.login}|${e.login}>` + (slackUser ? ` (<@${slackUser}>)` : '')
  if (a && (a.name || a.company || a.bio || (a.followers ?? 0) >= 50)) {
    // LI people-search is only worth linking when we have a real full name to key on —
    // single-token or handle-like names return junk results (worse than no link)
    const liName = a.name?.trim()
    lines.push([
      gh,
      a.followers != null && `${fmt(a.followers)} followers`,
      a.public_repos != null && `${fmt(a.public_repos)} repos${a.star_sum ? ` (${fmt(a.star_sum)} :star:)` : ''}`,
      a.gh_created_at && `joined ${a.gh_created_at.slice(0, 4)}`,
      a.bsky_handle && `:bsky: <https://bsky.app/profile/${a.bsky_handle}|${a.bsky_followers != null ? fmt(a.bsky_followers) : '?'}>`,
      a.twitter && `𝕏 <https://x.com/${a.twitter}|@${a.twitter}>`,
      liName?.includes(' ') && `:linkedin: <https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(liName)}|search>`,
    ].filter(Boolean).join(' · '))
    const where = [a.company, a.location].filter(Boolean).join(' · ')
    if (where) lines.push(where)
    if (a.bio) lines.push(`_${a.bio}_`)
    const orgs: string[] = a.orgs ? JSON.parse(a.orgs) : []
    if (orgs.length) lines.push(`orgs: ${orgs.slice(0, 6).join(', ')}${orgs.length > 6 ? ` +${orgs.length - 6}` : ''}`)
    if (a.blog) lines.push(`:globe_with_meridians: <${a.blog.startsWith('http') ? a.blog : `https://${a.blog}`}|${a.blog.replace(/^https?:\/\//, '')}>`)
    if (a.research) lines.push(`:mag: ${a.research}`)
  } else if (slackUser) {
    lines.push(gh)
  }
  const tgt = `${orgEmoji ? `:${orgEmoji}: ` : ''}<https://github.com/${e.target}|${short}>`
  if (count == null) {
    lines.push(tgt)
  } else {
    const total = `${fmt(count)} ${unit}`
    lines.push(`${tgt} · ${dashboardUrl ? `<${dashboardUrl}/?t=${encodeURIComponent(e.target)}|${total}>` : total}`)
  }
  return {
    username,
    icon_url: `https://github.com/${encodeURIComponent(e.login)}.png?size=96`,
    text: lines.join('\n'),
  }
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

  const researchOn = !!env.ANTHROPIC_API_KEY
  const minF = parseInt(env.RESEARCH_MIN_FOLLOWERS ?? '100', 10)
  let posted = 0
  for (const e of results) {
    // Actor-voiced OPs need the enrichment row (and the research blurb when configured
    // for a notable actor) — stop the batch to preserve chronology; enrichActors and
    // researchActors run earlier in the same tick, so the wait is ≤ one tick.
    const actor = await env.DB
      .prepare('SELECT * FROM actors WHERE login = ?')
      .bind(e.login)
      .first<ActorBits & { research_at: string | null }>()
    if (!actor) break
    if (researchOn && (actor.followers ?? 0) >= minF && !actor.research_at) break
    const cnt = await env.DB
      .prepare('SELECT count FROM counts WHERE target = ? ORDER BY ts DESC LIMIT 1')
      .bind(e.target)
      .first<{ count: number }>()
    const msg = renderActorOp(e, actor, cnt?.count, userMap[e.login], env.DASHBOARD_URL, (env.SLACK_ORG_EMOJI ?? {})[e.target.split('/')[0]])
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        ...msg,
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
  star_sum: number | null
  gh_created_at: string | null
  orgs: string | null
  bsky_handle: string | null
  bsky_followers: number | null
  research: string | null
}

