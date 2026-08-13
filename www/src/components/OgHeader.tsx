import { GitHubIcon } from '../kbd'

/** Shared masthead for the chrome-less /…/og card routes — the one place a
 * fork re-skins all OG cards' branding. */
export function OgHeader({ page, tagline }: { page?: string; tagline: string }) {
  return (
    <header>
      <h1>
        <img className="brand" src="/org/open-athena.png?v=3" alt="OA" />
        <span className="x">×</span>
        <span className="gh"><GitHubIcon /></span>
        {page && <span className="dim">{page}</span>}
      </h1>
      <p className="dim">{tagline}</p>
    </header>
  )
}
