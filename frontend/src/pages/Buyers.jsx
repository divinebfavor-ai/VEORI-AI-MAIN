import React, { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { Plus, Search, Phone, Mail, Briefcase, X, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import { buyers } from '../services/api'

function BuyerModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name:'', phone:'', email:'', buy_box_states:'', max_price:'', notes:'' })
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(f => ({...f, [k]: e.target.value}))

  const handleSave = async () => {
    if (!form.name) { toast.error('Name required'); return }
    setSaving(true)
    try {
      await buyers.createBuyer({ ...form, buy_box_states: form.buy_box_states.split(',').map(s=>s.trim()).filter(Boolean), max_price: form.max_price ? Number(form.max_price) : null })
      toast.success('Buyer added')
      onSave()
    } catch { toast.error('Failed to add buyer') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
      <div className="bg-card border border-border-subtle rounded-xl w-full max-w-md p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[18px] font-medium text-white">Add Buyer</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Full Name" placeholder="John Smith" value={form.name} onChange={set('name')} />
          <Input label="Phone" type="tel" placeholder="+1 (555) 000-0000" value={form.phone} onChange={set('phone')} />
          <Input label="Email" type="email" placeholder="buyer@company.com" value={form.email} onChange={set('email')} />
          <Input label="Buy Box States (comma separated)" placeholder="MI, OH, TN" value={form.buy_box_states} onChange={set('buy_box_states')} />
          <Input label="Max Price" type="number" placeholder="250000" value={form.max_price} onChange={set('max_price')} />
          <div className="flex flex-col gap-1.5">
            <label className="label-caps">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={3}
              className="bg-surface border border-border-subtle rounded-[6px] px-3 py-2.5 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none"
              placeholder="Preferences, requirements..." />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" loading={saving} onClick={handleSave}>Add Buyer</Button>
        </div>
      </div>
    </div>
  )
}

export default function Buyers() {
  const [buyerList, setBuyerList] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [showModal, setShowModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef                   = useRef()

  const load = async () => {
    setLoading(true)
    try { const r = await buyers.getBuyers(); const raw = r.data?.buyers ?? r.data?.data ?? r.data; setBuyerList(Array.isArray(raw) ? raw : []) }
    catch { setBuyerList([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // CSV import - mirrors the Leads page importer. Flexible headers in; the backend
  // /api/buyers/bulk does the real field mapping, phone dedup + chunked insert.
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)

    const v = (row, ...keys) => {
      for (const k of keys) {
        const val = row[k] || row[k?.toLowerCase()] || row[k?.toUpperCase()]
        if (val && String(val).trim()) return String(val).trim()
      }
      return ''
    }

    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async ({ data }) => {
        try {
          if (!data?.length) { toast.error('CSV appears to be empty'); setImporting(false); return }

          const mapped = data.map(r => ({
            name:           v(r, 'name', 'Name', 'Buyer Name', 'buyer_name', 'Full Name', 'Contact', 'Company'),
            phone:          v(r, 'phone', 'Phone', 'phone_number', 'Phone Number', 'Mobile', 'Cell', 'Contact Phone'),
            email:          v(r, 'email', 'Email', 'Email Address', 'Contact Email'),
            buyer_type:     v(r, 'buyer_type', 'Buyer Type', 'type', 'Type'),
            buy_box_states: v(r, 'buy_box_states', 'Buy Box States', 'states', 'States', 'Markets', 'Target States'),
            buy_box_types:  v(r, 'buy_box_types', 'Buy Box Types', 'property_types', 'Property Types', 'Asset Types'),
            max_price:      v(r, 'max_price', 'Max Price', 'max_purchase_price', 'Max Purchase Price', 'Budget', 'Price Cap'),
            notes:          v(r, 'notes', 'Notes', 'Comments'),
          })).filter(r => r.name || r.phone)

          if (!mapped.length) {
            toast.error('No buyers found. Check your CSV column headers (need at least Name or Phone).')
            setImporting(false)
            return
          }

          const res = await buyers.bulkAddBuyers(mapped)
          const { imported = mapped.length, duplicates_skipped = 0 } = res.data || {}

          let msg = `${imported} buyers imported`
          if (duplicates_skipped > 0) msg += ` · ${duplicates_skipped} duplicates skipped`
          toast.success(msg)
          load()
        } catch (err) {
          const msg = err?.response?.data?.error || err?.message || 'Import failed'
          toast.error(msg)
        }
        finally { setImporting(false); if (fileRef.current) fileRef.current.value = '' }
      },
    })
  }

  // Opt-in toggle - exposes this buyer to the cross-operator shared pool.
  // Optimistic: flip locally, call API, roll back on failure. Default is private.
  const toggleShare = async (b) => {
    const next = !b.share_to_pool
    setBuyerList(list => list.map(x => x.id === b.id ? { ...x, share_to_pool: next } : x))
    try {
      await buyers.updateBuyer(b.id, { share_to_pool: next })
      toast.success(next ? 'Shared to pool' : 'Removed from pool')
    } catch {
      setBuyerList(list => list.map(x => x.id === b.id ? { ...x, share_to_pool: !next } : x))
      toast.error('Could not update pool sharing')
    }
  }

  const filtered = buyerList.filter(b =>
    !search || `${b.name} ${b.email} ${b.phone}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-white">Buyers</h1>
          <p className="text-[13px] text-text-muted mt-1">{buyerList.length} cash buyers in your list</p>
        </div>
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
          <Button variant="secondary" loading={importing} onClick={() => fileRef.current?.click()}>
            <Upload size={15} strokeWidth={2} /> Import CSV
          </Button>
          <Button onClick={() => setShowModal(true)}>
            <Plus size={15} strokeWidth={2} /> Add Buyer
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search buyers…"
          className="w-full max-w-sm h-[44px] bg-surface border border-border-subtle rounded-[6px] pl-9 pr-4 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-20 text-text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-lg py-20 text-center">
          <Briefcase size={32} className="text-text-muted mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-text-primary mb-1">{search ? 'No results' : 'No buyers yet'}</p>
          <p className="text-[13px] text-text-muted mb-6">{search ? 'Try a different search' : 'Add your first cash buyer to start moving deals'}</p>
          {!search && <Button onClick={() => setShowModal(true)}><Plus size={14} /> Add Buyer</Button>}
        </div>
      ) : (
        <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left px-6 py-3 label-caps">Buyer</th>
                <th className="text-left px-6 py-3 label-caps">Contact</th>
                <th className="text-left px-6 py-3 label-caps">Buy Box</th>
                <th className="text-left px-6 py-3 label-caps">Max Price</th>
                <th className="text-left px-6 py-3 label-caps">Deals</th>
                <th className="text-left px-6 py-3 label-caps">Pool</th>
                <th className="text-left px-6 py-3 label-caps">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map(b => (
                <tr key={b.id} className="hover:bg-elevated transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-elevated border border-border-subtle flex items-center justify-center text-text-secondary text-[11px] font-semibold">
                        {b.name?.slice(0,2).toUpperCase() || 'BY'}
                      </div>
                      <span className="text-[14px] font-medium text-text-primary">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-0.5">
                      {b.phone && <span className="flex items-center gap-1.5 text-[12px] text-text-secondary"><Phone size={11} /> {b.phone}</span>}
                      {b.email && <span className="flex items-center gap-1.5 text-[12px] text-text-muted"><Mail size={11} /> {b.email}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(b.buy_box_states || []).slice(0,3).map(s => (
                        <span key={s} className="text-[11px] bg-elevated border border-border-subtle text-text-secondary px-1.5 py-0.5 rounded-[3px]">{s}</span>
                      ))}
                      {(b.buy_box_states||[]).length > 3 && <span className="text-[11px] text-text-muted">+{b.buy_box_states.length-3}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[14px] text-gold font-medium">
                    {b.max_price ? '$'+Number(b.max_price).toLocaleString() : '-'}
                  </td>
                  <td className="px-6 py-4 text-[14px] text-text-secondary tabular-nums">
                    {b.deals_closed || 0} closed
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => toggleShare(b)} title={b.share_to_pool ? 'Shared to cross-operator pool - click to make private' : 'Private - click to share to the pool'} className="cursor-pointer">
                      <Badge variant={b.share_to_pool ? 'gold' : 'gray'}>{b.share_to_pool ? 'Shared' : 'Private'}</Badge>
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={b.is_active ? 'green' : 'gray'}>{b.is_active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <BuyerModal onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); load() }} />}
    </div>
  )
}
