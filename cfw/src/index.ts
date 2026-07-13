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
    .prepare('UPDATE runs SET finished_at = ?, ok = ?, n_events = ?, error = ? WHERE id = ?')
    .bind(new Date().toISOString(), result.ok ? 1 : 0, result.nEvents, result.error ?? null, runId)
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
    headers: { 'content-type': 'application/json' },
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
  const before = url.searchParams.get('before')
  if (target) { wheres.push('target = ?'); binds.push(target) }
  if (kind) {
    if (!EVENT_KINDS.includes(kind)) return json({ error: `kind must be one of ${EVENT_KINDS.join(', ')}` }, 400)
    wheres.push('kind = ?'); binds.push(kind)
  }
  if (login) { wheres.push('login LIKE ?'); binds.push(`%${login}%`) }
  if (before) { wheres.push('id < ?'); binds.push(parseInt(before)) }
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500)
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''
  const { results } = await env.DB
    .prepare(`SELECT id, ts, kind, target, uid, login, source, sha FROM events ${where} ORDER BY id DESC LIMIT ?`)
    .bind(...binds, limit)
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
    const fullSweep = new Date(event.scheduledTime).getUTCHours() === parseInt(env.FULL_SWEEP_HOUR)
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
