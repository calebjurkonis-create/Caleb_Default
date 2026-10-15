import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createDemoStore } from './data/demoStore'
import { createSupabaseStore } from './data/supabaseStore'
import './styles.css'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const store = url && key ? createSupabaseStore(url, key) : createDemoStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
)
