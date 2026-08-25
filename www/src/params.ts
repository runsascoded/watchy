import type { Param } from 'use-prms'

/**
 * A list of `owner/repo` targets in a URL param.
 *
 * `URLSearchParams` leaves only alphanumerics and `*-._` unescaped, so a literal `/`
 * would come back as `%2F` — three characters of noise per target. `*` is the one safe
 * delimiter GitHub can't put in an owner or repo name, so it stands in for the slash;
 * the separator between targets is a space, which the URL bar shows as `+`.
 *
 * `?rc=marin-community*marin+Open-Athena*MarinFold`
 */
/** One target, same escaping (`?t=marin-community*marin`). Reads `/` too, so links
 * written before this — and anything hand-typed — still resolve. */
export const targetParam: Param<string> = {
  encode: target => (target ? target.replace(/\//g, '*') : undefined),
  decode: encoded => (encoded ?? '').replace(/\*/g, '/'),
}

export const targetsParam: Param<string[]> = {
  encode: targets => {
    const list = [...new Set(targets)].sort()
    return list.length ? list.map(t => t.replace(/\//g, '*')).join(' ') : undefined
  },
  decode: encoded =>
    encoded ? [...new Set(encoded.split(/[\s+]+/).filter(Boolean).map(t => t.replace(/\*/g, '/')))] : [],
}
