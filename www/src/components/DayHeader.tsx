import type { Event } from '../api'
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
export function DayHeader({ day, events, closed, showTargets, onToggle }: {
  day: string
  events: Event[]
  closed: boolean
  /** Off under group-by-repo, where the per-target headings already say this */
  showTargets: boolean
  onToggle: () => void
}) {
  const kinds = new Map<Event['kind'], number>()
  const targets = new Map<string, number>()
  const logins = new Set<string>()
  for (const e of events) {
    kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
    targets.set(e.target, (targets.get(e.target) ?? 0) + 1)
    logins.add(e.login)
  }
  const top = [...targets.entries()].sort((a, b) => b[1] - a[1])
  const bits: string[] = KIND_ORDER.filter(k => kinds.has(k)).map(k => `${kinds.get(k)} ${KIND_EMOJI[k]}`)
  if (logins.size < events.length) bits.push(`${logins.size} actors`)
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
      {(closed || events.length > 2) && <span className="day-stats">{bits.join(' · ')}</span>}
    </h2>
  )
}
