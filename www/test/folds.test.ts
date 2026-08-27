// The regression this encodes: "collapse all" collapsed the loaded days, the shorter page
// tripped the load-more sentinel, and the days that paged in rendered *open* — so the
// button looked like it had undone its own work. A day the user has never seen has to take
// the current default, which is only expressible as default-plus-exceptions.
import { describe, expect, it } from 'vitest'
import { isDayClosed, visibleDays } from '../src/folds'

/** Which of `days` render collapsed, in order. */
const shut = (days: string[], except: string[], closedByDefault: boolean) =>
  days.filter(d => isDayClosed(d, new Set(except), closedByDefault))

const DAYS = ['2026-08-27', '2026-08-26', '2026-08-25']

describe('isDayClosed', () => {
  it('defaults every day open, so a bare URL is the default view', () => {
    expect(shut(DAYS, [], false)).toEqual([])
  })

  it('collapses only the listed days while the default is open', () => {
    expect(shut(DAYS, ['2026-08-26'], false)).toEqual(['2026-08-26'])
  })

  it('collapses a day that paged in after "collapse all" — the regression', () => {
    // `2026-08-24` was not loaded when the button was clicked; it still arrives collapsed.
    expect(shut([...DAYS, '2026-08-24'], [], true)).toEqual([
      '2026-08-27', '2026-08-26', '2026-08-25', '2026-08-24',
    ])
  })

  it('re-opens just the days listed once the default is closed', () => {
    expect(shut(DAYS, ['2026-08-26'], true)).toEqual(['2026-08-27', '2026-08-25'])
  })

  it('is symmetric: the same exception list means opposite things under each default', () => {
    const except = ['2026-08-25']
    expect([shut(DAYS, except, false), shut(DAYS, except, true)])
      .toEqual([['2026-08-25'], ['2026-08-27', '2026-08-26']])
  })
})

describe('visibleDays', () => {
  const DAYS_DESC = ['2026-08-27', '2026-08-26', '2026-08-25', '2026-08-24']
  const allLoaded = () => true
  const noneLoaded = () => false

  it('draws every day when they are all collapsed, however little has been fetched', () => {
    // The fix: collapsed headers come from /api/days, so none of them waits on paging.
    expect(visibleDays(DAYS_DESC, () => true, noneLoaded)).toEqual({ shown: DAYS_DESC, frontier: false })
  })

  it('stops at the first open day still waiting on rows, and flags it', () => {
    const loaded = (d: string) => d > '2026-08-25'
    expect(visibleDays(DAYS_DESC, () => false, loaded))
      .toEqual({ shown: ['2026-08-27', '2026-08-26', '2026-08-25'], frontier: true })
  })

  it('runs past collapsed days to reach an open one that still needs rows', () => {
    const closed = (d: string) => d !== '2026-08-24'
    expect(visibleDays(DAYS_DESC, closed, noneLoaded)).toEqual({ shown: DAYS_DESC, frontier: true })
  })

  it('draws the whole list with no frontier once history is exhausted', () => {
    expect(visibleDays(DAYS_DESC, () => false, allLoaded)).toEqual({ shown: DAYS_DESC, frontier: false })
  })

  it('has nothing to show, and nothing to wait for, before any day is known', () => {
    expect(visibleDays([], () => false, noneLoaded)).toEqual({ shown: [], frontier: false })
  })
})
