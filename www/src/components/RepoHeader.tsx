import type { DayRollup } from '../api'
import { KIND_EMOJI, kindTotals } from '../kinds'
import { TargetLink } from '../target'
import { Caret } from './Caret'
import { Tooltip } from './Tooltip'

/**
 * A repo's heading inside a group-by-repo day: link, kind breakdown, fold control.
 *
 * Same bargain as the day header — the numbers describe the *repo's day*, from
 * `/api/days`, not the slice of it that happens to be loaded. `loaded` is the fallback
 * for the moment before the rollup lands (and if it never does).
 *
 * Folding is by repo rather than by (day, repo): the reason to fold `marin` is that its
 * 300 stars/day bury everything else, and wanting that on Tuesday but not Wednesday is
 * not a real preference. One click hides it everywhere; the state is a repo list in the
 * URL, not a matrix.
 */
export function RepoHeader({ target, cells, loaded, closed, onToggle }: {
  target: string
  /** This day's `/api/days` cells for this target (may be empty before the query lands) */
  cells: DayRollup['cells']
  loaded: number
  closed: boolean
  onToggle: () => void
}) {
  const totals = kindTotals(cells)
  const stats = totals.length
    ? totals.map(([k, n]) => `${n} ${KIND_EMOJI[k]}`).join(' · ')
    : String(loaded)

  return (
    <h3>
      <Tooltip tip={`${closed ? 'show' : 'hide'} ${target} — in every day`}>
        <button type="button" className="day-toggle" onClick={onToggle} aria-expanded={!closed} aria-label={`${closed ? 'show' : 'hide'} ${target}`}>
          <Caret closed={closed} />
        </button>
      </Tooltip>
      <TargetLink target={target} />
      {/* Redundant control, hidden from a11y: the caret above is the labelled one */}
      <button type="button" className="repo-stats" onClick={onToggle} tabIndex={-1} aria-hidden="true">
        {stats}
      </button>
    </h3>
  )
}
