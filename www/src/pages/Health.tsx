import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { get, type Health as HealthData, type Run } from '../api'

function ago(iso: string, now: string): string {
  const min = Math.max(0, Math.floor((Date.parse(now) - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}m ago`
  return `${Math.floor(h / 24)}d ${h % 24}h ago`
}

function duration(r: Run): string {
  if (!r.finished_at) return '…'
  return `${Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)}s`
}

function cellIcon(r: Run): string {
  if (r.ok === 0) return '❌'
  if (r.ok == null) return '⏳'
  if ((r.n_events ?? 0) > 0) return '⭐'
  return '✅'
}

function runSummary(r: Run, now: string): string {
  const parts = [
    `run ${r.id}`,
    ago(r.started_at, now),
    duration(r),
    `${r.n_repos ?? '?'} repo${r.n_repos === 1 ? '' : 's'}`,
  ]
  if (r.n_events) parts.push(`${r.n_events} event${r.n_events === 1 ? '' : 's'}`)
  if (r.n_skipped) parts.push(`${r.n_skipped} skipped`)
  if (r.full_sweep) parts.push('full sweep')
  if (r.error) parts.push(r.error)
  return parts.join(' · ')
}

/** Sea-of-✅ tick grid: one cell per run, floating tooltip on hover, details pane on click. */
function RunsGrid({ now }: { now: string }) {
  const { data } = useQuery({
    queryKey: ['runs'],
    queryFn: () => get<{ now: string; runs: Run[] }>('/api/runs?limit=432'),
    refetchInterval: 60_000,
  })
  const [hovered, setHovered] = useState<Run | null>(null)
  const [selected, setSelected] = useState<Run | null>(null)
  const { refs, floatingStyles } = useFloating({
    open: hovered != null,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 4 })],
    whileElementsMounted: autoUpdate,
  })
  if (!data) return <p className="dim">loading…</p>
  const t = data.now ?? now

  return (
    <>
      <div className="runs-grid" onMouseLeave={() => setHovered(null)}>
        {data.runs.map(r => (
          <button
            key={r.id}
            className={`cell${r.full_sweep ? ' sweep' : ''}${selected?.id === r.id ? ' sel' : ''}`}
            onMouseEnter={e => { refs.setReference(e.currentTarget); setHovered(r) }}
            onClick={() => setSelected(selected?.id === r.id ? null : r)}
          >
            {cellIcon(r)}
          </button>
        ))}
      </div>
      {hovered && (
        <div ref={refs.setFloating} style={floatingStyles} className="tt">{runSummary(hovered, t)}</div>
      )}
      {selected && (
        <div className="run-detail">
          <h4>run {selected.id} {cellIcon(selected)}</h4>
          <dl>
            <dt>started</dt><dd>{selected.started_at} ({ago(selected.started_at, t)})</dd>
            <dt>duration</dt><dd>{duration(selected)}</dd>
            <dt>events</dt><dd>{selected.n_events ?? ''}</dd>
            <dt>repos</dt><dd>{selected.n_repos ?? ''} fetched, {selected.n_skipped ?? 0} skipped</dd>
            {selected.full_sweep ? <><dt>sweep</dt><dd>full</dd></> : null}
            {selected.error && <><dt>error</dt><dd className="error">{selected.error}{selected.alerted ? ' 📟' : ''}</dd></>}
          </dl>
        </div>
      )}
    </>
  )
}

export default function Health() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => get<HealthData>('/api/health'),
    refetchInterval: 60_000,
  })
  if (isLoading) return <p className="dim">loading…</p>
  if (error || !data) return <p className="error">{String(error)}</p>

  const { now, lastOk, consecutiveFailures, events, state } = data
  const stale = lastOk ? Date.parse(now) - Date.parse(lastOk.finished_at!) > 3 * 3_600_000 : true
  const status = consecutiveFailures > 0 ? '⚠️ failing' : stale ? '⚠️ stale' : '✅ healthy'

  const eventTotal = events.counts.reduce((n, c) => n + c.count, 0)

  return (
    <div className="health">
      <div className="cards">
        <div className="card">
          <h3>Pipeline</h3>
          <p className="big">{status}</p>
          <p>last OK: {lastOk ? `${ago(lastOk.finished_at!, now)} (run ${lastOk.id})` : 'never'}</p>
          {consecutiveFailures > 0 && <p className="error">{consecutiveFailures} consecutive failures</p>}
        </div>
        <div className="card">
          <h3>Events</h3>
          <p className="big">{eventTotal}</p>
          <table>
            <tbody>
              {events.counts.map(c => (
                <tr key={`${c.source}/${c.kind}`}>
                  <td>{c.source}</td><td>{c.kind}</td><td className="num">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.latest && (
            <p className="dim">
              latest: {events.latest.kind} {events.latest.target} ← {events.latest.login} ({ago(events.latest.ts, now)})
            </p>
          )}
        </div>
        <div className="card">
          <h3>State</h3>
          <p>{state.stars} stars across {state.repos} repos</p>
          <p>{state.follows} follows across {state.targets} targets</p>
        </div>
      </div>
      <h3>Recent runs <span className="dim">(newest first; ⭐ = tick with events; click for detail)</span></h3>
      <RunsGrid now={now} />
    </div>
  )
}
