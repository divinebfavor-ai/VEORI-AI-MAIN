import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { intelligence } from '../../services/api'

const GREEN = '#00C37A'
const GOLD = '#C9A84C'
const AMBER = '#FF9500'
const RED = '#FF4444'
const errText = (err, fallback) => err?.response?.data?.error || err?.message || fallback
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n) < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`)

function Card({ title, right, children }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {title && <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{title}</p>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

const inputStyle = { padding: '7px 9px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 7, color: 'var(--input-text)', fontSize: 13, width: '100%', boxSizing: 'border-box' }
function NumField({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--t3)' }}>
      {label}
      <input inputMode="decimal" value={value ?? ''} onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} style={inputStyle} />
    </label>
  )
}
const toNums = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]))
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }

const RATING_COLOR = (r) => /critical|negative|past due|no matching|unsupported|weak|red flags|thin/.test(r) ? AMBER : /unknown|not assessed|no title|unpriced|no closing/.test(r) ? 'var(--t3)' : GREEN

export function Scorecard({ dealId, refreshKey }) {
  const [card, setCard] = useState(null)
  useEffect(() => {
    intelligence.scorecard(dealId).then(r => setCard(r.data.data)).catch(() => setCard(null))
  }, [dealId, refreshKey])
  if (!card) return null
  return (
    <Card title="Deal scorecard" right={<span style={{ fontSize: 11, color: 'var(--t4)' }}>Independent dimensions · no overall score</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
        {card.dimensions.map(d => (
          <div key={d.key} title={[...(d.evidence || []), d.note].filter(Boolean).join('\n')} style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t4)' }}>{d.label}</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600, color: RATING_COLOR(d.rating) }}>{d.rating}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--t3)' }}>{Object.entries(d.value || {}).filter(([, v]) => v != null).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') || '—'}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

const STRATEGY_FIELDS = {
  fix_flip: [['purchase_price', 'Purchase price'], ['sale_price', 'Sale price (ARV)'], ['rehab', 'Rehab'], ['holding_months', 'Holding months'], ['monthly_holding', 'Monthly holding $'], ['buy_closing_pct', 'Buy closing %'], ['sell_cost_pct', 'Selling cost %'], ['loan_amount', 'Loan amount'], ['loan_rate_pct', 'Loan rate %'], ['loan_points_pct', 'Loan points %']],
  wholesale: [['arv', 'ARV'], ['repairs', 'Repairs'], ['contract_price', 'Contract price'], ['flip_factor_pct', 'Buyer % of ARV']],
  buy_hold: [['purchase_price', 'Purchase price'], ['down_payment_pct', 'Down payment %'], ['loan_rate_pct', 'Rate %'], ['monthly_rent', 'Monthly rent'], ['vacancy_pct', 'Vacancy %'], ['management_pct', 'Management %'], ['maintenance_pct', 'Maintenance %'], ['capex_pct', 'CapEx %'], ['monthly_taxes', 'Monthly taxes'], ['monthly_insurance', 'Monthly insurance'], ['property_value', 'Property value']],
}

export function Scenarios({ dealId }) {
  const [strategy, setStrategy] = useState('fix_flip')
  const [base, setBase] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { setResult((await intelligence.scenarios(dealId, { strategy, base: toNums(base) })).data.data) }
    catch (err) { toast.error(errText(err, 'Could not run scenarios')) }
    finally { setBusy(false) }
  }
  const metricLabel = strategy === 'buy_hold' ? 'Annual cash flow' : strategy === 'wholesale' ? 'Assignment fee' : 'Profit / loss'
  return (
    <Card title="Scenario engine">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.keys(STRATEGY_FIELDS).map(s => (
          <button key={s} onClick={() => { setStrategy(s); setResult(null) }} style={{ padding: '5px 12px', borderRadius: 14, border: `1px solid ${strategy === s ? GREEN : 'var(--border)'}`, background: strategy === s ? 'rgba(0,195,122,0.10)' : 'transparent', color: strategy === s ? GREEN : 'var(--t3)', fontSize: 12, cursor: 'pointer' }}>{s.replace(/_/g, ' ')}</button>
        ))}
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--t4)' }}>Blank fields use the deal's figures where they exist; the response lists which came from the deal.</p>
      <div style={grid}>{STRATEGY_FIELDS[strategy].map(([k, l]) => <NumField key={k} label={l} value={base[k]} onChange={x => setBase(b => ({ ...b, [k]: x }))} />)}</div>
      <Button size="sm" variant="primary" loading={busy} onClick={run} style={{ marginTop: 12 }}>Run scenarios</Button>
      {result && (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: result.summary.includes('loses') ? AMBER : GREEN }}>{result.summary}</p>
          {result.inputs_from_deal?.length > 0 && <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--t4)' }}>From the deal: {result.inputs_from_deal.join(', ')}</p>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--t4)', textAlign: 'left' }}><th style={{ padding: 6 }}>Scenario</th><th style={{ padding: 6 }}>{metricLabel}</th><th style={{ padding: 6 }}>vs base</th><th style={{ padding: 6 }}>Cash required</th><th style={{ padding: 6 }}>Assumptions</th></tr></thead>
              <tbody>
                {result.scenarios.map(s => (
                  <tr key={s.key} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                    <td style={{ padding: 6, color: 'var(--t1)', whiteSpace: 'nowrap' }}>{s.label}</td>
                    <td style={{ padding: 6, color: s.metrics.profit_loss < 0 ? RED : 'var(--t1)', whiteSpace: 'nowrap' }}>{money(s.metrics.profit_loss)}</td>
                    <td style={{ padding: 6, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{s.change_vs_base == null || s.key === 'base' ? '—' : money(s.change_vs_base)}</td>
                    <td style={{ padding: 6, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{money(s.metrics.capital_required)}</td>
                    <td style={{ padding: 6, color: 'var(--t4)' }}>{s.assumptions.join('; ')}{s.risks.length ? <span style={{ color: AMBER }}> · {s.risks.join(' ')}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t4)' }}>{result.disclaimer}</p>
        </div>
      )}
    </Card>
  )
}

const OBJECTIVES = [['maximize_profit', 'Maximize profit'], ['minimize_cash_required', 'Minimize cash required'], ['minimize_risk', 'Minimize risk'], ['maximize_cash_flow', 'Maximize cash flow'], ['minimize_time_to_close', 'Minimize time to close']]

export function Optimizer({ dealId }) {
  const [objective, setObjective] = useState('')
  const [f, setF] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (x) => setF(s => ({ ...s, [k]: x }))
  const run = async () => {
    if (!objective) { toast.error('Choose what to optimize for'); return }
    setBusy(true)
    try {
      const body = {
        objective,
        seller: { ...toNums({ min_price: f.seller_min_price, min_cash_at_close: f.seller_min_cash, max_close_days: f.seller_max_days }), needs_debt_relief: !!f.seller_needs_relief },
        operator: { ...toNums({ max_price: f.op_max_price, available_cash: f.op_cash, min_profit: f.op_min_profit, max_close_days: f.op_max_days }), risk_tolerance: f.risk || 'medium' },
        costs: toNums({ sell_cost_pct: f.sell_cost_pct, holding_months: f.holding_months, monthly_holding: f.monthly_holding, assignment_close_days: f.assignment_days, cash_close_days: f.cash_days, financed_close_days: f.financed_days }),
        terms: {
          ...(f.hm_rate && f.hm_ltc ? { hard_money: toNums({ rate_pct: f.hm_rate, ltc_pct: f.hm_ltc, points_pct: f.hm_points }) } : {}),
          ...(f.sf_rate && f.sf_down ? { seller_finance: toNums({ rate_pct: f.sf_rate, down_payment_pct: f.sf_down, balloon_month: f.sf_balloon }) } : {}),
        },
      }
      setResult((await intelligence.optimize(dealId, body)).data.data)
    } catch (err) { toast.error(errText(err, 'Could not optimize')) }
    finally { setBusy(false) }
  }
  return (
    <Card title="Deal optimizer">
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--t3)' }}>You choose the objective. Veori searches structures between the seller's minimum and your maximum price and shows why others don't fit.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {OBJECTIVES.map(([k, l]) => <button key={k} onClick={() => setObjective(k)} style={{ padding: '5px 12px', borderRadius: 14, border: `1px solid ${objective === k ? GOLD : 'var(--border)'}`, background: objective === k ? 'rgba(201,168,76,0.12)' : 'transparent', color: objective === k ? GOLD : 'var(--t3)', fontSize: 12, cursor: 'pointer' }}>{l}</button>)}
      </div>
      <div style={grid}>
        <NumField label="Seller minimum price" value={f.seller_min_price} onChange={set('seller_min_price')} />
        <NumField label="Seller cash needed at close" value={f.seller_min_cash} onChange={set('seller_min_cash')} />
        <NumField label="Seller max days to close" value={f.seller_max_days} onChange={set('seller_max_days')} />
        <NumField label="Your maximum price" value={f.op_max_price} onChange={set('op_max_price')} />
        <NumField label="Your available cash" value={f.op_cash} onChange={set('op_cash')} />
        <NumField label="Your minimum profit" value={f.op_min_profit} onChange={set('op_min_profit')} />
        <NumField label="Selling cost %" value={f.sell_cost_pct} onChange={set('sell_cost_pct')} />
        <NumField label="Holding months" value={f.holding_months} onChange={set('holding_months')} />
        <NumField label="Monthly holding $" value={f.monthly_holding} onChange={set('monthly_holding')} />
        <NumField label="Hard money rate %" value={f.hm_rate} onChange={set('hm_rate')} />
        <NumField label="Hard money LTC %" value={f.hm_ltc} onChange={set('hm_ltc')} />
        <NumField label="Seller finance rate %" value={f.sf_rate} onChange={set('sf_rate')} />
        <NumField label="Seller finance down %" value={f.sf_down} onChange={set('sf_down')} />
        <NumField label="Days: assignment" value={f.assignment_days} onChange={set('assignment_days')} />
        <NumField label="Days: cash close" value={f.cash_days} onChange={set('cash_days')} />
        <NumField label="Days: financed close" value={f.financed_days} onChange={set('financed_days')} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--t3)' }}>Risk tolerance{' '}
          <select value={f.risk || 'medium'} onChange={e => set('risk')(e.target.value)} style={{ ...inputStyle, width: 'auto', display: 'inline-block' }}>
            <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--t3)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={!!f.seller_needs_relief} onChange={e => setF(s => ({ ...s, seller_needs_relief: e.target.checked }))} style={{ accentColor: GREEN }} /> Seller must be released from their loan
        </label>
        <Button size="sm" variant="primary" loading={busy} onClick={run}>Optimize</Button>
      </div>
      {result && (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}>{result.best ? <>Best for <strong>{result.objective_label.toLowerCase()}</strong>: {result.best.structure.replace(/_/g, ' ')} at {money(result.best.price)}</> : 'No structure fits your constraints.'}</p>
          {result.options.map(o => (
            <div key={o.structure} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--t2)' }}>
              <Badge variant={o === result.best ? 'green' : 'gray'}>{o.structure.replace(/_/g, ' ')}</Badge>{' '}
              price {money(o.price)} · profit {money(o.profit)} · cash {money(o.cash_required)}{o.monthly_cash_flow != null ? ` · ${money(o.monthly_cash_flow)}/mo` : ''}{o.days_to_close != null ? ` · ${o.days_to_close} days` : ''} · risk {o.risk_score}/5{o.note ? <span style={{ color: 'var(--t4)' }}> · {o.note}</span> : null}
            </div>
          ))}
          {result.infeasible.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--t3)' }}>{result.infeasible.length} ruled out</summary>
              {result.infeasible.slice(0, 30).map((x, i) => <p key={i} style={{ margin: '3px 0', fontSize: 11, color: 'var(--t4)' }}>{x.structure.replace(/_/g, ' ')}{x.price != null ? ` at ${money(x.price)}` : ''}: {x.reason}</p>)}
            </details>
          )}
          <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--t4)' }}>{[...result.assumptions, result.note].map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </Card>
  )
}

export function TimelineSimulator({ dealId }) {
  const [strategy, setStrategy] = useState('wholesale')
  const [carry, setCarry] = useState('')
  const [start, setStart] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { setResult((await intelligence.timeline(dealId, { strategy, start_date: start || null, monthly_carrying_cost: carry === '' ? null : Number(carry) })).data.data) }
    catch (err) { toast.error(errText(err, 'Could not simulate')) }
    finally { setBusy(false) }
  }
  return (
    <Card title="Deal timeline simulator">
      <div style={{ ...grid, alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--t3)' }}>Strategy
          <select value={strategy} onChange={e => setStrategy(e.target.value)} style={inputStyle}>{['wholesale', 'fix_flip', 'buy_hold', 'brrrr'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--t3)' }}>Start date
          <input type="date" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} />
        </label>
        <NumField label="Monthly carrying cost $" value={carry} onChange={setCarry} />
        <Button size="sm" variant="primary" loading={busy} onClick={run}>Simulate</Button>
      </div>
      {result && (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--t1)' }}>{result.total_days} days · done {result.completion_date}{result.holding_cost_total != null ? ` · holding cost ${money(result.holding_cost_total)}` : ''}</p>
          {result.schedule.map(p => <p key={p.phase} style={{ margin: '3px 0', fontSize: 12, color: 'var(--t2)' }}>{p.phase.replace(/_/g, ' ')}: {p.days} days ({p.starts} → {p.ends}){p.carrying ? <span style={{ color: GOLD }}> · carrying</span> : null}</p>)}
          {(result.delay_impact || []).map(d => <p key={d.delay_days} style={{ margin: '3px 0', fontSize: 12, color: AMBER }}>{d.statement}</p>)}
          <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--t4)' }}>{[result.formula, ...result.assumptions].map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </Card>
  )
}
