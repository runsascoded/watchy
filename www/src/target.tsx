// GitHub redirects `github.com/<owner>.png` to the owner's avatar — used as an
// org icon so headers/lines can drop the low-info `org/` prefix and show just
// the (generally unambiguous) repo short-name. Full target in the tooltip.
import { Tooltip } from './components/Tooltip'

export function orgOf(target: string): string {
  return target.split('/')[0]
}

export function shortName(target: string): string {
  const i = target.indexOf('/')
  return i < 0 ? target : target.slice(i + 1)
}

export function TargetLink({ target }: { target: string }) {
  return (
    <Tooltip tip={target}>
      <a href={`https://github.com/${target}`} className="target">
        <img className="org-icon" src={`https://github.com/${orgOf(target)}.png?size=40`} alt="" loading="lazy" />
        {shortName(target)}
      </a>
    </Tooltip>
  )
}
