import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tooltip } from './Tooltip'
import { get, type Health } from '../api'

/** "3m ago" from two ISO stamps — `now` comes from the server, so a skewed client clock can't produce a negative age. */
function ago(iso: string, now: string): string {
  const min = Math.max(0, Math.floor((Date.parse(now) - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const fmt = (n: number) => n.toLocaleString()

/**
 * What the header lockup means, plus the freshest log line. Shares the `health`
 * query key with the Health page, so whichever loads first warms the other.
 */
function HeroCard({ blurb }: { blurb: string }) {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => get<Health>('/api/health'),
    refetchInterval: 60_000,
  })
  const { lastOk, consecutiveFailures: fails, state, events, now } = data ?? {}
  const latest = events?.latest
  return (
    <div className="hero-tip">
      <div>{blurb}</div>
      {state && (
        <div className="dim">
          {fmt(state.stars)} ⭐ across {fmt(state.repos)} repos · {fmt(state.follows)} followers · {state.targets} targets
        </div>
      )}
      {/* The literal log line. A failing collector is the one thing worth shouting about here. */}
      {lastOk && now && (
        <div className={fails ? 'error' : 'dim'}>
          {fails
            ? `⚠ ${fails} consecutive failure${fails === 1 ? '' : 's'} — last ok run ${lastOk.id}, ${ago(lastOk.finished_at ?? lastOk.started_at, now)}`
            : `run ${lastOk.id} ok · ${ago(lastOk.finished_at ?? lastOk.started_at, now)}`}
        </div>
      )}
      {latest && now && (
        <div className="dim">latest: {latest.kind} {latest.target} ← {latest.login} · {ago(latest.ts, now)}</div>
      )}
    </div>
  )
}

/** Wraps the header brand mark; `blurb` is per-instance (each fork brands its own). */
export function HeroTip({ blurb, children }: { blurb: string; children: ReactNode }) {
  return <Tooltip tip={<HeroCard blurb={blurb} />}>{children}</Tooltip>
}
