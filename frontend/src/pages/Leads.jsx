import React, { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { formatDistanceToNow } from 'date-fns'
import { Search, Upload, Plus, X, ChevronLeft, ChevronRight, Phone, MapPin, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { leads, calls as callsApi } from '../services/api'

// ─── Score helpers ────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return 'text-text-muted'
  if (s >= 70) return 'text-primary'
  if (s >= 40) return 'text-warning'
  return 'text-danger'
}
function scoreBadge(s) {
  if (s >= 70) return 'green'
  if (s >= 40) return 'amber'
  return 'red'
}
function statusBadge(s) {
  const m = { interested:'green','appointment set':'green','under contract':'green','offer made':'gold',calling:'amber',new:'gray',contacted:'amber',dnc:'red',closed:'gold' }
  return m[s?.toLowerCase()] || 'gray'
}
function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : '—' }

const PAGE_SIZE = 15
const STATUS_OPTIONS = ['All','New','Contacted','Calling','Interested','Appointment Set','Offer Made','Under Contract','DNC','Closed']
const SCORE_OPTIONS  = [{ label:'All Scores', min:0, max:100 },{ label:'Hot (70+)', min:70, max:100 },{ label:'Warm (40–69)', min:40, max:69 },{ label:'Cold (<40)', min:0, max:39 }]

// ─── Lead Drawer ─────────────────────────────────────────────────────────────
function LeadDrawer({ lead, onClose }) {
  const [tab, setTab]     = useState('overview')
  const [callLog, setCallLog] = useState([])
  const [notes, setNotes] = useState(lead.notes || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (tab === 'calls') {
      callsApi.getCalls({ lead_id: lead.id }).then(r => setCallLog(r.data?.calls || [])).catch(() => {})
    }
  }, [tab, lead.id])

  const saveNotes = async () => {
    setSaving(true)
    try { await leads.updateLead(lead.id, { notes }); toast.success('Notes saved') }
    catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  const TABS = ['Overview','Calls','Notes']

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-[480px] bg-card border-l border-border-subtle flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border-subtle">
          <div>
            <h2 className="text-[18px] font-medium text-white">{lead.first_name} {lead.last_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              {lead.phone && <span className="flex items-center gap-1 text-[12px] text-text-muted"><Phone size={11} />{lead.phone}</span>}
              <Badge variant={statusBadge(lead.status)}>{lead.status || 'new'}</Badge>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Score banner */}
        {lead.motivation_score != null && (
          <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between bg-elevated/50">
            <div>
              <p className="label-caps mb-1">Motivation Score</p>
              <p className={`text-[48px] font-bold leading-none ${scoreColor(lead.motivation_score)}`}>
                {lead.motivation_score}
              </p>
            </div>
            <div className="text-right">
              <p className="label-caps mb-1">Calls Made</p>
              <p className="text-[32px] font-semibold text-text-primary leading-none">{lead.call_count || 0}</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-6">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t.toLowerCase())}
              className={`py-3 pr-6 text-[13px] font-medium border-b-2 transition-colors ${
                tab === t.toLowerCase() ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview' && (
            <div className="space-y-1">
              {[
                ['Property Address', [lead.property_address, lead.property_city, lead.property_state].filter(Boolean).join(', ')],
                ['Property Type',    lead.property_type],
                ['Estimated Value',  fmt$(lead.estimated_value)],
                ['Estimated ARV',    fmt$(lead.estimated_arv)],
                ['Estimated Equity', fmt$(lead.estimated_equity)],
                ['Source',           lead.source],
                ['Email',            lead.email],
                ['Last Called',      lead.last_call_date ? formatDistanceToNow(new Date(lead.last_call_date), { addSuffix: true }) : 'Never'],
                ['Seller Personality', lead.seller_personality],
                ['AI Summary',       lead.ai_summary || lead.notes],
              ].map(([label, val]) => val ? (
                <div key={label} className="flex gap-4 py-2.5 border-b border-border-subtle last:border-0">
                  <span className="label-caps w-[140px] flex-shrink-0 pt-0.5">{label}</span>
                  <span className="text-[13px] text-text-secondary flex-1">{val}</span>
                </div>
              ) : null)}
            </div>
          )}

          {tab === 'calls' && (
            <div className="space-y-2">
              {callLog.length === 0 && (
                <div className="text-center py-12 text-text-muted">
                  <Phone size={24} className="mx-auto mb-3" strokeWidth={1.5} />
                  <p className="text-[13px]">No calls recorded yet</p>
                </div>
              )}
              {callLog.map(c => (
                <div key={c.id} className="bg-elevated border border-border-subtle rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] text-text-primary font-medium">
                      {c.started_at ? formatDistanceToNow(new Date(c.started_at), { addSuffix: true }) : '—'}
                    </span>
                    <div className="flex items-center gap-2">
                      {c.duration_seconds && <span className="text-[11px] text-text-muted">{Math.floor(c.duration_seconds/60)}:{String(c.duration_seconds%60).padStart(2,'0')}</span>}
                      <Badge variant={statusBadge(c.outcome)}>{c.outcome || 'no answer'}</Badge>
                      {c.motivation_score != null && <span className={`text-[13px] font-semibold ${scoreColor(c.motivation_score)}`}>{c.motivation_score}</span>}
                    </div>
                  </div>
                  {c.ai_summary && <p className="text-[12px] text-text-muted leading-relaxed mt-1">{c.ai_summary}</p>}
                </div>
              ))}
            </div>
          )}

          {tab === 'notes' && (
            <div className="space-y-3">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8}
                className="w-full bg-surface border border-border-subtle rounded-[6px] px-4 py-3 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none"
                placeholder="Add notes about this seller…" />
              <Button loading={saving} onClick={saveNotes}>Save Notes</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Leads() {
  const [allLeads, setAllLeads]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [search, setSearch]       = useState('')
  const [status, setStatus]       = useState('All')
  const [scoreFilter, setScore]   = useState(0)
  const [page, setPage]           = useState(1)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef()

  const load = async () => {
    setLoading(true)
    try { const r = await leads.getLeads({ limit: 500 }); const raw = r.data?.leads ?? r.data?.data ?? r.data; setAllLeads(Array.isArray(raw) ? raw : []) }
    catch { setAllLeads([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Filter
  const filtered = allLeads.filter(l => {
    if (status !== 'All' && l.status?.toLowerCase() !== status.toLowerCase()) return false
    const sf = SCORE_OPTIONS[scoreFilter]
    if (l.motivation_score != null && (l.motivation_score < sf.min || l.motivation_score > sf.max)) return false
    if (search) {
      const s = search.toLowerCase()
      if (!`${l.first_name} ${l.last_name} ${l.phone} ${l.property_address}`.toLowerCase().includes(s)) return false
    }
    return true
  })

  const pages     = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  // CSV import
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async ({ data }) => {
        try {
          const mapped = data.map(r => ({
            first_name: r.first_name || r['First Name'] || r.FirstName || '',
            last_name:  r.last_name  || r['Last Name']  || r.LastName  || '',
            phone:      r.phone      || r.Phone         || r.phone_number || '',
            email:      r.email      || r.Email         || '',
            property_address: r.property_address || r.Address || r.address || '',
            property_city:    r.city  || r.City  || '',
            property_state:   r.state || r.State || '',
          })).filter(r => r.phone)
          await leads.bulkImportLeads(mapped)
          toast.success(`Imported ${mapped.length} leads`)
          load()
        } catch { toast.error('Import failed') }
        finally { setImporting(false) }
      },
    })
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-medium text-white">Leads</h1>
          <p className="text-[13px] text-text-muted mt-1">{allLeads.length.toLocaleString()} total · {filtered.length} shown</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          <Button variant="secondary" loading={importing} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Import CSV
          </Button>
          <Button onClick={() => toast.info('Manual lead entry coming soon')}>
            <Plus size={14} /> Add Lead
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search leads…"
            className="h-9 bg-surface border border-border-subtle rounded-[6px] pl-8 pr-4 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary w-56"
          />
        </div>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="h-9 bg-surface border border-border-subtle rounded-[6px] px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary cursor-pointer">
          {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={scoreFilter} onChange={e => { setScore(Number(e.target.value)); setPage(1) }}
          className="h-9 bg-surface border border-border-subtle rounded-[6px] px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary cursor-pointer">
          {SCORE_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
        </select>
        {(search || status !== 'All' || scoreFilter !== 0) && (
          <button onClick={() => { setSearch(''); setStatus('All'); setScore(0); setPage(1) }}
            className="text-[12px] text-text-muted hover:text-text-secondary transition-colors">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-20 text-text-muted text-[14px]">Loading leads…</div>
      ) : paginated.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-lg py-20 text-center">
          <p className="text-[15px] font-medium text-text-primary mb-2">{search || status !== 'All' ? 'No results' : 'No leads yet'}</p>
          <p className="text-[13px] text-text-muted mb-6">Import a CSV to get started</p>
          {!search && <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import CSV</Button>}
        </div>
      ) : (
        <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left px-6 py-3 label-caps">Seller</th>
                <th className="text-left px-6 py-3 label-caps">Property</th>
                <th className="text-left px-6 py-3 label-caps w-20">Score</th>
                <th className="text-left px-6 py-3 label-caps">Status</th>
                <th className="text-left px-6 py-3 label-caps">Last Call</th>
                <th className="text-left px-6 py-3 label-caps">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {paginated.map(l => (
                <tr key={l.id} onClick={() => setSelected(l)}
                  className="hover:bg-elevated cursor-pointer transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-[14px] font-medium text-text-primary">{l.first_name} {l.last_name}</p>
                    {l.phone && <p className="text-[11px] text-text-muted mt-0.5">{l.phone}</p>}
                  </td>
                  <td className="px-6 py-4">
                    {l.property_address
                      ? <><p className="text-[13px] text-text-secondary truncate max-w-[220px]">{l.property_address}</p>
                          <p className="text-[11px] text-text-muted">{[l.property_city, l.property_state].filter(Boolean).join(', ')}</p></>
                      : <span className="text-text-muted text-[13px]">—</span>
                    }
                  </td>
                  <td className="px-6 py-4">
                    {l.motivation_score != null ? (
                      <div>
                        <span className={`text-[18px] font-bold tabular-nums leading-none ${scoreColor(l.motivation_score)}`}>
                          {l.motivation_score}
                        </span>
                        <div className="mt-1 h-0.5 w-10 bg-elevated rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${l.motivation_score>=70?'bg-primary':l.motivation_score>=40?'bg-warning':'bg-danger'}`}
                            style={{ width: `${l.motivation_score}%` }} />
                        </div>
                      </div>
                    ) : <span className="text-text-muted text-[13px]">—</span>}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={statusBadge(l.status)}>{l.status || 'new'}</Badge>
                  </td>
                  <td className="px-6 py-4 text-[12px] text-text-muted">
                    {l.last_call_date ? formatDistanceToNow(new Date(l.last_call_date), { addSuffix: true }) : 'Never'}
                  </td>
                  <td className="px-6 py-4">
                    {l.source && <span className="text-[11px] bg-elevated border border-border-subtle text-text-muted px-2 py-0.5 rounded-[3px]">{l.source}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle">
              <p className="text-[12px] text-text-muted">
                Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="w-8 h-8 flex items-center justify-center rounded-[5px] border border-border-subtle text-text-muted hover:text-text-primary hover:bg-elevated disabled:opacity-30 transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[13px] text-text-secondary px-3">{page} / {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages, p+1))} disabled={page===pages}
                  className="w-8 h-8 flex items-center justify-center rounded-[5px] border border-border-subtle text-text-muted hover:text-text-primary hover:bg-elevated disabled:opacity-30 transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && <LeadDrawer lead={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
