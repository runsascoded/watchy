import { useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Tooltip } from '../components/Tooltip'
import { get, type TargetCount } from '../api'
import { inScope, owner } from '../scope'

const { max, min, floor, log10 } = Math

const W = 800
const H = 260
const PAD = { l: 44, r: 12, t: 8, b: 22 }
const N_SLOTS = 7

interface Point { ts: string; count: number }
interface Series { target: string; slot: number; label: string; owner: string; points: Point[] }

const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 10)

function Favicon({ login }: { login: string }) {
  return <img className="favicon" src={`https://github.com/${login}.png?size=32`} alt="" />
}

function yTicks(yMax: number): number[] {
  const mag = 10 ** floor(log10(max(1, yMax / 5)))
  const step = ([1, 2, 5, 10].find(s => yMax / (s * mag) <= 5) ?? 10) * mag
  const ticks = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  return ticks
}

/** Step-after multi-series line chart; values live in a cursor-following hover box (HB). */
function SeriesChart({ series }: { series: Series[] }) {
  const [hover, setHover] = useState<{ t: number; cx: number; cy: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const loaded = series.filter(s => s.points.length)

  const { x0, x1, yMax } = useMemo(() => {
    const ts = loaded.flatMap(s => [Date.parse(s.points[0].ts), Date.parse(s.points[s.points.length - 1].ts)])
    return {
      x0: ts.length ? min(...ts) : 0,
      x1: Date.now(),
      yMax: max(1, ...loaded.flatMap(s => s.points.map(p => p.count))) * 1.05,
    }
  }, [loaded])

  const px = (t: number) => PAD.l + ((t - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
  const py = (v: number) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b)

  function path(points: Point[]): string {
    let d = ''
    for (const p of points) {
      const x = px(Date.parse(p.ts)).toFixed(1)
      const y = py(p.count).toFixed(1)
      d += d ? `H${x}V${y}` : `M${x},${y}`
    }
    return d ? d + `H${px(x1).toFixed(1)}` : d
  }

  function valueAt(points: Point[], t: number): number | null {
    let v: number | null = null
    for (const p of points) {
      if (Date.parse(p.ts) > t) break
      v = p.count
    }
    return v
  }

  function onMove(e: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    const wrap = wrapRef.current!.getBoundingClientRect()
    const fx = ((e.clientX - rect.left) / rect.width) * W
    if (fx < PAD.l || fx > W - PAD.r) return setHover(null)
    setHover({
      t: x0 + ((fx - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0),
      cx: e.clientX - wrap.left,
      cy: e.clientY - wrap.top,
    })
  }

  const months = useMemo(() => {
    const all: number[] = []
    const d = new Date(x0)
    d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0)
    d.setUTCMonth(d.getUTCMonth() + 1)
    while (d.getTime() < x1) {
      all.push(d.getTime())
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
    const step = [1, 2, 3, 6, 12].find(s => all.length / s <= 10) ?? 12
    return all.filter(t => new Date(t).getUTCMonth() % step === (step > 2 ? 0 : new Date(all[0]).getUTCMonth() % step))
  }, [x0, x1])

  const hb = hover && loaded
    .map(s => ({ ...s, v: valueAt(s.points, hover.t) }))
    .filter(s => s.v != null)
    .sort((a, b) => b.v! - a.v!)
  const hbRight = hover != null && hover.cx > (wrapRef.current?.clientWidth ?? W) / 2

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks(yMax).map(v => (
          <g key={v}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={py(v)} y2={py(v)} />
            <text className="tick" x={PAD.l - 6} y={py(v) + 3} textAnchor="end">{v.toLocaleString()}</text>
          </g>
        ))}
        {months.map(t => (
          <text key={t} className="tick" x={px(t)} y={H - 6} textAnchor="middle">{new Date(t).toISOString().slice(0, 7)}</text>
        ))}
        {loaded.map(s => (
          <path key={s.target} d={path(s.points)} fill="none" strokeWidth={2} stroke={`var(--s${s.slot + 1})`} />
        ))}
        {hover != null && <line className="xhair" x1={px(hover.t)} x2={px(hover.t)} y1={PAD.t} y2={H - PAD.b} />}
      </svg>
      {hb && hb.length > 0 && (
        <div className="hb" style={hbRight ? { right: (wrapRef.current!.clientWidth - hover!.cx) + 12, top: hover!.cy + 8 } : { left: hover!.cx + 12, top: hover!.cy + 8 }}>
          <div className="hb-date">{fmtDate(hover!.t)}</div>
          {hb.map(s => (
            <div key={s.target} className="hb-row">
              <span className="swatch" style={{ background: `var(--s${s.slot + 1})` }} />
              <span className="hb-name">{s.label}</span>
              <b>{s.v!.toLocaleString()}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** One section: unified legend (click LI to remove) + filter input to add targets. */
function Section({ title, all }: { title: string; all: TargetCount[] }) {
  const [sel, setSel] = useState<Map<string, number>>(
    () => new Map(all.slice(0, 4).map((t, i) => [t.target, i])),
  )
  const [q, setQ] = useState('')

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
    <div className="chart">
      <h2>{title}</h2>
      <div className="legend">
        {series.map(s => (
          <Tooltip key={s.target} tip={`${s.target} — click to remove`}>
          <button className="li" onClick={() => remove(s.target)}>
            <span className="swatch" style={{ background: `var(--s${s.slot + 1})` }} />
            <Favicon login={s.owner} />
            {s.label}
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
      <SeriesChart series={series} />
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
      <Section title="Repo stars" all={data.stars.filter(t => inScope(t.target))} />
      <Section title="Followers" all={data.follows.filter(t => inScope(t.target))} />
      <p className="dim">
        Reconstructed from the event log (6-month backfill), anchored to current totals; hover for values.
      </p>
    </div>
  )
}
