import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, post } from './api'

export interface Whoami {
  kind: 'sso' | 'grant'
  email?: string | null
  label?: string
  admin: boolean
}

/** null = signed out; undefined = still loading. */
export function useWhoami(): { whoami: Whoami | null | undefined; refresh: () => void } {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['whoami'],
    queryFn: async (): Promise<Whoami | null> => {
      try {
        return await get<Whoami>('/api/auth/whoami')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 300_000,
    retry: false,
  })
  return { whoami: data, refresh: () => qc.invalidateQueries({ queryKey: ['whoami'] }) }
}

export function ssoUrl(next: string): string {
  return `/auth/sso?next=${encodeURIComponent(next)}`
}

/** Exchange a share-link token (?key=…) for a session cookie, then strip the param. */
export async function exchangeKeyParam(): Promise<boolean> {
  const url = new URL(location.href)
  const key = url.searchParams.get('key')
  if (!key) return false
  try {
    await post('/api/auth/exchange', { token: key })
    return true
  } catch {
    return false
  } finally {
    url.searchParams.delete('key')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
}

export function WhoamiChip() {
  const { whoami, refresh } = useWhoami()
  if (!whoami) return null
  const who = whoami.kind === 'sso' ? whoami.email : `🔗 ${whoami.label}`
  return (
    <span className="whoami">
      <span className="dim">{who}</span>
      <button
        className="linkish"
        onClick={async () => { await post('/api/auth/logout'); refresh() }}
      >
        sign out
      </button>
    </span>
  )
}

/** Shown in place of gated content when the API says 401. */
export function SignInPanel({ next }: { next: string }) {
  return (
    <div className="signin">
      <p>This section is restricted.</p>
      <p><a className="btn" href={ssoUrl(next)}>Sign in — Open Athena</a></p>
      <p className="dim">
        Have an access link? Just open it — it signs this browser in automatically.
      </p>
    </div>
  )
}
