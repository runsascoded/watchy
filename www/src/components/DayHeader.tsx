import type { ReactNode } from 'react'
import type { DayRollup, Event } from '../api'
import { KIND_EMOJI, kindTotals } from '../kinds'
import { shortName } from '../target'
import { Tooltip } from './Tooltip'

const TOP_TARGETS = 3
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Days are UTC buckets (`ts.slice(0, 10)`), same as the times on each line. */
function parts(day: string): { dow: number; year: string; md: string } {
  const d = new Date(`${day}T00:00:00Z`)
  return { dow: d.getUTCDay(), year: day.slice(0, 4), md: day.slice(5) }
}

/**
 * `Tue 08-25` — the weekday is the point (engagement is weekday-shaped), and the year
 * is noise within the current one. Month-day stays ISO-ordered rather than `8/25`:
 * the column still sorts by eye, and it doesn't read as a different date abroad.
 */
export function dayLabel(day: string, now: Date = new Date()): string {
  const { dow, year, md } = parts(day)
  return `${WEEKDAYS[dow]} ${year === String(now.getUTCFullYear()) ? md : day}`
}

/** What the short label drops, plus how long ago it was. */
export function dayLong(day: string, now: Date = new Date()): string {
  const { dow } = parts(day)
  const days = Math.round((Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
  const rel = days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 0 ? `in ${-days} days` : `${days} days ago`
  return `${WEEKDAYS_LONG[dow]}, ${day} · ${rel}`
}

function dots(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((n, i) => (i ? [<span key={`sep${i}`}> · </span>, n] : [n]))
}

/**
 * A day's rule, doubling as its summary and its collapse control.
 *
 * A 200-event day buries the days around it, and scrolling past it to find out it was
 * "118 stars on marin" is the wrong way to learn that. So the counts live in the header
 * the day already had, and the whole day folds away from the same click.
 *
 * Every stat is suppressed when it says nothing: the actor count only when someone acted
 * twice, the target list only when there's more than one, the whole line on a day too
 * small to summarize.
 */
export function DayHeader({ day, rollup, closed, showTargets, onToggle, target, onTarget, now }: {
  day: string
  /** The whole day's totals — absent until `/api/days` lands, or if it failed */
  rollup?: DayRollup
  closed: boolean
  /** Off under group-by-repo, where the per-target headings already say this */
  showTargets: boolean
  onToggle: () => void
  /** The feed's active target filter (`?t=`), so the matching chip reads as selected */
  target?: string
  onTarget?: (target: string) => void
  now?: Date
}) {
  const targets = new Map<string, number>()
  let total = 0
  for (const c of rollup?.cells ?? []) {
    targets.set(c.target, (targets.get(c.target) ?? 0) + c.n)
    total += c.n
  }
  // Name as tiebreak, so equal counts don't reorder between renders
  const top = [...targets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  const bits: ReactNode[] = kindTotals(rollup?.cells ?? []).map(([k, n]) => (
    <span key={k} className="n">{n} {KIND_EMOJI[k]}</span>
  ))
  if (rollup && rollup.actors < total) bits.push(<span key="actors" className="n">{rollup.actors} actors</span>)
  // With a target filter on, the day is single-target by construction — keep the lone
  // chip anyway, lit, so the click that filtered can also unfilter
  if (showTargets && (top.length > 1 || (target && top.length === 1))) {
    bits.push(...top.slice(0, TOP_TARGETS).map(([t, n]) => {
      const on = t === target
      return (
        <Tooltip key={t} tip={<>{t}<span className="dim"> · {on ? 'clear filter' : 'filter to this'}</span></>}>
          <button type="button" className={`chip${on ? ' on' : ''}`} onClick={() => onTarget?.(on ? '' : t)}>
            {shortName(t)} {n}
          </button>
        </Tooltip>
      )
    }))
    const rest = top.slice(TOP_TARGETS)
    if (rest.length) {
      bits.push(
        <Tooltip
          key="more"
          tip={<span className="more-tip">{rest.map(([t, n]) => <span key={t}>{t} <b>{n}</b></span>)}</span>}
        >
          <span className="more">+{rest.length} more</span>
        </Tooltip>,
      )
    }
  }

  return (
    <h2 className="day">
      <Tooltip tip={dayLong(day, now)}>
        <button type="button" className="day-toggle" onClick={onToggle} aria-expanded={!closed}>
          <span className="caret">{closed ? '▸' : '▾'}</span>
          {dayLabel(day, now)}
        </button>
      </Tooltip>
      {/* A collapsed day has nothing else on screen, so it always states its size */}
      {(closed || total > 2) && <span className="day-stats">{dots(bits)}</span>}
    </h2>
  )
}
