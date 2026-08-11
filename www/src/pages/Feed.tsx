import { useQuery } from '@tanstack/react-query'
import { boolParam, stringParam, useUrlState } from 'use-prms'
import { get, type Event, type TargetCount } from '../api'
import { inScope } from '../scope'
import { Tooltip } from '../components/Tooltip'
import { TargetLink } from '../target'

const KIND_EMOJI: Record<Event['kind'], string> = {
  star: '⭐️',
  unstar: '💔',
  follow: '🔔',
  unfollow: '🔕',
}
const KIND_VERB: Record<Event['kind'], string> = {
  star: 'starred',
  unstar: 'unstarred',
  follow: 'followed',
  unfollow: 'unfollowed',
}

function day(ts: string): string {
  return ts.slice(0, 10)
}

function time(ts: string): string {
  return ts.slice(11, 16) + 'Z'
}

export default function Feed() {
  // Filters + view mode live in the URL (use-prms): ?k=star&t=…&l=…&g
  const [kind, setKind] = useUrlState('k', stringParam(''))
  const [target, setTarget] = useUrlState('t', stringParam(''))
  const [login, setLogin] = useUrlState('l', stringParam(''))
  const [byRepo, setByRepo] = useUrlState('g', boolParam)

  // Over-fetch since the scope filter drops the other variant's events client-side
  const params = new URLSearchParams({ limit: '500' })
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

  const events = (data?.events ?? []).filter(e => inScope(e.target))
  const byDay = new Map<string, Event[]>()
  for (const e of events) {
    const d = day(e.ts)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(e)
  }

  const targetOptions = [
    ...(targets?.stars ?? []).map(t => t.target),
    ...(targets?.follows ?? []).map(t => t.target),
  ].filter(inScope)

  const line = (e: Event, showTarget: boolean) => (
    <li key={e.id}>
      <span className="emoji">{KIND_EMOJI[e.kind]}</span>
      <a href={`https://github.com/${e.login}`} className="login">{e.login}</a>
      {showTarget && <>{' '}{KIND_VERB[e.kind]}{' '}<TargetLink target={e.target} /></>}
      <Tooltip tip={e.ts}><span className="ts">{time(e.ts)}</span></Tooltip>
      {e.source === 'git' && <Tooltip tip={`backfilled from .watchy@${e.sha}`}><span className="source">git</span></Tooltip>}
    </li>
  )

  return (
    <div className="feed">
      <div className="filters">
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">all kinds</option>
          <option value="star">⭐️ star</option>
          <option value="unstar">💔 unstar</option>
          <option value="follow">🔔 follow</option>
          <option value="unfollow">🔕 unfollow</option>
        </select>
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">all targets</option>
          {targetOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="login contains…" value={login} onChange={e => setLogin(e.target.value)} />
        <label className="toggle">
          <input type="checkbox" checked={byRepo} onChange={e => setByRepo(e.target.checked)} />
          group by repo
        </label>
      </div>
      {isLoading && <p className="dim">loading…</p>}
      {error && <p className="error">{String(error)}</p>}
      {[...byDay.entries()].map(([d, dayEvents]) => {
        if (!byRepo) {
          return (
            <section key={d}>
              <h2>{d}</h2>
              <ul>{dayEvents.map(e => line(e, true))}</ul>
            </section>
          )
        }
        const byTarget = new Map<string, Event[]>()
        for (const e of dayEvents) {
          if (!byTarget.has(e.target)) byTarget.set(e.target, [])
          byTarget.get(e.target)!.push(e)
        }
        return (
          <section key={d}>
            <h2>{d}</h2>
            {[...byTarget.entries()].map(([t, evs]) => (
              <div className="repo-group" key={t}>
                <h3>
                  <TargetLink target={t} />
                  <span className="dim"> · {evs.length}</span>
                </h3>
                <ul>{evs.map(e => line(e, false))}</ul>
              </div>
            ))}
          </section>
        )
      })}
      {!isLoading && events.length === 0 && <p className="dim">no events match</p>}
    </div>
  )
}
