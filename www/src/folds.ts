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
 * Which days can be drawn, and which one the load-more sentinel belongs after.
 *
 * A collapsed day costs nothing: its header is entirely from `/api/days`, which returns the
 * whole history in one request. Only an *open* day needs rows, and rows arrive newest-first
 * a page at a time — so the first open day the stream hasn't reached is the frontier: it
 * shows what it has, and the sentinel goes after it. Open days below it are held back, or
 * the default view would be a wall of headers with no rows under them.
 *
 * Collapsed days are never held back, wherever they fall. Withholding them made opening one
 * day out of a collapsed history hide the other 783 — the day you opened became the frontier
 * and swallowed the rest of the list.
 *
 * With nothing open there is no frontier at all: the entire history renders at once and
 * nothing pages. Fetching a page per collapsed day was what made "collapse all" grind —
 * fetch, render, collapse, repeat — for rows that were never going to be shown.
 *
 * @param days   every known day, newest first
 * @param closed does this day render collapsed?
 * @param loaded have this day's events all arrived?
 */
export function visibleDays(
  days: string[],
  closed: (day: string) => boolean,
  loaded: (day: string) => boolean,
): { shown: string[]; frontier: string | null } {
  const shown: string[] = []
  let frontier: string | null = null
  for (const day of days) {
    if (!closed(day) && !loaded(day)) {
      if (frontier !== null) continue
      frontier = day
    }
    shown.push(day)
  }
  return { shown, frontier }
}

/**
 * Could any day be open? If not, the event query has nothing to fetch for — every header
 * on screen comes from `/api/days` — so it should not run at all.
 *
 * Deliberately answered from URL state alone, not from the day list: it gates the query
 * whose results the day list is partly built from, and reading `?ca`/`?c` is synchronous on
 * first render, so this costs nothing and cannot deadlock. It is conservative in one
 * direction — with the default open and every known day listed as an exception it still
 * says yes — which only means fetching a page that turns out to be unused.
 */
export function anyDayOpen(except: Set<string>, closedByDefault: boolean): boolean {
  return !closedByDefault || except.size > 0
}
