import { useState, type ReactNode } from 'react'
import { STATUS } from '../lib/dispositions'
import { cityLine, houseNumberOf, navTarget, shortName } from '../lib/leads'
import { googleRouteLegs, navUrl, routeEstimate, type NavApp, type Point } from '../lib/route'
import type { Lead } from '../types'
import { Icon } from './Icon'

interface Props {
  /** Real driving totals for the whole route when road routing is on. */
  road: { miles: number; minutes: number; partial?: boolean } | null
  /** Why the route is drawn with straight lines instead of roads, if we know. */
  roadProblem?: string | null
  /** Waiting on the routing service to order stops. */
  planning: boolean
  stops: Lead[]
  done: Set<string>
  me: Point | null
  navApp: NavApp
  openCount: number
  onClose(): void
  onOpenLead(l: Lead): void
  onRemove(id: string): void
  onReoptimize(): void
  onEnd(): void
  onNearest(n: number): void
  onDraw(): void
  /** Name of the gated area a stop is in, if any (a heads-up; the stop stays on the route). */
  gatedAt(l: Lead): string | null
  /** Where the route finishes, if anywhere. */
  end: Point | null
  /** The end point's street address, when it was typed in (not set from a location). */
  endAddress?: string | null
  /** The "ends at" chooser. */
  endPicker: ReactNode
}

export function RoutePanel(p: Props) {
  const [n, setN] = useState(15)
  const remaining = p.stops.filter((s) => !p.done.has(s.id))
  const next = remaining[0]
  const start = p.me ?? (p.stops[0] ? { lat: p.stops[0].lat!, lng: p.stops[0].lng! } : null)
  const est = start ? routeEstimate(start, remaining as Point[], p.end) : null
  const legs = googleRouteLegs(p.me, remaining as Point[], p.end, (pt) => {
    if (pt === p.end) return p.endAddress ?? null
    const t = navTarget(pt as Lead)
    return typeof t === 'string' ? t : null
  })
  const gatedLeft = remaining.filter((s) => p.gatedAt(s)).length

  return (
    <section className="sheet" aria-label="Today's route">
      <div className="grabber" />
      <header className="sheet-head">
        <div className="grow">
          <h2>Today's route</h2>
          {p.stops.length > 0 && est && (
            <div className="muted num" style={{ marginTop: 4 }}>
              {p.done.size} of {p.stops.length} done · {remaining.length} left ·{' '}
              {p.road
                ? `${p.road.miles.toFixed(1)} mi · ${p.road.minutes} min driving (${p.road.partial ? 'by road; a few legs estimated' : 'whole route, by road'})`
                : `~${est.miles.toFixed(1)} mi · ~${est.driveMin} min driving`}
            </div>
          )}
          {p.planning && <div className="muted" style={{ marginTop: 4 }}>Finding the fastest order by road…</div>}
          {p.roadProblem && p.stops.length > 0 && (
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Straight lines for now: {p.roadProblem}. KnockRoute keeps retrying.</div>
          )}
        </div>
        <button className="close" onClick={p.onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className="sheet-body">
        {p.stops.length === 0 ? (
          <div className="section">
            <div className="empty" style={{ paddingBottom: 8 }}>
              <h3>Build a route</h3>
              <div>Pick the doors you want to hit. KnockRoute orders them for the shortest drive and marks them as yours so teammates plan around you.</div>
            </div>
            {p.endPicker}
            <button className="btn route block" onClick={p.onDraw}>
              <Icon name="lasso" /> Draw around an area
            </button>
            <div className="card">
              <div style={{ fontWeight: 600 }}>
                {p.end ? 'Or take the open leads least out of your way to the end point' : `Or take the closest open leads to ${p.me ? 'you' : 'the map center'}`}
              </div>
              <div className="row">
                <button className="btn small" onClick={() => setN(Math.max(5, n - 5))} aria-label="Fewer stops">
                  <Icon name="minus" />
                </button>
                <span className="num" style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 22, minWidth: 40, textAlign: 'center' }}>{n}</span>
                <button className="btn small" onClick={() => setN(Math.min(60, n + 5))} aria-label="More stops">
                  <Icon name="plus" />
                </button>
                <button className="btn primary" style={{ flex: 1 }} disabled={!p.openCount || p.planning} onClick={() => p.onNearest(n)}>
                  {p.planning ? 'Planning…' : `Plan ${n} stops`}
                </button>
              </div>
              <div className="muted" style={{ fontSize: 14 }}>
                Skips leads already closed (appointment, not interested, bad info) and doors on a teammate's route today.
              </div>
            </div>
            <div className="muted" style={{ fontSize: 14 }}>You can also open any pin and tap “Add to route”.</div>
          </div>
        ) : (
          <>
            {next ? (
              <div className="next-card">
                <span className="eyebrow">Next stop · #{p.stops.indexOf(next) + 1}</span>
                <h3>{shortName(next)}</h3>
                <div>
                  {next.address}
                  <div className="muted">{cityLine(next)}</div>
                </div>
                {next.pinApprox && <div className="tag warn" style={{ alignSelf: 'flex-start' }}>Approximate pin · look for house #{houseNumberOf(next) || '?'}</div>}
                {p.gatedAt(next) && <div className="tag gated" style={{ alignSelf: 'flex-start' }}>Inside a gated community · {p.gatedAt(next)}</div>}
                <div className="row">
                  <a className="btn primary" href={navUrl(p.navApp, navTarget(next))} target="_blank" rel="noreferrer">
                    <Icon name="nav" /> Navigate
                  </a>
                  <button className="btn route" onClick={() => p.onOpenLead(next)}>
                    <Icon name="check" /> Log visit
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty">
                <h3>Route finished</h3>
                <div>Every stop has a disposition. Nice work.</div>
              </div>
            )}

            {p.endPicker}

            <div className="row">
              {legs.map((url, i) => (
                <a key={url} className="btn small" href={url} target="_blank" rel="noreferrer">
                  <Icon name="route" /> {legs.length > 1 ? `Google Maps leg ${i + 1}` : 'Whole route in Google Maps'}
                </a>
              ))}
              <button className="btn small" disabled={p.planning} onClick={p.onReoptimize}>
                Re-order from here
              </button>
            </div>

            {gatedLeft > 0 && (
              <div className="notice">
                Heads-up: {gatedLeft === 1 ? '1 stop is' : `${gatedLeft} stops are`} inside a gated community. {gatedLeft === 1 ? 'It stays' : 'They stay'} on the route; plan how you'll get in.
              </div>
            )}

            <ol className="list">
              {p.stops.map((s, i) => {
                const isDone = p.done.has(s.id)
                return (
                  <li key={s.id} className={`stop${isDone ? ' done' : ''}`}>
                    <span className="n num">{isDone ? <Icon name="check" /> : i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <button className="lead-row" style={{ padding: 0, display: 'block' }} onClick={() => p.onOpenLead(s)}>
                        <div className="name">{shortName(s)}</div>
                        <div className="sub">{s.address}, {s.city}{s.pinApprox ? ' · approximate pin' : ''}{p.gatedAt(s) ? ' · gated' : ''}</div>
                      </button>
                      <div className="actions">
                        <span className="status">
                          <span className="dot" style={{ background: STATUS[s.status].color }} />
                          {STATUS[s.status].label}
                        </span>
                        {!isDone && (
                          <button className="btn small" onClick={() => p.onRemove(s.id)}>
                            Skip
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>

            <button className="btn danger block" onClick={p.onEnd}>
              End route and release unvisited doors
            </button>
          </>
        )}
      </div>
    </section>
  )
}
