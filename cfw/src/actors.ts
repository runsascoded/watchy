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

/** Enrich up to CAP_PER_RUN posted-event actors lacking a fresh `actors` row (profile + public orgs).
 * Deleted accounts get a tombstone row (nulls + fetched_at) so they aren't refetched every tick. */
export async function enrichActors(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString()
  const { results } = await env.DB
    .prepare(
      `SELECT DISTINCT e.login FROM events e
       JOIN slack_posts sp ON sp.event_id = e.id
       LEFT JOIN actors a ON a.login = e.login
       WHERE a.login IS NULL OR a.fetched_at < ?
       ORDER BY e.id DESC LIMIT ${CAP_PER_RUN}`,
    )
    .bind(cutoff)
    .all<{ login: string }>()

  const now = new Date().toISOString()
  let n = 0
  for (const { login } of results) {
    const u = await ghJson(env.WATCHY_TOKEN, `/users/${encodeURIComponent(login)}`)
    const orgs = u ? await ghJson(env.WATCHY_TOKEN, `/users/${encodeURIComponent(login)}/orgs`) : null
    await env.DB
      .prepare(
        `INSERT OR REPLACE INTO actors
         (login, name, company, location, bio, blog, twitter, followers, following, public_repos, gh_created_at, orgs, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
      )
      .run()
    n++
  }
  return n
}
