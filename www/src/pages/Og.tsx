import { useQueries, useQuery } from '@tanstack/react-query'
import { OgHeader } from '../components/OgHeader'
import { SeriesChart, type Point, type Series } from '../components/SeriesChart'
import { get, type TargetCount } from '../api'
import { owner } from '../scope'

const N = 5

/** Chrome-less 1200×630 stars-over-time render, screenshotted to public/og.jpg
 * (the og:image for every route — a single SPA index.html serves them all). */
export default function Og() {
  const { data } = useQuery({
    queryKey: ['targets'],
    queryFn: () => get<{ stars: TargetCount[]; follows: TargetCount[] }>('/api/targets'),
  })
  const top = (data?.stars ?? []).slice(0, N)
  const results = useQueries({
    queries: top.map(t => ({
      queryKey: ['series', t.target],
      queryFn: () => get<{ series: Point[] }>(`/api/series?target=${encodeURIComponent(t.target)}`),
      staleTime: 300_000,
    })),
  })
  const series: Series[] = top.map((t, i) => ({
    target: t.target,
    slot: i,
    label: t.target.split('/').pop()!,
    owner: owner(t.target),
    points: results[i].data?.series ?? [],
  }))
  const ready = top.length > 0 && results.every(r => r.data)

  return (
    <div className="og-page" data-ready={ready || undefined}>
      <OgHeader tagline="GitHub stars + follows — live feed · graphs · Slack" />
      <div className="legend">
        {series.map(s => (
          <span key={s.target} className="li">
            <span className="swatch" style={{ background: `var(--s${s.slot + 1})` }} />
            {s.label}
          </span>
        ))}
      </div>
      <SeriesChart series={series} />
    </div>
  )
}
