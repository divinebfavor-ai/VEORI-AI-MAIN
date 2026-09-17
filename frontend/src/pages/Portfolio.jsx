import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Home, TrendingUp, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { portfolio, deals as dealsApi } from '../services/api'
import useIsMobile from '../hooks/useIsMobile'

const GREEN = '#00C37A'
const RED = '#FF4444'
const errText = (e, f) => e?.response?.data?.error || e?.message || f
const money = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`)
const pct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(1)}%`)
const STATUS_VARIANT = { owned: 'green', under_rehab: 'amber', listed: 'gold', sold: 'gray' }

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
const label = { margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }
const input = { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 8, padding: '9px 11px', color: 'var(--input-text)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }

function Tile({ title, value, sub }) {
  return (
    <div style={{ ...card, minWidth: 0 }}>
      <p style={label}>{title}</p>
      <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--t3)' }}>{sub}</p>}
    </div>
  )
}

export default function Portfolio() {
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expiring, setExpiring] = useState([])
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [adding, setAdding] = useState(false)
  const [closedDeals, setClosedDeals] = useState([])

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([portfolio.summary(), portfolio.expiring(90)])
      setData(s.data.data)
      setExpiring(e.data.data || [])
    } catch (err) { toast.error(errText(err, 'Could not load your portfolio')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    dealsApi.getDeals({ status: 'closed' })
      .then(r => setClosedDeals((r.data?.data || []).slice(0, 50)))
      .catch(() => {})
  }, [])

  const openProperty = async (id) => {
    setOpenId(id); setDetail(null)
    try { setDetail((await portfolio.property(id)).data.data) }
    catch (err) { toast.error(errText(err, 'Could not open that property')) }
  }

  const alreadyAdded = useMemo(() => new Set((data?.properties || []).map(p => p.deal_id).filter(Boolean)), [data])
  const addableDeals = closedDeals.filter(d => !alreadyAdded.has(d.id))

  const addFromDeal = async (dealId) => {
    try { await portfolio.fromDeal(dealId); toast.success('Added to your portfolio'); load() }
    catch (err) { toast.error(errText(err, 'Could not add that deal')) }
  }

  const t = data?.totals
  return (
    <div style={{ padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1200 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>Portfolio</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--t3)' }}>
            What you own: properties, leases and the money in and out. Every figure is calculated from what you record — nothing is estimated.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" loading={loading} onClick={load}><RefreshCw size={12} /> Refresh</Button>
          <Button size="sm" variant="primary" onClick={() => setAdding(a => !a)}><Plus size={13} /> Add property</Button>
        </div>
      </div>

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 140 : 170}px, 1fr))`, gap: 10 }}>
          <Tile title="Properties" value={t.properties} sub={`${t.units} unit${t.units === 1 ? '' : 's'}`} />
          <Tile title="Portfolio value" value={money(t.portfolio_value)} />
          <Tile title="Debt" value={money(t.total_debt)} />
          <Tile title="Equity" value={money(t.total_equity)} />
          <Tile title="Monthly rent" value={money(t.monthly_rent)} sub="contracted on active leases" />
          <Tile title="Monthly cash flow" value={money(t.monthly_cash_flow)} sub="after operating costs and debt" />
          <Tile title="Cap rate" value={pct(t.cap_rate_pct)} sub={t.cap_rate_note || 'portfolio NOI ÷ value'} />
        </div>
      )}

      {t?.properties_missing_data > 0 && (
        <div style={{ ...card, borderColor: 'rgba(201,168,76,0.45)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
            {t.properties_missing_data} propert{t.properties_missing_data === 1 ? 'y needs' : 'ies need'} more detail before their returns can be calculated. Open one to see exactly what is missing.
          </p>
        </div>
      )}

      {adding && <AddProperty onDone={() => { setAdding(false); load() }} />}

      {addableDeals.length > 0 && (
        <div style={card}>
          <p style={label}>Closed deals not in your portfolio</p>
          {addableDeals.slice(0, 5).map(d => (
            <div key={d.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, color: 'var(--t1)' }}>{d.property_address || 'Address not recorded'}</span>
              <Button size="sm" variant="secondary" onClick={() => addFromDeal(d.id)}>Add to portfolio</Button>
            </div>
          ))}
        </div>
      )}

      {expiring.length > 0 && (
        <div style={card}>
          <p style={label}>Leases ending in the next 90 days</p>
          {expiring.map(l => (
            <p key={l.id} style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--t2)' }}>
              {l.tenant_name || 'Tenant'} · ends {l.end_date} · {money(l.monthly_rent)}/mo
            </p>
          ))}
        </div>
      )}

      {!loading && !(data?.properties || []).length && (
        <div style={{ ...card, textAlign: 'center', padding: 28 }}>
          <Home size={22} style={{ color: 'var(--t3)' }} />
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--t2)' }}>Nothing in your portfolio yet.</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--t3)' }}>Add a property you own, or bring one across from a closed deal.</p>
        </div>
      )}

      {(data?.properties || []).map(p => (
        <div key={p.id} style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>
                {p.address} <Badge variant={STATUS_VARIANT[p.status] || 'gray'}>{String(p.status).replace(/_/g, ' ')}</Badge>
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t3)' }}>
                {[p.city, p.state].filter(Boolean).join(', ')} · {p.units_count} unit{p.units_count === 1 ? '' : 's'} · {String(p.strategy).replace(/_/g, ' ')}
                {p.metrics.occupancy_pct !== null ? ` · ${pct(p.metrics.occupancy_pct)} occupied` : ''}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => (openId === p.id ? setOpenId(null) : openProperty(p.id))}>
              {openId === p.id ? 'Close' : 'Open'}
            </Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`, gap: 10, marginTop: 12 }}>
            <Figure title="Equity" value={money(p.metrics.equity)} />
            <Figure title="Value" value={money(p.metrics.current_value)} />
            <Figure title="Cash flow / mo" value={money(p.metrics.monthly_cash_flow)} tone={p.metrics.monthly_cash_flow < 0 ? 'bad' : 'good'} />
            <Figure title="NOI / yr" value={money(p.metrics.noi)} />
            <Figure title="Cap rate" value={pct(p.metrics.cap_rate_pct)} />
            <Figure title="DSCR" value={p.metrics.dscr ?? '—'} />
            <Figure title="Cash-on-cash" value={pct(p.metrics.cash_on_cash_pct)} />
          </div>

          {p.metrics.missing.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--t3)' }}>{p.metrics.missing.length} figure(s) need more detail</summary>
              {p.metrics.missing.map((m, i) => (
                <p key={i} style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--t3)' }}>
                  <strong style={{ color: 'var(--t2)', textTransform: 'capitalize' }}>{m.item}:</strong> {m.why} {m.how}
                </p>
              ))}
            </details>
          )}

          {openId === p.id && <PropertyDetail detail={detail} onChanged={() => { openProperty(p.id); load() }} />}
        </div>
      ))}
    </div>
  )
}

function Figure({ title, value, tone }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t4)' }}>{title}</p>
      <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 600, color: tone === 'bad' ? RED : tone === 'good' ? GREEN : 'var(--t1)' }}>{value}</p>
    </div>
  )
}

function AddProperty({ onDone }) {
  const [form, setForm] = useState({ address: '', city: '', state: '', units_count: 1, strategy: 'rental', purchase_price: '', current_value: '', loan_balance: '', loan_payment: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (!form.address.trim()) return toast.error('Address is required')
    setBusy(true)
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '' && v !== null))
      await portfolio.createProperty(payload)
      toast.success('Property added')
      onDone()
    } catch (err) { toast.error(errText(err, 'Could not add the property')) }
    finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={card}>
      <p style={label}>Add a property you own</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
        <input style={input} placeholder="Address" value={form.address} onChange={set('address')} />
        <input style={input} placeholder="City" value={form.city} onChange={set('city')} />
        <input style={input} placeholder="State" value={form.state} onChange={set('state')} maxLength={2} />
        <input style={input} type="number" min="1" placeholder="Units" value={form.units_count} onChange={set('units_count')} />
        <select style={input} value={form.strategy} onChange={set('strategy')}>
          {['rental', 'flip', 'brrrr', 'short_term', 'land', 'commercial', 'other'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input style={input} type="number" placeholder="Purchase price" value={form.purchase_price} onChange={set('purchase_price')} />
        <input style={input} type="number" placeholder="Current value" value={form.current_value} onChange={set('current_value')} />
        <input style={input} type="number" placeholder="Loan balance" value={form.loan_balance} onChange={set('loan_balance')} />
        <input style={input} type="number" placeholder="Loan payment / mo" value={form.loan_payment} onChange={set('loan_payment')} />
      </div>
      <Button type="submit" size="sm" variant="primary" loading={busy} style={{ marginTop: 10 }}>Save property</Button>
    </form>
  )
}

function PropertyDetail({ detail, onChanged }) {
  const [tab, setTab] = useState('money')
  if (!detail) return <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--t3)' }}>Loading…</p>
  const { property, leases, transactions } = detail
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['money', 'Money'], ['leases', 'Leases']].map(([k, l]) => (
          <Button key={k} size="sm" variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === 'money' ? <MoneyTab property={property} transactions={transactions} onChanged={onChanged} />
        : <LeasesTab property={property} leases={leases} onChanged={onChanged} />}
    </div>
  )
}

function MoneyTab({ property, transactions, onChanged }) {
  const [form, setForm] = useState({ direction: 'income', category: 'rent', amount: '', occurred_on: new Date().toISOString().slice(0, 10), memo: '' })
  const [cats, setCats] = useState({ income: [], expense: [] })
  const [busy, setBusy] = useState(false)
  useEffect(() => { portfolio.categories().then(r => setCats(r.data.data)).catch(() => {}) }, [])
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value, ...(k === 'direction' ? { category: e.target.value === 'income' ? 'rent' : 'taxes' } : {}) }))
  const add = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await portfolio.addEntry(property.id, form); toast.success('Entry added'); setForm(f => ({ ...f, amount: '', memo: '' })); onChanged() }
    catch (err) { toast.error(errText(err, 'Could not add the entry')) }
    finally { setBusy(false) }
  }
  const remove = async (id) => {
    try { await portfolio.deleteEntry(id); onChanged() }
    catch (err) { toast.error(errText(err, 'Could not remove the entry')) }
  }
  const list = (form.direction === 'income' ? cats.income : cats.expense) || []
  return (
    <div>
      <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
        <select style={input} value={form.direction} onChange={set('direction')}>
          <option value="income">Money in</option>
          <option value="expense">Money out</option>
        </select>
        <select style={input} value={form.category} onChange={set('category')}>
          {list.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <input style={input} type="number" placeholder="Amount" value={form.amount} onChange={set('amount')} />
        <input style={input} type="date" value={form.occurred_on} onChange={set('occurred_on')} />
        <input style={input} placeholder="Note (optional)" value={form.memo} onChange={set('memo')} />
        <Button type="submit" size="sm" variant="primary" loading={busy}>Add</Button>
      </form>
      {!transactions.length && <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>No money recorded yet. Log rent and costs here and the returns above fill in.</p>}
      {transactions.slice(0, 20).map(tx => (
        <div key={tx.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>
            {tx.occurred_on} · {String(tx.category).replace(/_/g, ' ')}{tx.memo ? ` · ${tx.memo}` : ''}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: tx.direction === 'income' ? GREEN : 'var(--t1)' }}>
              {tx.direction === 'income' ? '+' : '−'}{money(tx.amount)}
            </span>
            <button onClick={() => remove(tx.id)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 2 }}><X size={13} /></button>
          </span>
        </div>
      ))}
    </div>
  )
}

function LeasesTab({ property, leases, onChanged }) {
  const [form, setForm] = useState({ tenant_name: '', monthly_rent: '', start_date: '', end_date: '', status: 'active' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const add = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''))
      await portfolio.addLease(property.id, payload)
      toast.success('Lease added'); setForm({ tenant_name: '', monthly_rent: '', start_date: '', end_date: '', status: 'active' }); onChanged()
    } catch (err) { toast.error(errText(err, 'Could not add the lease')) }
    finally { setBusy(false) }
  }
  const end = async (id) => {
    try { await portfolio.updateLease(id, { status: 'ended' }); toast.success('Lease ended'); onChanged() }
    catch (err) { toast.error(errText(err, 'Could not update the lease')) }
  }
  return (
    <div>
      <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
        <input style={input} placeholder="Tenant name" value={form.tenant_name} onChange={set('tenant_name')} />
        <input style={input} type="number" placeholder="Monthly rent" value={form.monthly_rent} onChange={set('monthly_rent')} />
        <input style={input} type="date" title="Start" value={form.start_date} onChange={set('start_date')} />
        <input style={input} type="date" title="End" value={form.end_date} onChange={set('end_date')} />
        <Button type="submit" size="sm" variant="primary" loading={busy}>Add lease</Button>
      </form>
      {!leases.length && <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>No leases recorded. Add one and the rent counts towards your cash flow.</p>}
      {leases.map(l => (
        <div key={l.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>
            <Badge variant={l.status === 'active' ? 'green' : l.status === 'pending' ? 'gold' : 'gray'}>{l.status}</Badge>{' '}
            {l.tenant_name || 'Tenant'} · {money(l.monthly_rent)}/mo{l.end_date ? ` · ends ${l.end_date}` : ''}
          </span>
          {l.status === 'active' && <Button size="sm" variant="secondary" onClick={() => end(l.id)}>End lease</Button>}
        </div>
      ))}
    </div>
  )
}
