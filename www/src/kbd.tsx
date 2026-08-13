import { useNavigate } from 'react-router-dom'
import { LookupModal, Omnibar, SequenceModal, ShortcutsModal, SpeedDial, useActions, type SpeedDialAction } from 'use-kbd'
import { useTheme, type Theme } from './theme'
import { INTERNAL } from './scope'

export const REPO_URL = 'https://github.com/runsascoded/watchy/tree/rw'

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '1em', height: '1em' }}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

/** Sun (light), moon (dark), or half-disc (system). */
function ThemeCycleIcon({ theme }: { theme: Theme }) {
  const style = { width: '1em', height: '1em' } as const
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 24 24" style={style} fill="currentColor">
        <circle cx="12" cy="12" r="4" />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <line x1="4.93" y1="4.93" x2="7.05" y2="7.05" />
          <line x1="16.95" y1="16.95" x2="19.07" y2="19.07" />
          <line x1="4.93" y1="19.07" x2="7.05" y2="16.95" />
          <line x1="16.95" y1="7.05" x2="19.07" y2="4.93" />
        </g>
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" style={style} fill="currentColor">
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" style={style} fill="currentColor">
      <path d="M12 3a9 9 0 0 0 0 18 9 9 0 0 0 0-18zm0 2v14a7 7 0 0 1 0-14z" />
    </svg>
  )
}

/** Nav hotkeys + omnibar entries; rendered inside the router so it can navigate. */
function NavActions() {
  const navigate = useNavigate()
  useActions({
    'nav:feed': { label: 'Feed', group: 'Navigate', defaultBindings: ['f'], handler: () => navigate('/') },
    'nav:graphs': { label: 'Graphs', group: 'Navigate', defaultBindings: ['g'], handler: () => navigate('/graphs') },
    ...(INTERNAL ? {
      'nav:actors': { label: 'Actors', group: 'Navigate', defaultBindings: ['a'], handler: () => navigate('/actors') },
    } : {}),
    'nav:health': { label: 'Health', group: 'Navigate', defaultBindings: ['h'], handler: () => navigate('/health') },
    'nav:github': { label: 'GitHub repo', group: 'Navigate', keywords: ['source', 'code'], handler: () => window.open(REPO_URL, '_blank') },
  })
  return null
}

/** Standard lower-right widget + keyboard surfaces (use-kbd). */
export function KbdSurfaces() {
  const { theme, cycleTheme } = useTheme()
  const actions: SpeedDialAction[] = [
    {
      key: 'theme',
      label: `Theme: ${theme[0].toUpperCase()}${theme.slice(1)} (click to cycle)`,
      icon: <ThemeCycleIcon theme={theme} />,
      onClick: cycleTheme,
    },
    { key: 'github', label: 'GitHub', icon: <GitHubIcon />, href: REPO_URL },
  ]
  return (
    <>
      <NavActions />
      <SpeedDial actions={actions} chevronMode="badge" />
      <ShortcutsModal />
      <Omnibar placeholder="Search actions…" maxResults={15} />
      <LookupModal />
      <SequenceModal />
    </>
  )
}
