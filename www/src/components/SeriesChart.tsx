import { useId, useMemo, useRef, useState } from 'react'

const { max, min, floor, ceil, log10 } = Math

export const W = 800
export const H = 260
const PAD = { l: 44, r: 12, t: 8, b: 22 }

export interface Point { ts: string; count: number }
export interface Series { target: string; slot: number; label: string; owner: string; points: Point[] }

const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 10)

function yTicks(y0: number, y1: number): number[] {
  const range = max(1, y1 - y0)
  const mag = 10 ** floor(log10(max(1, range / 5)))
  const step = ([1, 2, 5, 10].find(s => range / (s * mag) <= 5) ?? 10) * mag
  const ticks = []
  for (let v = ceil(y0 / step) * step; v <= y1; v += step) ticks.push(v)
  return ticks
}

/** Step-after multi-series line chart; values live in a cursor-following hover box (HB).
 * Legend-driven interaction (pltly semantics): `active = pinned ?? hovered` fades the
 * other series; a pin additionally rescales the y-domain to the pinned series alone
 * (off-domain neighbors stay faded, clipped at the plot edge). */
export function SeriesChart({ series, hovered, pinned }: { series: Series[]; hovered?: string | null; pinned?: string | null }) {
  const active = pinned ?? hovered ?? null
  const [hover, setHover] = useState<{ t: number; cx: number; cy: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const clipId = useId()
  const loaded = series.filter(s => s.points.length)

  const { x0, x1, y0, y1 } = useMemo(() => {
    const ts = loaded.flatMap(s => [Date.parse(s.points[0].ts), Date.parse(s.points[s.points.length - 1].ts)])
    // Data-driven y-domain (not zero-based) so small recent deltas stay visible;
    // pinned solo → domain from that series only
    const dom = pinned != null ? loaded.filter(s => s.target === pinned) : loaded
    const counts = dom.flatMap(s => s.points.map(p => p.count))
    const lo = counts.length ? min(...counts) : 0
    const hi = counts.length ? max(...counts) : 1
    const pad = max(1, (hi - lo) * 0.05)
    return {
      x0: ts.length ? min(...ts) : 0,
      x1: Date.now(),
      y0: max(0, lo - pad),
      y1: hi + pad,
    }
  }, [loaded, pinned])

  const px = (t: number) => PAD.l + ((t - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
  const py = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b)

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
        {yTicks(y0, y1).map(v => (
          <g key={v}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={py(v)} y2={py(v)} />
            <text className="tick" x={PAD.l - 6} y={py(v) + 3} textAnchor="end">{v.toLocaleString()}</text>
          </g>
        ))}
        {months.map(t => (
          <text key={t} className="tick" x={px(t)} y={H - 6} textAnchor="middle">{new Date(t).toISOString().slice(0, 7)}</text>
        ))}
        <clipPath id={clipId}>
          <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          {/* Active series drawn last (on top) */}
          {(active != null ? [...loaded].sort((a, b) => +(a.target === active) - +(b.target === active)) : loaded).map(s => (
            <path
              key={s.target}
              className={`series${active != null && s.target !== active ? ' faded' : ''}`}
              d={path(s.points)} fill="none" strokeWidth={2} stroke={`var(--s${s.slot + 1})`}
            />
          ))}
        </g>
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
