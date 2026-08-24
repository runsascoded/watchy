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
