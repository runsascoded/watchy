/**
 * GitHub avatar.
 *
 * Prefer the numeric-id CDN URL. `github.com/<login>.png` is a 302 to exactly
 * that URL and is served `cache-control: no-cache`, so a 100-row feed page
 * re-requests ~100 redirects on *every* load and GitHub starts 503ing them —
 * which is what the broken avatars were. `avatars.githubusercontent.com/u/<id>`
 * skips the redirect entirely and is a plain cacheable CDN asset; `uid` is the
 * GitHub user id, already stored on every event, so this costs no new data.
 *
 * Fall back to the login URL when there's no uid (a backfilled `git` event can
 * lack one), and hide (don't remove) an image that fails, so a dropped avatar
 * doesn't reflow the row's text.
 */
export function Avatar({ login, uid, size, className }: { login: string; uid?: number | null; size: number; className?: string }) {
  const src = uid
    ? `https://avatars.githubusercontent.com/u/${uid}?s=${size}&v=4`
    : `https://github.com/${login}.png?size=${size}`
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={e => { e.currentTarget.style.visibility = 'hidden' }}
    />
  )
}
