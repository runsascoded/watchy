/** Shared masthead for the chrome-less /…/og card routes — the one place a
 * fork re-skins all OG cards' branding. */
export function OgHeader({ page, tagline }: { page?: string; tagline: string }) {
  return (
    <header>
      <h1>👀 watchy{page && <span className="dim"> · {page}</span>}</h1>
      <p className="dim">{tagline}</p>
    </header>
  )
}
