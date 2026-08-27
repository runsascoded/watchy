import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { boolParam, intParam, stringParam, useUrlState } from 'use-prms'
import { ApiError, API_BASE, get, type Actor, type ActorEvent } from '../api'
import { exchangeKeyParam, SignInPanel } from '../auth'
import { ActorCard } from '../components/ActorCard'
import { Tooltip } from '../components/Tooltip'
import { TargetLink } from '../target'
import { kindEmoji } from '../kinds'

const MAX_ACTS = 8
const MAX_ORGS = 4
const DAY_MS = 86_400_000

interface Score {
  reach: number
  fame: number
  ratio: number
  recMax: number
  n: number
  latest: number // ms epoch of newest eligible event (0 if none)
  score: number
}

// Extra still-active events multiply recency by 1 + MULTI_EVENT_BONUS each —
// engagement depth counts, but can't outweigh a much more famous actor's single star
// (√Σ-decay did exactly that: two 72d-old stars beat one 51d-old star from an
// actor with 2.5× the followers, since log10 compresses fame gaps).
const MULTI_EVENT_BONUS = 0.15

/**
 * "Interest" = fame × follower-ratio × recency:
 * - fame: log10(1 + cross-platform reach: GH + bsky + X followers)
 * - ratio: GH followers/(followers+following) — discounts follow-for-follow accounts
 * - recency: max 2^(−age/hl) over still-active star/follow events within the window,
 *   × (1 + 0.15·(n−1)) for extra events — churned (starred-then-unstarred) actions
 *   contribute nothing; the max (vs a sum) keeps "newest action" the dominant axis.
 * hl → 0 makes the newest action dominate (≈ rev-chron); `sort=recent` is the exact version.
 */
export function scoreActor(a: Actor, hlDays: number, winDays: number, now: number): Score {
  const flw = a.followers ?? 0
  const reach = flw + (a.bsky_followers ?? 0) + (a.x_followers ?? 0)
  const fame = Math.log10(1 + reach)
  const ratio = (flw + 1) / (flw + (a.following ?? 0) + 2)
  let recMax = 0
  let n = 0
  let latest = 0
  for (const e of a.events) {
    if (!e.active) continue
    const t = Date.parse(e.ts)
    const age = Math.max(0, now - t)
    if (winDays > 0 && age > winDays * DAY_MS) continue
    recMax = Math.max(recMax, 2 ** (-age / (hlDays * DAY_MS)))
    n++
    if (t > latest) latest = t
  }
  const rec = recMax * (1 + MULTI_EVENT_BONUS * Math.max(0, n - 1))
  return { reach, fame, ratio, recMax, n, latest, score: fame * ratio * rec }
}

// Insiders: OA or marin-community org members, or company says Open Athena —
// kept in sync with the worker's NOT_OA (cfw/src/index.ts)
const OA_RE = /open.?athena/i
export function isInsider(a: Actor): boolean {
  return (a.orgs?.includes('"Open-Athena"') ?? false)
    || (a.orgs?.includes('"marin-community"') ?? false)
    || OA_RE.test(a.company ?? '')
}

function liSearch(a: Actor): string {
  return a.li_url ?? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(a.name ?? a.login)}`
}

const fmt = (n: number | null) => n?.toLocaleString() ?? ''

// Official Bluesky butterfly (brand asset path) — the 🦋 emoji reads as "generic bug"
const BskyIcon = () => (
  <svg className="bsky-logo" viewBox="0 0 600 530" aria-label="Bluesky">
    <path d="M135.72 44.03C202.216 93.951 273.74 195.17 300 249.49c26.262-54.316 97.782-155.54 164.28-205.46C512.26 8.009 590-19.862 590 68.825c0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.38-3.69-10.832-3.708-7.896-.017-2.936-1.193.516-3.707 7.896-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.449-163.25-81.433C20.15 217.613 9.997 86.535 9.997 68.825c0-88.687 77.742-60.816 125.72-24.795z" />
  </svg>
)

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
      <div>recency <b>{(s.recMax * (1 + 0.15 * Math.max(0, s.n - 1))).toFixed(2)}</b> = max 2^(−age/{hl}d){s.n > 1 && ` × ${(1 + 0.15 * (s.n - 1)).toFixed(2)} multi-event bonus`} over {s.n} active event{s.n === 1 ? '' : 's'}</div>
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
        <Tooltip tip="log₁₀(1 + GH + bsky + X followers) × GH follower-ratio (discounts follow-spam) × recency (decay of the newest still-active action, +15% per extra action). Hover any interest value for that actor's breakdown."><b className="hint">interest</b></Tooltip>{' '}
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
        <Tooltip tip="interest: the fame × ratio × recency score (see column TT). recent action: exact reverse-chronological by newest eligible action — conceptually the hl→0 limit of interest (recency dominates completely), but implemented as a plain sort because the score itself underflows at tiny hl; fame and ratio are ignored entirely.">
          <label className="prm">
            <span className="hint">sort</span>
            <select value={byRecent ? 'recent' : 'score'} onChange={e => setSort(e.target.value === 'recent' ? 'recent' : '')}>
              <option value="score">interest</option>
              <option value="recent">recent action</option>
            </select>
          </label>
        </Tooltip>
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
                    <Tooltip tip={<ActorCard a={a} />}>
                      <a href={`https://github.com/${a.login}`}><b>{a.login}</b></a>
                    </Tooltip>
                    {a.name && <div className="dim">{a.name}</div>}
                    {where && <div className="dim where">{where}</div>}
                  </td>
                  <td className="num score">
                    <Tooltip tip={<Breakdown a={a} s={s} hl={hl} />}>
                      {s.score >= 0.05 ? <span className="hint">{s.score.toFixed(1)}</span> : <span className="dim">–</span>}
                    </Tooltip>
                  </td>
                  <td className="num"><b>{fmt(a.followers)}</b><span className="dim"> / {a.following != null ? fmt(a.following) : '?'}</span></td>
                  <td className="num">
                    {(() => {
                      const tops: { n: string; s: number }[] = a.top_repos ? JSON.parse(a.top_repos) : []
                      if (!tops.length) return fmt(a.star_sum)
                      return (
                        <Tooltip tip={<div>{tops.map(t => <div key={t.n}><a href={`https://github.com/${t.n}`}>{t.n.split('/')[1] ?? t.n}</a> · {fmt(t.s)} ⭐</div>)}</div>}>
                          <span className="hint">{fmt(a.star_sum)}</span>
                        </Tooltip>
                      )
                    })()}
                  </td>
                  <td className="acts">
                    {a.events.slice(0, MAX_ACTS).map((e, i) => (
                      <div className={`act${e.active ? '' : ' gone'}`} key={i}>
                        <Tooltip tip={`${e.kind} · ${e.ts}${e.active ? '' : ' — no longer active'}`}>
                          <span>{kindEmoji(e.kind)}</span>
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
                    {a.twitter && (
                      <Tooltip tip={`@${a.twitter} on X`}>
                        <a href={`https://x.com/${a.twitter}`}>𝕏{a.x_followers != null && <span className="cnt">{fmt(a.x_followers)}</span>}</a>
                      </Tooltip>
                    )}
                    {a.bsky_handle && (
                      <Tooltip tip={`${a.bsky_handle} on Bluesky · ${fmt(a.bsky_followers) || '?'} followers`}>
                        <a href={`https://bsky.app/profile/${a.bsky_handle}`}><BskyIcon />{a.bsky_followers != null && <span className="cnt">{fmt(a.bsky_followers)}</span>}</a>
                      </Tooltip>
                    )}
                    <Tooltip tip={`${a.name ?? a.login} on LinkedIn (prefilled people-search)`}>
                      <a href={liSearch(a)}>in</a>
                    </Tooltip>
                    {a.blog && (
                      <Tooltip tip={a.blog.replace(/^https?:\/\//, '')}>
                        <a href={a.blog.startsWith('http') ? a.blog : `https://${a.blog}`}>🌐</a>
                      </Tooltip>
                    )}
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
