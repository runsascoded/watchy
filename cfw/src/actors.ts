import type { Env } from './collect'

const CAP_PER_RUN = 10 // 2 GH subrequests each; keeps cron ticks well under subrequest limits
const REFRESH_DAYS = 30

async function ghJson(token: string, path: string): Promise<any | null> {
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github.v3+json',
      'user-agent': 'watchy-cfw',
    },
  })
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`GitHub ${resp.status}: ${path}`)
  return resp.json()
}

/** Σ stargazers across the actor's owned repos — up to 2 pages (200 repos); GH's
 * repo listing can't sort by stars, so prolific owners undercount slightly. */
async function fetchStarSum(token: string, login: string): Promise<number | null> {
  let sum = 0
  for (let page = 1; page <= 2; page++) {
    const repos = await ghJson(token, `/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&page=${page}`)
    if (!repos) return page === 1 ? null : sum
    sum += repos.reduce((s: number, r: any) => s + (r.stargazers_count ?? 0), 0)
    if (repos.length < 100) break
  }
  return sum
}

interface BskyProfile {
  handle: string
  followersCount: number
}

/** Conservative Bluesky match: handle guesses (twitter handle, GH login), then a
 * name search requiring an exact display-name match — ambiguity returns null. */
export async function findBsky(login: string, twitter: string | null, name: string | null): Promise<BskyProfile | null> {
  const get = (path: string) => fetch(`https://public.api.bsky.app/xrpc/${path}`).then(r => (r.ok ? r.json<any>() : null)).catch(() => null)
  for (const guess of [twitter, login].filter(Boolean)) {
    const p = await get(`app.bsky.actor.getProfile?actor=${encodeURIComponent(`${guess!.toLowerCase()}.bsky.social`)}`)
    if (p?.handle) return { handle: p.handle, followersCount: p.followersCount ?? 0 }
  }
  if (name) {
    const res = await get(`app.bsky.actor.searchActors?q=${encodeURIComponent(name)}&limit=3`)
    const hit = res?.actors?.find((a: any) => a.displayName?.trim().toLowerCase() === name.trim().toLowerCase())
    if (hit) {
      const p = await get(`app.bsky.actor.getProfile?actor=${encodeURIComponent(hit.handle)}`)
      if (p?.handle) return { handle: p.handle, followersCount: p.followersCount ?? 0 }
    }
  }
  return null
}

/** Enrich up to CAP_PER_RUN event actors lacking a fresh `actors` row (profile + public orgs + star_sum + bsky).
 * Covers ALL events (not just Slack-posted ones): actor-voiced OPs need the row BEFORE
 * posting, so enrichment must not wait on the post ledger. Deleted accounts get a
 * tombstone row (nulls + fetched_at) so they aren't refetched every tick. */
export async function enrichActors(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString()
  const { results } = await env.DB
    .prepare(
      `SELECT DISTINCT e.login FROM events e
       LEFT JOIN actors a ON a.login = e.login
       WHERE a.login IS NULL OR a.fetched_at < ? OR (a.star_sum IS NULL AND a.followers IS NOT NULL)
       ORDER BY e.id DESC LIMIT ${CAP_PER_RUN}`,
    )
    .bind(cutoff)
    .all<{ login: string }>()

  const now = new Date().toISOString()
  let n = 0
  for (const { login } of results) {
    const u = await ghJson(env.WATCHY_TOKEN, `/users/${encodeURIComponent(login)}`)
    const orgs = u ? await ghJson(env.WATCHY_TOKEN, `/users/${encodeURIComponent(login)}/orgs`) : null
    const starSum = u ? await fetchStarSum(env.WATCHY_TOKEN, login) : null
    const bsky = u ? await findBsky(login, u.twitter_username ?? null, u.name ?? null) : null
    // Upsert (not INSERT OR REPLACE) so refreshes preserve research/research_at
    await env.DB
      .prepare(
        `INSERT INTO actors
         (login, name, company, location, bio, blog, twitter, followers, following, public_repos, gh_created_at, orgs, star_sum, bsky_handle, bsky_followers, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(login) DO UPDATE SET
           name = excluded.name, company = excluded.company, location = excluded.location,
           bio = excluded.bio, blog = excluded.blog, twitter = excluded.twitter,
           followers = excluded.followers, following = excluded.following,
           public_repos = excluded.public_repos, gh_created_at = excluded.gh_created_at,
           orgs = excluded.orgs, star_sum = excluded.star_sum,
           bsky_handle = excluded.bsky_handle, bsky_followers = excluded.bsky_followers,
           fetched_at = excluded.fetched_at`,
      )
      .bind(
        login,
        u?.name ?? null,
        u?.company ?? null,
        u?.location ?? null,
        u?.bio ?? null,
        u?.blog || null,
        u?.twitter_username ?? null,
        u?.followers ?? null,
        u?.following ?? null,
        u?.public_repos ?? null,
        u?.created_at ?? null,
        orgs ? JSON.stringify(orgs.map((o: any) => o.login)) : null,
        starSum,
        bsky?.handle ?? null,
        bsky?.followersCount ?? null,
        now,
      )
      .run()
    n++
  }
  return n
}

const RESEARCH_CAP = 3 // per tick; each is an LLM call with web search

interface ActorRow {
  login: string
  name: string | null
  company: string | null
  location: string | null
  bio: string | null
  blog: string | null
  twitter: string | null
  followers: number | null
  orgs: string | null
}

async function researchActor(env: Env, a: ActorRow): Promise<string | null> {
  const profile = { ...a, orgs: a.orgs ? JSON.parse(a.orgs) : [] }
  const prompt = `You research GitHub users who starred/followed repos of Open Athena (openathena.ai — a nonprofit that accelerates academia with AI capabilities; "marin" is its open LM-training effort with Stanford's Percy Liang lab).

Given the GitHub profile below, write 1-3 short sentences: who this person likely is, and why they might matter to Open Athena (researcher? potential collaborator? notable engineer? investor?). Use web search sparingly to confirm identity — if search is inconclusive, summarize the profile signal alone and say so briefly. Plain sentences only (it becomes a Slack thread reply): no preamble, no headers, no bullets.

Profile: ${JSON.stringify(profile)}`
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`)
  const body = await resp.json<{ content: Array<{ type: string; text?: string }> }>()
  const text = body.content.filter(b => b.type === 'text' && b.text).map(b => b.text!.trim()).join(' ').trim()
  return text || null
}

/**
 * One-time Claude research for notable actors with not-yet-posted matching events
 * (specs/actor-intel.md) — their actor-voiced OP waits for the blurb, so research
 * runs before `syncSlack` each tick. Cached in `actors.research` so an actor
 * starring five repos is researched once, not five times. No-op without ANTHROPIC_API_KEY.
 */
export async function researchActors(env: Env): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) return 0
  const matches = env.SLACK_MATCHES ?? []
  if (!matches.length) return 0
  const minF = parseInt(env.RESEARCH_MIN_FOLLOWERS ?? '100', 10)
  const where = matches.map(() => '(e.target = ? OR e.target LIKE ?)').join(' OR ')
  const binds = matches.flatMap(m => [m, `${m}/%`])
  const { results } = await env.DB
    .prepare(
      `SELECT a.login, a.name, a.company, a.location, a.bio, a.blog, a.twitter, a.followers, a.orgs
       FROM actors a
       WHERE a.research_at IS NULL AND a.followers >= ?
       AND EXISTS (SELECT 1 FROM events e LEFT JOIN slack_posts sp ON sp.event_id = e.id
                   WHERE e.login = a.login AND sp.event_id IS NULL AND (${where}))
       LIMIT ${RESEARCH_CAP}`,
    )
    .bind(minF, ...binds)
    .all<ActorRow>()

  const now = new Date().toISOString()
  let n = 0
  for (const a of results) {
    // Errors leave research_at NULL → retried next tick (capped, so a hard failure can't run away)
    const text = await researchActor(env, a)
    await env.DB.prepare('UPDATE actors SET research = ?, research_at = ? WHERE login = ?').bind(text, now, a.login).run()
    n++
  }
  return n
}
