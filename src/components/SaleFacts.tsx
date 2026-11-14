import type { Lead } from '../types'

const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** Tags for a new-homeowner lead: what it is, and whether the buyer looks like a landlord. */
export function NhoTags({ lead }: { lead: Lead }) {
  if (lead.leadType !== 'nho') return null
  return (
    <>
      <span className="tag nho">New homeowner</span>
      {lead.buyerFlag && <span className="tag">{lead.buyerFlag}</span>}
    </>
  )
}

/** The sale behind a new-homeowner lead. */
export function SaleFacts({ lead, compact }: { lead: Lead; compact?: boolean }) {
  if (lead.leadType !== 'nho') return null
  const bought = [lead.saleDate && day(lead.saleDate), lead.salePrice != null && money(lead.salePrice)].filter(Boolean).join(' · ')
  if (compact) return bought ? <div className="muted num" style={{ fontSize: 14 }}>Bought {bought}</div> : null
  return (
    <dl className="sale-facts num">
      {bought && (<><dt>Bought</dt><dd>{bought}</dd></>)}
      {lead.homestead && (<><dt>Homestead</dt><dd>{lead.homestead}</dd></>)}
      {lead.propertyType && (<><dt>Property</dt><dd>{lead.propertyType}</dd></>)}
      {lead.sourceNote && (<><dt>Note</dt><dd>{lead.sourceNote}</dd></>)}
      {lead.parcelId && (<><dt>Parcel</dt><dd>{lead.parcelId}</dd></>)}
    </dl>
  )
}
