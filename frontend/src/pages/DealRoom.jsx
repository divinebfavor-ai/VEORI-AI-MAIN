import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Send, RefreshCw, Check, X, AlertTriangle, Sparkles, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { intelligence, askVeoriStream } from '../services/api'
import useIsMobile from '../hooks/useIsMobile'
import { Scorecard, Scenarios, Optimizer, TimelineSimulator } from '../components/DealRoom/Phase3Panels'
import Worksheets from '../components/DealRoom/Worksheets'
import { AlertsBanner, AutopilotPanel } from '../components/DealRoom/Autonomy'

const GREEN = '#00C37A'
const GOLD = '#C9A84C'
const AMBER = '#FF9500'
const RED = '#FF4444'

const STATUS_STYLE = {
  VERIFIED: { variant: 'green', label: 'Verified' },
  USER_PROVIDED: { variant: 'gold', label: 'You provided' },
  CALCULATED: { variant: 'green', label: 'Calculated' },
  ESTIMATED: { variant: 'amber', label: 'Estimated' },
  INFERRED: { variant: 'gray', label: 'Inferred' },
  UNVERIFIED: { variant: 'amber', label: 'Unverified' },
  UNKNOWN: { variant: 'red', label: 'Unknown' },
}
const SEVERITY_COLOR = { critical: RED, high: AMBER, medium: GOLD, low: 'var(--t3)' }

const SECTIONS = [
  ['overview', 'Overview'], ['property', 'Property'], ['seller', 'Seller'], ['buyer', 'Buyer'], ['financials', 'Financials'],
  ['valuation', 'Valuation'], ['acquisition', 'Acquisition'], ['financing', 'Financing'], ['title', 'Title'],
  ['diligence', 'Due Diligence'], ['documents', 'Documents'], ['disposition', 'Disposition'], ['agents', 'Active Agents'],
  ['tasks', 'Tasks'], ['timeline', 'Timeline'], ['risks', 'Risks'], ['scenarios', 'Scenarios'], ['worksheets', 'Worksheets'], ['closing', 'Closing'], ['autopilot', 'Autopilot'],
]

const EXAMPLES = ['Analyze this property.', 'Can I wholesale this deal?', 'What creative-finance options exist?', 'Find the biggest risk in this transaction.', 'What information are we missing?', 'Find buyers for this property.', 'Would this work as a flip?', 'Run the rental numbers.', 'Build the underwriting package.', 'What does the law say about assigning this contract?', 'Why is this deal not working?', 'Will this contract close?']

const errText = (err, fallback) => err?.response?.data?.error || err?.message || fallback
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
const isClaim = (v) => v && typeof v === 'object' && 'status' in v && 'value' in v
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`)
const MONEY_FIELDS = /price|value|arv|repairs|balance|payment|arrears|equity|mao|spread|rent|tax|fee|amount|assessed/i

function formatValue(field, v) {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length ? v.map(x => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : '—'
  if (typeof v === 'number') return MONEY_FIELDS.test(field) && !/score|year|days|count|bed|bath|sqft|units|rate/i.test(field) ? money(v) : v.toLocaleString('en-US')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
const labelOf = (path) => path.split('.').pop().replace(/_/g, ' ').replace(/\b(arv|mao|pmi|dscr|ltv|emd|id)\b/gi, (m) => m.toUpperCase())

function Card({ title, right, children, style }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          {title && <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{title}</p>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

function ClaimRow({ path, claim, editable, onEdit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const st = STATUS_STYLE[claim?.status] || STATUS_STYLE.UNKNOWN
  const save = () => {
    const raw = draft.trim()
    const numeric = raw !== '' && !Number.isNaN(Number(raw.replace(/[$,]/g, '')))
    onEdit(path, raw === '' ? null : numeric ? Number(raw.replace(/[$,]/g, '')) : raw).then(ok => { if (ok) setEditing(false) })
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)', textTransform: 'capitalize' }}>{labelOf(path)}</p>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              style={{ flex: 1, minWidth: 0, padding: '5px 8px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, color: 'var(--input-text)', fontSize: 13 }} />
            <button onClick={save} aria-label="Save" style={{ background: 'none', border: 'none', color: GREEN, cursor: 'pointer' }}><Check size={15} /></button>
            <button onClick={() => setEditing(false)} aria-label="Cancel" style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}><X size={15} /></button>
          </div>
        ) : (
          <p style={{ margin: '2px 0 0', fontSize: 14, color: claim?.status === 'UNKNOWN' ? 'var(--t4)' : 'var(--t1)', wordBreak: 'break-word' }}>
            {formatValue(path, claim?.value)}
            {editable && <button onClick={() => { setDraft(claim?.value == null ? '' : String(claim.value)); setEditing(true) }} style={{ marginLeft: 8, background: 'none', border: 'none', color: GOLD, fontSize: 11, cursor: 'pointer' }}>edit</button>}
          </p>
        )}
        {(claim?.source || claim?.basis || claim?.note) && (
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--t4)' }}>{[claim.source, claim.basis, claim.note].filter(Boolean).join(' · ')}{claim.as_of ? ` · ${new Date(claim.as_of).toLocaleDateString()}` : ''}</p>
        )}
      </div>
      <Badge variant={st.variant}>{st.label}</Badge>
    </div>
  )
}

function ClaimList({ rep, paths, editable, onEdit }) {
  return (
    <div>
      {paths.map(p => {
        const c = get(rep, p)
        if (!isClaim(c)) return null
        return <ClaimRow key={p} path={p} claim={c} editable={editable.has(p)} onEdit={onEdit} />
      })}
    </div>
  )
}

// Every claim under a node, flattened to dotted paths.
function claimPaths(node, prefix) {
  const out = []
  const walk = (n, p) => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return
    if (isClaim(n)) { out.push(p); return }
    for (const [k, v] of Object.entries(n)) walk(v, p ? `${p}.${k}` : k)
  }
  walk(node, prefix)
  return out
}

function AgentOutput({ output }) {
  if (!output) return <p style={{ fontSize: 13, color: 'var(--t4)' }}>Not run yet. Ask Veori a question that needs this agent.</p>
  const d = output.data || output
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge variant={d.status === 'complete' ? 'green' : d.status === 'error' ? 'red' : 'amber'}>{String(d.status || '').replace(/_/g, ' ')}</Badge>
        <span style={{ fontSize: 12, color: 'var(--t3)' }}>Confidence {d.confidence?.score ?? output.confidence}/100</span>
        {d.attorney_review && <Badge variant="gold">Attorney review</Badge>}
      </div>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--t1)', lineHeight: 1.5 }}>{d.summary}</p>
      {d.confidence?.reasoning && <p style={{ margin: 0, fontSize: 12, color: 'var(--t4)' }}>{d.confidence.reasoning}</p>}
      {(d.calculations || []).map((c, i) => (
        <details key={i} style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: GOLD }}>How this was calculated: {String(c.name).replace(/_/g, ' ')}</summary>
          <p style={{ fontSize: 12, color: 'var(--t2)', margin: '8px 0 4px' }}>{c.formula}</p>
          <pre style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify({ inputs: c.inputs, output: c.output }, null, 2).slice(0, 4000)}</pre>
          {(c.assumptions || []).length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--t4)' }}>{c.assumptions.map((a, j) => <li key={j}>{a}</li>)}</ul>}
        </details>
      ))}
      {(d.findings || []).length > 0 && (
        <div>{d.findings.slice(0, 12).map((f, i) => <ClaimRow key={i} path={f.label} claim={f.claim} editable={false} />)}</div>
      )}
      {(d.recommendations || []).length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--t3)', margin: '4px 0' }}>RECOMMENDATIONS</p>
          {d.recommendations.map((r, i) => <p key={i} style={{ fontSize: 13, color: 'var(--t2)', margin: '4px 0' }}>• {r.action} <span style={{ color: 'var(--t4)' }}>— {r.why}</span></p>)}
        </div>
      )}
      {(d.missing || []).length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--t3)', margin: '4px 0' }}>MISSING</p>
          {d.missing.map((m, i) => <p key={i} style={{ fontSize: 12, color: 'var(--t3)', margin: '3px 0' }}><strong style={{ color: 'var(--t2)' }}>{labelOf(m.item)}</strong>: {m.why_it_matters} <em>How: {m.how_to_get}</em></p>)}
        </div>
      )}
    </div>
  )
}

function RiskList({ risks }) {
  if (!risks?.length) return <p style={{ fontSize: 13, color: 'var(--t4)' }}>No risks identified from available data — that is not the same as no risk.</p>
  return risks.map((r, i) => (
    <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}><span style={{ color: SEVERITY_COLOR[r.severity], fontWeight: 700, textTransform: 'uppercase', fontSize: 10, marginRight: 6 }}>{r.severity}</span>{r.risk}</p>
      {r.mitigation && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t3)' }}>Mitigation: {r.mitigation}</p>}
      {(r.category || r.identified_by) && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--t4)' }}>{[r.category, r.identified_by].filter(Boolean).join(' · ')}</p>}
    </div>
  ))
}

// What-If: deterministic recalculation as the operator changes numbers.
function WhatIf({ rep }) {
  const seed = (p) => { const c = get(rep, p); return c?.value != null && typeof c.value === 'number' ? String(c.value) : '' }
  const [v, setV] = useState(() => ({
    purchase_price: seed('transaction.contract_price') || seed('transaction.asking_price') || seed('transaction.offer_price'),
    arv: seed('financial.arv'), repairs: seed('financial.repairs'), holding_months: '6', monthly_holding: '', sell_cost_pct: '', buy_closing_pct: '',
    monthly_rent: seed('financial.market_rent'), down_payment_pct: '', loan_rate_pct: '', monthly_taxes: '', monthly_insurance: '', vacancy_pct: '',
  }))
  const [res, setRes] = useState({})
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const n = (k) => (v[k] === '' ? undefined : Number(v[k]))
      const out = {}
      const run = async (key, name, inputs) => {
        try { out[key] = (await intelligence.calc(name, inputs)).data.data } catch (err) { out[key] = { error: errText(err, 'Needs more inputs') } }
      }
      const tasks = []
      if (n('arv') != null && n('repairs') != null) tasks.push(run('wholesale', 'wholesale_mao', { arv: n('arv'), repairs: n('repairs') }))
      if (n('purchase_price') != null && n('arv') != null && n('repairs') != null) {
        const flip = { purchase_price: n('purchase_price'), sale_price: n('arv'), rehab: n('repairs'), holding_months: n('holding_months') ?? 0, monthly_holding: n('monthly_holding'), sell_cost_pct: n('sell_cost_pct'), buy_closing_pct: n('buy_closing_pct') }
        tasks.push(run('flip', 'fix_flip', flip), run('flipBE', 'fix_flip_break_even', flip))
      }
      if (n('purchase_price') != null && n('monthly_rent') != null && n('down_payment_pct') != null && n('loan_rate_pct') != null && n('monthly_taxes') != null && n('monthly_insurance') != null && n('vacancy_pct') != null) {
        tasks.push(run('hold', 'buy_hold', { purchase_price: n('purchase_price'), down_payment_pct: n('down_payment_pct'), loan_rate_pct: n('loan_rate_pct'), monthly_rent: n('monthly_rent'), vacancy_pct: n('vacancy_pct'), monthly_taxes: n('monthly_taxes'), monthly_insurance: n('monthly_insurance') }))
      }
      await Promise.all(tasks)
      setRes(out)
    }, 400)
    return () => clearTimeout(timer.current)
  }, [v])
  const field = (k, label) => (
    <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--t3)' }}>
      {label}
      <input inputMode="decimal" value={v[k]} onChange={e => setV(s => ({ ...s, [k]: e.target.value.replace(/[^\d.]/g, '') }))}
        style={{ padding: '7px 9px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 7, color: 'var(--input-text)', fontSize: 13 }} />
    </label>
  )
  const stat = (label, value) => <div key={label}><p style={{ margin: 0, fontSize: 11, color: 'var(--t4)' }}>{label}</p><p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{value}</p></div>
  return (
    <Card title="What-If (calculation engine)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['purchase_price', 'Purchase price'], ['arv', 'ARV / sale price'], ['repairs', 'Repairs'], ['holding_months', 'Holding months'], ['monthly_holding', 'Monthly holding $'], ['buy_closing_pct', 'Buy closing %'], ['sell_cost_pct', 'Selling cost %'],
          ['monthly_rent', 'Monthly rent'], ['vacancy_pct', 'Vacancy %'], ['down_payment_pct', 'Down payment %'], ['loan_rate_pct', 'Interest rate %'], ['monthly_taxes', 'Monthly taxes'], ['monthly_insurance', 'Monthly insurance']].map(([k, l]) => field(k, l))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {res.wholesale?.output && [stat('Wholesale MAO', money(res.wholesale.output.mao))]}
        {res.flip?.output && [stat('Flip profit', money(res.flip.output.profit)), stat('Flip ROI', res.flip.output.roi_pct == null ? '—' : `${res.flip.output.roi_pct}%`)]}
        {res.flipBE?.output && res.flipBE.output.break_even_points.map(p => stat(p.label, p.value == null ? 'not reachable' : p.unit === 'usd' ? money(p.value) : p.unit === 'pct' ? `${p.value}%` : `${p.value} mo`))}
        {res.hold?.output && [stat('Monthly cash flow', money(res.hold.output.monthly_cash_flow)), stat('Cash-on-cash', res.hold.output.cash_on_cash_pct == null ? '—' : `${res.hold.output.cash_on_cash_pct}%`), stat('DSCR', res.hold.output.dscr ?? '—')]}
      </div>
      {!Object.keys(res).length && <p style={{ fontSize: 12, color: 'var(--t4)', margin: 0 }}>Enter ARV and repairs for MAO; add a purchase price for flip profit and break-evens; add rent, vacancy, down payment, rate, taxes and insurance for rental cash flow. Unentered costs are counted as $0 and disclosed in each calculation.</p>}
      {(res.flip?.assumptions || []).length > 0 && <ul style={{ margin: '10px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--t4)' }}>{res.flip.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </Card>
  )
}

export default function DealRoom() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('overview')
  const [command, setCommand] = useState('')
  const [asking, setAsking] = useState(false)
  const [stream, setStream] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    try { setRoom((await intelligence.room(id)).data.data) }
    catch (err) { toast.error(errText(err, 'Could not load the Deal Room')) }
    finally { setLoading(false) }
  }, [id])
  useEffect(() => { load(); return () => abortRef.current?.abort() }, [load])

  const rep = room?.understanding
  const editable = useMemo(() => new Set(['property.sqft', 'property.bedrooms', 'property.bathrooms', 'property.year_built', 'property.property_type', 'property.condition', 'property.zoning', 'property.parcel_id', 'property.occupancy', 'property.ownership.owner_names', 'property.financing.loan_balance', 'property.financing.interest_rate', 'property.financing.monthly_payment', 'property.financing.arrears', 'property.taxes.annual', 'property.insurance.annual', 'people.seller.name', 'people.seller.timeline_days', 'people.seller.objectives', 'transaction.asking_price', 'transaction.contract_price', 'transaction.buyer_price', 'transaction.closing_date', 'financial.arv', 'financial.repairs', 'financial.as_is_value', 'financial.market_rent']), [])

  const editFact = async (path, value) => {
    try { const r = await intelligence.editFacts(id, { [path]: value }); setRoom(s => ({ ...s, understanding: r.data.data })); toast.success('Saved as your input'); return true }
    catch (err) { toast.error(errText(err, 'Could not save')); return false }
  }

  const ask = async (text) => {
    const cmd = (text ?? command).trim()
    if (!cmd || asking) return
    setAsking(true)
    setSection('overview')
    const state = { command: cmd, events: [], agents: {}, plan: null, synthesis: null, error: null }
    setStream({ ...state })
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await askVeoriStream(id, cmd, {}, (ev) => {
        if (ev.type === 'plan') state.plan = ev
        if (ev.type === 'agent_started') state.agents[ev.agent] = { name: ev.name, status: 'running' }
        if (ev.type === 'agent_completed') state.agents[ev.agent] = { name: ev.name, status: ev.status, summary: ev.summary, confidence: ev.confidence }
        if (ev.type === 'stage') state.events.push(ev)
        if (ev.type === 'synthesis') state.synthesis = ev.synthesis
        if (ev.type === 'error') state.error = ev.error
        setStream({ ...state, agents: { ...state.agents } })
      }, ctrl.signal)
      if (state.error) toast.error(state.error)
      setCommand('')
      await load()
    } catch (err) {
      if (err.name !== 'AbortError') { toast.error(errText(err, 'Analysis failed')); setStream(s => ({ ...s, error: errText(err, 'Analysis failed') })) }
    } finally { setAsking(false) }
  }

  const refreshData = async () => {
    setRefreshing(true)
    try { const r = await intelligence.refresh(id); setRoom(s => ({ ...s, understanding: r.data.data })); toast.success('Property data refreshed') }
    catch (err) { toast.error(errText(err, 'Refresh failed')) }
    finally { setRefreshing(false) }
  }

  const decide = async (approvalId, decision) => {
    try { await intelligence.decide(approvalId, decision); toast.success(decision === 'approved' ? 'Approved' : 'Rejected'); load() }
    catch (err) { toast.error(errText(err, 'Could not record the decision')) }
  }

  const requestApproval = async (rec) => {
    try { await intelligence.requestApproval(id, { agent_id: rec.agent, action_type: rec.action_type, payload: rec.payload, reason: rec.action }); toast.success('Approval requested'); load() }
    catch (err) { toast.error(errText(err, 'Could not request approval')) }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--t3)', fontSize: 13 }}>Building the deal understanding…</div>
  if (!room) return <div style={{ padding: 24, color: 'var(--t3)', fontSize: 13 }}>Deal not found.</div>

  const synthesis = stream?.synthesis || room.latest_synthesis
  const outputs = room.agent_outputs || {}
  const out = (agentId) => outputs[agentId]?.data
  const bna = synthesis?.best_next_action || room.best_next_action
  const pending = (room.approvals || []).filter(a => a.status === 'pending')

  const renderSection = () => {
    switch (section) {
      case 'overview': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Scorecard dealId={id} refreshKey={synthesis?.run_id || room.deal.updated_at} />
          {stream && (asking || stream.error) && (
            <Card title={asking ? 'Veori is working' : 'Last request'}>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--t2)' }}>“{stream.command}”{stream.plan ? ` → ${stream.plan.intent_label}` : ''}</p>
              {Object.entries(stream.agents).map(([aid, a]) => (
                <p key={aid} style={{ margin: '4px 0', fontSize: 12, color: 'var(--t3)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  {a.status === 'running' ? <Loader2 size={13} className="animate-spin" style={{ color: GOLD, flexShrink: 0 }} /> : <Check size={13} style={{ color: a.status === 'complete' ? GREEN : AMBER, flexShrink: 0 }} />}
                  <span><strong style={{ color: 'var(--t2)' }}>{a.name}</strong>{a.summary ? ` — ${a.summary}` : ''}</span>
                </p>
              ))}
              {stream.error && <p style={{ color: RED, fontSize: 13 }}>{stream.error}</p>}
            </Card>
          )}
          {synthesis && (
            <Card title={synthesis.intent_label || 'Answer'} right={synthesis.confidence && <span style={{ fontSize: 12, color: 'var(--t3)' }}>Confidence {synthesis.confidence.score}/100</span>}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--t1)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{synthesis.answer}</p>
              {synthesis.confidence?.reasoning && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--t4)' }}>{synthesis.confidence.reasoning}</p>}
            </Card>
          )}
          {(synthesis?.disagreements || []).length > 0 && (
            <Card title="Agents disagree">
              {synthesis.disagreements.map((d, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: 13, color: d.material ? AMBER : 'var(--t2)' }}>{labelOf(d.key)}: {d.spread_pct}% apart{d.material ? ' (material)' : ''}</p>
                  {d.positions.map((p, j) => <p key={j} style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t3)' }}>{p.agent}: {money(p.value)} <span style={{ color: 'var(--t4)' }}>{p.basis}</span></p>)}
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--t4)' }}>{d.resolution}</p>
                </div>
              ))}
            </Card>
          )}
          {(synthesis?.challenges || []).length > 0 && (
            <Card title="Challenger: why not?">
              {synthesis.challenges.map((c, i) => <p key={i} style={{ margin: '6px 0', fontSize: 13, color: 'var(--t2)' }}><span style={{ color: SEVERITY_COLOR[c.severity], fontSize: 10, fontWeight: 700, marginRight: 6 }}>{c.severity.toUpperCase()}</span>{c.question} <span style={{ color: 'var(--t4)', fontSize: 12 }}>{c.evidence}</span></p>)}
            </Card>
          )}
          {(synthesis?.recommendations || []).filter(r => r.requires_approval && r.allowed && r.action_type).length > 0 && (
            <Card title="Needs your approval before Veori acts">
              {synthesis.recommendations.filter(r => r.requires_approval && r.allowed && r.action_type).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div><p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}>{r.action}</p><p style={{ margin: 0, fontSize: 11, color: 'var(--t4)' }}>{r.permission_reason}</p></div>
                  <Button size="sm" variant="secondary" onClick={() => requestApproval(r)}>Request approval</Button>
                </div>
              ))}
            </Card>
          )}
          {!synthesis && !stream && <Card><p style={{ margin: 0, fontSize: 13, color: 'var(--t3)' }}>Ask Veori anything about this deal. Try: {EXAMPLES.map((e, i) => <button key={i} onClick={() => ask(e)} style={{ margin: '4px 6px 0 0', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '3px 10px', color: 'var(--t2)', fontSize: 12, cursor: 'pointer' }}>{e}</button>)}</p></Card>}
          {(rep?.data_gaps || []).length > 0 && <Card title="Data not available">{rep.data_gaps.map((g, i) => <p key={i} style={{ margin: '4px 0', fontSize: 13, color: AMBER }}>{g.source}: {g.reason}</p>)}</Card>}
        </div>
      )
      case 'property': return <Card title="Property"><ClaimList rep={rep} paths={claimPaths(rep.property, 'property')} editable={editable} onEdit={editFact} /></Card>
      case 'seller': return <Card title="Seller"><ClaimList rep={rep} paths={claimPaths(rep.people?.seller, 'people.seller')} editable={editable} onEdit={editFact} /></Card>
      case 'buyer': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Assigned buyer"><ClaimList rep={rep} paths={claimPaths(rep.people?.buyer, 'people.buyer')} editable={editable} onEdit={editFact} /></Card>
          <Card title="Buyer matches">
            {(out('buyer_matching')?.data?.ranked || []).length ? out('buyer_matching').data.ranked.map(b => (
              <div key={b.buyer_id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}>{b.name} <span style={{ color: 'var(--t4)', fontSize: 11 }}>score {b.score}</span></p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>Matches: {b.matched_criteria.join(', ') || 'no specific criteria'}{b.proof_of_funds ? ' · proof of funds' : ''}{b.past_deals ? ` · ${b.past_deals} past deal(s)` : ''}</p>
              </div>
            )) : <AgentOutput output={outputs.buyer_matching} />}
          </Card>
        </div>
      )
      case 'financials': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Financial facts"><ClaimList rep={rep} paths={[...claimPaths(rep.financial, 'financial'), ...['transaction.asking_price', 'transaction.offer_price', 'transaction.contract_price', 'transaction.buyer_price', 'transaction.assignment_fee']]} editable={editable} onEdit={editFact} /></Card>
          <WhatIf rep={rep} />
        </div>
      )
      case 'valuation': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Valuation Agent"><AgentOutput output={outputs.valuation} /></Card>
          <Card title="ARV Agent"><AgentOutput output={outputs.arv} /></Card>
          <Card title={`Comparables on file (${(rep.comparables || []).length})`}>
            {(rep.comparables || []).length ? rep.comparables.map((c, i) => (
              <p key={i} style={{ margin: '4px 0', fontSize: 12, color: 'var(--t2)' }}>{c.address} · {money(c.price)} <Badge variant={c.price_type === 'sold' ? 'green' : 'amber'}>{c.price_type === 'sold' ? 'Sold' : c.price_type === 'listed' ? 'Listing' : c.price_type}</Badge> <span style={{ color: 'var(--t4)' }}>{[c.sqft && `${c.sqft} sqft`, c.distance_miles != null && `${c.distance_miles} mi`, c.source].filter(Boolean).join(' · ')}</span></p>
            )) : <p style={{ fontSize: 13, color: 'var(--t4)', margin: 0 }}>No comparables on file.</p>}
          </Card>
        </div>
      )
      case 'acquisition': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Motivated Seller Agent"><AgentOutput output={outputs.motivated_seller} /></Card>
          <Card title="Lead Intelligence Agent"><AgentOutput output={outputs.lead_intelligence} /></Card>
          <Card title="Wholesale Agent"><AgentOutput output={outputs.wholesale} /></Card>
        </div>
      )
      case 'financing': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {['financing', 'creative_finance', 'subject_to', 'seller_finance'].map(a => <Card key={a} title={(room.agents || []).find(x => x.id === a)?.name || a}><AgentOutput output={outputs[a]} /></Card>)}
        </div>
      )
      case 'title': return <Card title="Title Intelligence Agent"><AgentOutput output={outputs.title_intelligence} /></Card>
      case 'diligence': return (
        <Card title={`Missing information (${(rep.unknowns || []).length})`}>
          {(synthesis?.missing || rep.unknowns || []).map((m, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)', textTransform: 'capitalize' }}>{labelOf(m.item || m.field)}</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>{m.why_it_matters}</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--t4)' }}>How to get it: {m.how_to_get}</p>
            </div>
          ))}
        </Card>
      )
      case 'documents': return (
        <Card title="Contracts">
          {(get(rep, 'transaction.contracts.value') || []).length ? get(rep, 'transaction.contracts.value').map((c, i) => <p key={i} style={{ margin: '4px 0', fontSize: 13, color: 'var(--t2)' }}>{c.type || 'contract'} · {String(c.status || '').replace(/_/g, ' ')}{c.sent_at ? ` · sent ${new Date(c.sent_at).toLocaleDateString()}` : ''}{c.signed_at ? ` · signed ${new Date(c.signed_at).toLocaleDateString()}` : ''}</p>)
            : <p style={{ margin: 0, fontSize: 13, color: 'var(--t4)' }}>No contracts on this deal yet. Create and send them from the deal workspace.</p>}
          <Button size="sm" variant="secondary" style={{ marginTop: 10 }} onClick={() => navigate(`/deals/${id}`)}>Open deal workspace</Button>
        </Card>
      )
      case 'disposition': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Disposition Agent"><AgentOutput output={outputs.disposition} /></Card>
          <Card title="Buyer Matching Agent"><AgentOutput output={outputs.buyer_matching} /></Card>
        </div>
      )
      case 'agents': return (
        <Card title={`Agents (${(room.agents || []).length})`}>
          {(room.agents || []).map(a => {
            const o = outputs[a.id]
            return (
              <details key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <summary style={{ cursor: o ? 'pointer' : 'default', listStyle: 'none' }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}>{a.name} <span style={{ fontSize: 11, color: 'var(--t4)' }}>v{a.version} · {a.domain} · {a.permissions}{o ? ` · ${new Date(o.created_at).toLocaleString()}` : ''}</span></p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>{o ? `${o.data?.summary} (confidence ${o.confidence})` : a.status === 'flagged_off' ? 'Original agent — switched off (AGENTS_ENABLED)' : 'Not run on this deal yet'}</p>
                </summary>
                {o && <div style={{ marginTop: 10 }}><AgentOutput output={o} /></div>}
              </details>
            )
          })}
        </Card>
      )
      case 'worksheets': return <Worksheets dealId={id} saved={rep?.worksheets} onSaved={load} />
      case 'autopilot': return <AutopilotPanel dealId={id} settings={room.settings} onChanged={load} />
      case 'tasks': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title={`Pending approvals (${pending.length})`}>
            {pending.length ? pending.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}>{a.reason}</p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)' }}>{a.action_type.replace(/_/g, ' ')} · {a.agent_id} · expires {a.expires_at ? new Date(a.expires_at).toLocaleString() : '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button size="sm" variant="primary" onClick={() => decide(a.id, 'approved')}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={() => decide(a.id, 'rejected')}>Reject</Button>
                </div>
              </div>
            )) : <p style={{ margin: 0, fontSize: 13, color: 'var(--t4)' }}>Nothing waiting on you.</p>}
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--t4)' }}>Approving records your decision; the approved action is then carried out from the deal workspace.</p>
          </Card>
          <Card title="Decided">
            {(room.approvals || []).filter(a => a.status !== 'pending').map(a => <p key={a.id} style={{ margin: '4px 0', fontSize: 12, color: 'var(--t3)' }}>{a.reason} · <strong>{a.status}</strong>{a.decided_at ? ` ${new Date(a.decided_at).toLocaleString()}` : ''}</p>)}
          </Card>
        </div>
      )
      case 'scenarios': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Scenarios dealId={id} />
          <Optimizer dealId={id} />
        </div>
      )
      case 'timeline': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TimelineSimulator dealId={id} />
        <Card title="Audit trail">
          {(room.audit || []).map(e => (
            <div key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>{e.action_type}{e.human_approved ? ' · human approved' : ''}</p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--t4)' }}>{new Date(e.created_at).toLocaleString()}{e.agent_id ? ` · ${e.agent_id}` : ''}{e.confidence != null ? ` · confidence ${e.confidence}` : ''}</p>
            </div>
          ))}
        </Card>
        </div>
      )
      case 'risks': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Risk register"><RiskList risks={out('risk')?.data?.register || synthesis?.risks} /></Card>
          {(synthesis?.challenges || []).length > 0 && <Card title="Challenges">{synthesis.challenges.map((c, i) => <p key={i} style={{ margin: '4px 0', fontSize: 13, color: 'var(--t2)' }}>{c.question}</p>)}</Card>}
        </div>
      )
      case 'closing': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Transaction Coordinator Agent"><AgentOutput output={outputs.transaction_coordinator} /></Card>
          <Card title="Transaction terms"><ClaimList rep={rep} paths={claimPaths(rep.transaction, 'transaction')} editable={editable} onEdit={editFact} /></Card>
        </div>
      )
      default: return null
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ padding: isMobile ? '12px 16px' : '14px 20px', borderBottom: '1px solid var(--border-rest)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <button onClick={() => navigate(`/deals/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--t3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <ArrowLeft size={13} /> Deal
          </button>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.deal.property_address || 'Deal Room'}</p>
          <Badge variant="gold">{String(room.deal.status || '').replace(/_/g, ' ')}</Badge>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge variant={room.settings?.mode === 'autopilot' ? 'green' : 'gray'}>{room.settings?.mode || 'copilot'}</Badge>
          <Button size="sm" variant="secondary" loading={refreshing} onClick={refreshData}><RefreshCw size={12} /> Refresh data</Button>
        </div>
      </div>

      <AlertsBanner key={`${id}-${room.deal.status}`} dealId={id} stage={room.deal.status} style={{ margin: isMobile ? '12px 16px 0' : '14px 20px 0' }} />

      {bna && (
        <div style={{ margin: isMobile ? '12px 16px 0' : '14px 20px 0', padding: '12px 14px', borderRadius: 12, border: `1px solid ${bna.urgency === 'critical' ? RED : bna.urgency === 'high' ? AMBER : 'rgba(0,195,122,0.35)'}`, background: 'rgba(0,195,122,0.05)' }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: GREEN }}>BEST NEXT ACTION · {String(bna.urgency).toUpperCase()}</p>
          <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{bna.action}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t3)' }}>{bna.why} · Impact: {bna.impact} · Owner: {bna.assigned_to}{bna.source_agent ? ` · from ${bna.source_agent}` : ''}</p>
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); ask() }} style={{ margin: isMobile ? '12px 16px 0' : '14px 20px 0', display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card-bg)', border: '1px solid var(--border-active)', borderRadius: 12, padding: '0 12px' }}>
          <Sparkles size={15} style={{ color: GOLD, flexShrink: 0 }} />
          <input value={command} onChange={e => setCommand(e.target.value)} maxLength={1000} disabled={asking} placeholder="Ask Veori about this deal…"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 14, padding: '11px 0' }} />
        </div>
        <Button type="submit" variant="primary" loading={asking} disabled={!command.trim()}><Send size={14} /> Ask</Button>
      </form>

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 14, padding: isMobile ? 16 : 20, flex: 1, minHeight: 0 }}>
        <nav aria-label="Deal Room sections" style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 2, overflowX: isMobile ? 'auto' : 'visible', flexShrink: 0, width: isMobile ? 'auto' : 170 }}>
          {SECTIONS.map(([key, label]) => (
            <button key={key} onClick={() => setSection(key)}
              style={{ textAlign: 'left', whiteSpace: 'nowrap', padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, background: section === key ? 'rgba(0,195,122,0.10)' : 'transparent', color: section === key ? GREEN : 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {label}
              {key === 'tasks' && pending.length > 0 && <span style={{ background: GOLD, color: '#000', borderRadius: 8, fontSize: 10, padding: '0 5px', fontWeight: 700 }}>{pending.length}</span>}
              {key === 'risks' && (out('risk')?.data?.counts?.critical || 0) > 0 && <AlertTriangle size={12} style={{ color: RED }} />}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1, minWidth: 0 }}>{renderSection()}</div>
      </div>
    </div>
  )
}
