// Default to the prod worker so `pnpm dev` works without a local api (ctbk pattern).
// Same-origin when served by the worker itself; override with VITE_API_BASE.
export const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (location.port === '4199' ? 'https://watchy.ryan-0dc.workers.dev' : '')

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
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`)
  return resp.json()
}
