/**
 * Day folds are stored as *exceptions to a default*, not as a list of collapsed days.
 *
 * The list-of-collapsed-days model can only name days that exist yet, and the feed pages in
 * more as you scroll — so "collapse all" collapsed what was loaded, the shorter page pulled
 * the next page in, and those days arrived open, looking like the button had undone itself.
 * A default plus exceptions has no such gap: a day that arrives later simply takes the
 * default. `?ca` flips the default to closed; `?c` lists the days that differ from it.
 */
export function isDayClosed(day: string, except: Set<string>, closedByDefault: boolean): boolean {
  return except.has(day) !== closedByDefault
}

/**
 * How much of the day list can be drawn right now.
 *
 * A collapsed day costs nothing: its header is entirely from `/api/days`, which returns the
 * whole history in one request. Only an *open* day needs rows, and rows arrive newest-first
 * a page at a time — so the list runs free until the first open day the event stream hasn't
 * reached. That day is the frontier: it shows what it has, the load-more sentinel goes after
 * it, and days below it wait for paging to catch up.
 *
 * Collapse everything and there is no frontier, so the entire history renders at once and
 * nothing pages at all — which is the point. Fetching a page per collapsed day was what
 * made "collapse all" visibly grind: fetch, render, collapse, repeat.
 *
 * @param days     every known day, newest first
 * @param closed   does this day render collapsed?
 * @param loaded   have this day's events all arrived?
 */
export function visibleDays(
  days: string[],
  closed: (day: string) => boolean,
  loaded: (day: string) => boolean,
): { shown: string[]; frontier: boolean } {
  const shown: string[] = []
  for (const day of days) {
    shown.push(day)
    if (!closed(day) && !loaded(day)) return { shown, frontier: true }
  }
  return { shown, frontier: false }
}
