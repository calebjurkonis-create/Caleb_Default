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
const store = import.meta.env.VITE_DEMO ? createDemoStore() : createSupabaseStore(url, key)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
)
