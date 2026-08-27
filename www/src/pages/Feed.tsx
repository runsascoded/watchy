import { useEffect, useRef } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { boolParam, datesParam, stringParam, useUrlState } from 'use-prms'
import { useActions } from 'use-kbd'
import { get, type ActorCardFields, type DayRollup, type Event, type TargetCount } from '../api'
import { ssoUrl, useWhoami } from '../auth'
import { ActorCard } from '../components/ActorCard'
import { Avatar } from '../components/Avatar'
import { Caret } from '../components/Caret'
import { DayHeader } from '../components/DayHeader'
import { RepoHeader } from '../components/RepoHeader'
import { TargetPicker } from '../components/TargetPicker'
import { Tooltip } from '../components/Tooltip'
import { TargetLink } from '../target'
import { isDayClosed, visibleDays } from '../folds'
import { targetParam, targetsParam } from '../params'
import { KIND_EMOJI, KIND_VERB } from '../kinds'
import { INTERNAL } from '../scope'

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
  const [target, setTarget] = useUrlState('t', targetParam)
  const [login, setLogin] = useUrlState('l', stringParam(''))
  const [byRepo, setByRepo] = useUrlState('g', boolParam)
  const [details, setDetails] = useUrlState('d', boolParam)
  // `?c=260818-24` records the days that *differ* from the default, so an empty param is
  // the default view and a shared link carries only what you changed. `?ca` flips the
  // default from open to closed, which is what "collapse all" has to mean: collapsing
  // shrinks the page, that pulls the next page in, and days arriving after the click must
  // obey the click too — otherwise the button appears to load fresh work undone. With `ca`
  // set, `c` lists the days you re-opened.
  const [closedByDefault, setClosedByDefault] = useUrlState('ca', boolParam)
  const [exceptDays, setExceptDays] = useUrlState('c', datesParam)
  const except = new Set(exceptDays)
  const isClosed = (d: string) => isDayClosed(d, except, closedByDefault)
  const toggleDay = (d: string) => {
    const next = new Set(except)
    if (!next.delete(d)) next.add(d)
    setExceptDays([...next])
  }
  // Both setters land: use-prms re-reads the live URL per write, and replaceState is sync.
  const collapseAll = () => { setClosedByDefault(true); setExceptDays([]) }
  const expandAll = () => { setClosedByDefault(false); setExceptDays([]) }
  // Repo folds are by repo, not by (day, repo) — see RepoHeader
  const [foldedRepos, setFoldedRepos] = useUrlState('rc', targetsParam)
  const folded = new Set(foldedRepos)
  const toggleRepo = (t: string) => {
    const next = new Set(folded)
    if (!next.delete(t)) next.add(t)
    setFoldedRepos([...next])
  }

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
  // Day headers summarize the whole day, so the totals come from the server — the loaded
  // pages only ever hold a prefix of a busy day (see api.ts `DayRollup`). Same filters as
  // the event query, so the header always describes the rows below it.
  const { data: dayData } = useQuery({
    queryKey: ['days', kind, target, login],
    queryFn: () => {
      const params = new URLSearchParams()
      if (kind) params.set('kind', kind)
      if (target) params.set('target', target)
      if (login) params.set('login', login)
      return get<{ days: DayRollup[] }>(`/api/days?${params}`)
    },
  })
  const rollups = new Map((dayData?.days ?? []).map(d => [d.day, d]))

  const { data: targets } = useQuery({
    queryKey: ['targets'],
    queryFn: () => get<{ stars: TargetCount[]; follows: TargetCount[] }>('/api/targets'),
  })

  const events = data?.pages.flatMap(p => p.events) ?? []
  const byDay = new Map<string, Event[]>()
  for (const e of events) {
    const d = day(e.ts)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(e)
  }

  // The day list comes from the rollups, not from the loaded events: `/api/days` returns the
  // whole history under the same filters, so every day header is available immediately and a
  // collapsed day never has to be paged to. `byDay` still contributes, in case a day's first
  // event lands between the two queries.
  //
  // Events arrive newest-first, so a day is fully loaded once the stream has passed it.
  const oldestLoaded = events.length ? day(events[events.length - 1].ts) : null
  const dayLoaded = (d: string) => !hasNextPage || (oldestLoaded !== null && oldestLoaded < d)
  const allDays = [...new Set([...rollups.keys(), ...byDay.keys()])].sort().reverse()
  const { shown, frontier } = visibleDays(allDays, isClosed, dayLoaded)

  // Load-more sentinel: fetch the next page as it nears the viewport, but only while a
  // frontier exists — with nothing open, no page would put a row on screen.
  //
  // Re-created per page rather than observed once, because IntersectionObserver only fires
  // on *changes*: a page that doesn't grow past the sentinel leaves it silently intersecting
  // and paging stops, so the observer has to be re-armed to re-check. Terminates when the
  // frontier closes, the headers push the sentinel out of range, or history runs out.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const pagesLoaded = data?.pages.length ?? 0
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !frontier || !hasNextPage || isFetchingNextPage) return
    const obs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) fetchNextPage() }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [fetchNextPage, frontier, hasNextPage, isFetchingNextPage, pagesLoaded])

  // Details mode gives everyone avatars — the login is already shown and already links to the
  // profile, so the picture is not new information. Display names and the hovercard come from
  // the gated `/api/actors/cards`: the public feed stays a list of logins rather than a
  // directory of people (specs/feed-details.md).
  //
  // Ask for the logins actually on screen, not "the actors" — the actors *table* endpoint is
  // capped at the top 500 by follower count, so most of the feed fell outside it and rendered
  // as bare logins. The key grows as you page in, and `keepPreviousData` keeps the names
  // already resolved on screen while the superset loads instead of flashing back to logins.
  const { whoami } = useWhoami()
  const cardLogins = [...new Set(events.map(e => e.login))].sort()
  const { data: cardData } = useQuery({
    queryKey: ['actor-cards', cardLogins],
    queryFn: () => get<{ actors: ActorCardFields[] }>(`/api/actors/cards?logins=${cardLogins.join(',')}`),
    enabled: details && INTERNAL && !!whoami && cardLogins.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const actors = new Map((cardData?.actors ?? []).map(a => [a.login, a]))

  const targetOptions = [
    ...(targets?.stars ?? []).map(t => t.target),
    ...(targets?.follows ?? []).map(t => t.target),
  ]

  // The filter dropdowns, as omnibar-searchable actions (only while Feed is mounted)
  useActions({
    'feed:kind:all': { label: 'All kinds', group: 'Feed filters', handler: () => setKind('') },
    'feed:kind:star': { label: '⭐️ Stars only', group: 'Feed filters', handler: () => setKind('star') },
    'feed:kind:unstar': { label: '💔 Unstars only', group: 'Feed filters', handler: () => setKind('unstar') },
    'feed:kind:follow': { label: '🔔 Follows only', group: 'Feed filters', handler: () => setKind('follow') },
    'feed:kind:unfollow': { label: '🔕 Unfollows only', group: 'Feed filters', handler: () => setKind('unfollow') },
    'feed:group-by-repo': { label: 'Toggle group by repo', group: 'Feed filters', handler: () => setByRepo(!byRepo) },
    'feed:details': { label: 'Toggle details (avatars, names)', group: 'Feed filters', handler: () => setDetails(!details) },
    'feed:collapse-all': { label: 'Collapse all days', group: 'Feed filters', handler: collapseAll },
    'feed:expand-all': { label: 'Expand all days', group: 'Feed filters', handler: expandAll },
    'feed:unfold-repos': { label: 'Unfold all repos', group: 'Feed filters', handler: () => setFoldedRepos([]) },
    'feed:target:all': { label: 'All targets', group: 'Feed filters', keywords: ['target'], handler: () => setTarget('') },
    // One action per known target; omnibar-only (the modal would drown in them)
    ...Object.fromEntries(targetOptions.map(t => [`feed:target:${t}`, {
      label: `Target: ${t}`,
      group: 'Feed filters',
      keywords: ['target', ...t.split('/')],
      hideFromModal: true,
      handler: () => setTarget(t),
    }])),
  })

  const actorName = (e: Event) => {
    const a = actors.get(e.login)
    if (!a) return <a href={`https://github.com/${e.login}`} className="login">{e.login}</a>
    return (
      <Tooltip tip={<ActorCard a={a} />}>
        <a href={`https://github.com/${e.login}`} className="login">{a.name ?? e.login}</a>
        {a.name && <span className="dim login-handle">{e.login}</span>}
      </Tooltip>
    )
  }

  const line = (e: Event, showTarget: boolean) => (
    <li key={e.id}>
      <span className="emoji">{KIND_EMOJI[e.kind]}</span>
      {details && <Avatar className="avi" login={e.login} uid={e.uid} size={48} />}
      {details ? actorName(e) : <a href={`https://github.com/${e.login}`} className="login">{e.login}</a>}
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
        <TargetPicker value={target} options={targetOptions} onChange={setTarget} />
        <input placeholder="login contains…" value={login} onChange={e => setLogin(e.target.value)} />
        <label className="toggle">
          <input type="checkbox" checked={byRepo} onChange={e => setByRepo(e.target.checked)} />
          group by repo
        </label>
        {/* Toggle and hint share a wrapper so a wrapping filter row can't strand the
            explanation on the next line, away from the control it explains. */}
        <span className="detail-toggle">
          <label className="toggle">
            <input type="checkbox" checked={details} onChange={e => setDetails(e.target.checked)} />
            details
          </label>
          {/* Signed out, details still buys avatars, but the names behind them are gated —
              say so where the surprise happens rather than letting it read as a broken toggle. */}
          {details && INTERNAL && whoami === null && (
            <a className="linkish" href={ssoUrl(location.pathname + location.search)}>sign in for names</a>
          )}
        </span>
        <span className="bulk">
          {/* Same <Caret> as the day/repo headers — these buttons name the state they
              put you in, so their glyphs have to read identically */}
          {/* Each button is spent once the view already matches what it would do —
              which, with `ca` in play, means "default is X and nothing differs from it" */}
          <button type="button" onClick={collapseAll} disabled={closedByDefault && except.size === 0}><Caret closed /> all</button>
          <button type="button" onClick={expandAll} disabled={!closedByDefault && except.size === 0}><Caret closed={false} /> all</button>
        </span>
      </div>
      {isLoading && <p className="dim">loading…</p>}
      {error && <p className="error">{String(error)}</p>}
      {shown.map(d => {
        const dayEvents = byDay.get(d) ?? []
        const shut = isClosed(d)
        const header = (
          <DayHeader
            day={d}
            rollup={rollups.get(d)}
            closed={shut}
            showTargets={!byRepo}
            onToggle={() => toggleDay(d)}
            target={target}
            onTarget={setTarget}
          />
        )
        if (shut) return <section key={d}>{header}</section>
        if (!byRepo) {
          return (
            <section key={d}>
              {header}
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
            {header}
            {[...byTarget.entries()].map(([t, evs]) => (
              <div className="repo-group" key={t}>
                <RepoHeader
                  target={t}
                  cells={(rollups.get(d)?.cells ?? []).filter(c => c.target === t)}
                  loaded={evs.length}
                  closed={folded.has(t)}
                  onToggle={() => toggleRepo(t)}
                />
                {!folded.has(t) && <ul>{evs.map(e => line(e, false))}</ul>}
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
