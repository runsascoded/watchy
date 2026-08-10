import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider } from 'react-router-dom'
import Feed from './pages/Feed'
import Health from './pages/Health'
import Icons from './pages/Icons'
import Graphs from './pages/Graphs'
import Actors from './pages/Actors'
import Access from './pages/Access'
import { WhoamiChip } from './auth'
// Internal-only routes (AR etc.) are compiled in only for the internal
// deployment (watchy.oa.dev); the public bundle omits them entirely.
import { INTERNAL } from './scope'
import './index.scss'

if (INTERNAL) document.title = 'watchy · OA'

const queryClient = new QueryClient()

function Layout() {
  return (
    <div className="layout">
      <header>
        <h1><Link to="/">👀 watchy</Link>{INTERNAL && <span className="dim"> · OA</span>}</h1>
        <nav>
          <NavLink to="/" end>Feed</NavLink>
          <NavLink to="/health">Health</NavLink>
          <NavLink to="/graphs">Graphs</NavLink>
          <NavLink to="/icons">Icons</NavLink>
          {INTERNAL && <NavLink to="/actors">Actors</NavLink>}
          <a href="https://github.com/runsascoded/watchy">GitHub</a>
        </nav>
        {INTERNAL && <WhoamiChip />}
      </header>
      <main><Outlet /></main>
    </div>
  )
}

const router = createBrowserRouter([
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
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
