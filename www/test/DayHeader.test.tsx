// The day header makes a claim about the *day*. Two ways that goes wrong, both seen:
// summarizing the loaded page instead of the day (a header that said "89 ⭐" on a
// 180-star day), and printing stats that say nothing. Both are specced here.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DayHeader, dayLabel, dayLong } from '../src/components/DayHeader'
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

// Fixed "now" so the current-year rule (and "yesterday") don't drift with the clock
const now = new Date('2026-08-25T12:00:00Z')
const props = { closed: false, showTargets: true, onToggle: () => {}, now }

describe('dayLabel', () => {
  it('leads with the weekday and drops the year within the current one', () => {
    expect(dayLabel('2026-08-25', now)).toBe('Tue 08-25')
  })

  it('keeps the full ISO date once the year differs', () => {
    expect(dayLabel('2025-12-29', now)).toBe('Mon 2025-12-29')
  })
})

describe('dayLong', () => {
  it('restores what the short label drops, and says how long ago', () => {
    expect([dayLong('2026-08-25', now), dayLong('2026-08-24', now), dayLong('2026-08-19', now)]).toEqual([
      'Tuesday, 2026-08-25 · today',
      'Monday, 2026-08-24 · yesterday',
      'Wednesday, 2026-08-19 · 6 days ago',
    ])
  })
})

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
      button: '▾Mon 08-24',
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

  it('names the targets behind "+2 more" on hover, unshortened', async () => {
    const rollup: DayRollup = {
      day: '2026-08-24',
      actors: 15,
      cells: ['a', 'b', 'c', 'd', 'e'].map((t, i) => cell('star', `o/${t}`, 5 - i)),
    }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} />)
    await userEvent.setup().hover(screen.getByText('+2 more'))
    const tip = await screen.findByRole('tooltip')
    expect([...tip.querySelectorAll('.more-tip > span')].map(s => s.textContent)).toEqual(['o/d 2', 'o/e 1'])
  })

  it('drops the actor count when nobody acted twice, and the targets under group-by-repo', () => {
    const rollup: DayRollup = { day: '2026-08-24', actors: 8, cells: [cell('star', 'o/r', 5), cell('star', 'o/s', 3)] }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} showTargets={false} />)
    expect(header().stats).toBe('8 ⭐️')
  })

  it('says nothing at all about a day too small to summarize', () => {
    const rollup: DayRollup = { day: '2026-08-24', actors: 2, cells: [cell('star', 'o/r', 2)] }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} />)
    expect(header()).toEqual({ button: '▾Mon 08-24', stats: null })
  })

  it('always states the size of a collapsed day — nothing else is on screen', () => {
    const rollup: DayRollup = { day: '2026-08-24', actors: 2, cells: [cell('star', 'o/r', 2)] }
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} closed />)
    expect(header()).toEqual({ button: '▸Mon 08-24', stats: '2 ⭐️' })
  })

  it('renders the date alone while the rollup is in flight', () => {
    render(<DayHeader day="2026-08-24" {...props} />)
    expect(header()).toEqual({ button: '▾Mon 08-24', stats: null })
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

describe('DayHeader target chips', () => {
  const rollup: DayRollup = {
    day: '2026-08-24',
    actors: 8,
    cells: [cell('star', 'marin-community/marin', 5), cell('follow', 'marin-community', 3)],
  }

  it('filters to the full target, not the shortened chip text', () => {
    const onTarget = vi.fn()
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} onTarget={onTarget} />)
    screen.getByRole('button', { name: 'marin 5' }).click()
    expect(onTarget).toHaveBeenCalledWith('marin-community/marin')
  })

  it('lights the chip that matches the active filter, and clears it on a second click', () => {
    const onTarget = vi.fn()
    render(<DayHeader day="2026-08-24" rollup={rollup} {...props} target="marin-community/marin" onTarget={onTarget} />)
    const chip = screen.getByRole('button', { name: 'marin 5' })
    expect(chip).toHaveClass('chip', 'on')
    chip.click()
    expect(onTarget).toHaveBeenCalledWith('')
  })

  it('keeps the lone chip once a filter has narrowed the day to one target', () => {
    // Suppressing it (as an uninformative single-target list) would strand the filter:
    // the header is where it was set, so it has to be where it can be unset.
    const filtered: DayRollup = { day: '2026-08-24', actors: 5, cells: [cell('star', 'marin-community/marin', 5)] }
    render(<DayHeader day="2026-08-24" rollup={filtered} {...props} target="marin-community/marin" />)
    expect(header().stats).toBe('5 ⭐️ · marin 5')
  })
})
