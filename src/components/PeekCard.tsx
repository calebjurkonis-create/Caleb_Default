import { useEffect, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { STATUS } from '../lib/dispositions'
import { activeClaim, cityLine, fullName, houseNumberOf, navTarget, timeAgo, turning65 } from '../lib/leads'
import { navUrl, type NavApp } from '../lib/route'
import type { Activity, Lead } from '../types'
import { Icon } from './Icon'
import { HistoryList } from './LeadSheet'
import { zoneAt, zoneLabel } from '../lib/gated'

interface Props {
  store: Store
  snap: Snapshot
  lead: Lead
  onRoute: boolean
  navApp: NavApp
  onClose(): void
  onOpen(): void
  onToggleRoute(): void
}

/** Quick look after tapping a pin: who it is and what's happened there. "Log a visit" opens the full lead. */
export function PeekCard({ store, snap, lead, onRoute, navApp, onClose, onOpen, onToggleRoute }: Props) {
  const [history, setHistory] = useState<Activity[] | null>(null)
  useEffect(() => {
    let live = true
    setHistory(null)
    store.history(lead.id).then((h) => live && setHistory(h)).catch(() => live && setHistory([]))
    return () => {
      live = false
    }
  }, [store, lead.id, lead.attempts, lead.status, lead.lastActivityAt, snap.itemsVersion])

  const age = turning65(lead.dob)
  const claim = activeClaim(lead)
  const hasPoint = lead.lat != null && lead.lng != null
  const zone = hasPoint ? zoneAt({ lat: lead.lat!, lng: lead.lng! }, snap.zones) : null

  return (
    <section className="sheet peek" aria-label={`Quick look: ${fullName(lead)}`}>
      <div className="grabber" />
      <header className="sheet-head">
        <button className="grow peek-title" onClick={onOpen}>
          <h2>{fullName(lead)}</h2>
          <div className="muted" style={{ marginTop: 2 }}>{lead.address}, {cityLine(lead)}</div>
        </button>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body" style={{ gap: 12 }}>
        <div className="tags">
          <span className="status">
            <span className="dot" style={{ background: STATUS[lead.status].color }} />
            {STATUS[lead.status].label}
          </span>
          {lead.lastActivityAt && <span className="tag">{memberName(snap, lead.lastActivityBy)} · {timeAgo(lead.lastActivityAt)}</span>}
          {age && <span className={`tag${age.monthsAway <= 2 ? ' warn' : ''}`}>{age.label}</span>}
          {claim && <span className="tag warn">{claim === snap.me?.id ? 'On your route' : `On ${memberName(snap, claim)}'s route`}</span>}
          {zone && <span className="tag gated">Gated · {zoneLabel(zone)}</span>}
          {hasPoint && lead.pinApprox && <span className="tag warn">Approximate pin · house #{houseNumberOf(lead) || '?'}</span>}
        </div>
        <div>
          <HistoryList snap={snap} history={history} limit={3} />
        </div>
        <button className="btn primary block" onClick={onOpen}>Log a visit</button>
        <div className="row">
          {hasPoint && (
            <a className="btn" href={navUrl(navApp, navTarget(lead))} target="_blank" rel="noreferrer" aria-label="Navigate">
              <Icon name="nav" /> Navigate
            </a>
          )}
          {hasPoint && (
            <button className={`btn ${onRoute ? '' : 'route'}`} onClick={onToggleRoute}>
              <Icon name={onRoute ? 'minus' : 'plus'} /> {onRoute ? 'Off route' : 'Add to route'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
