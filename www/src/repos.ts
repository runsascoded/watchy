import type { DayRollup } from './api'

/**
 * The repos to list under a day in group-by-repo mode, in order.
 *
 * Loaded events give both membership and order — most recently active first — but only for
 * the slice of the day that has paged in, and a busy day pages in 100 events at a time. On
 * 2026-08-25 the first page covered 2 of the day's 5 repos, so the view quietly claimed the
 * day had two. `/api/days` knows the full set, and a folded repo needs nothing but its
 * counts, so repos with no loaded rows are appended rather than omitted — busiest first,
 * since their place in the activity order isn't known until paging reaches them.
 */
export function dayRepos(loaded: string[], cells: DayRollup['cells']): string[] {
  const seen = new Set(loaded)
  const rest = new Map<string, number>()
  for (const c of cells) {
    if (seen.has(c.target)) continue
    rest.set(c.target, (rest.get(c.target) ?? 0) + c.n)
  }
  const trailing = [...rest].sort(([a, na], [b, nb]) => nb - na || a.localeCompare(b)).map(([t]) => t)
  return [...loaded, ...trailing]
}
