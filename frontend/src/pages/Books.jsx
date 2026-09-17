import React, { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Plus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { books, portfolio, deals as dealsApi } from '../services/api'
import useIsMobile from '../hooks/useIsMobile'

const GREEN = '#00C37A'
const RED = '#FF4444'
const errText = (e, f) => e?.response?.data?.error || e?.message || f
const money = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`)
const titleise = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
const label = { margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }
const input = { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 8, padding: '9px 11px', color: 'var(--input-text)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderTop: '1px solid var(--border)' }

const thisYear = new Date().getFullYear()
const yearStart = (y) => `${y}-01-01`
const yearEnd = (y) => `${y}-12-31`

export default function Books() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('pnl')
  const [year, setYear] = useState(thisYear)
  const [pnl, setPnl] = useState(null)
  const [se, setSe] = useState(null)
  const [vendorPay, setVendorPay] = useState(null)
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b, c, d] = await Promise.all([
        books.pnl({ from: yearStart(year), to: yearEnd(year) }),
        books.scheduleE(year),
        books.vendorPayments(year),
        books.vendors(),
      ])
      setPnl(a.data.data); setSe(b.data.data); setVendorPay(c.data.data); setVendors(d.data.data || [])
    } catch (err) { toast.error(errText(err, 'Could not load your books')) }
    finally { setLoading(false) }
  }, [year])
  useEffect(() => { load() }, [load])

  const grab = async (path, filename) => {
    try { await books.download(path, { year, from: yearStart(year), to: yearEnd(year) }, filename); toast.success('Downloaded') }
    catch (err) { toast.error(errText(err, 'Could not export')) }
  }

  return (
    <div style={{ padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1100 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>Books</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--t3)' }}>
            Money in and out across properties, deals and overhead — with the summaries your accountant asks for.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={{ ...input, width: 'auto' }} value={year} onChange={e => setYear(Number(e.target.value))}>
            {[0, 1, 2, 3].map(i => thisYear - i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button size="sm" variant="secondary" loading={loading} onClick={load}><RefreshCw size={12} /> Refresh</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['pnl', 'Profit & loss'], ['tax', 'Tax summary'], ['vendors', 'Vendors & 1099s'], ['entry', 'Add entry']].map(([k, l]) => (
          <Button key={k} size="sm" variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>

      {tab === 'pnl' && pnl && <ProfitAndLoss pnl={pnl} year={year} onExport={() => grab('/api/books/export/ledger.csv', `veori-ledger-${year}.csv`)} />}
      {tab === 'tax' && se && <TaxSummary se={se} onExport={() => grab('/api/books/export/schedule-e.csv', `veori-schedule-e-${year}.csv`)} />}
      {tab === 'vendors' && vendorPay && <Vendors pay={vendorPay} vendors={vendors} onChanged={load} onExport={() => grab('/api/books/export/1099.csv', `veori-1099-${year}.csv`)} />}
      {tab === 'entry' && <AddEntry onAdded={load} />}
    </div>
  )
}

function ProfitAndLoss({ pnl, year, onExport }) {
  const t = pnl.totals
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[['Income', t.income], ['Operating costs', t.operating_expenses], ['Net operating', t.net_operating], ['Debt payments', t.debt_payments], ['Capital improvements', t.capital_improvements], ['Net after debt', t.net_after_debt]].map(([k, v]) => (
          <div key={k} style={card}>
            <p style={label}>{k}</p>
            <p style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 700, color: v < 0 ? RED : 'var(--t1)' }}>{money(v)}</p>
          </div>
        ))}
      </div>

      {pnl.fees_not_in_the_books.length > 0 && (
        <div style={{ ...card, borderColor: 'rgba(201,168,76,0.45)' }}>
          <p style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={12} /> Fees collected on deals but not in your books</p>
          {pnl.fees_not_in_the_books.map(f => (
            <p key={f.deal_id} style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--t2)' }}>{f.address || 'Deal'} · {money(f.amount)}</p>
          ))}
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t3)' }}>Add them under “Add entry” so the year’s income is complete.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isNarrow() ? '1fr' : '1fr 1fr', gap: 10 }}>
        <div style={card}>
          <p style={label}>Income by category</p>
          {pnl.income.length ? pnl.income.map(i => (
            <div key={i.category} style={row}><span style={{ fontSize: 13, color: 'var(--t2)' }}>{titleise(i.category)}</span><span style={{ fontSize: 13, fontWeight: 600, color: GREEN }}>{money(i.amount)}</span></div>
          )) : <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>Nothing recorded for {year}.</p>}
        </div>
        <div style={card}>
          <p style={label}>Costs by category</p>
          {pnl.expenses.length ? pnl.expenses.map(i => (
            <div key={i.category} style={row}><span style={{ fontSize: 13, color: 'var(--t2)' }}>{titleise(i.category)}</span><span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{money(i.amount)}</span></div>
          )) : <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>Nothing recorded for {year}.</p>}
        </div>
      </div>

      <div style={card}>
        <p style={label}>Where it came from</p>
        {['properties', 'deals', 'overhead'].map(k => (
          <div key={k} style={row}>
            <span style={{ fontSize: 13, color: 'var(--t2)' }}>{titleise(k)}</span>
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>
              in {money(pnl.by_scope[k].income)} · out {money(pnl.by_scope[k].expense)} · <strong style={{ color: pnl.by_scope[k].net < 0 ? RED : GREEN }}>{money(pnl.by_scope[k].net)}</strong>
            </span>
          </div>
        ))}
        {pnl.notes.map((n, i) => <p key={i} style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t3)' }}>{n}</p>)}
        <Button size="sm" variant="secondary" style={{ marginTop: 10 }} onClick={onExport}><Download size={12} /> Export ledger (CSV)</Button>
      </div>
    </>
  )
}

function TaxSummary({ se, onExport }) {
  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={label}>Rental summary {se.year} (Schedule E shape)</p>
          <Button size="sm" variant="secondary" onClick={onExport}><Download size={12} /> Export (CSV)</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 10 }}>
          <Figure title="Rents received" value={money(se.totals.rents_received)} />
          <Figure title="Expenses claimed" value={money(se.totals.expenses_claimed)} />
          <Figure title="Net before depreciation" value={money(se.totals.net_before_depreciation)} />
        </div>
      </div>

      {!se.properties.length && <div style={card}><p style={{ margin: 0, fontSize: 13, color: 'var(--t3)' }}>No property money recorded for {se.year}.</p></div>}

      {se.properties.map(p => (
        <div key={p.property_id} style={card}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{p.address}</p>
          <div style={row}><span style={{ fontSize: 13, color: 'var(--t2)' }}>Line 3 · Rents received</span><span style={{ fontSize: 13, fontWeight: 600, color: GREEN }}>{money(p.rents_received)}</span></div>
          {p.expense_lines.map(l => (
            <div key={l.line} style={row}><span style={{ fontSize: 13, color: 'var(--t2)' }}>Line {l.line} · {l.label}</span><span style={{ fontSize: 13, color: 'var(--t1)' }}>{money(l.amount)}</span></div>
          ))}
          <div style={row}><span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Net before depreciation</span><span style={{ fontSize: 13, fontWeight: 700, color: p.net_before_depreciation < 0 ? RED : GREEN }}>{money(p.net_before_depreciation)}</span></div>
          {p.not_included.map(x => (
            <p key={x.category} style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t3)' }}>
              <strong style={{ color: 'var(--t2)' }}>{titleise(x.category)} {money(x.amount)} not claimed:</strong> {x.why}
            </p>
          ))}
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t3)' }}><strong style={{ color: 'var(--t2)' }}>Depreciation:</strong> {p.depreciation.why}{p.depreciation.basis_hint ? ` ${p.depreciation.basis_hint}` : ''}</p>
        </div>
      ))}

      <div style={card}>
        {se.caveats.map((c, i) => <p key={i} style={{ margin: i ? '6px 0 0' : 0, fontSize: 11, color: 'var(--t3)' }}>{c}</p>)}
      </div>
    </>
  )
}

function Vendors({ pay, vendors, onChanged, onExport }) {
  const [form, setForm] = useState({ name: '', trade: '', email: '', phone: '', entity_type: 'individual' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Name is required')
    setBusy(true)
    try { await books.createVendor(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''))); toast.success('Vendor added'); setForm({ name: '', trade: '', email: '', phone: '', entity_type: 'individual' }); onChanged() }
    catch (err) { toast.error(errText(err, 'Could not add the vendor')) }
    finally { setBusy(false) }
  }
  const toggleW9 = async (v) => {
    try { await books.updateVendor(v.id, { w9_on_file: !v.w9_on_file }); onChanged() }
    catch (err) { toast.error(errText(err, 'Could not update the vendor')) }
  }
  const byId = Object.fromEntries(vendors.map(v => [v.id, v]))

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={label}>1099 tracking · {pay.year}</p>
          <Button size="sm" variant="secondary" onClick={onExport}><Download size={12} /> Export 1099 list (CSV)</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 10 }}>
          <Figure title="Need a 1099" value={pay.needing_1099} />
          <Figure title="Missing a W-9" value={pay.missing_w9} tone={pay.missing_w9 ? 'bad' : undefined} />
          <Figure title="Costs with no vendor" value={money(pay.expenses_without_a_vendor)} />
        </div>
        {pay.vendors.filter(v => v.paid_this_year > 0).map(v => (
          <div key={v.vendor_id} style={row}>
            <span style={{ fontSize: 13, color: 'var(--t1)' }}>
              {v.name} {v.needs_1099 && <Badge variant={v.w9_on_file ? 'gold' : 'red'}>{v.w9_on_file ? '1099 due' : 'W-9 missing'}</Badge>}
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>{v.trade ? ` · ${v.trade}` : ''}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{money(v.paid_this_year)}</span>
              <Button size="sm" variant="secondary" onClick={() => toggleW9(byId[v.vendor_id] || { id: v.vendor_id, w9_on_file: v.w9_on_file })}>
                {v.w9_on_file ? 'W-9 on file' : 'Mark W-9 received'}
              </Button>
            </span>
          </div>
        ))}
        {pay.caveats.map((c, i) => <p key={i} style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t3)' }}>{c}</p>)}
      </div>

      <form onSubmit={add} style={card}>
        <p style={label}>Add a vendor</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 }}>
          <input style={input} placeholder="Name" value={form.name} onChange={set('name')} />
          <input style={input} placeholder="Trade (roofing, legal…)" value={form.trade} onChange={set('trade')} />
          <input style={input} placeholder="Email" value={form.email} onChange={set('email')} />
          <input style={input} placeholder="Phone" value={form.phone} onChange={set('phone')} />
          <select style={input} value={form.entity_type} onChange={set('entity_type')}>
            {['individual', 'sole_prop', 'llc', 's_corp', 'c_corp', 'partnership', 'other'].map(t => <option key={t} value={t}>{titleise(t)}</option>)}
          </select>
          <Button type="submit" size="sm" variant="primary" loading={busy}><Plus size={12} /> Add</Button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t3)' }}>Veori records whether a W-9 is on file, never the tax id itself — keep the W-9 in your own records.</p>
      </form>
    </>
  )
}

function AddEntry({ onAdded }) {
  const [form, setForm] = useState({ direction: 'expense', category: 'marketing', amount: '', occurred_on: new Date().toISOString().slice(0, 10), memo: '', property_id: '', deal_id: '', vendor_id: '' })
  const [cats, setCats] = useState({ income: [], expense: [] })
  const [props, setProps] = useState([])
  const [dealList, setDealList] = useState([])
  const [vendorList, setVendorList] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    portfolio.categories().then(r => setCats(r.data.data)).catch(() => {})
    portfolio.properties().then(r => setProps(r.data.data || [])).catch(() => {})
    dealsApi.getDeals({}).then(r => setDealList((r.data?.data || []).slice(0, 100))).catch(() => {})
    books.vendors().then(r => setVendorList(r.data.data || [])).catch(() => {})
  }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value, ...(k === 'direction' ? { category: e.target.value === 'income' ? 'assignment_fee' : 'marketing' } : {}) }))
  const submit = async (e) => {
    e.preventDefault()
    if (!form.amount) return toast.error('Amount is required')
    setBusy(true)
    try {
      await books.addEntry(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')))
      toast.success('Added to your books')
      setForm(f => ({ ...f, amount: '', memo: '' }))
      onAdded()
    } catch (err) { toast.error(errText(err, 'Could not add the entry')) }
    finally { setBusy(false) }
  }
  const list = (form.direction === 'income' ? cats.income : cats.expense) || []

  return (
    <form onSubmit={submit} style={card}>
      <p style={label}>Add to the books</p>
      <p style={{ margin: '4px 0 10px', fontSize: 12, color: 'var(--t3)' }}>Leave property and deal empty for business overhead such as software or marketing.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <select style={input} value={form.direction} onChange={set('direction')}>
          <option value="expense">Money out</option>
          <option value="income">Money in</option>
        </select>
        <select style={input} value={form.category} onChange={set('category')}>
          {list.map(c => <option key={c} value={c}>{titleise(c)}</option>)}
        </select>
        <input style={input} type="number" placeholder="Amount" value={form.amount} onChange={set('amount')} />
        <input style={input} type="date" value={form.occurred_on} onChange={set('occurred_on')} />
        <select style={input} value={form.property_id} onChange={set('property_id')}>
          <option value="">No property</option>
          {props.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
        </select>
        <select style={input} value={form.deal_id} onChange={set('deal_id')}>
          <option value="">No deal</option>
          {dealList.map(d => <option key={d.id} value={d.id}>{d.property_address || 'Deal'}</option>)}
        </select>
        <select style={input} value={form.vendor_id} onChange={set('vendor_id')}>
          <option value="">No vendor</option>
          {vendorList.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input style={input} placeholder="Note (optional)" value={form.memo} onChange={set('memo')} />
        <Button type="submit" size="sm" variant="primary" loading={busy}>Add entry</Button>
      </div>
    </form>
  )
}

function Figure({ title, value, tone }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t4)' }}>{title}</p>
      <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 600, color: tone === 'bad' ? RED : 'var(--t1)' }}>{value}</p>
    </div>
  )
}

function isNarrow() {
  return typeof window !== 'undefined' && window.innerWidth < 760
}
