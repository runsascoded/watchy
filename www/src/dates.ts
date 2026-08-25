/**
 * A set of dates in a URL param, at a length someone might actually share.
 *
 * The naive encoding of "these 7 days are collapsed" is
 * `?c=2026-08-24%2C2026-08-23%2C…` — 90 characters of mostly redundant digits, and a
 * `%2C` between each pair because `URLSearchParams` percent-encodes commas. This says
 * the same thing in 22: `?c=260818-24`.
 *
 * Three compressions, in order of how much they buy:
 *
 * 1. **Runs contract.** Consecutive days become `start-end`. Collapsing a week is one
 *    token regardless of its length — and collapsing a week is the common case.
 * 2. **Digits are inherited.** Each token drops the leading digits it shares with the
 *    one before it: `260731 0805 0824-25` is Jul 31, Aug 5, Aug 24–25 of 2026. A token
 *    is 2 digits (day), 4 (month-day), 6 (2-digit year), or 8 (full year, for dates
 *    outside 2000–2099). The first token is never abbreviated.
 * 3. **The separator is a space.** Which `URLSearchParams` writes as `+` and reads back
 *    as a space — so the URL bar shows `?c=260731+0805+0824-25` with nothing escaped,
 *    while the round trip stays exactly the one the URL spec defines. (Decoding also
 *    accepts a literal `+`, in case something hands the string over un-decoded.)
 *
 * Malformed tokens are skipped rather than thrown: this is a hand-editable URL, and a
 * typo should cost you one day's state, not the whole page.
 */
import type { Param } from 'use-prms'

const DAY_MS = 86_400_000
const TOKEN = /^(\d{2}|\d{4}|\d{6}|\d{8})(?:-(\d{2}|\d{4}|\d{6}|\d{8}))?$/

/** ISO `YYYY-MM-DD` → UTC ms; NaN if it isn't one. */
function ms(date: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN
}

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** Expand a 2/4/6/8-digit token against the date before it (`YYYYMMDD` digits). */
function expand(token: string, prev: string | null): string | null {
  const full = token.length === 8 ? token
    : token.length === 6 ? `20${token}`
    : prev === null ? null
    : prev.replace(/-/g, '').slice(0, 8 - token.length) + token
  if (full === null) return null
  const date = `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6)}`
  // Round-trip through the calendar so 0231 / 0000 are rejected rather than normalized
  const t = ms(date)
  return !isNaN(t) && iso(t) === date ? date : null
}

/** The shortest token for `date` that `expand` will read back, given `prev`. */
function contract(date: string, prev: string | null): string {
  const d = date.replace(/-/g, '')
  if (prev === null) return d.startsWith('20') ? d.slice(2) : d
  const p = prev.replace(/-/g, '')
  if (p.slice(0, 6) === d.slice(0, 6)) return d.slice(6)
  if (p.slice(0, 4) === d.slice(0, 4)) return d.slice(4)
  return d.startsWith('20') ? d.slice(2) : d
}

export function encodeDates(dates: readonly string[]): string | undefined {
  const sorted = [...new Set(dates)].map(ms).filter(t => !isNaN(t)).sort((a, b) => a - b)
  if (!sorted.length) return undefined
  // Contract calendar-consecutive days into runs before encoding either end
  const runs: Array<[number, number]> = []
  for (const t of sorted) {
    const last = runs[runs.length - 1]
    if (last && t === last[1] + DAY_MS) last[1] = t
    else runs.push([t, t])
  }
  const tokens: string[] = []
  let prev: string | null = null
  for (const [from, to] of runs) {
    const start = iso(from)
    let token = contract(start, prev)
    prev = start
    if (to !== from) {
      const end = iso(to)
      token += `-${contract(end, prev)}`
      prev = end
    }
    tokens.push(token)
  }
  return tokens.join(' ')
}

export function decodeDates(encoded: string | undefined): string[] {
  if (!encoded) return []
  const out: string[] = []
  let prev: string | null = null
  for (const token of encoded.split(/[\s+]+/).filter(Boolean)) {
    const m = TOKEN.exec(token)
    if (!m) continue
    const start = expand(m[1], prev)
    if (!start) continue
    prev = start
    if (m[2] === undefined) {
      out.push(start)
      continue
    }
    const end = expand(m[2], start)
    // A backwards range is a typo, not an instruction to walk the calendar in reverse
    if (!end || ms(end) < ms(start)) { out.push(start); continue }
    for (let t = ms(start); t <= ms(end); t += DAY_MS) out.push(iso(t))
    prev = end
  }
  return [...new Set(out)]
}

/**
 * `use-prms` param for a set of ISO dates. Empty set ⇒ absent from the URL, so the
 * default view carries no param at all.
 */
export const datesParam: Param<string[]> = { encode: encodeDates, decode: decodeDates }
