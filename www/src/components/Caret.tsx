/**
 * The fold indicator, shared by day headers, repo headers, and the bulk ▼/▶ all buttons —
 * one definition so a control and the state it produces can't drift apart.
 *
 * An SVG rather than a glyph, because the character route has no pair that works. ▸/▾
 * (U+25B8/25BE) ink a fraction of their em box, so scaling them up grew the line box
 * around the same faint mark; ►/▼ (U+25BA/25BC) are legible but come from different glyph
 * families — a "pointer" and a triangle — and render at visibly different sizes; ▶ (U+25B6)
 * would match ▼ but takes an emoji presentation on some platforms. One path rotated 90°
 * sidesteps all of it: both states are the same shape at the same size, by construction,
 * in every font.
 *
 * Decorative: the state it depicts is already on the button as `aria-expanded`, and the
 * button carries the label.
 */
export function Caret({ closed }: { closed: boolean }) {
  return (
    <svg className={`caret${closed ? ' shut' : ''}`} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M1.5 4 h9 L6 9.5 Z" />
    </svg>
  )
}
