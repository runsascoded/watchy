// `/api/events` only ever exposed a cursor over the whole stream, so showing one specific
// day meant walking back to it 100 rows at a time — nine requests and 896 rows to display
// 2026-08-25's 365. Date filtering belongs here, not in the client.
import { describe, expect, it } from 'vitest'
import { eventFilters } from '../src/index'

const filters = (qs: string) => eventFilters(new URL(`https://w.example/api/events${qs}`))
const clause = (qs: string) => {
  const f = filters(qs)
  if (f instanceof Response) throw new Error('expected filters, got a Response')
  return f
}

describe('eventFilters days', () => {
  it('has no day clause when none is asked for', () => {
    expect(clause('')).toEqual({ wheres: [], binds: [] })
  })

  it('bounds one day as a half-open range, so it rides the ts index', () => {
    expect(clause('?days=2026-08-25')).toEqual({
      wheres: ['((ts >= ? AND ts < ?))'],
      binds: ['2026-08-25', '2026-08-26'],
    })
  })

  it('ORs several days into one request', () => {
    expect(clause('?days=2026-08-25,2026-08-24')).toEqual({
      wheres: ['((ts >= ? AND ts < ?) OR (ts >= ? AND ts < ?))'],
      binds: ['2026-08-25', '2026-08-26', '2026-08-24', '2026-08-25'],
    })
  })

  it('rolls over a month boundary', () => {
    expect(clause('?days=2026-08-31').binds).toEqual(['2026-08-31', '2026-09-01'])
  })

  it('rolls over a leap day', () => {
    expect(clause('?days=2024-02-28').binds).toEqual(['2024-02-28', '2024-02-29'])
  })

  it('combines with the other filters rather than replacing them', () => {
    expect(clause('?days=2026-08-25&kind=star&target=o/r')).toEqual({
      wheres: ['target = ?', 'kind = ?', '((ts >= ? AND ts < ?))'],
      binds: ['o/r', 'star', '2026-08-25', '2026-08-26'],
    })
  })

  it('rejects a malformed day, naming it, instead of binding junk', async () => {
    const res = filters('?days=2026-08-25,last-tuesday')
    expect(res).toBeInstanceOf(Response)
    expect((res as Response).status).toBe(400)
    expect(await (res as Response).json()).toEqual({ error: 'days must be YYYY-MM-DD: last-tuesday' })
  })

  it('ignores empty segments from a trailing comma', () => {
    expect(clause('?days=2026-08-25,').binds).toEqual(['2026-08-25', '2026-08-26'])
  })
})
