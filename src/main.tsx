// KnockRoute has moved to Therisma (Nov 25, 2026). The app now shows only this notice, to everyone,
// signed in or not, and makes no calls to the database. The old app code is still in the repo
// (src/App.tsx) and in git history; no data was changed or deleted.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function Moved() {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="KnockRoute has moved"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: '#12324a',
        color: '#fff',
        textAlign: 'center',
        fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif", fontSize: 30, lineHeight: 1.2, margin: '0 0 14px' }}>
          KnockRoute has moved to Therisma.
        </h1>
        <p style={{ fontSize: 20, lineHeight: 1.4, margin: 0 }}>Text Caleb for your login.</p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Moved />
  </StrictMode>,
)
