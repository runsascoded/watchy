import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api'

interface Actor {
  login: string
  name: string | null
  company: string | null
  location: string | null
  bio: string | null
  blog: string | null
  twitter: string | null
  followers: number | null
  public_repos: number | null
  gh_created_at: string | null
  orgs: string | null
  n_events: number
  first_ts: string
  last_ts: string
}

function liSearch(a: Actor): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(a.name ?? a.login)}`
}

export default function Actors() {
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['actors'],
    queryFn: () => get<{ actors: Actor[] }>('/api/actors'),
  })
  const actors = useMemo(() => {
    const all = data?.actors ?? []
    if (!q) return all
    const needle = q.toLowerCase()
    return all.filter(a =>
      [a.login, a.name, a.company, a.location, a.bio, a.orgs].some(f => f?.toLowerCase().includes(needle)),
    )
  }, [data, q])
  if (isLoading) return <p className="dim">loading…</p>
  if (error || !data) return <p className="error">{String(error)}</p>

  return (
    <div className="actors">
      <p>
        {data.actors.length} enriched actors behind posted events, by GitHub reach. LinkedIn links are
        prefilled people-searches — open logged-in to see mutual connections.
      </p>
      <div className="filters">
        <input placeholder="filter (login, name, company, org, bio…)" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>actor</th><th>company</th><th>location</th><th className="num">followers</th>
              <th className="num">repos</th><th className="num">joined</th><th>orgs</th>
              <th className="num">events</th><th>latest</th><th>links</th><th>bio</th>
            </tr>
          </thead>
          <tbody>
            {actors.map(a => {
              const orgs: string[] = a.orgs ? JSON.parse(a.orgs) : []
              return (
                <tr key={a.login}>
                  <td className="who">
                    {orgs.includes('Open-Athena') && <span className="chip oa">OA</span>}
                    <a href={`https://github.com/${a.login}`}><b>{a.login}</b></a>
                    {a.name && <div className="dim">{a.name}</div>}
                  </td>
                  <td>{a.company}</td>
                  <td>{a.location}</td>
                  <td className="num">{a.followers?.toLocaleString()}</td>
                  <td className="num">{a.public_repos?.toLocaleString()}</td>
                  <td className="num">{a.gh_created_at?.slice(0, 4)}</td>
                  <td className="orgs">{orgs.map(o => <a key={o} className="chip" href={`https://github.com/${o}`}>{o}</a>)}</td>
                  <td className="num">{a.n_events}</td>
                  <td className="dim">{a.last_ts.slice(0, 10)}</td>
                  <td className="links">
                    {a.twitter && <a href={`https://x.com/${a.twitter}`}>𝕏</a>}
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
