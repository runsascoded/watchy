import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get, type Event, type TargetCount } from '../api'

const KIND_EMOJI: Record<Event['kind'], string> = {
  star: '⭐️',
  unstar: '💔',
  follow: '📣',
  unfollow: '🔇',
}
const KIND_VERB: Record<Event['kind'], string> = {
  star: 'starred',
  unstar: 'unstarred',
  follow: 'followed',
  unfollow: 'unfollowed',
}

function targetUrl(e: Event): string {
  return `https://github.com/${e.target}`
}

function day(ts: string): string {
  return ts.slice(0, 10)
}

function time(ts: string): string {
  return ts.slice(11, 16) + 'Z'
}

export default function Feed() {
  const [kind, setKind] = useState('')
  const [target, setTarget] = useState('')
  const [login, setLogin] = useState('')

  const params = new URLSearchParams({ limit: '200' })
  if (kind) params.set('kind', kind)
  if (target) params.set('target', target)
  if (login) params.set('login', login)

  const { data, isLoading, error } = useQuery({
    queryKey: ['events', kind, target, login],
    queryFn: () => get<{ events: Event[] }>(`/api/events?${params}`),
  })
  const { data: targets } = useQuery({
    queryKey: ['targets'],
    queryFn: () => get<{ stars: TargetCount[]; follows: TargetCount[] }>('/api/targets'),
  })

  const events = data?.events ?? []
  const byDay = new Map<string, Event[]>()
  for (const e of events) {
    const d = day(e.ts)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(e)
  }

  const targetOptions = [
    ...(targets?.stars ?? []).map(t => t.target),
    ...(targets?.follows ?? []).map(t => t.target),
  ]

  return (
    <div className="feed">
      <div className="filters">
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">all kinds</option>
          <option value="star">⭐️ star</option>
          <option value="unstar">💔 unstar</option>
          <option value="follow">📣 follow</option>
          <option value="unfollow">🔇 unfollow</option>
        </select>
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">all targets</option>
          {targetOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="login contains…" value={login} onChange={e => setLogin(e.target.value)} />
      </div>
      {isLoading && <p className="dim">loading…</p>}
      {error && <p className="error">{String(error)}</p>}
      {[...byDay.entries()].map(([d, dayEvents]) => (
        <section key={d}>
          <h2>{d}</h2>
          <ul>
            {dayEvents.map(e => (
              <li key={e.id}>
                <span className="emoji">{KIND_EMOJI[e.kind]}</span>
                <a href={`https://github.com/${e.login}`} className="login">{e.login}</a>
                {' '}{KIND_VERB[e.kind]}{' '}
                <a href={targetUrl(e)} className="target">{e.target}</a>
                <span className="ts" title={e.ts}>{time(e.ts)}</span>
                {e.source === 'git' && <span className="source" title={`backfilled from .watchy@${e.sha}`}>git</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!isLoading && events.length === 0 && <p className="dim">no events match</p>}
    </div>
  )
}
