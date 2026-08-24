/**
 * D1 caps a single statement at 100 bound parameters — past that it throws
 * `too many SQL variables ... SQLITE_ERROR [code: 7500]`.
 *
 * That makes every `WHERE col IN (?,?,…)` built from a runtime list a time bomb: fine
 * until the list outgrows 100, then it throws on every call forever. It cost us two
 * weekly Slack scoreboards — `updateWeeklyOp` binds one `?` per distinct actor, so the
 * live thread froze at exactly login #101 and every later update (including the
 * end-of-week finalize) threw, leaving the OP showing mid-week star totals.
 *
 * So: never inline a runtime-length list into a statement. Run it in chunks.
 */
export const D1_MAX_BINDS = 100

/**
 * Run `sql` once per chunk of `items` and concatenate the rows. `sql` receives the
 * `?,?,…` placeholder string for its `IN (…)`; `extra` binds are passed *before* the
 * chunk, so write them earlier in the statement. Row order is per-chunk — sort the
 * result if you need a global ordering.
 */
export async function chunkedAll<T>(
  db: D1Database,
  items: readonly (string | number)[],
  sql: (placeholders: string) => string,
  extra: readonly (string | number)[] = [],
): Promise<T[]> {
  const size = D1_MAX_BINDS - extra.length
  const out: T[] = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    const { results } = await db
      .prepare(sql(chunk.map(() => '?').join(',')))
      .bind(...extra, ...chunk)
      .all<T>()
    out.push(...results)
  }
  return out
}
