import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import { intelligence } from '../../services/api'

const errText = (err, fallback) => err?.response?.data?.error || err?.message || fallback

// Starting shapes for each worksheet: the fields the agents read. Replace the values with real figures.
const TEMPLATES = {
  rent_roll: { units: [{ unit: '1', beds: 2, rent: 1000, market_rent: 1100, status: 'occupied', lease_end: '2027-01-31' }] },
  operating_statement: { income: [{ name: 'Rent', annual_amount: 0 }], expenses: [{ name: 'Taxes', annual_amount: 0 }, { name: 'Insurance', annual_amount: 0 }], vacancy_pct: 0, market_cap_rate_pct: null, cap_rate_source: '' },
  rehab_scope: { contingency_pct: 10, items: [{ item: 'Roof', quantity: 1, unit_cost: 0, unit_cost_low: null, unit_cost_high: null, source: 'contractor bid' }] },
  construction_budget: { start_date: '', planned_end_date: '', percent_complete: 0, lines: [{ name: 'Kitchen', budget: 0, spent: 0, committed: 0 }], change_orders: [] },
  land: { acreage: null, zoning: '', road_access: null, utilities: '', flood_zone: '', topography: '', wetlands_environmental: '', easements_restrictions: '', comparable_sales: [{ price: 0, acreage: 0, date: '' }], development: { units: null, sale_price_per_unit: null, hard_cost_per_unit: null, soft_cost_pct: null, developer_profit_pct: null, infrastructure_cost: null } },
  negotiation_notes: { seller_said: '', price_mentioned: null, timeline: '', must_haves: [], concerns: [] },
  jv_terms: { investor_equity: null, sponsor_equity: null, total_distributions: null, hold_years: null, preferred_return_pct: null, sponsor_promote_pct: null },
  loan_quotes: [{ type: 'hard_money', lender: '', rate_pct: null, points_pct: null, fees: null, loan_amount: null, months: null }, { type: 'dscr', lender: '', rate_pct: null, min_dscr: null, max_ltv_pct: null, term_months: 360 }],
  due_diligence: { title_commitment: 'open', inspection: 'open', comparables: 'open', flood_zone: 'open' },
}

export default function Worksheets({ dealId, saved, onSaved }) {
  const [catalog, setCatalog] = useState({})
  const [active, setActive] = useState('rehab_scope')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { intelligence.worksheets().then(r => setCatalog(r.data.data || {})).catch(() => {}) }, [])
  useEffect(() => {
    const existing = saved?.[active]?.data
    setText(JSON.stringify(existing ?? TEMPLATES[active] ?? {}, null, 2))
  }, [active, saved])
  let parseError = null
  try { JSON.parse(text) } catch (e) { parseError = e.message }
  const save = async (clear = false) => {
    setBusy(true)
    try {
      await intelligence.saveWorksheet(dealId, active, clear ? null : JSON.parse(text))
      toast.success(clear ? 'Worksheet cleared' : 'Worksheet saved as your input')
      onSaved?.()
    } catch (err) { toast.error(errText(err, 'Could not save')) } finally { setBusy(false) }
  }
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>Worksheets</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.keys(TEMPLATES).map(k => (
          <button key={k} onClick={() => setActive(k)} style={{ padding: '4px 10px', borderRadius: 12, border: `1px solid ${active === k ? '#00C37A' : 'var(--border)'}`, background: active === k ? 'rgba(0,195,122,0.10)' : 'transparent', color: active === k ? '#00C37A' : 'var(--t3)', fontSize: 12, cursor: 'pointer' }}>
            {k.replace(/_/g, ' ')}{saved?.[k] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--t3)' }}>{catalog[active] || ''}{saved?.[active] ? ` · saved ${new Date(saved[active].set_at).toLocaleString()}` : ' · not saved yet (template shown)'}</p>
      <textarea value={text} onChange={e => setText(e.target.value)} spellCheck={false}
        style={{ width: '100%', minHeight: 260, boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, padding: 10, background: 'var(--input-bg)', border: `1px solid ${parseError ? '#FF4444' : 'var(--input-border)'}`, borderRadius: 8, color: 'var(--input-text)' }} />
      {parseError && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#FF4444' }}>Not valid JSON: {parseError}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button size="sm" variant="primary" loading={busy} disabled={!!parseError} onClick={() => save(false)}>Save</Button>
        {saved?.[active] && <Button size="sm" variant="secondary" loading={busy} onClick={() => save(true)}>Clear</Button>}
      </div>
    </div>
  )
}
