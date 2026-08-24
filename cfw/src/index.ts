import { collect, type CollectResult, type Env } from './collect'
import { enrichActors, researchActors } from './actors'
import { handleAuth } from './auth'
import { chunkedAll } from './d1'
import { gateFor, hasScope } from './gate'
import { buildWeekStats, renderRollup, renderSummary, weeklySummary } from './summary'

import { maybeAlert } from './alerts'
import { sendPushover } from './pushover'
import { syncSlack } from './slack'
import { getWeeklyThread, updateWeeklyOp, weekStartOf } from './weekly'

// Backstop only — the close-out normally fires from runCollection, on the first tick of
// a new week. Keep in sync with wrangler.jsonc triggers.crons; day-agnostic by design
// (specs/weekly-rollup.md).
const WEEKLY_CRON = '0 14 * * *'

async function runCollection(env: Env, fullSweep: boolean): Promise<CollectResult> {
  const startedAt = new Date().toISOString()
  const { meta } = await env.DB
    .prepare('INSERT INTO runs (started_at) VALUES (?)')
    .bind(startedAt)
    .run()
  const runId = meta.last_row_id

  let result: CollectResult
  try {
    result = await collect(env, fullSweep, runId as number)
  } catch (e) {
    result = { ok: false, fullSweep, nEvents: 0, reposFetched: 0, skipped: [], error: (e as Error).message }
  }

  await env.DB
    .prepare('UPDATE runs SET finished_at = ?, ok = ?, n_events = ?, error = ?, full_sweep = ?, n_repos = ?, n_skipped = ? WHERE id = ?')
    .bind(new Date().toISOString(), result.ok ? 1 : 0, result.nEvents, result.error ?? null, fullSweep ? 1 : 0, result.reposFetched, result.skipped.length, runId)
    .run()

  const alerted = await maybeAlert(env, runId, result.ok, result.error)
  if (alerted) {
    await env.DB.prepare('UPDATE runs SET alerted = 1 WHERE id = ?').bind(runId).run()
  }
  // Enrichment and research run BEFORE posting: actor-voiced OPs embed the actor's
  // bits (and research blurb, when configured), so syncSlack waits on those rows.
  try {
    const enriched = await enrichActors(env)
    if (enriched) console.log(`actors: enriched ${enriched}`)
  } catch (e) {
    console.error('enrichActors failed:', e)
  }
  try {
    const researched = await researchActors(env)
    if (researched) console.log(`actors: researched ${researched}`)
  } catch (e) {
    console.error('researchActors failed:', e)
  }
  // Close the outgoing week before posting into the new one: the rollup is a broadcast
  // reply under the *old* OP, so firing it from the daily cron put it in the channel
  // hours after the new week's thread had already started. Idempotent per week (one
  // indexed lookup on the common path); the cron stays as a backstop.
  try {
    await weeklySummary(env)
  } catch (e) {
    console.error('weeklySummary failed:', e)
  }
  try {
    const slackPosted = await syncSlack(env)
    if (slackPosted) console.log(`slack: posted ${slackPosted} event(s)`)
  } catch (e) {
    console.error('syncSlack failed:', e)
  }
  console.log(JSON.stringify({ runId, ...result }))
  return result
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2) + '\n', {
    status,
    headers: {
      'content-type': 'application/json',
      // Dev FE (localhost:4199) is cross-origin; data is public pending the CF Access decision
      'access-control-allow-origin': '*',
    },
  })
}

function keyGate(req: Request, env: Env): Response | null {
  if (env.MANUAL_CHECK_KEY) {
    const key = new URL(req.url).searchParams.get('key')
    if (key !== env.MANUAL_CHECK_KEY) return new Response('forbidden\n', { status: 403 })
  }
  return null
}

const EVENT_KINDS = ['star', 'unstar', 'follow', 'unfollow']

async function apiEvents(url: URL, env: Env): Promise<Response> {
  const wheres: string[] = []
  const binds: (string | number)[] = []
  const target = url.searchParams.get('target')
  const kind = url.searchParams.get('kind')
  const login = url.searchParams.get('login')
  if (target) { wheres.push('target = ?'); binds.push(target) }
  if (kind) {
    if (!EVENT_KINDS.includes(kind)) return json({ error: `kind must be one of ${EVENT_KINDS.join(', ')}` }, 400)
    wheres.push('kind = ?'); binds.push(kind)
  }
  if (login) { wheres.push('login LIKE ?'); binds.push(`%${login}%`) }
  // Scope filter (site flavors are owner-disjoint): ?owners=a,b keeps events whose
  // target is an owner or one of its repos; ?exclude=1 inverts (public flavor)
  const owners = url.searchParams.get('owners')?.split(',').filter(Boolean) ?? []
  if (owners.length) {
    const clause = owners.map(() => '(target = ? OR target LIKE ?)').join(' OR ')
    wheres.push(`${url.searchParams.get('exclude') === '1' ? 'NOT ' : ''}(${clause})`)
    for (const o of owners) binds.push(o, `${o}/%`)
  }
  // Keyset cursor for infinite scroll — matches the (ts, id) sort, so pages stay
  // stable as new events arrive (unlike OFFSET)
  const beforeTs = url.searchParams.get('before_ts')
  const beforeId = url.searchParams.get('before_id')
  if (beforeTs && beforeId) { wheres.push('(ts, id) < (?, ?)'); binds.push(beforeTs, parseInt(beforeId)) }
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 5000)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''
  // Event-time order, not insertion order: bootstrap star events carry starred_at
  // timestamps spanning years, so id-order would clump them at the end.
  // prior_ts: when the star/follow being undone was itself observed, its ts —
  // lets the UI say how long the star/follow lasted.
  const { results } = await env.DB
    .prepare(`SELECT id, ts, kind, target, uid, login, source, sha,
      CASE WHEN kind IN ('unstar', 'unfollow') THEN
        (SELECT MAX(p.ts) FROM events p
          WHERE p.login = e.login AND p.target = e.target AND p.ts < e.ts
            AND p.kind = CASE e.kind WHEN 'unstar' THEN 'star' ELSE 'follow' END)
      END AS prior_ts
      FROM events e ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all()
  return json({ events: results })
}

async function apiTargets(env: Env): Promise<Response> {
  const [stars, follows] = await env.DB.batch([
    env.DB.prepare('SELECT repo AS target, count(*) AS count FROM stars GROUP BY repo ORDER BY count DESC, target'),
    env.DB.prepare('SELECT target, count(*) AS count FROM follows GROUP BY target ORDER BY count DESC, target'),
  ])
  return json({ stars: stars.results, follows: follows.results })
}

async function apiCounts(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get('target')
  if (!target) return json({ error: 'target param required' }, 400)
  const { results } = await env.DB
    .prepare('SELECT ts, count FROM counts WHERE target = ? ORDER BY ts')
    .bind(target)
    .all()
  return json({ target, counts: results })
}

/** Count-over-time for a target, reconstructed from the events backlog.
 * Running ±1 sum over star/unstar (repos) or follow/unfollow (orgs), anchored so the
 * series ends at the current absolute count — `counts` only starts at the worker
 * cutover, but events carry the 6-month backfill. */
async function apiSeries(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get('target')
  if (!target) return json({ error: 'target param required' }, 400)
  const isRepo = target.includes('/')
  const [cum, current] = await env.DB.batch([
    // One point per timestamp (last cum wins): the backfill bootstrap lands
    // every pre-existing star/follow as an event at one ts, which would
    // otherwise render as a 0→N ramp at the left edge of the chart
    env.DB.prepare(
      `SELECT ts, cum FROM (
         SELECT ts,
           SUM(CASE WHEN kind IN ('star', 'follow') THEN 1 ELSE -1 END)
             OVER (ORDER BY ts, id) AS cum,
           ROW_NUMBER() OVER (PARTITION BY ts ORDER BY id DESC) AS rn
         FROM events WHERE target = ?
       ) WHERE rn = 1 ORDER BY ts`,
    ).bind(target),
    isRepo
      ? env.DB.prepare('SELECT COUNT(*) AS n FROM stars WHERE repo = ?').bind(target)
      : env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE target = ?').bind(target),
  ])
  const rows = cum.results as { ts: string; cum: number }[]
  const n = (current.results[0] as { n: number }).n
  const offset = rows.length ? n - rows[rows.length - 1].cum : n
  return json({ target, series: rows.map(r => ({ ts: r.ts, count: r.cum + offset })) })
}

interface ActorEvent {
  login: string
  ts: string
  kind: string
  target: string
  active: number // star/follow still present in current state (0 for churned or un- events)
}

/** All posted events, newest first, grouped by login (small: one row per Slack-posted event). */
async function postedEventsByLogin(env: Env, sinceTs?: string): Promise<Map<string, ActorEvent[]>> {
  const { results } = await env.DB
    .prepare(
      `SELECT e.login, e.ts, e.kind, e.target,
         CASE
           WHEN e.kind = 'star' THEN EXISTS (SELECT 1 FROM stars s WHERE s.repo = e.target AND s.login = e.login)
           WHEN e.kind = 'follow' THEN EXISTS (SELECT 1 FROM follows f WHERE f.target = e.target AND f.login = e.login)
           ELSE 0
         END AS active
       FROM events e
       JOIN slack_posts sp ON sp.event_id = e.id
       ${sinceTs ? 'WHERE e.ts >= ?' : ''} ORDER BY e.ts DESC`,
    )
    .bind(...(sinceTs ? [sinceTs] : []))
    .all<ActorEvent>()
  const byLogin = new Map<string, ActorEvent[]>()
  for (const e of results) {
    if (!byLogin.has(e.login)) byLogin.set(e.login, [])
    byLogin.get(e.login)!.push(e)
  }
  return byLogin
}

/** Enriched actors behind posted events, follower-sorted, with posted-activity rollups + per-actor events. */
async function apiActors(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '500', 10), 2000)
  const [{ results }, evByLogin] = await Promise.all([
    env.DB
      .prepare(
        `SELECT a.*, x.n_events, x.first_ts, x.last_ts FROM actors a
         JOIN (SELECT e.login, COUNT(*) n_events, MIN(e.ts) first_ts, MAX(e.ts) last_ts
               FROM events e JOIN slack_posts sp ON sp.event_id = e.id GROUP BY e.login) x
           ON x.login = a.login
         ORDER BY a.followers DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{ login: string }>(),
    postedEventsByLogin(env),
  ])
  return json({ actors: results.map(a => ({ ...a, events: (evByLogin.get(a.login) ?? []).map(({ login: _, ...e }) => e) })) })
}

/**
 * Public-tier profile cards for an explicit set of logins — what the feed's details mode
 * needs (specs/feed-details.md), and nothing else.
 *
 * Deliberately not `apiActors` with a filter: that one is `ORDER BY followers DESC LIMIT 500`
 * for the actors *table*, so a feed row by anyone outside the top 500 silently rendered as a
 * bare login. It also ships the derived tier (research prose, cross-platform handles) plus
 * every posted event per actor — a payload the feed has no use for and shouldn't be handed.
 */
async function apiActorCards(url: URL, env: Env): Promise<Response> {
  const logins = [...new Set((url.searchParams.get('logins') ?? '').split(',').filter(Boolean))].slice(0, 1000)
  if (!logins.length) return json({ actors: [] })
  const actors = await chunkedAll(
    env.DB,
    logins,
    ph => `SELECT login, name, company, location, bio, followers, following, star_sum FROM actors WHERE login IN (${ph})`,
  )
  return json({ actors })
}

// Excludes insiders (prospects only): OA or marin-community org membership, or company
// matching open…athena ("@Open-Athena", "Open Athena"). Kept in sync with buildWeekStats
// notables and the FE isInsider (www/src/pages/Actors.tsx).
const NOT_OA = `(a.orgs IS NULL OR (a.orgs NOT LIKE '%"Open-Athena"%' AND a.orgs NOT LIKE '%"marin-community"%'))
       AND (a.company IS NULL OR a.company NOT LIKE '%open%athena%')`

interface SummaryActor {
  login: string
  name: string | null
  company: string | null
  location: string | null
  bio: string | null
  blog: string | null
  twitter: string | null
  followers: number
  following: number | null
  star_sum: number | null
  bsky_handle: string | null
  bsky_followers: number | null
  x_followers: number | null
  orgs: string | null
}

/** Mirrors the FE interest score (www/src/pages/Actors.tsx) at the default 60d half-life. */
function interestScore(
  a: { followers: number | null; following: number | null; bsky_followers?: number | null; x_followers?: number | null },
  events: ActorEvent[],
  nowMs: number,
): number {
  const flw = a.followers ?? 0
  // Fame counts cross-platform reach; the spam ratio stays GH-only (following counts are GH's)
  const reach = flw + (a.bsky_followers ?? 0) + (a.x_followers ?? 0)
  const fame = Math.log10(1 + reach)
  const ratio = (flw + 1) / (flw + (a.following ?? 0) + 2)
  // Recency = decay of the newest still-active action, +15% per extra action —
  // max (not Σ) so event count can't outweigh fame (see www scoreActor)
  let recMax = 0
  let n = 0
  for (const e of events) {
    if (!e.active) continue
    recMax = Math.max(recMax, 2 ** (-Math.max(0, nowMs - Date.parse(e.ts)) / (60 * 86_400_000)))
    n++
  }
  return fame * ratio * recMax * (1 + 0.15 * Math.max(0, n - 1))
}

/** Agent-digestible roll-up of recent high-profile (non-OA) actors — for feeding applitrack etc. */
async function apiActorsSummary(url: URL, env: Env): Promise<Response> {
  const months = Math.max(1, parseInt(url.searchParams.get('months') ?? '6', 10))
  const since = url.searchParams.get('since') ?? new Date(Date.now() - months * 30 * 86_400_000).toISOString().slice(0, 10)
  const minFollowers = Math.max(0, parseInt(url.searchParams.get('min_followers') ?? '100', 10))
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500)
  const sinceTs = `${since}T00:00:00Z`
  const [{ results: actors }, evByLogin] = await Promise.all([
    env.DB
      .prepare(
        `SELECT a.login, a.name, a.company, a.location, a.bio, a.blog, a.twitter, a.followers, a.following,
                a.star_sum, a.bsky_handle, a.bsky_followers, a.x_followers, a.orgs
         FROM actors a
         WHERE a.followers >= ? AND ${NOT_OA}
         AND EXISTS (SELECT 1 FROM events e JOIN slack_posts sp ON sp.event_id = e.id
                     WHERE e.login = a.login AND e.kind IN ('star', 'follow') AND e.ts >= ?)
         ORDER BY a.followers DESC LIMIT 1000`,
      )
      .bind(minFollowers, sinceTs)
      .all<SummaryActor>(),
    postedEventsByLogin(env, sinceTs),
  ])
  const nowMs = Date.now()
  // Rank the full eligible set before applying `limit` — interest order ≠ follower order
  const out = actors
    .map(a => ({
      ...a,
      orgs: a.orgs ? (JSON.parse(a.orgs) as string[]) : [],
      interest: Math.round(interestScore(a, evByLogin.get(a.login) ?? [], nowMs) * 10) / 10,
      events: (evByLogin.get(a.login) ?? []).map(({ login: _, ...e }) => e),
    }))
    .sort((x, y) => y.interest - x.interest || y.followers - x.followers)
    .slice(0, limit)
  const meta = { since, min_followers: minFollowers, generated_at: new Date().toISOString(), n: out.length }
  if (url.searchParams.get('format') === 'md') {
    const fmtN = (n: number) => n.toLocaleString('en-US')
    const lines = [
      `# High-profile GitHub actors on watched OA/marin repos · since ${since}`,
      '',
      `Criteria: ≥${minFollowers} followers, ≥1 star/follow on a watched target; Open Athena / marin-community members excluded. ${out.length} actors, ranked by interest (log-followers × follower-ratio × recency-decayed still-active actions, 60d half-life). Generated ${meta.generated_at}.`,
      '',
    ]
    for (const a of out) {
      const title = a.name ? `${a.name} ([${a.login}](https://github.com/${a.login}))` : `[${a.login}](https://github.com/${a.login})`
      const reach = [
        `${fmtN(a.followers)} GH followers${a.following != null ? ` / ${fmtN(a.following)} following` : ''}`,
        a.bsky_followers != null && `${fmtN(a.bsky_followers)} bsky`,
        a.x_followers != null && `${fmtN(a.x_followers)} X`,
      ].filter(Boolean).join(', ')
      lines.push(`## ${title} · interest ${a.interest} · ${reach}`)
      const where = [a.company, a.location].filter(Boolean).join(' · ')
      if (where) lines.push(`- ${where}`)
      if (a.bio) lines.push(`- ${a.bio}`)
      if (a.orgs.length) lines.push(`- orgs: ${a.orgs.join(', ')}`)
      const links = [
        a.twitter && `[x.com/${a.twitter}](https://x.com/${a.twitter})`,
        a.bsky_handle && `[bsky.app/profile/${a.bsky_handle}](https://bsky.app/profile/${a.bsky_handle})`,
        a.blog && (a.blog.startsWith('http') ? a.blog : `https://${a.blog}`),
      ].filter(Boolean)
      if (links.length) lines.push(`- links: ${links.join(' · ')}`)
      for (const e of a.events) {
        const verb = e.kind === 'star' || e.kind === 'unstar' ? `${e.kind}red` : `${e.kind}ed`
        lines.push(`- ${verb} ${e.target} · ${e.ts.slice(0, 10)}${e.active ? '' : ' (no longer active)'}`)
      }
      lines.push('')
    }
    return new Response(lines.join('\n'), {
      headers: { 'content-type': 'text/markdown; charset=utf-8', 'access-control-allow-origin': '*' },
    })
  }
  return json({ ...meta, actors: out })
}

/** One-round-trip pipeline snapshot for the FE /health page (ctbk pattern). */
async function apiHealth(env: Env): Promise<Response> {
  const [runs, eventCounts, latestEvent, starState, followState] = await env.DB.batch([
    env.DB.prepare('SELECT id, started_at, finished_at, ok, n_events, error, alerted, full_sweep, n_repos, n_skipped FROM runs ORDER BY id DESC LIMIT 20'),
    env.DB.prepare('SELECT source, kind, count(*) AS count FROM events GROUP BY source, kind ORDER BY source, kind'),
    env.DB.prepare('SELECT ts, kind, target, login FROM events ORDER BY id DESC LIMIT 1'),
    env.DB.prepare('SELECT count(*) AS stars, count(DISTINCT repo) AS repos FROM stars'),
    env.DB.prepare('SELECT count(*) AS follows, count(DISTINCT target) AS targets FROM follows'),
  ])
  const runRows = runs.results as Array<{ ok: number | null }>
  const lastOk = runRows.find(r => r.ok === 1) ?? null
  let consecutiveFailures = 0
  for (const r of runRows) {
    if (r.ok === 1) break
    if (r.ok === 0) consecutiveFailures++
  }
  return json({
    now: new Date().toISOString(),
    lastOk,
    consecutiveFailures,
    runs: runs.results,
    events: { counts: eventCounts.results, latest: latestEvent.results[0] ?? null },
    state: { ...(starState.results[0] as object), ...(followState.results[0] as object) },
  })
}

async function apiStatus(env: Env): Promise<Response> {
  const { results: runs } = await env.DB
    .prepare('SELECT id, started_at, finished_at, ok, n_events, error, alerted FROM runs ORDER BY id DESC LIMIT 20')
    .all<{ ok: number | null }>()
  const lastOk = runs.find(r => r.ok === 1) ?? null
  let consecutiveFailures = 0
  for (const r of runs) {
    if (r.ok === 1) break
    if (r.ok === 0) consecutiveFailures++
  }
  return json({ lastOk, consecutiveFailures, runs })
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === WEEKLY_CRON) {
      ctx.waitUntil(weeklySummary(env).catch(e => console.error('weeklySummary failed:', e)))
      return
    }
    // Minute check matters at sub-hourly cron cadence: sweep once at HH:00, not every tick of the hour
    const d = new Date(event.scheduledTime)
    const fullSweep = d.getUTCHours() === parseInt(env.FULL_SWEEP_HOUR) && d.getUTCMinutes() === 0
    ctx.waitUntil(
      runCollection(env, fullSweep).catch(e => console.error('runCollection failed:', e)),
    )
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    if (path.startsWith('/api/auth/')) return handleAuth(req, env)

    if (path === '/api/events') return apiEvents(url, env)
    if (path === '/api/targets') return apiTargets(env)
    if (path === '/api/counts') return apiCounts(url, env)
    if (path === '/api/actors' || path === '/api/actors/summary' || path === '/api/actors/cards') {
      const gate = gateFor(env)
      const auth = gate && await gate.authenticate(req)
      if (!auth || !hasScope(auth, 'internal')) return json({ error: 'unauthenticated' }, 401)
      if (path === '/api/actors/summary') return apiActorsSummary(url, env)
      return path === '/api/actors/cards' ? apiActorCards(url, env) : apiActors(url, env)
    }
    if (path === '/api/series') return apiSeries(url, env)
    if (path === '/api/status') return apiStatus(env)
    if (path === '/api/health') return apiHealth(env)
    if (path === '/api/runs') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 1000)
      const { results } = await env.DB
        .prepare('SELECT id, started_at, finished_at, ok, n_events, error, alerted, full_sweep, n_repos, n_skipped FROM runs ORDER BY id DESC LIMIT ?')
        .bind(limit)
        .all<{ id: number; n_events: number | null }>()
      const withEvents = results.filter(r => (r.n_events ?? 0) > 0).map(r => r.id)
      const evByRun = new Map<number, unknown[]>()
      if (withEvents.length) {
        const evs = await chunkedAll<{ run_id: number }>(
          env.DB,
          withEvents,
          ph => `SELECT run_id, ts, kind, target, login FROM events WHERE run_id IN (${ph})`,
        )
        for (const e of evs) {
          if (!evByRun.has(e.run_id)) evByRun.set(e.run_id, [])
          evByRun.get(e.run_id)!.push(e)
        }
      }
      return json({ now: new Date().toISOString(), runs: results.map(r => ({ ...r, events: evByRun.get(r.id) ?? [] })) })
    }
    if (path === '/api/summaries') {
      const { results } = await env.DB
        .prepare('SELECT week_start, created_at, text, stats, slack_ts FROM summaries ORDER BY week_start DESC LIMIT 12')
        .all()
      return json({ summaries: results })
    }

    if (path === '/summary-preview') {
      const denied = keyGate(req, env)
      if (denied) return denied
      const stats = await buildWeekStats(env)
      // Mirror the real routing: threaded rollup when the week opened a thread,
      // standalone summary otherwise (specs/weekly-rollup.md)
      const opTs = await getWeeklyThread(env, stats.weekStart)
      return json({
        text: opTs ? renderRollup(stats, env.DASHBOARD_URL) : renderSummary(stats, env.DASHBOARD_URL),
        thread_ts: opTs,
        stats,
      })
    }

    // Rebuild a week's live-thread scoreboard from D1. The OP is only rewritten when its
    // week sees new events, so a week whose updates failed (or whose data was fixed after
    // the fact) stays wrong forever without a way to force the rebuild.
    if (path === '/weekly-refresh') {
      const denied = keyGate(req, env)
      if (denied) return denied
      const week = url.searchParams.get('week') ?? weekStartOf(new Date().toISOString())
      const opTs = await getWeeklyThread(env, week)
      if (!opTs) return json({ error: `no weekly thread for ${week}` }, 404)
      const closed = url.searchParams.get('closed') === '1'
      await updateWeeklyOp(env, week, opTs, { closed })
      return json({ week, ts: opTs, closed })
    }

    if (path === '/check') {
      const denied = keyGate(req, env)
      if (denied) return denied
      const fullSweep = url.searchParams.get('full') === '1'
      try {
        return json(await runCollection(env, fullSweep))
      } catch (e) {
        return json({ error: (e as Error).message }, 500)
      }
    }

    if (path === '/test-pushover') {
      const denied = keyGate(req, env)
      if (denied) return denied
      try {
        const sent = await sendPushover(env, { title: '🧪 watchy test', message: 'Pushover wiring is working.' })
        return json({ sent, ...(sent ? {} : { note: 'PUSHOVER_TOKEN/PUSHOVER_USER not configured' }) })
      } catch (e) {
        return json({ error: (e as Error).message }, 500)
      }
    }

    return new Response(
      'watchy: /api/events, /api/targets, /api/counts?target=, /api/actors, /api/status, /check, /test-pushover\n',
      { status: path === '/' ? 200 : 404 },
    )
  },
}
