import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import Feed from './pages/Feed'
import Health from './pages/Health'
import Icons from './pages/Icons'
import Graphs from './pages/Graphs'
import Actors from './pages/Actors'
import Access from './pages/Access'
import Og from './pages/Og'
import { WhoamiChip } from './auth'
import { HotkeysProvider } from 'use-kbd'
import { KbdSurfaces } from './kbd'
import { ThemeProvider } from './theme'
// Internal-only routes (AR etc.) are compiled in only for internal
// deployments; the public bundle omits them entirely.
import { INTERNAL } from './scope'
import 'use-kbd/styles.css'
import './index.scss'

const TITLE_BASE = 'watchy'
const PAGE_TITLES: Record<string, string> = {
  '/health': 'Health',
  '/graphs': 'Graphs',
  '/icons': 'Icons',
  '/actors': 'Actors',
  '/access': 'Access',
}

// Off-site links open in new tabs — one delegated capture listener (runs before
// the default navigation) instead of target= on every anchor; also covers
// FloatingPortal tooltips, which render outside the app root. Same-host anchors
// (router Links, hash/relative) are untouched; mailto: has an empty .host.
document.addEventListener('click', e => {
  const a = (e.target as Element | null)?.closest?.('a')
  if (a?.host && a.host !== location.host) {
    a.target = '_blank'
    a.rel = 'noopener'
  }
}, true)

const queryClient = new QueryClient()

function Layout() {
  const { pathname } = useLocation()
  useEffect(() => {
    const page = PAGE_TITLES[pathname]
    document.title = page ? `${TITLE_BASE} · ${page}` : TITLE_BASE
  }, [pathname])
  return (
    <div className="layout">
      <header>
        <h1><Link to="/">👀 watchy</Link></h1>
        <nav>
          <NavLink to="/" end>Feed</NavLink>
          <NavLink to="/graphs">Graphs</NavLink>
          {INTERNAL && <NavLink to="/actors">Actors</NavLink>}
          <NavLink to="/health">Health</NavLink>
        </nav>
        {INTERNAL && <WhoamiChip />}
      </header>
      <main><Outlet /></main>
      <KbdSurfaces />
    </div>
  )
}

const router = createBrowserRouter([
  // Chrome-less 1200×630 render of the stars chart — screenshotted to public/og.jpg
  { path: '/og', element: <Og /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Feed /> },
      { path: '/health', element: <Health /> },
      { path: '/icons', element: <Icons /> },
      { path: '/graphs', element: <Graphs /> },
      ...(INTERNAL ? [
        { path: '/actors', element: <Actors /> },
        { path: '/access', element: <Access /> },
      ] : []),
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HotkeysProvider>
          <RouterProvider router={router} />
        </HotkeysProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
