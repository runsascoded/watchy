/**
 * The fold indicator, shared by day headers, repo headers, and the bulk ▼/► all buttons —
 * one definition so a control and the state it produces can't drift apart.
 *
 * ► / ▼ (U+25BA / U+25BC), not the small ▸ / ▾ (U+25B8 / U+25BE): the small pair inks a
 * fraction of its em box, so at header size the open and closed states were easy to
 * confuse, and scaling the font up only grew the line box around the same thin glyph.
 * Neither of these has an emoji presentation — unlike ▶ (U+25B6), which renders as a
 * color ▶️ on some platforms — so they stay flat text everywhere.
 */
export const CARET_OPEN = '▼'
export const CARET_SHUT = '►'

export function Caret({ closed }: { closed: boolean }) {
  return <span className="caret">{closed ? CARET_SHUT : CARET_OPEN}</span>
}
