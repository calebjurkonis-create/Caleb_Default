import { useState } from 'react'
import { loginEmail, type Snapshot, type Store } from '../data/store'
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
      {store.mode === 'demo' ? <DemoLogin store={store} snap={snap} /> : <PasswordLogin store={store} />}
    </main>
  )
}

function DemoLogin({ store, snap }: { store: Store; snap: Snapshot }) {
  const [who, setWho] = useState<string | null>(null)
  const member = snap.members.find((m) => m.id === who)
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
        <button className="btn primary" disabled={!member} onClick={() => go(member!.role)}>
          {member ? `Sign in as ${member.name} (${member.role})` : 'Pick your name'}
        </button>
        {member?.role === 'manager' && (
          <button className="btn" onClick={() => go('agent')}>See the agent view</button>
        )}
      </div>
    </div>
  )
}

function PasswordLogin({ store }: { store: Store }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await store.signInWithPassword!(loginEmail(email), password)
        } catch (err) {
          const msg = (err as Error).message
          setError(/invalid login/i.test(msg) ? "That username and password don't match. Check with a manager if you're not sure." : msg)
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="field">
        Username or email
        <input
          id="login-email"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="firstnamelastname"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        Password
        <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div className="err">{error}</div>}
      <button className="btn primary block" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="muted" style={{ fontSize: 14 }}>No account yet? A manager sets you up.</div>
    </form>
  )
}

/** First sign-in with a password a manager set up: choose your own before going further. */
export function SetPassword({ store, name }: { store: Store; name: string }) {
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tooShort = pw.length > 0 && pw.length < 8
  const mismatch = again.length > 0 && pw !== again
  return (
    <main className="login">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 52, height: 52, display: 'inline-block' }}><Logo /></span>
        <h1>Welcome, {name}</h1>
      </div>
      <p className="lede" style={{ margin: 0 }}>Pick your own password. The one you were given is shared, so anyone could guess it.</p>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault()
          if (pw.length < 8 || pw !== again) return
          setBusy(true)
          setError(null)
          try {
            await store.setOwnPassword!(pw)
          } catch (err) {
            setError((err as Error).message)
            setBusy(false)
          }
        }}
      >
        <label className="field">
          New password (8+ characters)
          <input id="new-pw" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          Type it again
          <input id="new-pw-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {tooShort && <div className="err">Use at least 8 characters.</div>}
        {mismatch && <div className="err">The two passwords don't match.</div>}
        {error && <div className="err">{error}</div>}
        <button className="btn primary block" disabled={busy || pw.length < 8 || pw !== again}>
          {busy ? 'Saving…' : 'Save my password'}
        </button>
        <button type="button" className="btn small" onClick={() => store.signOut()}>Sign out</button>
      </form>
    </main>
  )
}
