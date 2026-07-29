import { collect, type CollectResult, type Env } from './collect'
import { maybeAlert } from './alerts'
import { sendPushover } from './pushover'

async function runCollection(env: Env, fullSweep: boolean): Promise<CollectResult> {
  const startedAt = new Date().toISOString()
  const { meta } = await env.DB
    .prepare('INSERT INTO runs (started_at) VALUES (?)')
    .bind(startedAt)
    .run()
  const runId = meta.last_row_id

  let result: CollectResult
  try {
    result = await collect(env, fullSweep)
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
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''
  // Event-time order, not insertion order: bootstrap star events carry starred_at
  // timestamps spanning years, so id-order would clump them at the end
  const { results } = await env.DB
    .prepare(`SELECT id, ts, kind, target, uid, login, source, sha FROM events ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
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

    if (path === '/api/events') return apiEvents(url, env)
    if (path === '/api/targets') return apiTargets(env)
    if (path === '/api/counts') return apiCounts(url, env)
    if (path === '/api/status') return apiStatus(env)
    if (path === '/api/health') return apiHealth(env)

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
      'watchy: /api/events, /api/targets, /api/counts?target=, /api/status, /check, /test-pushover\n',
      { status: path === '/' ? 200 : 404 },
    )
  },
}
