import type { ActorCardFields } from '../api'
import { Avatar } from './Avatar'

const fmt = (n: number | null) => n?.toLocaleString() ?? ''

/**
 * GH-hovercard-style preview, built entirely from enrichment data (no OG fetch
 * needed). Every field here is visible on the actor's GitHub profile — the
 * derived tier (research prose, cross-platform handles, LinkedIn) deliberately
 * stays out, so this card is safe anywhere the viewer is allowed to see actors
 * at all. Shared by the Actors table and the Feed (specs/feed-details.md).
 */
export function ActorCard({ a }: { a: ActorCardFields }) {
  const where = [a.company, a.location].filter(Boolean).join(' · ')
  return (
    <div className="card">
      <Avatar login={a.login} size={96} />
      <div>
        <div><b>{a.name ?? a.login}</b>{a.name && <span className="dim"> · {a.login}</span>}</div>
        {where && <div className="dim">{where}</div>}
        <div>
          {fmt(a.followers)} followers
          {a.following != null && <span className="dim"> · {fmt(a.following)} following</span>}
          {a.star_sum != null && a.star_sum > 0 && <span className="dim"> · {fmt(a.star_sum)} ⭐</span>}
        </div>
        {a.bio && <div className="card-bio">{a.bio}</div>}
      </div>
    </div>
  )
}
