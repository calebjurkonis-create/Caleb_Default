import { useState } from 'react'
import type { Snapshot, Store } from '../data/store'
import type { NavApp } from '../lib/route'
import { Icon } from './Icon'

interface Props {
  store: Store
  snap: Snapshot
  navApp: NavApp
  satellite: boolean
  onNavApp(a: NavApp): void
  onSatellite(on: boolean): void
  onClose(): void
}

export function MorePanel({ store, snap, navApp, satellite, onNavApp, onSatellite, onClose }: Props) {
  const [sim, setSim] = useState(store.simulateTeam?.get() ?? false)
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <section className="sheet full" aria-label="Settings">
      <header className="sheet-head">
        <div className="grow">
          <h2>{snap.me?.name}</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {snap.me?.role === 'manager' ? 'Manager' : 'Agent'} · {store.mode === 'demo' ? 'Demo mode' : 'Live team data'}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body">
        <label className="field">
          Navigate with
          <select id="nav-app" value={navApp} onChange={(e) => onNavApp(e.target.value as NavApp)}>
            <option value="apple">Apple Maps</option>
            <option value="google">Google Maps</option>
            <option value="waze">Waze</option>
          </select>
        </label>
        <label className="switch">
          <span>Satellite map</span>
          <input id="sat" type="checkbox" checked={satellite} onChange={(e) => onSatellite(e.target.checked)} />
        </label>

        <div className="card">
          <b>Put KnockRoute on your home screen</b>
          <div className="muted" style={{ fontSize: 14 }}>
            iPhone: open this page in Safari, tap the Share button, then “Add to Home Screen”. Android: Chrome menu, then “Install app”. It opens full-screen like a regular app.
          </div>
        </div>

        {store.mode === 'demo' && (
          <div className="section">
            <h3 style={{ fontSize: 20 }}>Demo</h3>
            <label className="switch">
              <span>Simulate teammates logging visits</span>
              <input
                id="sim"
                type="checkbox"
                checked={sim}
                onChange={(e) => {
                  store.simulateTeam!.set(e.target.checked)
                  setSim(e.target.checked)
                }}
              />
            </label>
            {confirmReset ? (
              <div className="row">
                <button className="btn danger" onClick={() => { store.resetDemo!(); setConfirmReset(false) }}>Reset sample data</button>
                <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn" onClick={() => setConfirmReset(true)}>Start the demo over…</button>
            )}
          </div>
        )}

        <button className="btn block" onClick={() => store.signOut()}>
          Sign out
        </button>
      </div>
    </section>
  )
}
