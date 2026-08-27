// Group-by-repo derived its repo list from loaded events, so a busy day showed only the
// repos the first 100-event page happened to reach. Measured against prod: 2026-08-25 has 5
// repos and the first page covered 2 — the view claimed the day had two.
import { describe, expect, it } from 'vitest'
import type { DayRollup } from '../src/api'
import { dayRepos } from '../src/repos'

const cell = (target: string, n: number, kind = 'star') => ({ kind, target, n }) as DayRollup['cells'][0]

const CELLS = [
  cell('marin-community/marin', 349),
  cell('marin-community/marin', 3, 'unstar'),
  cell('Open-Athena/MarinFold', 2),
  cell('marin-community/levanter', 7),
  cell('Open-Athena/mumwelt', 1),
]

describe('dayRepos', () => {
  it('keeps the loaded repos in activity order, then appends the rest busiest first', () => {
    expect(dayRepos(['marin-community/marin'], CELLS)).toEqual([
      'marin-community/marin',
      'marin-community/levanter',
      'Open-Athena/MarinFold',
      'Open-Athena/mumwelt',
    ])
  })

  it('sums a repo across kinds when ranking the ones with no rows', () => {
    // marin is 349 stars + 3 unstars; ranked ahead of levanter's 7 despite being split
    expect(dayRepos([], CELLS)[0]).toBe('marin-community/marin')
  })

  it('breaks count ties by name, so the order does not wobble between renders', () => {
    const tied = [cell('b/one', 4), cell('a/two', 4)]
    expect(dayRepos([], tied)).toEqual(['a/two', 'b/one'])
  })

  it('never duplicates a repo that has both loaded rows and rollup cells', () => {
    expect(dayRepos(['marin-community/levanter'], CELLS)).toEqual([
      'marin-community/levanter',
      'marin-community/marin',
      'Open-Athena/MarinFold',
      'Open-Athena/mumwelt',
    ])
  })

  it('falls back to the loaded repos before the rollup lands', () => {
    expect(dayRepos(['a/b', 'c/d'], [])).toEqual(['a/b', 'c/d'])
  })
})
