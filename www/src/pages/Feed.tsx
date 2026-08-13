import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { boolParam, stringParam, useUrlState } from 'use-prms'
import { get, type Event, type TargetCount } from '../api'
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

/** Rough human age between two ISO timestamps ("16d", "8mo", "1.5y"). */
function age(from: string, to: string): string {
  const d = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (d < 1) return '<1d'
  if (d < 60) return `${Math.round(d)}d`
  if (d < 730) return `${Math.round(d / 30.44)}mo`
  return `${(d / 365.25).toFixed(1)}y`
}

const PAGE = 100

export default function Feed() {
  // Filters + view mode live in the URL (use-prms): ?k=star&t=…&l=…&g
  const [kind, setKind] = useUrlState('k', stringParam(''))
  const [target, setTarget] = useUrlState('t', stringParam(''))
  const [login, setLogin] = useUrlState('l', stringParam(''))
  const [byRepo, setByRepo] = useUrlState('g', boolParam)

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['events', kind, target, login],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (kind) params.set('kind', kind)
      if (target) params.set('target', target)
      if (login) params.set('login', login)
      if (pageParam) {
        params.set('before_ts', pageParam.ts)
        params.set('before_id', String(pageParam.id))
      }
      return get<{ events: Event[] }>(`/api/events?${params}`)
    },
    initialPageParam: null as null | { ts: string; id: number },
    getNextPageParam: last => {
      const tail = last.events[last.events.length - 1]
      return last.events.length === PAGE ? { ts: tail.ts, id: tail.id } : undefined
    },
  })
  const { data: targets } = useQuery({
    queryKey: ['targets'],
    queryFn: () => get<{ stars: TargetCount[]; follows: TargetCount[] }>('/api/targets'),
  })

  // Load-more sentinel: fetch the next page as it nears the viewport
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) fetchNextPage() }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [fetchNextPage])

  const events = data?.pages.flatMap(p => p.events) ?? []
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

  const line = (e: Event, showTarget: boolean) => (
    <li key={e.id}>
      <span className="emoji">{KIND_EMOJI[e.kind]}</span>
      <a href={`https://github.com/${e.login}`} className="login">{e.login}</a>
      {showTarget && <>{' '}{KIND_VERB[e.kind]}{' '}<TargetLink target={e.target} /></>}
      {e.prior_ts && (
        <Tooltip tip={`${e.kind === 'unstar' ? 'starred' : 'followed'} ${e.prior_ts.slice(0, 10)}`}>
          <span className="prior dim"> ({e.kind === 'unstar' ? '⭐' : '🔔'} {age(e.prior_ts, e.ts)} earlier)</span>
        </Tooltip>
      )}
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
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="dim">loading more…</p>}
      {!isLoading && !hasNextPage && events.length > 0 && <p className="dim">— end of history —</p>}
    </div>
  )
}
