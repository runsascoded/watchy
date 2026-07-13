import { useQuery } from '@tanstack/react-query'
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

export default function Health() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => get<HealthData>('/api/health'),
    refetchInterval: 60_000,
  })
  if (isLoading) return <p className="dim">loading…</p>
  if (error || !data) return <p className="error">{String(error)}</p>

  const { now, lastOk, consecutiveFailures, runs, events, state } = data
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
      <h3>Recent runs</h3>
      <table className="runs">
        <thead>
          <tr>
            <th>id</th><th>started</th><th>dur</th><th>ok</th><th>events</th>
            <th>repos</th><th>skipped</th><th>sweep</th><th>error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className={r.ok === 0 ? 'failed' : ''}>
              <td>{r.id}</td>
              <td title={r.started_at}>{ago(r.started_at, now)}</td>
              <td>{duration(r)}</td>
              <td>{r.ok === 1 ? '✅' : r.ok === 0 ? '❌' : '…'}</td>
              <td className="num">{r.n_events ?? ''}</td>
              <td className="num">{r.n_repos ?? ''}</td>
              <td className="num">{r.n_skipped ?? ''}</td>
              <td>{r.full_sweep ? 'full' : ''}</td>
              <td className="error">{r.error ?? ''}{r.alerted ? ' 📟' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
