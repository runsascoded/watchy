// The day header makes a claim about the *day*. Two ways that goes wrong, both seen:
// summarizing the loaded page instead of the day (a header that said "89 ⭐" on a
// 180-star day), and printing stats that say nothing. Both are specced here.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayHeader } from '../src/components/DayHeader'
import type { DayRollup } from '../src/api'

const cell = (kind: string, target: string, n: number) => ({ kind, target, n }) as DayRollup['cells'][0]

/** The header's two pieces: the caret+date button, and the stats span (absent when the
 * day has nothing worth summarizing). Read separately — the gap between them is CSS. */
function header(): { button: string; stats: string | null } {
  const h = screen.getByRole('heading')
  return {
    button: h.querySelector('button')!.textContent!,
    stats: h.querySelector('.day-stats')?.textContent ?? null,
  }
}

const props = { closed: false, showTargets: true, onToggle: () => {} }

describe('DayHeader', () => {
  it('reports the rollup total, not the number of events on screen', () => {
    // The regression: 100 loaded of a 180-star day. The header must say 180.
    const rollup: DayRollup = {
      day: '2026-08-24',
      actors: 190,
      cells: [cell('star', 'marin-community/marin', 180), cell('follow', 'marin-community', 21), cell('unstar', 'marin-community/marin', 3)],
    }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} />)
    expect(header()).toEqual({
      button: '▾2026-08-24',
      stats: '180 ⭐️ · 3 💔 · 21 🔔 · 190 actors · marin 183 · marin-community 21',
    })
  })

  it('orders kinds star → unstar → follow → unfollow, and breaks target ties by name', () => {
    const rollup: DayRollup = {
      day: '2026-08-24',
      actors: 4,
      cells: [cell('unfollow', 'o', 1), cell('follow', 'o', 1), cell('unstar', 'o/r', 1), cell('star', 'o/r', 1)],
    }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} />)
    expect(header().stats).toBe('1 ⭐️ · 1 💔 · 1 🔔 · 1 🔕 · o 2 · r 2')
  })

  it('caps the target list and counts the remainder', () => {
    const rollup: DayRollup = {
      day: '2026-08-24',
      actors: 15,
      cells: ['a', 'b', 'c', 'd', 'e'].map((t, i) => cell('star', `o/${t}`, 5 - i)),
    }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} />)
    expect(header().stats).toBe('15 ⭐️ · a 5 · b 4 · c 3 · +2 more')
  })

  it('drops the actor count when nobody acted twice, and the targets under group-by-repo', () => {
    const rollup: DayRollup = { day: '2026-08-24', actors: 8, cells: [cell('star', 'o/r', 5), cell('star', 'o/s', 3)] }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} showTargets={false} />)
    expect(header().stats).toBe('8 ⭐️')
  })

  it('says nothing at all about a day too small to summarize', () => {
    const rollup: DayRollup = { day: '2026-08-24', actors: 2, cells: [cell('star', 'o/r', 2)] }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} />)
    expect(header()).toEqual({ button: '▾2026-08-24', stats: null })
  })

  it('always states the size of a collapsed day — nothing else is on screen', () => {
    const rollup: DayRollup = { day: '2026-08-24', actors: 2, cells: [cell('star', 'o/r', 2)] }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} closed />)
    expect(header()).toEqual({ button: '▸2026-08-24', stats: '2 ⭐️' })
  })

  it('renders the date alone while the rollup is in flight', () => {
    render(<DayHeader day="2026-08-24" {...props} />)
    expect(header()).toEqual({ button: '▾2026-08-24', stats: null })
  })

  it('toggles from the whole date button, and exposes the state to a11y', () => {
    const onToggle = vi.fn()
    render(<DayHeader day="2026-08-24" {...props} onToggle={onToggle} closed />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    button.click()
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
