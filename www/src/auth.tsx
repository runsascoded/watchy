// Auth FE, on `@open-athena/auth/react` (specs/auth-adoption.md). The package
// ships logic-only, unstyled primitives; the copy and class names below stay
// here, which is the vendored half of the split — every app fights bundled CSS.
import { SignInPanel as PkgSignInPanel, WhoamiChip as PkgWhoamiChip, useWhoami as usePkgWhoami } from '@open-athena/auth/react'
import type { Whoami } from '@open-athena/auth/react'

export type { Whoami }

/** null = signed out; undefined = still loading. */
export function useWhoami(): { whoami: Whoami | null | undefined; refresh: () => void } {
  const { whoami, refresh } = usePkgWhoami({ kind: 'app' })
  return { whoami, refresh }
}

export function ssoUrl(next: string): string {
  return `/auth/sso?next=${encodeURIComponent(next)}`
}

export { exchangeKeyParam } from '@open-athena/auth/react'

export function WhoamiChip() {
  const { whoami } = useWhoami()
  // Signed out, the package's chip renders *nothing* — so the first visit to a host
  // that hasn't been through /auth/sso (a fresh staging alias, a new browser, an
  // expired cookie) offers no way in, and gated UI degrades in silence: `details`
  // still ticks, but `/api/actors/cards` 401s and every name stays a bare login.
  // `undefined` is still loading, so only an explicit `null` earns the link.
  if (whoami === null) {
    const next = location.pathname + location.search
    return <div className="whoami"><a className="linkish" href={ssoUrl(next)}>Sign in</a></div>
  }
  return (
    <PkgWhoamiChip
      whoami={whoami}
      // The package's post-logout `useForgetWhoami` calls TanStack's
      // `removeQueries`, which destroys the cache entry and notifies *cache*
      // subscribers — but a QueryObserver subscribes to the query, so nothing
      // re-renders and the page keeps showing the identity you just dropped
      // (upstream: specs/auth-upstream-followups.md §1). Reloading also drops
      // every already-fetched private response from memory, which is what
      // signing out should mean anyway.
      onSignedOut={() => location.reload()}
      classNames={{ root: 'whoami', name: 'dim', button: 'linkish' }}
    />
  )
}

/** Shown in place of gated content when the API says 401. */
export function SignInPanel({ next }: { next: string }) {
  return (
    <PkgSignInPanel
      signInUrl={ssoUrl(next)}
      withNext={false}
      title="This section is restricted."
      signInLabel="Sign in — Open Athena"
      hint="Have an access link? Just open it — it signs this browser in automatically."
      classNames={{ root: 'signin', button: 'btn', hint: 'dim' }}
    />
  )
}
