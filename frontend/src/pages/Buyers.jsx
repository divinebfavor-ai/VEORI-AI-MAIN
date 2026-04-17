import React, { useState, useEffect, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import Papa from 'papaparse'
import { Plus, Upload, Search, Eye, X, AlertTriangle, UserCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import { buyers as buyersApi } from '../services/api'

// Add Buyer Modal
function AddBuyerModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', email: '',
    company: '', states: '', max_price: '', repair_tolerance: 'light',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.first_name || !form.phone) { toast.error('Name and phone required'); return }
    setLoading(true)
    try {
      const data = { ...form, states: form.states.split(',').map(s => s.trim()).filter(Boolean) }
      await buyersApi.createBuyer(data)
      toast.success('Buyer added!')
      onCreated?.()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add buyer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border-subtle rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Add Buyer</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" value={form.first_name} onChange={set('first_name')} placeholder="John" />
            <Input label="Last Name" value={form.last_name} onChange={set('last_name')} placeholder="Smith" />
          </div>
          <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000" />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="buyer@email.com" />
          <Input label="Company" value={form.company} onChange={set('company')} placeholder="Smith Investments LLC" />
          <Input
            label="Buy Box States (comma-separated)"
            value={form.states}
            onChange={set('states')}
            placeholder="GA, FL, TX, NC"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Max Purchase Price ($)"
              type="number"
              value={form.max_price}
              onChange={set('max_price')}
              placeholder="250000"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Repair Tolerance</label>
              <select
                value={form.repair_tolerance}
                onChange={set('repair_tolerance')}
                className="bg-surface border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="none">No Repairs</option>
                <option value="light">Light ($0-10k)</option>
                <option value="medium">Medium ($10-30k)</option>
                <option value="heavy">Heavy ($30k+)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Add Buyer</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// CSV Import Modal for Buyers
function ImportBuyersModal({ onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const onDrop = useCallback((accepted) => {
    const f = accepted[0]
    if (!f) return
    setFile(f)
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => setParsed(result.data),
      error: () => toast.error('Failed to parse CSV'),
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    maxFiles: 1,
  })

  const doImport = async () => {
    if (!parsed.length) return
    setImporting(true)
    try {
      const res = await buyersApi.bulkAddBuyers(parsed)
      setImportResult(res.data)
      toast.success(`Imported ${res.data?.imported || parsed.length} buyers!`)
      onImported?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border-subtle rounded-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Import Buyers from CSV</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-5">
          {!importResult && (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-primary bg-primary/5' : 'border-border-default hover:border-primary/50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload size={32} className="mx-auto mb-3 text-text-muted" />
              {file ? (
                <p className="text-text-primary font-medium">{file.name} — {parsed.length} rows</p>
              ) : (
                <>
                  <p className="text-text-primary font-medium">Drop buyer CSV here</p>
                  <p className="text-text-muted text-sm mt-1">or click to browse</p>
                </>
              )}
            </div>
          )}

          {importResult && (
            <div className="text-center py-8">
              <div className="text-5xl font-black text-success mb-2">{importResult.imported || parsed.length}</div>
              <div className="text-text-secondary">buyers imported successfully</div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <Button variant="ghost" onClick={onClose}>{importResult ? 'Close' : 'Cancel'}</Button>
          {!importResult && parsed.length > 0 && (
            <Button onClick={doImport} loading={importing}>Import {parsed.length} Buyers</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Buyer Profile Drawer
function BuyerProfile({ buyer, onClose }) {
  if (!buyer) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-96 bg-surface border-l border-border-subtle flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-border-subtle flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-text-primary">
              {buyer.first_name} {buyer.last_name}
            </h2>
            <p className="text-text-muted text-sm">{buyer.company || 'Independent Buyer'}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Phone', value: buyer.phone },
              { label: 'Email', value: buyer.email },
              { label: 'States', value: Array.isArray(buyer.states) ? buyer.states.join(', ') : buyer.states },
              { label: 'Max Price', value: buyer.max_price ? `$${Number(buyer.max_price).toLocaleString()}` : null },
              { label: 'Repair Tolerance', value: buyer.repair_tolerance },
              { label: 'Deals Closed', value: buyer.deals_closed ?? 0 },
            ].filter(i => i.value != null).map(({ label, value }) => (
              <div key={label} className="bg-elevated rounded-lg p-3">
                <div className="text-xs text-text-muted mb-1">{label}</div>
                <div className="text-sm text-text-primary font-medium">{value}</div>
              </div>
            ))}
          </div>

          {buyer.notes && (
            <div className="bg-elevated rounded-lg p-3">
              <div className="text-xs text-text-muted mb-1">Notes</div>
              <div className="text-sm text-text-secondary">{buyer.notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Buyers() {
  const [buyersData, setBuyersData] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [selectedBuyer, setSelectedBuyer] = useState(null)

  const fetchBuyers = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (search) params.search = search
      const res = await buyersApi.getBuyers(params)
      const d = res.data
      setBuyersData(d.buyers || d.data || d || [])
      setTotal(d.total || d.count || 0)
    } catch {
      toast.error('Failed to load buyers')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { fetchBuyers() }, [fetchBuyers])

  const repairLabel = { none: 'None', light: 'Light', medium: 'Medium', heavy: 'Heavy' }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Buyers</h1>
          <p className="text-text-secondary text-sm mt-1">{total.toLocaleString()} cash buyers</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={16} /> Import CSV
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Buyer
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search buyers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-surface border border-border-default rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border-subtle rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            Loading buyers...
          </div>
        ) : buyersData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <UserCheck size={48} className="mb-3 opacity-40" />
            <p className="font-medium text-text-secondary">No buyers found</p>
            <p className="text-sm mt-1">Import your buyer database or add buyers manually</p>
            <Button className="mt-4" onClick={() => setShowImport(true)}>
              <Upload size={16} /> Import Buyers
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  {['Name', 'Phone', 'Email', 'Buy Box States', 'Max Price', 'Repair Tolerance', 'Deals Closed', 'Actions'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buyersData.map((buyer, i) => (
                  <tr
                    key={buyer.id || i}
                    className={`border-b border-border-subtle/50 cursor-pointer transition-colors ${
                      i % 2 === 0 ? 'bg-card' : 'bg-surface'
                    } hover:bg-elevated`}
                    onClick={() => setSelectedBuyer(buyer)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-text-primary">
                        {buyer.first_name} {buyer.last_name}
                      </div>
                      {buyer.company && (
                        <div className="text-xs text-text-muted">{buyer.company}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary font-mono">{buyer.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{buyer.email || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray(buyer.states) ? buyer.states : (buyer.states || '').split(',')).slice(0, 4).map((s, j) => (
                          <span key={j} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {s.trim()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary font-medium">
                      {buyer.max_price ? `$${Number(buyer.max_price).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          buyer.repair_tolerance === 'heavy' ? 'orange'
                            : buyer.repair_tolerance === 'medium' ? 'yellow'
                            : buyer.repair_tolerance === 'light' ? 'blue'
                            : 'gray'
                        }
                      >
                        {repairLabel[buyer.repair_tolerance] || buyer.repair_tolerance || 'Unknown'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary font-bold">
                      {buyer.deals_closed ?? 0}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedBuyer(buyer)}
                      >
                        <Eye size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddBuyerModal onClose={() => setShowAdd(false)} onCreated={fetchBuyers} />}
      {showImport && <ImportBuyersModal onClose={() => setShowImport(false)} onImported={fetchBuyers} />}
      {selectedBuyer && <BuyerProfile buyer={selectedBuyer} onClose={() => setSelectedBuyer(null)} />}
    </div>
  )
}
