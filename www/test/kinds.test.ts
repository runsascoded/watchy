// Three copies of this map had drifted: two carried a bare ⭐ (U+2B50) where the canonical
// one carries ⭐️ (U+2B50 U+FE0F). The variation selector is what forces emoji presentation,
// so the same event rendered flat on the Health timeline and in color in the feed. Pinning
// the codepoints, since that difference is invisible in a diff.
import { describe, expect, it } from 'vitest'
import { KIND_EMOJI, KIND_ORDER, kindEmoji } from '../src/kinds'

const codepoints = (s: string) => [...s].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))

describe('KIND_EMOJI', () => {
  it('is exactly these four glyphs', () => {
    expect(KIND_EMOJI).toEqual({ star: '⭐️', unstar: '💔', follow: '🔔', unfollow: '🔕' })
  })

  it('spells the star with the variation selector that forces emoji presentation', () => {
    expect(codepoints(KIND_EMOJI.star)).toEqual(['U+2B50', 'U+FE0F'])
  })

  it('covers every kind the headers order, so none renders blank', () => {
    expect(KIND_ORDER.map(k => KIND_EMOJI[k])).toEqual(['⭐️', '💔', '🔔', '🔕'])
  })
})

describe('kindEmoji', () => {
  it('resolves the known kinds to the same glyphs as the map', () => {
    expect(KIND_ORDER.map(kindEmoji)).toEqual(KIND_ORDER.map(k => KIND_EMOJI[k]))
  })

  it('shows an unrecognized kind rather than rendering nothing', () => {
    expect(kindEmoji('fork')).toBe('fork')
  })
})
