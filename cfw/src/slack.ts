import type { Env } from './collect'
import { ensureWeeklyThread, updateWeeklyOp, weekStartOf } from './weekly'

// Mirrors src/watchy/slack.py (render_event / event metadata) — keep in sync.
// Shortcodes, not literal emoji: Slack normalizes literals in stored text.
// The event kind is carried by the per-message avatar (icon_url), not a leading emoji;
// `unit` is the running-total suffix's emoji (repo star count vs org follower count).
const KINDS: Record<string, { verb: string; unit: string }> = {
  star: { verb: 'starred', unit: ':star:' },
  unstar: { verb: 'unstarred', unit: ':star:' },
  follow: { verb: 'followed', unit: ':bell:' },
  unfollow: { verb: 'unfollowed', unit: ':bell:' },
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

// Sender-line verbs for actor-voiced OPs — literal emoji, tenseless ("user ⭐ repo");
// Slack usernames don't render shortcodes. 🔔/🔕 = follow/unfollow (subscribe/mute).
const OP_VERB: Record<string, string> = {
  star: '⭐',
  unstar: '💔',
  follow: '🔔',
  unfollow: '🔕',
}

function shortTarget(target: string): string {
  const i = target.indexOf('/')
  return i < 0 ? target : target.slice(i + 1)
}

/** LI search keywords from a GH company string: strip parentheticals + @handles,
 * keep the last comma segment — "IIIS, Tsinghua University" → "Tsinghua University",
 * "Sereact (@sereact)" → "Sereact". Literal strings find nothing on LI. */
export function companyKeywords(co: string): string {
  const stripped = co.replace(/\(.*?\)/g, '').replace(/@[\w-]+/g, '').replace(/\s+/g, ' ').trim().replace(/[,;]+$/, '')
  const segs = stripped.split(/,\s*/).filter(Boolean)
  return segs.length ? segs[segs.length - 1] : co
}

export interface ActorOpMsg {
  username: string
  icon_url: string
  text: string // mrkdwn fallback (notifications, older clients)
  blocks: unknown[]
}

// Literal unicode for rich_text link anchors (shortcodes render outside mrkdwn
// anchors; literal emoji inside rich_text `link` text stay in the link)
const UNIT_CHAR: Record<string, string> = { star: '⭐', unstar: '⭐', follow: '🔔', unfollow: '🔔' }

export interface ActorOpOpts {
  counts?: (number | undefined)[] // running total per event, parallel to `events`
  slackUser?: string
  dashboardUrl?: string
  orgEmoji?: Record<string, string> // org → workspace-emoji name
}

/**
 * Actor-voiced OP (specs/actor-intel.md v5-v8): the event(s) ride the sender line
 * ("Naveen Nagarajan ⭐ marin", their GH avatar; back-to-back events by the same
 * actor combine comma-delimited); the body is the actor's bits + one compact
 * event-ref line per event. Low-info actors get just the event refs. No action
 * timestamp — the Slack post ts is close enough at the 5-minute cron cadence.
 */
export function renderActorOp(events: EventRow[], a: ActorBits | null, opts: ActorOpOpts = {}): ActorOpMsg {
  const { counts = [], slackUser, dashboardUrl, orgEmoji = {} } = opts
  const login = events[0].login
  const acts = events.map(e => `${OP_VERB[e.kind]} ${shortTarget(e.target)}`).join(', ')
  let username = `${a?.name ?? login} ${acts}`
  if (username.length > 80) username = `${login} ${acts}`
  const fmt = (n: number) => n.toLocaleString('en-US')
  const bold = (notable: boolean, s: string) => (notable ? `*${s}*` : s)
  const lines: string[] = []
  const gh = `<https://github.com/${login}|${login}>` + (slackUser ? ` (<@${slackUser}>)` : '')
  if (a && (a.name || a.company || a.bio || (a.followers ?? 0) >= 50)) {
    // A linkedin.com/in/… blog IS their LI profile — link it (best-case LI signal)
    // and drop both the blind people-search and the redundant blog entry.
    const blogUrl = a.blog ? (a.blog.startsWith('http') ? a.blog : `https://${a.blog}`) : null
    const liProfile = blogUrl?.match(/linkedin\.com\/in\/([^/?#]+)/)
    // LI people-search is only worth linking when we have a real full name to key on —
    // single-token or handle-like names return junk results (worse than no link)
    const liName = a.name?.trim()
    const li = liProfile
      ? `:linkedin: <${blogUrl}|${liProfile[1]}>`
      : liName?.includes(' ')
        ? `:linkedin: <https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(liName)}|search>`
        : null
    // Tease high-star repos alongside the star sum ("mostly VMamba 2,300")
    const tops: Array<{ n: string; s: number }> = a.top_repos ? JSON.parse(a.top_repos) : []
    const topStr = tops.filter(t => t.s >= 200).slice(0, 2)
      .map(t => ` · <https://github.com/${t.n}|${shortTarget(t.n)}> ${fmt(t.s)}`).join('')
    lines.push([
      gh,
      a.followers != null && bold(a.followers >= 100, `${fmt(a.followers)} follower${a.followers === 1 ? '' : 's'}`),
      a.public_repos != null && `${fmt(a.public_repos)} repo${a.public_repos === 1 ? '' : 's'}${a.star_sum ? ` (${bold(a.star_sum >= 1000, `${fmt(a.star_sum)} :star:`)}${topStr})` : ''}`,
      a.gh_created_at && `joined ${a.gh_created_at.slice(0, 4)}`,
      a.bsky_handle && `:bsky: <https://bsky.app/profile/${a.bsky_handle}|${a.bsky_followers != null ? fmt(a.bsky_followers) : '?'}>`,
      a.twitter && `𝕏 <https://x.com/${a.twitter}|@${a.twitter}>`,
      li,
    ].filter(Boolean).join(' · '))
    // Company · location · bio · blog fold into one line; employer links to LI
    // company search (or the GH org page for @org-style companies)
    const co = a.company?.trim()
    const coPart = co
      ? co.startsWith('@')
        ? `<https://github.com/${co.slice(1)}|${co}>`
        : `<https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(companyKeywords(co))}|${co}>`
      : null
    const bio = a.bio?.replace(/\s+/g, ' ').trim()
    const blogPart = blogUrl && !liProfile
      && `:globe_with_meridians: <${blogUrl}|${blogUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}>`
    const where = [coPart, a.location, bio && `_${bio}_`, blogPart].filter(Boolean).join(' · ')
    if (where) lines.push(where)
    const orgs: string[] = a.orgs ? JSON.parse(a.orgs) : []
    if (orgs.length) {
      const links = orgs.slice(0, 6).map(o => `<https://github.com/${o}|${o}>`)
      lines.push(`orgs: ${links.join(', ')}${orgs.length > 6 ? ` +${orgs.length - 6}` : ''}`)
    }
    if (a.research) lines.push(`:mag: ${a.research}`)
  } else if (slackUser) {
    lines.push(gh)
  }
  const blocks: unknown[] = []
  if (lines.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } })
  // Event-ref lines as rich_text so the total link can carry its ⭐/🔔 INSIDE the
  // anchor — Slack renders mrkdwn-anchor shortcodes outside the link.
  const refSections = events.map((e, i) => {
    const org = e.target.split('/')[0]
    const short = shortTarget(e.target)
    const count = counts[i]
    // mrkdwn fallback line
    const tgt = `${orgEmoji[org] ? `:${orgEmoji[org]}: ` : ''}<https://github.com/${e.target}|${short}>`
    const total = count != null ? `${fmt(count)} ${KINDS[e.kind].unit}` : null
    lines.push(total == null ? tgt : `${tgt} · ${dashboardUrl ? `<${dashboardUrl}/?t=${encodeURIComponent(e.target)}|${total}>` : total}`)
    // rich_text elements
    const els: unknown[] = []
    if (orgEmoji[org]) els.push({ type: 'emoji', name: orgEmoji[org] }, { type: 'text', text: ' ' })
    els.push({ type: 'link', url: `https://github.com/${e.target}`, text: short })
    if (count != null) {
      els.push({ type: 'text', text: ' · ' })
      const totalChar = `${fmt(count)} ${UNIT_CHAR[e.kind]}`
      els.push(dashboardUrl
        ? { type: 'link', url: `${dashboardUrl}/?t=${encodeURIComponent(e.target)}`, text: totalChar }
        : { type: 'text', text: totalChar })
    }
    return { type: 'rich_text_section', elements: els }
  })
  blocks.push({ type: 'rich_text', elements: refSections })
  return {
    username,
    icon_url: `https://github.com/${encodeURIComponent(login)}.png?size=96`,
    text: lines.join('\n'),
    blocks,
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

  // Back-to-back events by the same actor combine into one message
  const groups: EventRow[][] = []
  for (const e of results) {
    const last = groups[groups.length - 1]
    if (last && last[0].login === e.login) last.push(e)
    else groups.push([e])
  }

  const researchOn = !!env.ANTHROPIC_API_KEY
  const minF = parseInt(env.RESEARCH_MIN_FOLLOWERS ?? '100', 10)
  const weekOps = new Map<string, string>() // week_start → OP ts (created on demand)
  let posted = 0
  for (const events of groups) {
    const { login } = events[0]
    // Event msgs post as replies under the week's OP (specs/actor-intel.md v9)
    const wk = weekStartOf(events[0].ts)
    let opTs = weekOps.get(wk)
    if (!opTs) {
      try {
        opTs = await ensureWeeklyThread(env, wk)
        weekOps.set(wk, opTs)
      } catch (e) {
        console.error(`ensureWeeklyThread(${wk}) failed: ${(e as Error).message}`)
        break // don't post channel-level while the thread is unavailable; retry next tick
      }
    }
    // Actor-voiced OPs need the enrichment row (and the research blurb when configured
    // for a notable actor) — stop the batch to preserve chronology; enrichActors and
    // researchActors run earlier in the same tick, so the wait is ≤ one tick.
    const actor = await env.DB
      .prepare('SELECT * FROM actors WHERE login = ?')
      .bind(login)
      .first<ActorBits & { research_at: string | null }>()
    if (!actor) break
    if (researchOn && (actor.followers ?? 0) >= minF && !actor.research_at) break
    const counts: (number | undefined)[] = []
    for (const e of events) {
      const cnt = await env.DB
        .prepare('SELECT count FROM counts WHERE target = ? ORDER BY ts DESC LIMIT 1')
        .bind(e.target)
        .first<{ count: number }>()
      counts.push(cnt?.count)
    }
    const msg = renderActorOp(events, actor, {
      counts,
      slackUser: userMap[login],
      dashboardUrl: env.DASHBOARD_URL,
      orgEmoji: env.SLACK_ORG_EMOJI,
    })
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        thread_ts: opTs,
        ...msg,
        metadata: { event_type: 'watchy_event', event_payload: { id: events[0].id, date: events[0].ts.slice(0, 10) } },
        unfurl_links: false,
        unfurl_media: false,
      }),
    })
    const body = await resp.json<{ ok: boolean; ts?: string; error?: string }>()
    if (!body.ok) {
      // Leave the events unledgered — next run retries; don't block later events on a
      // transient failure, but stop this batch to preserve chronological posting order
      console.error(`slack post failed for event ${events[0].id}: ${body.error}`)
      break
    }
    await env.DB.batch(events.map(e =>
      env.DB.prepare('INSERT INTO slack_posts (event_id, ts) VALUES (?, ?)').bind(e.id, body.ts),
    ))
    posted += events.length
    if (posted < results.length) await new Promise(r => setTimeout(r, PACE_MS))
  }
  if (posted) {
    for (const [wk, opTs] of weekOps) {
      try {
        await updateWeeklyOp(env, wk, opTs)
      } catch (e) {
        console.error(`updateWeeklyOp(${wk}) failed: ${(e as Error).message}`) // next batch retries
      }
    }
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
  top_repos: string | null
  research: string | null
}

