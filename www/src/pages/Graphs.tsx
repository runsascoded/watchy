import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Tooltip } from '../components/Tooltip'
import { SeriesChart, type Point, type Series } from '../components/SeriesChart'
import { get, type TargetCount } from '../api'
import { owner } from '../scope'

const N_SLOTS = 7

function Favicon({ login }: { login: string }) {
  return <img className="favicon" src={`https://github.com/${login}.png?size=32`} alt="" />
}

/** One section: unified legend + filter input to add targets.
 * LI hover highlights its series; click pins ("solo": fades others + rescales
 * the y-domain to it); re-click / outside-click unpins; ✕ removes. */
function Section({ title, all }: { title: string; all: TargetCount[] }) {
  const [sel, setSel] = useState<Map<string, number>>(
    () => new Map(all.slice(0, 4).map((t, i) => [t.target, i])),
  )
  const [q, setQ] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Clicking outside this section un-pins (clicks within — chart hovers,
  // legend, adder — keep it)
  useEffect(() => {
    if (pinned == null) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPinned(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned])

  // Basename-only labels when unambiguous across the section's full target list
  const labels = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of all) {
      const base = t.target.split('/').pop()!
      counts.set(base, (counts.get(base) ?? 0) + 1)
    }
    return new Map(all.map(t => {
      const base = t.target.split('/').pop()!
      return [t.target, counts.get(base) === 1 ? base : t.target]
    }))
  }, [all])

  const add = (target: string) => {
    if (sel.size >= N_SLOTS || sel.has(target)) return
    const used = new Set(sel.values())
    const slot = [...Array(N_SLOTS).keys()].find(i => !used.has(i))!
    setSel(new Map(sel).set(target, slot))
    setQ('')
  }
  const remove = (target: string) => {
    const next = new Map(sel)
    next.delete(target)
    setSel(next)
    if (pinned === target) setPinned(null)
    if (hovered === target) setHovered(null)
  }

  const active = [...sel.entries()]
  const results = useQueries({
    queries: active.map(([t]) => ({
      queryKey: ['series', t],
      queryFn: () => get<{ series: Point[] }>(`/api/series?target=${encodeURIComponent(t)}`),
      staleTime: 300_000,
    })),
  })
  const series: Series[] = active.map(([target, slot], i) => ({
    target,
    slot,
    label: labels.get(target) ?? target,
    owner: owner(target),
    points: results[i].data?.series ?? [],
  }))

  const matches = q
    ? all.filter(t => !sel.has(t.target) && t.target.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className="chart" ref={rootRef}>
      <h2>{title}</h2>
      <div className="legend">
        {series.map(s => (
          <Tooltip key={s.target} tip={`${s.target} — click to ${pinned === s.target ? 'unpin' : 'spotlight'}, ✕ to remove`}>
          <button
            className={`li${pinned === s.target ? ' pinned' : ''}`}
            onMouseEnter={() => setHovered(s.target)}
            onMouseLeave={() => setHovered(h => (h === s.target ? null : h))}
            onClick={() => setPinned(p => (p === s.target ? null : s.target))}
          >
            <span className="swatch" style={{ background: `var(--s${s.slot + 1})` }} />
            <Favicon login={s.owner} />
            {s.label}
            <span className="rm" onClick={e => { e.stopPropagation(); remove(s.target) }}>✕</span>
          </button>
          </Tooltip>
        ))}
        <span className="adder">
          <input
            placeholder={sel.size >= N_SLOTS ? 'series limit reached' : '+ add…'}
            disabled={sel.size >= N_SLOTS}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches[0]) add(matches[0].target) }}
          />
          {matches.length > 0 && (
            <div className="matches">
              {matches.map(t => (
                <button key={t.target} onClick={() => add(t.target)}>
                  <Favicon login={owner(t.target)} />
                  {t.target} <span className="dim">{t.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      </div>
      <SeriesChart series={series} hovered={hovered} pinned={pinned} />
    </div>
  )
}

export default function Graphs() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['targets'],
    queryFn: () => get<{ stars: TargetCount[]; follows: TargetCount[] }>('/api/targets'),
  })
  if (isLoading) return <p className="dim">loading…</p>
  if (error || !data) return <p className="error">{String(error)}</p>
  return (
    <div className="graphs">
      <Section title="Repo stars" all={data.stars} />
      <Section title="Followers" all={data.follows} />
      <p className="dim">
        Reconstructed from the event log (6-month backfill), anchored to current totals; hover for values.
      </p>
    </div>
  )
}
