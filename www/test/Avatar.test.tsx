// `github.com/<login>.png` is a 302 served `cache-control: no-cache`, so a feed page
// re-requested ~100 redirects on every load and GitHub started 503ing them. The fix is
// to address the CDN by uid; this pins that choice so it can't quietly revert.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Avatar } from '../src/components/Avatar'

const src = (el: HTMLElement) => el.querySelector('img')!.getAttribute('src')

describe('Avatar', () => {
  it('addresses the CDN by uid, at the requested size', () => {
    const { container } = render(<Avatar login="eric-czech" uid={6130352} size={48} />)
    expect(src(container)).toBe('https://avatars.githubusercontent.com/u/6130352?s=48&v=4')
  })

  it('falls back to the login URL when the event carries no uid', () => {
    // Backfilled `git` events can lack one
    const { container } = render(<Avatar login="eric-czech" uid={null} size={96} />)
    expect(src(container)).toBe('https://github.com/eric-czech.png?size=96')
  })

  it('hides a failed image rather than unmounting it, so the row does not reflow', () => {
    const { container } = render(<Avatar login="gone" uid={1} size={48} />)
    const img = container.querySelector('img')!
    img.dispatchEvent(new Event('error'))
    expect(img.style.visibility).toBe('hidden')
    expect(container.querySelector('img')).toBe(img)
  })

  it('is decorative: empty alt, lazy', () => {
    const { container } = render(<Avatar login="x" uid={1} size={48} />)
    const img = container.querySelector('img')!
    expect([img.getAttribute('alt'), img.getAttribute('loading')]).toEqual(['', 'lazy'])
  })
})
