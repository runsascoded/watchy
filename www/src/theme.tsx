import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'watchy-theme'
const ORDER: Theme[] = ['system', 'dark', 'light']

// Every color goes through CSS `light-dark()`, so overriding `color-scheme` on
// :root IS the theme switch ('' defers to the OS via the stylesheet default).
const apply = (theme: Theme) => {
  document.documentElement.style.colorScheme = theme === 'system' ? '' : theme
}

const read = (): Theme => {
  const s = localStorage.getItem(STORAGE_KEY)
  return s === 'light' || s === 'dark' ? s : 'system'
}

const ThemeContext = createContext<{ theme: Theme; cycleTheme: () => void }>({ theme: 'system', cycleTheme: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    apply(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])
  const cycleTheme = () => setTheme(t => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length])
  return <ThemeContext.Provider value={{ theme, cycleTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
