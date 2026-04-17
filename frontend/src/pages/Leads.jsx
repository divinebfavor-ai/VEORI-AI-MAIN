import React, { useState, useEffect, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import Papa from 'papaparse'
import { formatDistanceToNow } from 'date-fns'
import {
  Search, Upload, Plus, Phone, Eye, ChevronDown, X, AlertTriangle, Users
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import LeadProfile from '../components/Leads/LeadProfile'
import { leads as leadsApi } from '../services/api'

const STATUS_OPTIONS = ['All', 'New', 'Calling', 'Contacted', 'Interested', 'Appointment Set', 'Offer Made', 'Under Contract', 'Closed', 'DNC']
const STATE_OPTIONS = ['All', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
const SCORE_OPTIONS = ['All', 'Hot 70+', 'Warm 40-69', 'Cold 0-39']

function scoreBadgeVariant(score, dnc) {
  if (dnc) return 'red'
  if (score == null) return 'gray'
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  return 'gray'
}

function statusBadgeVariant(status) {
  const map = {
    interested: 'green', 'appointment set': 'green', 'under contract': 'blue',
    'offer made': 'orange', calling: 'yellow', new: 'gray', contacted: 'yellow',
    dnc: 'red', closed: 'blue',
  }
  return map[status?.toLowerCase()] || 'gray'
}

// CSV Import Modal
function CSVImportModal({ onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState([])
  const [dncCount, setDncCount] = useState(0)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const onDrop = useCallback((accepted) => {
    const f = accepted[0]
    if (!f) return
    setFile(f)
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data
        setParsed(rows)
        const dnc = rows.filter(r => r.dnc === 'true' || r.dnc === '1' || r.dnc?.toLowerCase() === 'yes').length
        setDncCount(dnc)
      },
      error: () => toast.error('Failed to parse CSV'),
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    maxFiles: 1,
  })

  const doImport = async () => {
    if (!parsed.length) return
    setImporting(true)
    try {
      const res = await leadsApi.bulkImportLeads(parsed)
      const result = res.data
      setImportResult(result)
      toast.success(`Imported ${result.imported || parsed.length} leads!`)
      onImported?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : []
  const preview = parsed.slice(0, 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border-subtle rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Import Leads from CSV</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Drop zone */}
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
                <p className="text-text-primary font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-text-primary font-medium">Drop your CSV file here</p>
                  <p className="text-text-muted text-sm mt-1">or click to browse</p>
                </>
              )}
            </div>
          )}

          {/* DNC warning */}
          {dncCount > 0 && (
            <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3">
              <AlertTriangle size={16} className="text-warning flex-shrink-0" />
              <p className="text-sm text-warning">
                {dncCount} lead{dncCount !== 1 ? 's' : ''} flagged as DNC will be skipped or marked accordingly
              </p>
            </div>
          )}

          {/* Preview table */}
          {parsed.length > 0 && !importResult && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-primary">
                  Preview — {parsed.length} rows
                </h3>
                <span className="text-xs text-text-muted">Showing first 10</span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border-subtle">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-elevated border-b border-border-subtle">
                      {headers.slice(0, 8).map(h => (
                        <th key={h} className="px-3 py-2 text-left text-text-muted font-medium uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className={`border-b border-border-subtle/50 ${i % 2 === 0 ? 'bg-card' : 'bg-surface'}`}>
                        {headers.slice(0, 8).map(h => (
                          <td key={h} className="px-3 py-2 text-text-secondary truncate max-w-[120px]">
                            {row[h] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div className="text-center py-8">
              <div className="text-5xl font-black text-success mb-2">{importResult.imported || parsed.length}</div>
              <div className="text-text-secondary">leads imported successfully</div>
              {importResult.skipped > 0 && (
                <div className="text-sm text-warning mt-2">{importResult.skipped} skipped (DNC or duplicates)</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <Button variant="ghost" onClick={onClose}>
            {importResult ? 'Close' : 'Cancel'}
          </Button>
          {!importResult && parsed.length > 0 && (
            <Button onClick={doImport} loading={importing}>
              Import {parsed.length} Leads
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Add Lead Modal
function AddLeadModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', address: '', city: '', state: '', zip: '' })
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.first_name || !form.phone) { toast.error('Name and phone required'); return }
    setLoading(true)
    try {
      await leadsApi.createLead(form)
      toast.success('Lead added!')
      onCreated?.()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add lead')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border-subtle rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Add New Lead</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" value={form.first_name} onChange={set('first_name')} placeholder="John" />
            <Input label="Last Name" value={form.last_name} onChange={set('last_name')} placeholder="Smith" />
          </div>
          <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000" />
          <Input label="Address" value={form.address} onChange={set('address')} placeholder="123 Main St" />
          <div className="grid grid-cols-3 gap-3">
            <Input label="City" value={form.city} onChange={set('city')} placeholder="Atlanta" />
            <Input label="State" value={form.state} onChange={set('state')} placeholder="GA" />
            <Input label="Zip" value={form.zip} onChange={set('zip')} placeholder="30301" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Add Lead</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Leads() {
  const [leadsData, setLeadsData] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [stateFilter, setStateFilter] = useState('All')
  const [scoreFilter, setScoreFilter] = useState('All')
  const [selectedLeads, setSelectedLeads] = useState([])
  const [selectedLead, setSelectedLead] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [page, setPage] = useState(1)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: 50 }
      if (search) params.search = search
      if (statusFilter !== 'All') params.status = statusFilter
      if (stateFilter !== 'All') params.state = stateFilter
      if (scoreFilter === 'Hot 70+') params.score_min = 70
      else if (scoreFilter === 'Warm 40-69') { params.score_min = 40; params.score_max = 69 }
      else if (scoreFilter === 'Cold 0-39') params.score_max = 39

      const res = await leadsApi.getLeads(params)
      const d = res.data
      setLeadsData(d.leads || d.data || d || [])
      setTotal(d.total || d.count || 0)
    } catch (err) {
      toast.error('Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter, stateFilter, scoreFilter])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const toggleSelect = (id) => {
    setSelectedLeads(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }
  const toggleAll = () => {
    if (selectedLeads.length === leadsData.length) setSelectedLeads([])
    else setSelectedLeads(leadsData.map(l => l.id))
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Leads</h1>
          <p className="text-text-secondary text-sm mt-1">{total.toLocaleString()} total leads</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={16} /> Import CSV
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Lead
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name, phone, address..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full bg-surface border border-border-default rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="appearance-none bg-surface border border-border-default rounded-lg px-3 py-2 pr-8 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary cursor-pointer"
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        </div>

        {/* State filter */}
        <div className="relative">
          <select
            value={stateFilter}
            onChange={(e) => { setStateFilter(e.target.value); setPage(1) }}
            className="appearance-none bg-surface border border-border-default rounded-lg px-3 py-2 pr-8 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary cursor-pointer"
          >
            {STATE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        </div>

        {/* Score filter */}
        <div className="relative">
          <select
            value={scoreFilter}
            onChange={(e) => { setScoreFilter(e.target.value); setPage(1) }}
            className="appearance-none bg-surface border border-border-default rounded-lg px-3 py-2 pr-8 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary cursor-pointer"
          >
            {SCORE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border-subtle rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            Loading leads...
          </div>
        ) : leadsData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <Users size={48} className="mb-3 opacity-40" />
            <p className="font-medium text-text-secondary">No leads found</p>
            <p className="text-sm mt-1">Import a CSV or add leads manually</p>
            <Button className="mt-4" onClick={() => setShowImport(true)}>
              <Upload size={16} /> Import CSV
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle bg-card">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedLeads.length === leadsData.length && leadsData.length > 0}
                      onChange={toggleAll}
                      className="rounded border-border-default"
                    />
                  </th>
                  {['Name', 'Phone', 'Address', 'State', 'Score', 'Status', 'Source', 'Last Called', 'Actions'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leadsData.map((lead, i) => {
                  const score = lead.motivation_score ?? lead.score
                  return (
                    <tr
                      key={lead.id || i}
                      className={`border-b border-border-subtle/50 cursor-pointer transition-colors ${
                        i % 2 === 0 ? 'bg-card' : 'bg-surface'
                      } hover:bg-elevated`}
                      onClick={() => setSelectedLead(lead)}
                    >
                      <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSelect(lead.id) }}>
                        <input
                          type="checkbox"
                          checked={selectedLeads.includes(lead.id)}
                          onChange={() => {}}
                          className="rounded border-border-default"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-text-primary">
                          {lead.first_name} {lead.last_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary font-mono">
                        {lead.phone || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary max-w-[160px] truncate">
                        {lead.address || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {lead.state || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={scoreBadgeVariant(score, lead.dnc)}>
                          {lead.dnc ? 'DNC' : score != null ? score : 'N/A'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadgeVariant(lead.status)}>
                          {lead.status || 'New'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {lead.source || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {lead.last_called
                          ? formatDistanceToNow(new Date(lead.last_called), { addSuffix: true })
                          : 'Never'}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button
                            className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                            onClick={() => {}}
                            title="Call"
                          >
                            <Phone size={14} />
                          </button>
                          <button
                            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-elevated rounded-lg transition-colors"
                            onClick={() => setSelectedLead(lead)}
                            title="View"
                          >
                            <Eye size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showImport && (
        <CSVImportModal
          onClose={() => setShowImport(false)}
          onImported={fetchLeads}
        />
      )}
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onCreated={fetchLeads}
        />
      )}

      {/* Lead Profile Drawer */}
      {selectedLead && (
        <LeadProfile
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={(updated) => {
            setLeadsData(prev => prev.map(l => l.id === updated.id ? updated : l))
            setSelectedLead(updated)
          }}
        />
      )}
    </div>
  )
}
