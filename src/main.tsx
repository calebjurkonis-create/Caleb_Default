import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createDemoStore } from './data/demoStore'
import { createSupabaseStore } from './data/supabaseStore'
import './styles.css'

// The office's Supabase project. The publishable key is meant to ship in the app;
// logins and the database's access rules are what protect the data.
// Set VITE_DEMO=1 to run with sample data instead.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://wybrhduekutlgsahbrqj.supabase.co'
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'sb_publishable_4WT0bYgSGyFrrx_a7BEuNg_SZs2em9v'
// knockroute.vercel.app/demo: a private trial for someone outside the office. It never
// touches the team database; everything stays in that phone's browser.
const GUEST_NAME = 'Eric'
const isGuest = /^\/demo\/?$/.test(location.pathname)
if (isGuest) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/demo.webmanifest')
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'KnockRoute Demo')
  document.title = 'KnockRoute Demo'
}
const store = isGuest
  ? createDemoStore({ guestName: GUEST_NAME })
  : import.meta.env.VITE_DEMO
    ? createDemoStore()
    : createSupabaseStore(url, key)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
)
