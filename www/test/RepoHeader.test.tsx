// Same claim as the day header, one level down: the numbers describe the repo's day,
// not the slice of it that happens to be loaded.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RepoHeader } from '../src/components/RepoHeader'
import type { DayRollup } from '../src/api'

const cell = (kind: string, n: number) => ({ kind, target: 'marin-community/marin', n }) as DayRollup['cells'][0]
const props = { target: 'marin-community/marin', closed: false, onToggle: () => {} }

/** The stats button, which is also the second (unlabelled) fold control. */
const stats = () => screen.getByRole('heading').querySelector('.repo-stats')!.textContent

describe('RepoHeader', () => {
  it('breaks the repo down by kind, from the rollup rather than the loaded page', () => {
    render(<RepoHeader {...props} cells={[cell('star', 306), cell('unstar', 4)]} loaded={100} />)
    expect(stats()).toBe('306 ⭐️ · 4 💔')
  })

  it('falls back to the loaded count until the rollup lands', () => {
    render(<RepoHeader {...props} cells={[]} loaded={17} />)
    expect(stats()).toBe('17')
  })

  it('folds from a labelled caret that names the repo', () => {
    const onToggle = vi.fn()
    render(<RepoHeader {...props} cells={[cell('star', 5)]} loaded={5} closed onToggle={onToggle} />)
    const caret = screen.getByRole('button', { name: 'show marin-community/marin' })
    expect(caret).toHaveAttribute('aria-expanded', 'false')
    caret.click()
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('exposes exactly one fold control to a11y, though both halves click', () => {
    const onToggle = vi.fn()
    render(<RepoHeader {...props} cells={[cell('star', 5)]} loaded={5} onToggle={onToggle} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    screen.getByRole('heading').querySelector<HTMLButtonElement>('.repo-stats')!.click()
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
