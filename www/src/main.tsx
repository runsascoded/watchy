import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router-dom'
import Feed from './pages/Feed'
import Health from './pages/Health'
import Icons from './pages/Icons'
import Actors from './pages/Actors'

// Internal-only routes (AR etc.) are compiled in only for the Access-gated
// deployment (watchy.oa.dev); the public bundle omits them entirely.
const INTERNAL = import.meta.env.VITE_INTERNAL === '1'
import './index.scss'

const queryClient = new QueryClient()

function Layout() {
  return (
    <div className="layout">
      <header>
        <h1><Link to="/">👀 watchy</Link></h1>
        <nav>
          <Link to="/">Feed</Link>
          <Link to="/health">Health</Link>
          <Link to="/icons">Icons</Link>
          {INTERNAL && <Link to="/actors">Actors</Link>}
          <a href="https://github.com/runsascoded/watchy">GitHub</a>
        </nav>
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
      ...(INTERNAL ? [{ path: '/actors', element: <Actors /> }] : []),
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
