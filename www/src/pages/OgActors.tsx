import { useQuery } from '@tanstack/react-query'
import { get } from '../api'
import { KIND_EMOJI } from '../components/EventTimeline'
import { OgHeader } from '../components/OgHeader'
import { isInsider, scoreActor } from './Actors'
import { type Actor } from '../api'

const N = 7

const fmtK = (n: number | null | undefined) =>
  n == null ? '' : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

/** Rough age ("3d", "2mo") of an ISO ts. */
const age = (ts: string) => {
  const d = (Date.now() - Date.parse(ts)) / 86_400_000
  return d < 1 ? '<1d' : d < 60 ? `${Math.round(d)}d` : `${Math.round(d / 30.44)}mo`
}

/** Chrome-less 1200×630 top-actors table — the /actors og:image (og-actors.jpg).
 * The OGI aspect ratio suits "a few rows × lots of cols" better than the page itself. */
export default function OgActors() {
  const { data } = useQuery({
    queryKey: ['actors'],
    queryFn: () => get<{ actors: Actor[] }>('/api/actors'),
    retry: false,
  })
  const now = Date.now()
  const ranked = (data?.actors ?? [])
    .filter(a => !isInsider(a))
    .map(a => ({ a, s: scoreActor(a, 60, 0, now) }))
    .sort((x, y) => y.s.score - x.s.score || (y.a.followers ?? 0) - (x.a.followers ?? 0))
    .slice(0, N)

  return (
    <div className="og-page og-actors" data-ready={ranked.length > 0 || undefined}>
      <OgHeader page="actors" tagline="who's starring + following — enriched, interest-ranked" />
      <table>
        <thead>
          <tr>
            <th></th>
            <th>actor</th>
            <th className="num">followers</th>
            <th>company · location</th>
            <th>latest</th>
            <th className="num">events</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ a, s }, i) => {
            const latest = a.events.filter(e => e.active).sort((x, y) => y.ts.localeCompare(x.ts))[0]
            const where = [a.company, a.location].filter(Boolean).join(' · ')
            return (
              <tr key={a.login}>
                <td className="num dim">{i + 1}</td>
                <td className="actor">
                  <img src={`https://github.com/${a.login}.png?size=96`} alt="" />
                  <b>{a.name ?? a.login}</b>
                  {a.name && <span className="dim">{a.login}</span>}
                </td>
                <td className="num">{fmtK(a.followers)}{a.bsky_followers != null && a.bsky_followers > 0 && <span className="dim"> +{fmtK(a.bsky_followers)} 🦋</span>}</td>
                <td className="where">{where}</td>
                <td>{latest && <>{KIND_EMOJI[latest.kind]} {latest.target.split('/').pop()} <span className="dim">{age(latest.ts)}</span></>}</td>
                <td className="num">{s.n}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
