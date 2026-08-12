// GitHub redirects `github.com/<owner>.png` to the owner's avatar — used as an
// org icon so headers/lines can drop the low-info `org/` prefix and show just
// the (generally unambiguous) repo short-name. Full target in the tooltip.
import { Tooltip } from './components/Tooltip'

export function orgOf(target: string): string {
  return target.split('/')[0]
}

// Local brand icons (scripts/gen-pfp.py org-icons → public/org/) override the GH
// org avatar where its white bg is jarring in the dark-mode feed
// (?v= busts caches when the asset is regenerated — bump it alongside)
const ORG_ICON: Record<string, string> = { 'Open-Athena': '/org/open-athena.png?v=3' }

function orgIcon(org: string, size: number): string {
  return ORG_ICON[org] ?? `https://github.com/${org}.png?size=${size}`
}

export function shortName(target: string): string {
  const i = target.indexOf('/')
  return i < 0 ? target : target.slice(i + 1)
}

export function TargetLink({ target }: { target: string }) {
  const tip = (
    <span className="tgt-tip">
      <img src={orgIcon(orgOf(target), 96)} alt="" />
      {target}
    </span>
  )
  return (
    <Tooltip tip={tip}>
      <a href={`https://github.com/${target}`} className="target">
        <img className="org-icon" src={orgIcon(orgOf(target), 40)} alt="" loading="lazy" />
        {shortName(target)}
      </a>
    </Tooltip>
  )
}
