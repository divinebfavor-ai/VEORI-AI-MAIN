// Deal stages - keys match deals.status and backend services/dealStageService.js.
// Change both together.
export const DEAL_STAGES = [
  { key: 'lead',           label: 'New',            badge: 'gray',  color: 'var(--surface-bg-3)' },
  { key: 'contacted',      label: 'Contacted',      badge: 'amber', color: '#FF9500' },
  { key: 'offer_sent',     label: 'Offer Sent',     badge: 'gold',  color: '#C9A84C' },
  { key: 'negotiating',    label: 'Negotiating',    badge: 'gold',  color: '#C9A84C' },
  { key: 'under_contract', label: 'Under Contract', badge: 'green', color: '#00C37A' },
  { key: 'sent_to_title',  label: 'At Title',       badge: 'green', color: '#00C37A' },
  { key: 'closing_prep',   label: 'Closing',        badge: 'green', color: '#00C37A' },
  { key: 'closed',         label: 'Closed',         badge: 'green', color: '#00C37A' },
  { key: 'lost',           label: 'Lost',           badge: 'red',   color: '#FF4444' },
]

// The working path shown as milestones (Lost is off-path).
export const MILESTONE_STAGES = DEAL_STAGES.filter(s => s.key !== 'lost')

// Labels saved by older screens, mapped to their stage key.
const LEGACY = {
  new: 'lead', calling: 'contacted', 'offer made': 'offer_sent', 'under contract': 'under_contract',
  'buyer search': 'under_contract', title: 'sent_to_title', dead: 'lost',
}

export function stageKey(status) {
  const s = String(status || '').toLowerCase().trim()
  if (!s) return 'lead'
  if (DEAL_STAGES.some(d => d.key === s)) return s
  return LEGACY[s] || 'lead'
}

export function stageInfo(status) {
  const key = stageKey(status)
  return DEAL_STAGES.find(d => d.key === key)
}

// Shown before a move whose automation reaches outside the platform.
export const STAGE_EFFECTS = {
  under_contract: 'Texts cash buyers whose buy box fits (all active buyers if none fit) and sends the deal package to your title company.',
  closed: 'Records the fee and texts a thank-you to the seller and buyer.',
}
