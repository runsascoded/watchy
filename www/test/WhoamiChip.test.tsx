// The package's chip renders nothing when signed out, which left every host that hadn't
// been through /auth/sso — a fresh staging alias, a new browser, an expired cookie — with
// no visible way in, while gated UI (`details`' names) failed silently. The wrapper owes a
// sign-in link in exactly that state, and only that state: `undefined` is still loading.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Whoami } from '@open-athena/auth/react'

const whoami = vi.hoisted(() => ({ value: undefined as Whoami | null | undefined }))

vi.mock('@open-athena/auth/react', () => ({
  useWhoami: () => ({ whoami: whoami.value, refresh: () => {} }),
  // Mirrors the real chip, which bails on a falsy whoami rather than throwing
  WhoamiChip: ({ whoami }: { whoami: Whoami | null | undefined }) =>
    whoami ? <div className="whoami">{whoami.email}</div> : null,
  SignInPanel: () => null,
  exchangeKeyParam: null,
}))

const { WhoamiChip } = await import('../src/auth')

const renderAt = (path: string, value: Whoami | null | undefined) => {
  whoami.value = value
  history.replaceState(null, '', path)
  return render(<WhoamiChip />)
}

describe('WhoamiChip', () => {
  it('offers a sign-in link when signed out, returning to the current page', () => {
    renderAt('/?d&c=260826', null)
    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/auth/sso?next=%2F%3Fd%26c%3D260826')
  })

  it('renders nothing while whoami is still loading', () => {
    const { container } = renderAt('/', undefined)
    expect(container.innerHTML).toBe('')
  })

  it('defers to the package chip once signed in', () => {
    renderAt('/', { email: 'ryan.williams@openathena.ai' } as Whoami)
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.getByText('ryan.williams@openathena.ai')).toBeInTheDocument()
  })
})
