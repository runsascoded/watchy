import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get, type Event } from '../api'
import { KIND_EMOJI } from '../components/EventTimeline'
import { OgHeader } from '../components/OgHeader'

const N = 14

const KIND_VERB: Record<Event['kind'], string> = {
  star: 'starred',
  unstar: 'unstarred',
  follow: 'followed',
  unfollow: 'unfollowed',
}

/** Rough age ("3h", "2d", "8mo") of an ISO ts. */
const age = (ts: string) => {
  const h = (Date.now() - Date.parse(ts)) / 3_600_000
  if (h < 1) return '<1h'
  if (h < 48) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 60) return `${Math.round(d)}d`
  return `${Math.round(d / 30.44)}mo`
}

/** Chrome-less 1200×630 recent-feed snapshot — the homepage og:image
 * (screenshotted to public/og.jpg). */
export default function Og() {
  const { data } = useQuery({
    queryKey: ['og-events'],
    queryFn: () => get<{ events: Event[] }>(`/api/events?limit=${N}`),
  })
  const events = data?.events ?? []
  // Hold data-ready until every avatar has decoded — scrns keys its capture on
  // the attribute, and half-loaded avatars leave blank gaps in the card
  const [avisReady, setAvisReady] = useState(false)
  useEffect(() => {
    if (!events.length) return
    Promise.allSettled(
      events.filter(e => e.uid != null).map(e => {
        const img = new Image()
        img.src = `https://avatars.githubusercontent.com/u/${e.uid}?s=96`
        return img.decode()
      }),
    ).then(() => setAvisReady(true))
  }, [events.length])
  return (
    <div className="og-page og-feed" data-ready={(events.length > 0 && avisReady) || undefined}>
      <OgHeader tagline="GitHub stars + follows — live feed · graphs · Slack" />
      <ul>
        {events.map(e => (
          <li key={e.id}>
            <span className="emoji">{KIND_EMOJI[e.kind]}</span>
            {e.uid != null && <img className="avi" src={`https://avatars.githubusercontent.com/u/${e.uid}?s=96`} alt="" />}
            <b>{e.login}</b>
            <span className="dim">{KIND_VERB[e.kind]}</span>
            <span className="tgt">{e.target.split('/').pop()}</span>
            <span className="dim age">{age(e.ts)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
