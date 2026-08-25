import type { Event } from './api'

// Lifted out of pages/Feed.tsx so the day headers render the same glyphs as the lines
// under them. (There are older copies in components/EventTimeline.tsx and pages/Actors.tsx
// using a bare ⭐ rather than ⭐️ — not consolidated here, since changing what the other
// pages render isn't this change's business.)
export const KIND_EMOJI: Record<Event['kind'], string> = {
  star: '⭐️',
  unstar: '💔',
  follow: '🔔',
  unfollow: '🔕',
}

export const KIND_VERB: Record<Event['kind'], string> = {
  star: 'starred',
  unstar: 'unstarred',
  follow: 'followed',
  unfollow: 'unfollowed',
}

/** Gains before losses, stars before follows — a fixed order, so a day whose mix
 * changes doesn't reshuffle the header under you. */
export const KIND_ORDER: Event['kind'][] = ['star', 'unstar', 'follow', 'unfollow']

/** Roll `/api/days` cells up by kind, dropping the kinds a day (or repo) has none of. */
export function kindTotals(cells: readonly { kind: Event['kind']; n: number }[]): Array<[Event['kind'], number]> {
  const totals = new Map<Event['kind'], number>()
  for (const c of cells) totals.set(c.kind, (totals.get(c.kind) ?? 0) + c.n)
  return KIND_ORDER.filter(k => totals.has(k)).map(k => [k, totals.get(k)!])
}
