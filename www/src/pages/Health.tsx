import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import EventTimeline, { KIND_EMOJI } from '../components/EventTimeline'
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

function cellClass(r: Run): string {
  if (r.ok === 0) return 'fail'
  if (r.ok == null) return 'pending'
  if ((r.n_events ?? 0) > 0) return 'events'
  return 'ok'
}

const HOUR_MS = 3_600_000
const DAY_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const HOUR_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })

/** Label for the boundary crossed between a run and the next-older one (newest-first flow):
 * hour labels within the trailing 3h, day labels beyond. */
function boundaryLabel(newer: Run, older: Run, now: string): string | null {
  const a = new Date(newer.started_at)
  const b = new Date(older.started_at)
  if (a.getDate() !== b.getDate() || a.getMonth() !== b.getMonth()) return DAY_FMT.format(b)
  const recent = Date.parse(now) - a.getTime() < 3 * HOUR_MS
  if (recent && a.getHours() !== b.getHours()) return HOUR_FMT.format(new Date(a).setMinutes(0, 0, 0))
  return null
}

function RunTT({ r, now }: { r: Run; now: string }) {
  const parts = [
    `run ${r.id}`,
    `${r.started_at.slice(0, 16).replace('T', ' ')}Z`,
    ago(r.started_at, now),
    duration(r),
    `${r.n_repos ?? '?'} repo${r.n_repos === 1 ? '' : 's'}`,
  ]
  if (r.n_events && !r.events?.length) parts.push(`${r.n_events} event${r.n_events === 1 ? '' : 's'}`)
  if (r.n_skipped) parts.push(`${r.n_skipped} skipped`)
  if (r.full_sweep) parts.push('full sweep')
  if (r.error) parts.push(r.error)
  return (
    <>
      <div>{parts.join(' · ')}</div>
      {r.events?.map((e, i) => (
        <div key={i}>{KIND_EMOJI[e.kind]} {e.login} → {e.target}</div>
      ))}
    </>
  )
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
        {data.runs.map((r, i) => {
          const label = i > 0 ? boundaryLabel(data.runs[i - 1], r, t) : null
          return (
            <Fragment key={r.id}>
              {label && <span className="boundary">{label}</span>}
              <button
                className={`cell ${cellClass(r)}${r.full_sweep ? ' sweep' : ''}${selected?.id === r.id ? ' sel' : ''}`}
                onMouseEnter={e => { refs.setReference(e.currentTarget); setHovered(r) }}
                onClick={() => setSelected(selected?.id === r.id ? null : r)}
              >
                {r.ok === 0 ? '×' : (r.n_events ?? 0) > 0 ? r.n_events : ''}
              </button>
            </Fragment>
          )
        })}
      </div>
      {hovered && (
        <div ref={refs.setFloating} style={floatingStyles} className="tt"><RunTT r={hovered} now={t} /></div>
      )}
      {selected && (
        <div className="run-detail">
          <h4>run {selected.id} {selected.ok === 0 ? '❌' : selected.ok == null ? '⏳' : '✅'}</h4>
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
      <h3>Activity <span className="dim">(hover for who/what; click a marker for the actor, a cluster to zoom in)</span></h3>
      <EventTimeline now={now} />
      <h3>Recent runs <span className="dim">(newest first; gold = events, red = failure; click for detail)</span></h3>
      <RunsGrid now={now} />
    </div>
  )
}
