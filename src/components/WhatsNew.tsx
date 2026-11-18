import { useState } from 'react'

/** Bump this when there's a new announcement; everyone sees the new cards once. */
export const WHATS_NEW_ID = '2026-11-gated-and-own-leads'

interface Props {
  isManager: boolean
  gatedCount: number
  /** Closes it for good (saved to this person's account). */
  onClose(): void
  onShowGated(): void
  onAddLead(): void
}

/** One-time "What's new" announcement: one card per feature, Next / Got it. */
export function WhatsNew({ isManager, gatedCount, onClose, onShowGated, onAddLead }: Props) {
  const [step, setStep] = useState(0)
  const last = step === 1
  return (
    <div className="wn-scrim" role="dialog" aria-modal="true" aria-label="What's new in KnockRoute">
      <div className="wn-card">
        <button className="wn-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {step === 0 ? (
          <>
            <svg className="wn-art" viewBox="0 0 260 120" role="img" aria-label="A map with a red outlined gated neighborhood">
              <rect width="260" height="120" rx="12" fill="#e4e9e2" />
              <path d="M0 40 L260 30 M70 0 L90 120 M0 95 L260 100 M200 0 L190 120" stroke="#fff" strokeWidth="6" />
              <path d="M104 22 L172 18 L184 64 L160 96 L110 92 L96 58 Z" fill="rgba(209,67,67,.18)" stroke="#d14343" strokeWidth="2.5" strokeDasharray="6 4" />
              <text x="140" y="60" textAnchor="middle" fontFamily="Barlow, sans-serif" fontSize="11" fontWeight="700" fill="#a32727">Gated</text>
              <circle cx="40" cy="70" r="5" fill="#2f6fdb" />
              <circle cx="225" cy="62" r="5" fill="#2f6fdb" />
              <circle cx="60" cy="110" r="5" fill="#1f9455" />
            </svg>
            <span className="wn-kicker">New · 1 of 2</span>
            <h3>Know the gate before you park</h3>
            <p>
              Gated neighborhoods now show as <b>red outlines</b> on the map
              {gatedCount > 0 ? `: ${gatedCount} so far across Clermont, Davenport and Winter Garden` : ''}. Skip doors you can’t reach and plan routes that
              actually work.
            </p>
            <button className="btn primary block" onClick={onShowGated}>
              Show me on the map
            </button>
          </>
        ) : (
          <>
            <svg className="wn-art" viewBox="0 0 260 120" role="img" aria-label="Teal pins for agents' own leads">
              <rect width="260" height="120" rx="12" fill="#e4e9e2" />
              <path d="M0 50 L260 40 M120 0 L110 120" stroke="#fff" strokeWidth="6" />
              <circle cx="60" cy="80" r="8" fill="#0f9e84" stroke="#fff" strokeWidth="2" />
              <circle cx="170" cy="78" r="8" fill="#0f9e84" stroke="#fff" strokeWidth="2" />
              <circle cx="205" cy="24" r="8" fill="#0f9e84" stroke="#fff" strokeWidth="2" />
              <circle cx="35" cy="22" r="5" fill="#2f6fdb" />
              <rect x="140" y="88" width="104" height="24" rx="12" fill="#fff" />
              <text x="192" y="104" textAnchor="middle" fontFamily="Barlow, sans-serif" fontSize="11" fontWeight="700" fill="#0b7a6a">
                {isManager ? 'Johnny’s own lead' : 'Your own lead'}
              </text>
            </svg>
            <span className="wn-kicker">New · 2 of 2</span>
            <h3>Add your own leads</h3>
            {isManager ? (
              <p>
                Agents can now add their own leads: referrals, neighbors, friends turning 65. You’ll see them as <b>teal pins</b> labeled with the agent’s
                name, and every knock counts on the leaderboard.
              </p>
            ) : (
              <p>
                A referral, a neighbor, a friend turning 65? Add them in seconds, one at a time or a whole list. They show as <b>teal pins</b> that only you
                and your managers see, and every knock counts on the leaderboard.
              </p>
            )}
            {!isManager && (
              <button className="btn route block" onClick={onAddLead}>
                Add a lead
              </button>
            )}
          </>
        )}
        <div className="wn-foot">
          <span className="wn-dots" aria-hidden="true">
            <i className={step === 0 ? 'on' : ''} />
            <i className={step === 1 ? 'on' : ''} />
          </span>
          {!last && (
            <button className="link-btn wn-skip" onClick={onClose}>
              Skip
            </button>
          )}
          {last ? (
            <button className="btn small primary" onClick={onClose}>
              Got it
            </button>
          ) : (
            <button className="btn small primary" onClick={() => setStep(1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
