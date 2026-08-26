// Repo filter: a combobox, not a <select>.
//
// The <select> it replaces had two problems. Picking a repo from ~35 options
// meant scrolling a native menu with no way to type past it, and once picked
// there was no visible way back — "all targets" is just another option buried
// at the top of the list, so a filter set by clicking a day-header chip looked
// stuck. Both are the same fix: type to narrow, and an explicit × to clear.
//
// Opening shows the full list with the current target as placeholder, so the
// box is always ready for a query rather than needing its text cleared first.
import { useEffect, useId, useRef, useState } from 'react'

interface Props {
  value: string
  options: readonly string[]
  onChange: (target: string) => void
}

export function TargetPicker({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  const q = query.trim().toLowerCase()
  const hits = q ? options.filter(o => o.toLowerCase().includes(q)) : [...options]
  const clamped = Math.min(hi, Math.max(hits.length - 1, 0))

  // Clicking anywhere else closes without committing — the input's own blur
  // can't do this, since it also fires on the way to clicking an option.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const commit = (t: string) => {
    onChange(t)
    setOpen(false)
    setQuery('')
    input.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      const d = e.key === 'ArrowDown' ? 1 : -1
      setHi((clamped + d + hits.length) % (hits.length || 1))
      return
    }
    if (e.key === 'Enter' && open && hits.length) {
      e.preventDefault()
      commit(hits[clamped])
    }
  }

  return (
    <div className="target-picker" ref={box}>
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="target"
        placeholder={value || 'all targets'}
        value={open ? query : value}
        onChange={e => {
          setQuery(e.target.value)
          setHi(0)
          setOpen(true)
        }}
        onFocus={() => {
          setQuery('')
          setHi(0)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {value && (
        <button
          type="button"
          className="clear"
          aria-label="all targets"
          // mousedown, not click: the input's blur would otherwise close the
          // list and re-render this button out from under the click
          onMouseDown={e => {
            e.preventDefault()
            commit('')
          }}
        >
          ×
        </button>
      )}
      {open && (
        <ul className="options" id={listId} role="listbox">
          {hits.length === 0 && <li className="empty dim">no match</li>}
          {hits.map((t, i) => (
            <li key={t}>
              <button
                type="button"
                role="option"
                aria-selected={t === value}
                className={i === clamped ? 'hi' : undefined}
                onMouseEnter={() => setHi(i)}
                onMouseDown={e => {
                  e.preventDefault()
                  commit(t)
                }}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
