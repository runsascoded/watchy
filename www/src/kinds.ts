import type { Event } from './api'

// The one definition, for every surface: feed lines, day and repo headers, the Health
// timeline, the Actors table, and the OG cards. Two of those used to carry their own copy,
// with a bare ⭐ instead of ⭐️ — the variation selector is what forces emoji presentation,
// so the same event rendered as a flat glyph on one page and a color one on another.
// `scripts/gen-pfp.py` keeps a fourth copy by necessity (different language, and it
// rasterizes the glyph rather than rendering it); keep it in step by hand.
export const KIND_EMOJI: Record<Event['kind'], string> = {
  star: '⭐️',
  unstar: '💔',
  follow: '🔔',
  unfollow: '🔕',
}

/** Emoji for a kind that isn't statically known to be one: the Health timeline, the Actors
 * table and the OG cards read `kind` off row types that declare it as a bare string. Falls
 * back to the raw value, so an unrecognized kind shows up rather than rendering blank.
 *
 * KIND_EMOJI itself stays keyed to the union — that is what makes adding a fifth kind a
 * type error here instead of a silent gap in the feed. */
export function kindEmoji(kind: string): string {
  return KIND_EMOJI[kind as Event['kind']] ?? kind
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
