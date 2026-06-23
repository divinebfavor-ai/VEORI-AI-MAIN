/**
 * Feature 21 Deal Profit Calculator
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

// Creative-finance strategies + the extra inputs each one needs. Cash = current
// behaviour (no extra fields). Keys here map 1:1 to creativeFinanceCalc.js inputs.
const STRATEGIES = [
  { id: 'cash',           label: '💵 Cash / Wholesale', fields: [] },
  { id: 'subject_to',     label: '🏠 Subject-To',       fields: [
    { key: 'mortgage_balance',    label: 'Mortgage Balance ($)' },
    { key: 'arrears_amount',      label: 'Arrears / Behind ($)' },
    { key: 'est_monthly_payment', label: 'Est. Monthly Payment ($)' },
    { key: 'interest_rate',       label: 'Interest Rate (%)' },
    { key: 'cash_to_seller',      label: 'Cash to Seller ($, optional)' },
  ] },
  { id: 'seller_finance', label: '📝 Seller Finance',   fields: [
    { key: 'price',         label: 'Purchase Price ($, optional)' },
    { key: 'down_percent',  label: 'Down Payment (%)' },
    { key: 'rate',          label: 'Interest Rate (%)' },
    { key: 'term_years',    label: 'Term (years)' },
    { key: 'balloon_years', label: 'Balloon (years, optional)' },
  ] },
  { id: 'lease_option',   label: '🔑 Lease-Option',     fields: [
    { key: 'option_price',  label: 'Option Price ($, optional)' },
    { key: 'option_fee',    label: 'Option Fee ($, optional)' },
    { key: 'lease_monthly', label: 'Monthly Lease ($)' },
    { key: 'option_months', label: 'Option Length (months)' },
  ] },
]

export default function ProfitCalculator() {
  const [form, setForm] = useState({
    arv: '', asking_price: '', closing_costs_pct: '2', holding_costs: '0', assignment_fee_target: '10000',
  })
  const [strategy, setStrategy]       = useState('cash')
  const [strategyForm, setStrategyForm] = useState({})
  const [result, setResult]   = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab]         = useState('calc')

  useEffect(() => {
    fetch(`${API}/profit-calc/history`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setHistory(d.calculations || []))
      .catch(() => {})
  }, [])

  async function calculate() {
    if (!form.arv) return alert('ARV required')
    setLoading(true)
    try {
      // Cash → omit strategy fields entirely (request byte-for-byte as before).
      // Creative → send strategy + only the numeric fields the operator filled.
      const strategyPayload = {}
      if (strategy !== 'cash') {
        const inputs = {}
        for (const [k, v] of Object.entries(strategyForm)) {
          if (v !== '' && v != null && !Number.isNaN(parseFloat(v))) inputs[k] = parseFloat(v)
        }
        strategyPayload.strategy = strategy
        strategyPayload.strategy_inputs = inputs
      }
      const r = await fetch(`${API}/profit-calc/calculate`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({
          arv:                    parseFloat(form.arv),
          asking_price:           parseFloat(form.asking_price) || 0,
          closing_costs_pct:      parseFloat(form.closing_costs_pct) || 2,
          holding_costs:          parseFloat(form.holding_costs) || 0,
          assignment_fee_target:  parseFloat(form.assignment_fee_target) || 10000,
          repair_items:           [],
          ...strategyPayload,
        }),
      })
      const d = await r.json()
      if (d.success) setResult(d.result)
      else alert(d.error)
    } catch { alert('Network error') }
    setLoading(false)
  }

  const s = {
    page: { padding: '32px', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif' },
    card: { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
    tab: (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
    row: (label, value, color='#fff') => (
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
        <span style={{ fontWeight: 700, color }}>{value}</span>
      </div>
    ),
  }

  function field(label, key, placeholder='') {
    return (
      <div>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>{label}</label>
        <input style={s.input} type="number" placeholder={placeholder} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
      </div>
    )
  }

  function strategyField(label, key) {
    return (
      <div key={key}>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>{label}</label>
        <input style={s.input} type="number" value={strategyForm[key] ?? ''} onChange={e => setStrategyForm(p => ({ ...p, [key]: e.target.value }))} />
      </div>
    )
  }

  const activeStrategy = STRATEGIES.find(x => x.id === strategy) || STRATEGIES[0]

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>💰 Profit Calculator</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Calculate deal profitability with 3 scenarios conservative, moderate, aggressive</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'calc')}    onClick={() => setTab('calc')}>🧮 Calculator</button>
        <button style={s.tab(tab === 'history')} onClick={() => setTab('history')}>📋 History</button>
      </div>

      {tab === 'calc' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#C9A84C' }}>DEAL INPUTS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Strategy selector — Cash keeps the original behaviour & fields. */}
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Strategy</label>
                <select style={s.input} value={strategy}
                  onChange={e => { setStrategy(e.target.value); setStrategyForm({}) }}>
                  {STRATEGIES.map(x => <option key={x.id} value={x.id} style={{ background: '#0A1526' }}>{x.label}</option>)}
                </select>
              </div>
              {field('After Repair Value (ARV) *', 'arv', '250000')}
              {field('Asking / Offer Price', 'asking_price', '120000')}
              {field('Closing Costs %', 'closing_costs_pct', '2')}
              {field('Holding Costs ($)', 'holding_costs', '0')}
              {field('Target Assignment Fee ($)', 'assignment_fee_target', '10000')}
              {/* Creative-finance fields — only shown for non-cash strategies. */}
              {activeStrategy.fields.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.08em' }}>{activeStrategy.label.toUpperCase()} TERMS</div>
                  {activeStrategy.fields.map(f => strategyField(f.label, f.key))}
                </div>
              )}
              <button onClick={calculate} disabled={loading}
                style={{ padding: '12px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif', marginTop: 4 }}>
                {loading ? 'Calculating…' : 'Calculate Deal 🧮'}
              </button>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', margin: 0, textAlign: 'center' }}>
                Go to Rehab Estimator for detailed repair breakdowns
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!result && (
              <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
                <div>Enter deal inputs to see profit analysis</div>
              </div>
            )}

            {result && (
              <>
                {/* Deal Rating */}
                <div style={{ ...s.card, textAlign: 'center', background: result.deal_rating.includes('✅') ? 'rgba(0,195,122,0.08)' : result.deal_rating.includes('⚠️') ? 'rgba(201,168,76,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${result.deal_rating.includes('✅') ? 'rgba(0,195,122,0.25)' : result.deal_rating.includes('⚠️') ? 'rgba(201,168,76,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                  <div style={{ fontSize: 28, fontWeight: 900 }}>{result.deal_rating}</div>
                </div>

                {/* Key Numbers */}
                <div style={s.card}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 12 }}>KEY NUMBERS</div>
                  {s.row('ARV', `$${result.arv?.toLocaleString()}`)}
                  {s.row('Repairs (mid)', `$${result.repair_midpoint?.toLocaleString() || '0'}`)}
                  {s.row('Closing Costs', `$${result.closing_costs?.toLocaleString()}`)}
                  {s.row('Holding Costs', `$${result.holding_costs?.toLocaleString()}`)}
                  {s.row('MAO (70% rule)', `$${result.mao?.toLocaleString()}`, '#C9A84C')}
                  {result.asking_price > 0 && s.row('Asking Price', `$${result.asking_price?.toLocaleString()}`)}
                  {result.net_profit != null && s.row('Net Profit', `$${result.net_profit?.toLocaleString()}`, result.net_profit >= 0 ? '#00C37A' : '#EF4444')}
                  {result.roi_pct != null && s.row('ROI', `${result.roi_pct}%`, result.roi_pct >= 15 ? '#00C37A' : '#C9A84C')}
                </div>

                {/* Creative-finance terms — only present for non-cash strategies. */}
                {result.creative && (
                  <div style={{ ...s.card, border: '1px solid rgba(201,168,76,0.25)', background: 'rgba(201,168,76,0.05)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.1em', marginBottom: 12 }}>
                      {result.creative.strategy?.replace(/_/g, ' ').toUpperCase()} TERMS
                    </div>
                    {Object.entries(result.creative)
                      .filter(([k, v]) => k !== 'strategy' && k !== 'note' && v != null)
                      .map(([k, v]) => {
                        const isMoney = !/rate|percent|years|months/.test(k)
                        const disp = typeof v === 'number'
                          ? (isMoney ? `$${v.toLocaleString()}` : `${v}${/rate|percent/.test(k) ? '%' : ''}`)
                          : String(v)
                        return s.row(k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), disp,
                          /cash_in_deal|down_payment|monthly/.test(k) ? '#C9A84C' : '#fff')
                      })}
                    {result.creative.note && (
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>{result.creative.note}</p>
                    )}
                  </div>
                )}

                {/* Scenarios */}
                {result.scenarios && (
                  <div style={s.card}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 12 }}>3 SCENARIOS</div>
                    {['conservative','moderate','aggressive'].map(key => {
                      const sc = result.scenarios[key]
                      const colors = { conservative: '#F59E0B', moderate: '#00C37A', aggressive: '#EF4444' }
                      return (
                        <div key={key} style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'capitalize', color: colors[key] }}>{sc.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#00C37A' }}>MAO: ${sc.mao?.toLocaleString()}</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>ARV<br /><b style={{ color: '#fff' }}>${sc.arv?.toLocaleString()}</b></div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Buyer Profit<br /><b style={{ color: '#00C37A' }}>${sc.buyer_profit_at_mao?.toLocaleString()}</b></div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Buyer ROI<br /><b style={{ color: '#C9A84C' }}>{sc.buyer_roi_at_mao}%</b></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No calculations saved yet.</div>
          ) : history.map(h => (
            <div key={h.id} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{h.leads?.property_address || h.leads?.first_name + ' ' + h.leads?.last_name || 'Unknown Property'}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>ARV: ${h.arv?.toLocaleString()} · MAO: ${h.mao?.toLocaleString()}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {h.net_profit != null && <div style={{ fontSize: 16, fontWeight: 900, color: h.net_profit >= 0 ? '#00C37A' : '#EF4444' }}>${h.net_profit?.toLocaleString()}</div>}
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{new Date(h.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
