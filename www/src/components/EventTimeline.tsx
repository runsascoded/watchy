import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { get, type Event } from '../api'
import { inScope } from '../scope'

const { max, min, floor } = Math

export const KIND_EMOJI: Record<string, string> = { star: '⭐', unstar: '💔', follow: '📣', unfollow: '🔇' }

const W = 800
const H = 150
const PAD = { l: 8, r: 8, axis: 16 }
const PLOT_W = W - PAD.l - PAD.r
const BUCKET_PX = 16
// Buckets stack emoji markers up to this; if any visible bucket exceeds it the
// whole view degrades to a continuous bar chart (discrete stacks stop scaling)
const MAX_STACK = 6
const BAR_TOP = 12
const HOUR = 3_600_000
const DAY = 24 * HOUR

const DAY_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const HOUR_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'short' })

const PRESETS: [string, number | null][] = [['7d', 7 * DAY], ['30d', 30 * DAY], ['90d', 90 * DAY], ['all', null]]

function ticks(t0: number, t1: number): { t: number; label: string }[] {
  const span = t1 - t0
  const out: { t: number; label: string }[] = []
  const d = new Date(t0)
  if (span > 1000 * DAY) {
    d.setMonth(0, 1); d.setHours(0, 0, 0, 0)
    d.setFullYear(d.getFullYear() + 1)
    const step = [1, 2, 5].find(s => span / (s * 365 * DAY) <= 10) ?? 5
    while (d.getTime() < t1) {
      if (d.getFullYear() % step === 0) out.push({ t: d.getTime(), label: String(d.getFullYear()) })
      d.setFullYear(d.getFullYear() + 1)
    }
  } else if (span > 150 * DAY) {
    d.setDate(1); d.setHours(0, 0, 0, 0)
    d.setMonth(d.getMonth() + 1)
    const step = [1, 3, 6].find(s => span / (s * 30 * DAY) <= 12) ?? 6
    while (d.getTime() < t1) {
      if (d.getMonth() % step === 0) out.push({ t: d.getTime(), label: MONTH_FMT.format(d) })
      d.setMonth(d.getMonth() + 1)
    }
  } else if (span > 3 * DAY) {
    d.setHours(24, 0, 0, 0)
    const step = [1, 2, 7, 14].find(s => span / (s * DAY) <= 12) ?? 14
    let i = 0
    while (d.getTime() < t1) {
      if (i % step === 0) out.push({ t: d.getTime(), label: DAY_FMT.format(d) })
      d.setDate(d.getDate() + 1)
      i++
    }
  } else {
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    const step = [1, 3, 6, 12].find(s => span / (s * HOUR) <= 12) ?? 12
    while (d.getTime() < t1) {
      if (d.getHours() % step === 0) out.push({ t: d.getTime(), label: HOUR_FMT.format(d) })
      d.setHours(d.getHours() + 1)
    }
  }
  return out
}

interface Hovered {
  events: Event[]
}

/** Pan/zoomable event timeline: drag to pan, wheel to zoom, click a cluster to zoom into it. */
export default function EventTimeline({ now }: { now: string }) {
  const { data } = useQuery({
    queryKey: ['all-events'],
    queryFn: () => get<{ events: Event[] }>('/api/events?limit=5000'),
    staleTime: 300_000,
    refetchInterval: 300_000,
  })
  const nowMs = Date.parse(now)
  const [domain, setDomain] = useState<[number, number]>([nowMs - 7 * DAY, nowMs])
  const [hovered, setHovered] = useState<Hovered | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; t0: number; t1: number } | null>(null)
  // Survives pointerup (unlike `drag`) so the ensuing click can be suppressed
  const moved = useRef(false)
  const { refs, floatingStyles } = useFloating({
    open: hovered != null,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 4 })],
    whileElementsMounted: autoUpdate,
  })

  const events = useMemo(
    () => (data?.events ?? []).filter(e => inScope(e.target)).sort((a, b) => a.ts.localeCompare(b.ts)),
    [data],
  )
  const minTs = events.length ? Date.parse(events[0].ts) : nowMs - 7 * DAY

  const [t0, t1] = domain
  const px = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * PLOT_W
  const clamp = (a: number, b: number): [number, number] => {
    const span = min(max(b - a, HOUR), nowMs - minTs + DAY)
    let lo = a
    if (lo < minTs - DAY) lo = minTs - DAY
    if (lo + span > nowMs + HOUR) lo = nowMs + HOUR - span
    return [lo, lo + span]
  }

  // Wheel zoom needs a non-passive listener to preventDefault page scroll
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const fx = ((e.clientX - rect.left) / rect.width) * W
      setDomain(([a, b]) => {
        const tc = a + ((fx - PAD.l) / PLOT_W) * (b - a)
        const f = e.deltaY > 0 ? 1.25 : 0.8
        return clamp(tc - (tc - a) * f, tc + (b - tc) * f)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [minTs, nowMs])

  const visible = events.filter(e => {
    const t = Date.parse(e.ts)
    return t >= t0 && t <= t1
  })

  // Bucket by pixel column; small buckets render stacked markers, big ones a count cluster
  const buckets = useMemo(() => {
    const m = new Map<number, Event[]>()
    for (const e of visible) {
      const b = floor((px(Date.parse(e.ts)) - PAD.l) / BUCKET_PX)
      if (!m.has(b)) m.set(b, [])
      m.get(b)!.push(e)
    }
    return [...m.entries()].map(([b, evs]) => ({ x: PAD.l + b * BUCKET_PX + BUCKET_PX / 2, evs }))
  }, [visible, t0, t1])

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, t0, t1 }
    moved.current = false
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const rect = svgRef.current!.getBoundingClientRect()
    const dx = e.clientX - drag.current.x
    if (Math.abs(dx) > 3) moved.current = true
    const dt = (dx / rect.width) * W / PLOT_W * (drag.current.t1 - drag.current.t0)
    setDomain(clamp(drag.current.t0 - dt, drag.current.t1 - dt))
  }
  function onPointerUp() {
    drag.current = null
  }

  const zoomTo = (evs: Event[]) => {
    if (moved.current) return
    const a = Date.parse(evs[0].ts)
    const b = Date.parse(evs[evs.length - 1].ts)
    const pad = max((b - a) * 0.5, HOUR)
    setDomain(clamp(a - pad, b + pad))
  }

  const maxCount = max(0, ...buckets.map(b => b.evs.length))
  const barMode = maxCount > MAX_STACK
  const barMaxH = H - PAD.axis - BAR_TOP
  // √ scale: one viral/bootstrap spike shouldn't crush every other bar to the floor
  const barH = (n: number) => max(2, Math.sqrt(n / maxCount) * barMaxH)

  if (!data) return <p className="dim">loading…</p>

  return (
    <div className="timeline" onMouseLeave={() => setHovered(null)}>
      <div className="tl-controls">
        {PRESETS.map(([label, span]) => (
          <button key={label} onClick={() => setDomain(span ? [nowMs - span, nowMs] : clamp(minTs - DAY, nowMs))}>{label}</button>
        ))}
        <span className="dim">{new Date(t0).toISOString().slice(0, 10)} → {new Date(t1).toISOString().slice(0, 10)} · {visible.length} events · drag to pan, wheel to zoom</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.axis} y2={H - PAD.axis} />
        {ticks(t0, t1).map(({ t, label }) => (
          <g key={t}>
            <line className="grid" x1={px(t)} x2={px(t)} y1={8} y2={H - PAD.axis} />
            <text className="tick" x={px(t) + 3} y={H - 4}>{label}</text>
          </g>
        ))}
        {barMode && (
          <g>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={BAR_TOP} y2={BAR_TOP} />
            <text className="tick" x={PAD.l} y={BAR_TOP - 3}>max {maxCount} (√ scale)</text>
          </g>
        )}
        {buckets.map(({ x, evs }) =>
          barMode ? (
            <rect
              key={`b${x}`}
              className="bar"
              x={x - BUCKET_PX / 2 + 1.5}
              width={BUCKET_PX - 3}
              y={H - PAD.axis - barH(evs.length)}
              height={barH(evs.length)}
              rx={2}
              onMouseEnter={ev => { refs.setReference(ev.currentTarget as unknown as Element); setHovered({ events: evs }) }}
              onClick={() => zoomTo(evs)}
            />
          ) : (
            evs.map((e, row) => (
              <text
                key={e.id}
                className="marker"
                x={x}
                y={H - PAD.axis - 6 - row * 13}
                textAnchor="middle"
                onMouseEnter={ev => { refs.setReference(ev.currentTarget as unknown as Element); setHovered({ events: [e] }) }}
                onClick={() => { if (!moved.current) window.open(`https://github.com/${e.login}`, '_blank') }}
              >
                {KIND_EMOJI[e.kind]}
              </text>
            ))
          ),
        )}
      </svg>
      {hovered && (
        <div ref={refs.setFloating} style={floatingStyles} className="tt">
          {hovered.events.slice(0, 6).map(e => (
            <div key={e.id}>
              {KIND_EMOJI[e.kind]} {e.login} {e.kind}{e.kind.endsWith('star') ? 'red' : 'ed'} {e.target} · {e.ts.slice(0, 16).replace('T', ' ')}Z
            </div>
          ))}
          {hovered.events.length > 6 && <div className="dim">+{hovered.events.length - 6} more — click to zoom in</div>}
        </div>
      )}
    </div>
  )
}
