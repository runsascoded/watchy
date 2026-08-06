import { useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { get, type TargetCount } from '../api'

const { max, min, round } = Math

const W = 800
const H = 260
const PAD = { l: 44, r: 12, t: 8, b: 22 }
const N_SLOTS = 7
const DEFAULT_SEL = 4

interface Point { ts: string; count: number }

function fmtDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

function yTicks(yMax: number): number[] {
  const step = [1, 2, 5].map(s => s * 10 ** max(0, String(round(yMax / 4)).length - 1)).find(s => yMax / s <= 5) ?? 1
  const ticks = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  return ticks
}

/** Step-after multi-series line chart with crosshair + tooltip. */
function SeriesChart({ title, series }: {
  title: string
  series: { name: string; slot: number; points: Point[] }[]
}) {
  const [hover, setHover] = useState<number | null>(null) // hovered time (ms)
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
    let prevY: number | null = null
    for (const p of points) {
      const x = px(Date.parse(p.ts))
      const y = py(p.count)
      d += d ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`
      prevY = y
    }
    if (prevY != null) d += `H${px(x1).toFixed(1)}`
    return d
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
    const fx = ((e.clientX - rect.left) / rect.width) * W
    if (fx < PAD.l || fx > W - PAD.r) return setHover(null)
    setHover(x0 + ((fx - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0))
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
    // Thin to ≤10 labels, keeping January (year boundaries) aligned when stepping by 3/6/12
    const step = [1, 2, 3, 6, 12].find(s => all.length / s <= 10) ?? 12
    return all.filter(t => new Date(t).getUTCMonth() % step === (step > 2 ? 0 : new Date(all[0]).getUTCMonth() % step))
  }, [x0, x1])

  return (
    <div className="chart">
      <h2>{title}</h2>
      <div className="legend">
        {series.map(s => (
          <span key={s.name} className="li">
            <span className="swatch" style={{ background: `var(--s${s.slot + 1})` }} />
            {s.name}
            {hover != null && s.points.length > 0 && <b>{valueAt(s.points, hover)?.toLocaleString() ?? ''}</b>}
          </span>
        ))}
        {hover != null && <span className="li dim">{fmtDate(hover)}</span>}
      </div>
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
          <path key={s.name} d={path(s.points)} fill="none" strokeWidth={2} stroke={`var(--s${s.slot + 1})`} />
        ))}
        {hover != null && <line className="xhair" x1={px(hover)} x2={px(hover)} y1={PAD.t} y2={H - PAD.b} />}
      </svg>
    </div>
  )
}

function Picker({ options, sel, setSel }: {
  options: { target: string; slot: number }[]
  sel: Set<string>
  setSel: (s: Set<string>) => void
}) {
  return (
    <div className="picker">
      {options.map(o => (
        <label key={o.target} className={sel.has(o.target) ? 'on' : ''}>
          <input
            type="checkbox"
            checked={sel.has(o.target)}
            disabled={!sel.has(o.target) && sel.size >= N_SLOTS}
            onChange={e => {
              const next = new Set(sel)
              e.target.checked ? next.add(o.target) : next.delete(o.target)
              setSel(next)
            }}
          />
          <span className="swatch" style={{ background: `var(--s${o.slot + 1})` }} />
          {o.target}
        </label>
      ))}
    </div>
  )
}

function useSeries(targets: string[]) {
  return useQueries({
    queries: targets.map(t => ({
      queryKey: ['series', t],
      queryFn: () => get<{ series: Point[] }>(`/api/series?target=${encodeURIComponent(t)}`),
      staleTime: 300_000,
    })),
  })
}

function Section({ title, all }: { title: string; all: TargetCount[] }) {
  // Stable color slots: position in the full (count-sorted) list, independent of selection
  const options = useMemo(() => all.slice(0, N_SLOTS).map((t, i) => ({ target: t.target, slot: i })), [all])
  const [sel, setSel] = useState<Set<string>>(() => new Set(options.slice(0, DEFAULT_SEL).map(o => o.target)))
  const active = options.filter(o => sel.has(o.target))
  const results = useSeries(active.map(o => o.target))
  const series = active.map((o, i) => ({ name: o.target, slot: o.slot, points: results[i].data?.series ?? [] }))
  return (
    <>
      <SeriesChart title={title} series={series} />
      <Picker options={options} sel={sel} setSel={setSel} />
    </>
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
