import { INTERNAL } from './scope'

// Internal build (gh.oa.dev) is same-origin: /api/* proxies to the worker
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
  // unstar/unfollow only: ts of the star/follow being undone, when observed
  prior_ts?: string | null
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

export interface ActorEvent {
  ts: string
  kind: string
  target: string
  active: number // star/follow still present in current state
}

/** `/api/actors` — gated (`internal`): the derived fields below are ours, not GitHub's. */
export interface Actor {
  login: string
  name: string | null
  company: string | null
  location: string | null
  bio: string | null
  blog: string | null
  twitter: string | null
  followers: number | null
  following: number | null
  public_repos: number | null
  gh_created_at: string | null
  orgs: string | null
  star_sum: number | null
  top_repos: string | null // JSON [{n: full_name, s: stars}], top 3 by stars
  bsky_handle: string | null
  bsky_followers: number | null
  x_followers: number | null
  li_url: string | null // curated LI profile (else we fall back to a name search)
  li_company_url: string | null
  n_events: number
  first_ts: string
  last_ts: string
  events: ActorEvent[]
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
