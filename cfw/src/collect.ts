import { GhError, listFollowers, listRepos, listStargazers } from './github'

export interface Env {
  DB: D1Database
  WATCHY_TOKEN: string
  TARGETS_JSON: string
  FULL_SWEEP_HOUR: string
  PUSHOVER_TOKEN?: string
  PUSHOVER_USER?: string
  MANUAL_CHECK_KEY?: string
}

interface Targets {
  stars: string[]
  follows: string[]
}

export interface CollectResult {
  ok: boolean
  fullSweep: boolean
  nEvents: number
  reposFetched: number
  skipped: string[]  // repos that 403/404'd (expected states post-restriction)
  error?: string
}

const BATCH_SIZE = 100

async function runBatched(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + BATCH_SIZE))
  }
}

/**
 * One collection pass. Loads all current state up-front (2 queries), diffs in
 * memory, and writes deltas only. On non-full-sweep runs, repos whose observed
 * `stargazers_count` matches stored state are skipped entirely (count-delta gate).
 */
export async function collect(env: Env, fullSweep: boolean): Promise<CollectResult> {
  const db = env.DB
  const targets = JSON.parse(env.TARGETS_JSON) as Targets
  const obsTs = new Date().toISOString()
  const result: CollectResult = { ok: true, fullSweep, nEvents: 0, reposFetched: 0, skipped: [] }

  // repo -> uid -> {login, starred_at}
  const starState = new Map<string, Map<number, { login: string }>>()
  const starCounts = new Map<string, number>()
  const { results: starRows } = await db.prepare('SELECT repo, uid, login FROM stars').all<{ repo: string; uid: number; login: string }>()
  for (const r of starRows) {
    let m = starState.get(r.repo)
    if (!m) starState.set(r.repo, (m = new Map()))
    m.set(r.uid, { login: r.login })
    starCounts.set(r.repo, (starCounts.get(r.repo) ?? 0) + 1)
  }
  const followState = new Map<string, Map<number, { login: string }>>()
  const { results: followRows } = await db.prepare('SELECT target, uid, login FROM follows').all<{ target: string; uid: number; login: string }>()
  for (const r of followRows) {
    let m = followState.get(r.target)
    if (!m) followState.set(r.target, (m = new Map()))
    m.set(r.uid, { login: r.login })
  }

  const stmts: D1PreparedStatement[] = []
  const insEvent = db.prepare("INSERT INTO events (ts, kind, target, uid, login, source) VALUES (?, ?, ?, ?, ?, 'live')")
  const insStar = db.prepare('INSERT INTO stars (repo, uid, login, starred_at) VALUES (?, ?, ?, ?)')
  const delStar = db.prepare('DELETE FROM stars WHERE repo = ? AND uid = ?')
  const updStarLogin = db.prepare('UPDATE stars SET login = ? WHERE repo = ? AND uid = ?')
  const insFollow = db.prepare('INSERT INTO follows (target, uid, login) VALUES (?, ?, ?)')
  const delFollow = db.prepare('DELETE FROM follows WHERE target = ? AND uid = ?')
  const updFollowLogin = db.prepare('UPDATE follows SET login = ? WHERE target = ? AND uid = ?')
  const insCount = db.prepare('INSERT OR REPLACE INTO counts (ts, target, count) VALUES (?, ?, ?)')

  for (const owner of targets.stars) {
    const repos = await listRepos(env.WATCHY_TOKEN, owner)
    for (const repo of repos) {
      const name = repo.full_name
      const stateCount = starCounts.get(name) ?? 0
      const countChanged = repo.stargazers_count !== stateCount
      if (countChanged || fullSweep) {
        stmts.push(insCount.bind(obsTs, name, repo.stargazers_count))
      }
      if (!countChanged && !fullSweep) continue

      let gazers
      try {
        gazers = await listStargazers(env.WATCHY_TOKEN, name)
      } catch (e) {
        // 403/404 are expected states since GitHub's 2026-06 stargazer restriction
        // (lost collaborator access, repo deleted/renamed) — skip, don't fail the run.
        if (e instanceof GhError && (e.status === 403 || e.status === 404)) {
          result.skipped.push(`${name}: ${e.status}`)
          continue
        }
        throw e
      }
      result.reposFetched++

      const prev = starState.get(name) ?? new Map<number, { login: string }>()
      const seen = new Set<number>()
      for (const g of gazers) {
        seen.add(g.uid)
        const old = prev.get(g.uid)
        if (!old) {
          stmts.push(insEvent.bind(g.starred_at ?? obsTs, 'star', name, g.uid, g.login))
          stmts.push(insStar.bind(name, g.uid, g.login, g.starred_at))
          result.nEvents++
        } else if (old.login !== g.login) {
          stmts.push(updStarLogin.bind(g.login, name, g.uid))  // rename, not an event
        }
      }
      for (const [uid, { login }] of prev) {
        if (!seen.has(uid)) {
          stmts.push(insEvent.bind(obsTs, 'unstar', name, uid, login))
          stmts.push(delStar.bind(name, uid))
          result.nEvents++
        }
      }
    }
  }

  for (const target of targets.follows) {
    const followers = await listFollowers(env.WATCHY_TOKEN, target)
    const prev = followState.get(target) ?? new Map<number, { login: string }>()
    const seen = new Set<number>()
    for (const f of followers) {
      seen.add(f.uid)
      const old = prev.get(f.uid)
      if (!old) {
        stmts.push(insEvent.bind(obsTs, 'follow', target, f.uid, f.login))
        stmts.push(insFollow.bind(target, f.uid, f.login))
        result.nEvents++
      } else if (old.login !== f.login) {
        stmts.push(updFollowLogin.bind(f.login, target, f.uid))
      }
    }
    for (const [uid, { login }] of prev) {
      if (!seen.has(uid)) {
        stmts.push(insEvent.bind(obsTs, 'unfollow', target, uid, login))
        stmts.push(delFollow.bind(target, uid))
        result.nEvents++
      }
    }
    if (fullSweep || followers.length !== prev.size) {
      stmts.push(insCount.bind(obsTs, target, followers.length))
    }
  }

  await runBatched(db, stmts)
  return result
}
