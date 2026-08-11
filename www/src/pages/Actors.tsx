import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { boolParam, intParam, stringParam, useUrlState } from 'use-prms'
import { ApiError, API_BASE, get } from '../api'
import { exchangeKeyParam, SignInPanel } from '../auth'
import { Tooltip } from '../components/Tooltip'
import { TargetLink } from '../target'

const KIND_EMOJI: Record<string, string> = { star: '⭐️', unstar: '💔', follow: '📣', unfollow: '🔇' }
const MAX_ACTS = 8
const MAX_ORGS = 4
const DAY_MS = 86_400_000

interface ActorEvent {
  ts: string
  kind: string
  target: string
  active: number // star/follow still present in current state
}

interface Actor {
  login: string
  name: string | null
  company: string | null
  location: string | null
  bio: string | null
  blog: string | null
  twitter: string | null
  followers: number | null
  following: number | null
  public_repos: number | null
  gh_created_at: string | null
  orgs: string | null
  star_sum: number | null
  bsky_handle: string | null
  bsky_followers: number | null
  x_followers: number | null
  n_events: number
  first_ts: string
  last_ts: string
  events: ActorEvent[]
}

interface Score {
  reach: number
  fame: number
  ratio: number
  recSum: number
  n: number
  latest: number // ms epoch of newest eligible event (0 if none)
  score: number
}

/**
 * "Interest" = fame × follower-ratio × recency:
 * - fame: log10(1 + cross-platform reach: GH + bsky + X followers)
 * - ratio: GH followers/(followers+following) — discounts follow-for-follow accounts
 * - recency: √Σ 2^(−age/hl) over still-active star/follow events within the window —
 *   churned (starred-then-unstarred) actions contribute nothing; √ tempers
 *   many-small-events so they don't drown one famous actor's single star.
 * hl → 0 makes the newest action dominate (≈ rev-chron); `sort=recent` is the exact version.
 */
function scoreActor(a: Actor, hlDays: number, winDays: number, now: number): Score {
  const flw = a.followers ?? 0
  const reach = flw + (a.bsky_followers ?? 0) + (a.x_followers ?? 0)
  const fame = Math.log10(1 + reach)
  const ratio = (flw + 1) / (flw + (a.following ?? 0) + 2)
  let recSum = 0
  let n = 0
  let latest = 0
  for (const e of a.events) {
    if (!e.active) continue
    const t = Date.parse(e.ts)
    const age = Math.max(0, now - t)
    if (winDays > 0 && age > winDays * DAY_MS) continue
    recSum += 2 ** (-age / (hlDays * DAY_MS))
    n++
    if (t > latest) latest = t
  }
  return { reach, fame, ratio, recSum, n, latest, score: fame * ratio * Math.sqrt(recSum) }
}

// Insiders: OA or marin-community org members, or company says Open Athena —
// kept in sync with the worker's NOT_OA (cfw/src/index.ts)
const OA_RE = /open.?athena/i
function isInsider(a: Actor): boolean {
  return (a.orgs?.includes('"Open-Athena"') ?? false)
    || (a.orgs?.includes('"marin-community"') ?? false)
    || OA_RE.test(a.company ?? '')
}

function liSearch(a: Actor): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(a.name ?? a.login)}`
}

const fmt = (n: number | null) => n?.toLocaleString() ?? ''

function Breakdown({ a, s, hl }: { a: Actor; s: Score; hl: number }) {
  const reachParts = [
    `${fmt(a.followers ?? 0)} GH`,
    a.bsky_followers != null && `${fmt(a.bsky_followers)} bsky`,
    a.x_followers != null && `${fmt(a.x_followers)} X`,
  ].filter(Boolean).join(' + ')
  return (
    <div className="bd">
      <div>fame <b>{s.fame.toFixed(2)}</b> = log₁₀(1 + {fmt(s.reach)} reach: {reachParts})</div>
      <div>ratio <b>{s.ratio.toFixed(2)}</b> = GH followers / (followers + following)</div>
      <div>recency <b>{Math.sqrt(s.recSum).toFixed(2)}</b> = √Σ 2^(−age/{hl}d) over {s.n} active event{s.n === 1 ? '' : 's'}</div>
      <div>interest = <b>{s.score.toFixed(2)}</b></div>
    </div>
  )
}

export default function Actors() {
  const [q, setQ] = useState('')
  const [hl, setHl] = useUrlState('hl', intParam(60))
  const [win, setWin] = useUrlState('w', intParam(0))
  const [sort, setSort] = useUrlState('s', stringParam(''))
  const [showOA, setShowOA] = useUrlState('oa', boolParam)
  const qc = useQueryClient()
  // A share link lands here as /actors?key=…: exchange it for a session cookie
  // (and strip the token from the URL) before the data query settles.
  const [keyDone, setKeyDone] = useState(() => !new URL(location.href).searchParams.has('key'))
  useEffect(() => {
    if (keyDone) return
    exchangeKeyParam().then(() => {
      qc.invalidateQueries({ queryKey: ['whoami'] })
      setKeyDone(true)
    })
  }, [keyDone, qc])
  const { data, isLoading, error } = useQuery({
    queryKey: ['actors'],
    queryFn: () => get<{ actors: Actor[] }>('/api/actors'),
    enabled: keyDone,
    retry: false,
  })
  const byRecent = sort === 'recent'
  const ranked = useMemo(() => {
    const now = Date.now()
    return (data?.actors ?? [])
      .filter(a => showOA || !isInsider(a))
      .map(a => ({ a, s: scoreActor(a, hl, win, now) }))
      .sort((x, y) =>
        byRecent
          ? y.s.latest - x.s.latest || y.s.score - x.s.score
          : y.s.score - x.s.score || (y.a.followers ?? 0) - (x.a.followers ?? 0),
      )
  }, [data, hl, win, byRecent, showOA])
  const rows = useMemo(() => {
    if (!q) return ranked
    const needle = q.toLowerCase()
    return ranked.filter(({ a }) =>
      [a.login, a.name, a.company, a.location, a.bio, a.orgs].some(f => f?.toLowerCase().includes(needle)),
    )
  }, [ranked, q])
  if (isLoading || !keyDone) return <p className="dim">loading…</p>
  if (error instanceof ApiError && error.status === 401) return <SignInPanel next="/actors" />
  if (error || !data) return <p className="error">{String(error)}</p>

  return (
    <div className="actors">
      <p>
        {data.actors.length} enriched actors behind posted events, ranked by{' '}
        <Tooltip tip="log₁₀(1 + GH + bsky + X followers) × GH follower-ratio (discounts follow-spam) × √(recency-decayed still-active actions). Hover any interest value for that actor's breakdown."><b className="hint">interest</b></Tooltip>{' '}
        (or newest action — see sort). LinkedIn links are prefilled people-searches — open logged-in to see
        mutual connections.
      </p>
      <p className="dim digest">
        Agent digest (last 6mo, ≥100 followers, OA/marin members excluded):{' '}
        <a href={`${API_BASE}/api/actors/summary`}>JSON</a>
        {' · '}
        <a href={`${API_BASE}/api/actors/summary?format=md`}>markdown</a>
        {' — prms: '}<code>months</code>, <code>since</code>, <code>min_followers</code>, <code>limit</code>;
        agents can auth with a grant token (<code>Authorization: Bearer</code>).
      </p>
      <div className="filters">
        <input placeholder="filter (login, name, company, org, bio…)" value={q} onChange={e => setQ(e.target.value)} />
        <label className="prm">
          sort
          <select value={byRecent ? 'recent' : 'score'} onChange={e => setSort(e.target.value === 'recent' ? 'recent' : '')}>
            <option value="score">interest</option>
            <option value="recent">recent action</option>
          </select>
        </label>
        <Tooltip tip="recency half-life (days): smaller → recent actions dominate the score (rev-chron in the limit); larger → fame dominates">
          <label className="prm">
            hl
            <input type="number" min={1} value={hl} onChange={e => setHl(Math.max(1, +e.target.value || 60))} />
            d
          </label>
        </Tooltip>
        <Tooltip tip="only actions newer than this count toward the score / recent sort; 0 = no window">
          <label className="prm">
            window
            <input type="number" min={0} value={win} onChange={e => setWin(Math.max(0, +e.target.value || 0))} />
            d
          </label>
        </Tooltip>
        <label className="toggle">
          <input type="checkbox" checked={showOA} onChange={e => setShowOA(e.target.checked)} />
          show OA/marin members
        </label>
      </div>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>actor</th>
              <th className="num">interest</th>
              <th className="num"><Tooltip tip="GitHub followers / following"><span className="hint">flw / ing</span></Tooltip></th>
              <th className="num"><Tooltip tip="Σ stars across their owned repos (first 200)"><span className="hint">Σ⭐</span></Tooltip></th>
              <th>actions</th><th>orgs</th><th>links</th><th>bio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, s }) => {
              const orgs: string[] = a.orgs ? JSON.parse(a.orgs) : []
              const where = [a.company, a.location].filter(Boolean).join(' · ')
              return (
                <tr key={a.login}>
                  <td className="who">
                    {orgs.includes('Open-Athena') && <span className="chip oa">OA</span>}
                    <a href={`https://github.com/${a.login}`}><b>{a.login}</b></a>
                    {a.name && <div className="dim">{a.name}</div>}
                    {where && <div className="dim where">{where}</div>}
                  </td>
                  <td className="num score">
                    <Tooltip tip={<Breakdown a={a} s={s} hl={hl} />}>
                      {s.score >= 0.05 ? <span className="hint">{s.score.toFixed(1)}</span> : <span className="dim">–</span>}
                    </Tooltip>
                  </td>
                  <td className="num"><b>{fmt(a.followers)}</b><span className="dim"> / {a.following != null ? fmt(a.following) : '?'}</span></td>
                  <td className="num">{fmt(a.star_sum)}</td>
                  <td className="acts">
                    {a.events.slice(0, MAX_ACTS).map((e, i) => (
                      <div className={`act${e.active ? '' : ' gone'}`} key={i}>
                        <Tooltip tip={`${e.kind} · ${e.ts}${e.active ? '' : ' — no longer active'}`}>
                          <span>{KIND_EMOJI[e.kind] ?? e.kind}</span>
                        </Tooltip>
                        {' '}<TargetLink target={e.target} />
                        <span className="dim ts">{e.ts.slice(0, 10)}</span>
                      </div>
                    ))}
                    {a.events.length > MAX_ACTS && <div className="dim">+{a.events.length - MAX_ACTS} more</div>}
                  </td>
                  <td className="orgs">
                    {orgs.slice(0, MAX_ORGS).map(o => <a key={o} className="chip" href={`https://github.com/${o}`}>{o}</a>)}
                    {orgs.length > MAX_ORGS && (
                      <Tooltip tip={orgs.slice(MAX_ORGS).join(', ')}><span className="dim hint">+{orgs.length - MAX_ORGS}</span></Tooltip>
                    )}
                  </td>
                  <td className="links">
                    {a.twitter && <a href={`https://x.com/${a.twitter}`}>𝕏</a>}
                    {a.bsky_handle && (
                      <Tooltip tip={`${fmt(a.bsky_followers) || '?'} bsky followers`}>
                        <a href={`https://bsky.app/profile/${a.bsky_handle}`}>🦋</a>
                      </Tooltip>
                    )}
                    <a href={liSearch(a)}>in</a>
                    {a.blog && <a href={a.blog.startsWith('http') ? a.blog : `https://${a.blog}`}>🌐</a>}
                  </td>
                  <td className="bio">{a.bio}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
