/**
 * GitHub avatar by login. `github.com/<login>.png` needs no API call and no
 * stored URL, but it does rate-limit: a feed page requests ~100 of these at
 * once and some come back 503. Hide (don't remove) a failed one, so the row's
 * text doesn't reflow when an avatar drops out.
 */
export function Avatar({ login, size, className }: { login: string; size: number; className?: string }) {
  return (
    <img
      className={className}
      src={`https://github.com/${login}.png?size=${size}`}
      alt=""
      loading="lazy"
      onError={e => { e.currentTarget.style.visibility = 'hidden' }}
    />
  )
}
