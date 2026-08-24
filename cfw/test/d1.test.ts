// D1 rejects a statement with >100 bound parameters, which silently turned every
// `WHERE col IN (?,?,…)` over a runtime-length list into a bomb that armed itself the
// week we crossed 100 distinct actors. The stub below enforces the real limit, so a
// query that regresses to a single unchunked statement fails here rather than in prod.
import { describe, expect, it } from 'vitest'
import { chunkedAll, D1_MAX_BINDS } from '../src/d1'

interface Call {
  sql: string
  binds: unknown[]
}

/** Minimal D1Database stand-in: records calls, enforces the bind cap, echoes binds back. */
function stubDb(calls: Call[]): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          if (binds.length > D1_MAX_BINDS) {
            throw new Error(`too many SQL variables at offset 0: SQLITE_ERROR [code: 7500]`)
          }
          calls.push({ sql, binds })
          return { all: async () => ({ results: binds.map(v => ({ v })) }) }
        },
      }
    },
  } as unknown as D1Database
}

const sql = (ph: string) => `SELECT v FROM t WHERE v IN (${ph})`

describe('chunkedAll', () => {
  it('runs one statement when the list fits', async () => {
    const calls: Call[] = []
    const rows = await chunkedAll<{ v: number }>(stubDb(calls), [1, 2, 3], sql)
    expect(calls).toEqual([{ sql: 'SELECT v FROM t WHERE v IN (?,?,?)', binds: [1, 2, 3] }])
    expect(rows).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }])
  })

  it('splits at the bind cap and concatenates, losing no items', async () => {
    const calls: Call[] = []
    const items = Array.from({ length: 250 }, (_, i) => i)
    const rows = await chunkedAll<{ v: number }>(stubDb(calls), items, sql)
    expect(calls.map(c => c.binds.length)).toEqual([100, 100, 50])
    expect(rows.map(r => r.v)).toEqual(items)
  })

  it('counts `extra` binds against the cap and passes them first', async () => {
    const calls: Call[] = []
    const items = Array.from({ length: 100 }, (_, i) => i)
    await chunkedAll(stubDb(calls), items, ph => `SELECT v FROM t WHERE ts < ? AND v IN (${ph})`, ['2026-08-24'])
    expect(calls.map(c => c.binds.length)).toEqual([100, 2])
    expect(calls.map(c => c.binds[0])).toEqual(['2026-08-24', '2026-08-24'])
  })

  it('issues no statement for an empty list', async () => {
    const calls: Call[] = []
    expect(await chunkedAll(stubDb(calls), [], sql)).toEqual([])
    expect(calls).toEqual([])
  })
})
