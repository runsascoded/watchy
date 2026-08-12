import { useState, type ReactNode } from 'react'
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react'

/** Floating-ui hover tooltip (shared `.tt` styling) — use instead of native `title`. */
export function Tooltip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 6 })],
    whileElementsMounted: autoUpdate,
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    // safePolygon keeps the TT open while the cursor travels into it — several
    // TTs carry links (Σ⭐ top repos, actor cards) that must be clickable
    useHover(context, { move: false, delay: { open: 100, close: 50 }, handleClose: safePolygon() }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ])
  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className={className}>{children}</span>
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="tt">{tip}</div>
        </FloatingPortal>
      )}
    </>
  )
}
