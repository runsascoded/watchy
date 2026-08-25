// URL params people paste into Slack: `%2F` per target is three characters of noise,
// and `URLSearchParams` only leaves alphanumerics and `*-._` alone. `*` is the one
// delimiter GitHub can't put in a name, so it stands in for the slash.
import { describe, expect, it } from 'vitest'
import { targetParam, targetsParam } from '../src/params'

describe('targetParam', () => {
  it('writes the slash as * and reads it back', () => {
    expect(targetParam.encode('marin-community/marin')).toBe('marin-community*marin')
    expect(targetParam.decode('marin-community*marin')).toBe('marin-community/marin')
  })

  it('still reads a literal slash, so links written before this keep working', () => {
    expect(targetParam.decode('marin-community/marin')).toBe('marin-community/marin')
  })

  it('leaves the param out of the URL when no target is selected', () => {
    expect([targetParam.encode(''), targetParam.decode(undefined)]).toEqual([undefined, ''])
  })
})

describe('targetsParam', () => {
  it('sorts and dedupes, space-separated (the URL bar shows +)', () => {
    expect(targetsParam.encode(['Open-Athena/MarinFold', 'marin-community/marin', 'Open-Athena/MarinFold']))
      .toBe('Open-Athena*MarinFold marin-community*marin')
  })

  it('round-trips through both separators', () => {
    expect(targetsParam.decode('Open-Athena*MarinFold+marin-community*marin'))
      .toEqual(['Open-Athena/MarinFold', 'marin-community/marin'])
  })

  it('is empty-safe in both directions', () => {
    expect([targetsParam.encode([]), targetsParam.decode(undefined), targetsParam.decode('')]).toEqual([undefined, [], []])
  })
})
