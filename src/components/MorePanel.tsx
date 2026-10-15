import { useState } from 'react'
import { roadPath } from '../lib/roads'
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
  roadKey: string
  onRoadKey(key: string): void
}

export function MorePanel({ store, snap, navApp, satellite, onNavApp, onSatellite, onClose, roadKey, onRoadKey }: Props) {
  const [sim, setSim] = useState(store.simulateTeam?.get() ?? false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState<string | null>(null)
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

        {snap.me?.role === 'manager' ? (
          <RoadRouting store={store} roadKey={roadKey} onRoadKey={onRoadKey} />
        ) : (
          <div className="muted" style={{ fontSize: 14 }}>
            Road routing is {roadKey ? 'on: routes follow real streets.' : 'off: routes show straight lines between stops.'}
          </div>
        )}

        <div className="card">
          <b>Put KnockRoute on your home screen</b>
          <div className="muted" style={{ fontSize: 14 }}>
            iPhone: open this page in Safari, tap the Share button, then “Add to Home Screen”. Android: Chrome menu, then “Install app”. It opens full-screen like a regular app.
          </div>
        </div>

        {store.mode === 'demo' && (
          <div className="section">
            <h3 style={{ fontSize: 20 }}>Demo</h3>
            {store.simulateTeam && (
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
            )}
            {confirmReset ? (
              <div className="row">
                <button className="btn danger" onClick={() => { store.resetDemo!(); setConfirmReset(false) }}>Erase everything in this demo</button>
                <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn" onClick={() => setConfirmReset(true)}>Start the demo over…</button>
            )}
          </div>
        )}

        {store.changePassword && (
          <form
            className="section"
            onSubmit={async (e) => {
              e.preventDefault()
              setPwMsg(null)
              try {
                await store.changePassword!(newPassword)
                setNewPassword('')
                setPwMsg('Password changed.')
              } catch (err) {
                setPwMsg((err as Error).message)
              }
            }}
          >
            <label className="field">
              New password
              <input id="new-password" type="password" autoComplete="new-password" minLength={6} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            {pwMsg && <div className="muted">{pwMsg}</div>}
            <button className="btn">Change my password</button>
          </form>
        )}

        <button className="btn block" onClick={() => store.signOut()}>
          Sign out
        </button>
      </div>
    </section>
  )
}

/** Managers paste the OpenRouteService key once; everyone's routes then follow real roads. */
function RoadRouting({ store, roadKey, onRoadKey }: { store: Store; roadKey: string; onRoadKey(k: string): void }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save(value: string) {
    setBusy(true)
    setMsg(null)
    try {
      if (value && value !== 'off') {
        // Check the key with a tiny two-point route before saving it for the whole team.
        const ok = await roadPath(value, [
          { lat: 28.5384, lng: -81.3789 },
          { lat: 28.5421, lng: -81.3723 },
        ])
        if (!ok) {
          setMsg("That key didn't work. Copy it again from openrouteservice.org (Dashboard → your token) and paste it here.")
          return
        }
      }
      await store.setSetting('ors_key', value)
      onRoadKey(value)
      setDraft('')
      setMsg(value === 'off' ? 'Road routing is off. Routes show straight lines again.' : 'Road routing is on for the whole team.')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <b>Road routing</b>
      <div className="muted" style={{ fontSize: 14 }}>
        {roadKey
          ? 'On. Routes follow real streets and stops are ordered by drive time. If the routing service is ever unavailable, routes fall back to straight lines.'
          : 'Off. Routes show straight lines between stops. Turn it back on below, or paste a different OpenRouteService key.'}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) save(draft.trim())
        }}
      >
        <input
          id="ors-key"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={roadKey ? 'Paste a new key to replace it' : 'Paste your OpenRouteService key'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: '1 1 180px', minWidth: 0 }}
        />
        <button className="btn small" disabled={busy || !draft.trim()}>{busy ? 'Checking…' : 'Save'}</button>
      </form>
      {roadKey && (
        <button className="btn small" disabled={busy} onClick={() => save('off')}>
          Turn road routing off
        </button>
      )}
      {!roadKey && (
        <button className="btn small" disabled={busy} onClick={() => save('')}>
          Turn road routing back on
        </button>
      )}
      {msg && <div className="muted" style={{ fontSize: 14 }}>{msg}</div>}
    </div>
  )
}
