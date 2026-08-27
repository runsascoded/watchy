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
