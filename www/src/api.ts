import { INTERNAL } from './scope'

// Internal build (watchy.oa.dev) is same-origin: /api/* proxies to the worker
// via a Pages Function so the auth cookie flows (see specs/auth-gate.md); the
// vite dev server proxies the same paths. Public builds hit the prod worker
// cross-origin (ctbk pattern) except on workers.dev itself. VITE_API_BASE overrides.
export const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (INTERNAL || location.hostname.endsWith('.workers.dev') ? '' : 'https://watchy.ryan-0dc.workers.dev')

export class ApiError extends Error {
  constructor(public status: number, path: string) {
    super(`${path}: ${status}`)
  }
}

export interface Event {
  id: number
  ts: string
  kind: 'star' | 'unstar' | 'follow' | 'unfollow'
  target: string
  uid: number | null
  login: string
  source: 'live' | 'git'
  sha: string | null
}

export interface RunEvent {
  run_id: number
  ts: string
  kind: string
  target: string
  login: string
}

export interface Run {
  id: number
  started_at: string
  finished_at: string | null
  ok: number | null
  n_events: number | null
  error: string | null
  alerted: number
  full_sweep: number | null
  n_repos: number | null
  n_skipped: number | null
  events?: RunEvent[]
}

export interface Health {
  now: string
  lastOk: Run | null
  consecutiveFailures: number
  runs: Run[]
  events: {
    counts: Array<{ source: string; kind: string; count: number }>
    latest: { ts: string; kind: string; target: string; login: string } | null
  }
  state: { stars: number; repos: number; follows: number; targets: number }
}

export interface TargetCount {
  target: string
  count: number
}

export async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`)
  if (!resp.ok) throw new ApiError(resp.status, path)
  return resp.json()
}

export async function post<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!resp.ok) throw new ApiError(resp.status, path)
  return resp.json()
}
