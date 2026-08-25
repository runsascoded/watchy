// A URL people share, so the encoding is a wire format: every case below is a promise
// that a link keeps working. Round-trip is the property that matters, but the exact
// strings are pinned too — a "harmless" change to them silently breaks old links.
import { describe, expect, it } from 'vitest'
import { decodeDates, encodeDates } from '../src/dates'

describe('encodeDates', () => {
  it('contracts a run of consecutive days into one token', () => {
    const week = ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24']
    expect(encodeDates(week)).toBe('260818-24')
    // The whole point: 90 chars of `?c=2026-08-24%2C…` becomes 9
    expect(encodeDates(week)!.length).toBe(9)
  })

  it('drops the digits each token shares with the one before it', () => {
    // Aug 24 inherits the month from Aug 5, so it costs two digits, not four
    expect(encodeDates(['2026-07-31', '2026-08-05', '2026-08-24', '2026-08-25'])).toBe('260731 0805 24-25')
  })

  it('spells out a year change in full, then abbreviates again', () => {
    expect(encodeDates(['2025-12-29', '2026-01-02', '2026-01-09'])).toBe('251229 260102 09')
  })

  it('sorts and dedupes, so the same set is always the same string', () => {
    expect(encodeDates(['2026-08-24', '2026-08-22', '2026-08-24'])).toBe('260822 24')
  })

  it('leaves the param out of the URL entirely when nothing is selected', () => {
    expect([encodeDates([]), encodeDates(['nonsense'])]).toEqual([undefined, undefined])
  })

  it('uses the full year outside 2000-2099', () => {
    expect(encodeDates(['1999-12-31', '2100-01-01'])).toBe('19991231 21000101')
  })
})

describe('decodeDates', () => {
  it('expands runs and inherited digits', () => {
    expect(decodeDates('260731 0805 0824-25')).toEqual(['2026-07-31', '2026-08-05', '2026-08-24', '2026-08-25'])
  })

  it('reads a literal + as the separator too, since that is what the URL bar shows', () => {
    expect(decodeDates('260822+24')).toEqual(['2026-08-22', '2026-08-24'])
  })

  it('carries the range end into the next token, not the range start', () => {
    expect(decodeDates('260824-0902 05')).toEqual(['2026-08-24', ...['25', '26', '27', '28', '29', '30', '31'].map(d => `2026-08-${d}`), '2026-09-01', '2026-09-02', '2026-09-05'])
  })

  it('is absent-safe and empty-safe', () => {
    expect([decodeDates(undefined), decodeDates('')]).toEqual([[], []])
  })

  it('skips a malformed token instead of dropping the whole selection', () => {
    // A leading abbreviated token has nothing to inherit from; `0231` is not a date;
    // a backwards range keeps its start rather than walking the calendar backwards
    expect([decodeDates('24 260822'), decodeDates('260822 0231 24'), decodeDates('260824-22')]).toEqual([
      ['2026-08-22'],
      ['2026-08-22', '2026-08-24'],
      ['2026-08-24'],
    ])
  })
})

describe('round trip', () => {
  const cases = [
    ['2026-08-24'],
    ['2026-08-18', '2026-08-19', '2026-08-20'],
    ['2026-07-31', '2026-08-05', '2026-08-24', '2026-08-25'],
    ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01'],
    ['2024-02-28', '2024-02-29', '2024-03-01'], // leap day, and the run spanning it
  ]
  for (const dates of cases) {
    it(`survives ${encodeDates(dates)}`, () => {
      expect(decodeDates(encodeDates(dates))).toEqual(dates)
    })
  }
})
