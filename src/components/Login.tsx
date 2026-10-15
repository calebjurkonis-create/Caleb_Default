import { useState } from 'react'
import type { Snapshot, Store } from '../data/store'
import type { Role } from '../types'
import { Logo } from './Icon'

export function Login({ store, snap }: { store: Store; snap: Snapshot }) {
  return (
    <main className="login">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 52, height: 52, display: 'inline-block' }}><Logo /></span>
        <h1>KnockRoute</h1>
      </div>
      <p className="lede" style={{ margin: 0 }}>Plan the fastest route through your leads, and see every door your team knocks the moment it happens.</p>
      <div className="road" />
      {store.mode === 'demo' ? <DemoLogin store={store} snap={snap} /> : <CodeLogin store={store} />}
    </main>
  )
}

function DemoLogin({ store, snap }: { store: Store; snap: Snapshot }) {
  const [who, setWho] = useState<string | null>(null)
  const go = (role: Role) => who && store.signInAs!(who, role)
  return (
    <div className="panel">
      <div className="notice">
        <b>Demo mode.</b> Sample leads only, not real people. Your changes stay on this phone until the team database is connected.
      </div>
      <div style={{ fontWeight: 600 }}>Who are you?</div>
      <div className="people" role="group" aria-label="Team member">
        {snap.members.map((m) => (
          <button key={m.id} className="person" aria-pressed={who === m.id} onClick={() => setWho(m.id)}>
            {m.name}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" disabled={!who} onClick={() => go('agent')}>Sign in as agent</button>
        <button className="btn" disabled={!who} onClick={() => go('manager')}>Sign in as manager</button>
      </div>
    </div>
  )
}

function CodeLogin({ store }: { store: Store }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault()
        if (!sent) run(async () => { await store.requestCode!(email.trim()); setSent(true) })
        else run(() => store.verifyCode!(email.trim(), code.trim()))
      }}
    >
      <label className="field">
        Work email
        <input id="login-email" type="email" autoComplete="email" required value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {sent && (
        <label className="field">
          6-digit code from your email
          <input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      {error && <div className="err">{error.includes('Signups not allowed') ? "That email isn't on the team yet. Ask a manager to invite you." : error}</div>}
      <button className="btn primary block" disabled={busy}>
        {busy ? 'One moment…' : sent ? 'Sign in' : 'Email me a code'}
      </button>
      {sent && (
        <button type="button" className="btn small" onClick={() => { setSent(false); setCode('') }}>
          Use a different email
        </button>
      )}
    </form>
  )
}
