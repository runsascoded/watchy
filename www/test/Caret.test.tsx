// Both fold states must be the *same* mark, differing only by rotation. The glyph versions
// this replaced failed exactly there: ►/▼ come from different families and rendered at
// visibly different sizes, so open and closed didn't look like one control in two states.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Caret } from '../src/components/Caret'

const svg = (closed: boolean) => render(<Caret closed={closed} />).container.querySelector('svg')!

describe('Caret', () => {
  it('draws one shape at one size, whatever the state', () => {
    const [open, shut] = [svg(false), svg(true)]
    expect([open.getAttribute('viewBox'), open.querySelector('path')!.getAttribute('d')])
      .toEqual([shut.getAttribute('viewBox'), shut.querySelector('path')!.getAttribute('d')])
  })

  it('marks only the closed state, which is what the rotation hangs off', () => {
    expect([[...svg(false).classList], [...svg(true).classList]]).toEqual([['caret'], ['caret', 'shut']])
  })

  it('is decorative: the button around it carries the label and aria-expanded', () => {
    expect(svg(false).getAttribute('aria-hidden')).toBe('true')
  })
})
