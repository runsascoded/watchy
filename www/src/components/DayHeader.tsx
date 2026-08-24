import type { DayRollup, Event } from '../api'
import { KIND_EMOJI } from '../kinds'

const KIND_ORDER: Event['kind'][] = ['star', 'unstar', 'follow', 'unfollow']
const TOP_TARGETS = 3

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
export function DayHeader({ day, rollup, closed, showTargets, onToggle }: {
  day: string
  /** The whole day's totals — absent until `/api/days` lands, or if it failed */
  rollup?: DayRollup
  closed: boolean
  /** Off under group-by-repo, where the per-target headings already say this */
  showTargets: boolean
  onToggle: () => void
}) {
  const kinds = new Map<Event['kind'], number>()
  const targets = new Map<string, number>()
  let total = 0
  for (const c of rollup?.cells ?? []) {
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + c.n)
    targets.set(c.target, (targets.get(c.target) ?? 0) + c.n)
    total += c.n
  }
  // Name as tiebreak, so equal counts don't reorder between renders
  const top = [...targets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const bits: string[] = KIND_ORDER.filter(k => kinds.has(k)).map(k => `${kinds.get(k)} ${KIND_EMOJI[k]}`)
  if (rollup && rollup.actors < total) bits.push(`${rollup.actors} actors`)
  if (showTargets && top.length > 1) {
    bits.push(...top.slice(0, TOP_TARGETS).map(([t, n]) => `${t.split('/').pop()} ${n}`))
    if (top.length > TOP_TARGETS) bits.push(`+${top.length - TOP_TARGETS} more`)
  }

  return (
    <h2 className="day">
      <button
        type="button"
        className="day-toggle"
        onClick={onToggle}
        aria-expanded={!closed}
        title={closed ? 'expand' : 'collapse'}
      >
        <span className="caret">{closed ? '▸' : '▾'}</span>
        {day}
      </button>
      {/* A collapsed day has nothing else on screen, so it always states its size */}
      {(closed || total > 2) && <span className="day-stats">{bits.join(' · ')}</span>}
    </h2>
  )
}
