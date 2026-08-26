// The combobox's contract: type to narrow, click or Enter to commit, × to clear.
// The × is the point of the whole component — a target set by clicking a
// day-header chip previously had no visible way back.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TargetPicker } from '../src/components/TargetPicker'

const OPTIONS = [
  'marin-community/marin',
  'marin-community/levanter',
  'Open-Athena/MarinFold',
  'Open-Athena/ec2',
]

const setup = (value = '') => {
  const onChange = vi.fn()
  render(<TargetPicker value={value} options={OPTIONS} onChange={onChange} />)
  return { onChange, user: userEvent.setup(), input: screen.getByRole('combobox') }
}

/** The visible option labels, in order. */
const shown = () => screen.queryAllByRole('option').map(o => o.textContent)

describe('TargetPicker', () => {
  it('shows every target once opened', async () => {
    const { user, input } = setup()
    expect(shown()).toEqual([])
    await user.click(input)
    expect(shown()).toEqual(OPTIONS)
  })

  it('narrows to substring matches, case-insensitively, across owner and repo', async () => {
    const { user, input } = setup()
    await user.click(input)
    await user.type(input, 'marin')
    expect(shown()).toEqual([
      'marin-community/marin',
      'marin-community/levanter',
      'Open-Athena/MarinFold',
    ])
  })

  it('says so when nothing matches', async () => {
    const { user, input } = setup()
    await user.click(input)
    await user.type(input, 'zzz')
    expect(shown()).toEqual([])
    expect(screen.getByText('no match')).toBeInTheDocument()
  })

  it('commits the clicked option', async () => {
    const { user, input, onChange } = setup()
    await user.click(input)
    await user.click(screen.getByRole('option', { name: 'Open-Athena/ec2' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Open-Athena/ec2')
    expect(shown()).toEqual([])
  })

  it('commits the highlighted option on Enter, after arrowing down', async () => {
    const { user, input, onChange } = setup()
    await user.click(input)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('marin-community/levanter')
  })

  it('clears the filter from the ×', async () => {
    const { user, onChange } = setup('marin-community/marin')
    await user.click(screen.getByRole('button', { name: 'all targets' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('')
  })

  it('has no × while unset', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'all targets' })).toBeNull()
  })

  it('displays the committed target, and offers it as placeholder while querying', async () => {
    const { user, input } = setup('marin-community/marin')
    expect(input).toHaveValue('marin-community/marin')
    await user.click(input)
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'marin-community/marin')
  })

  it('discards an uncommitted query on Escape', async () => {
    const { user, input, onChange } = setup('marin-community/marin')
    await user.click(input)
    await user.type(input, 'ec2')
    await user.keyboard('{Escape}')
    expect(shown()).toEqual([])
    expect(input).toHaveValue('marin-community/marin')
    expect(onChange).not.toHaveBeenCalled()
  })
})
