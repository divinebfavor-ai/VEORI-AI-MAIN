import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import { formatDistanceToNow } from 'date-fns'
import { Search, Upload, Plus, X, ChevronLeft, ChevronRight, Phone, FileText, Mic, Zap, Mail, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { leads, calls as callsApi, deals as dealsApi } from '../services/api'
import useIntelStore from '../store/intelStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return 'var(--t4)'
  if (s >= 70) return 'var(--green)'
  if (s >= 40) return 'var(--amber)'
  return 'var(--red)'
}
function statusBadge(s) {
  const m = { interested:'green','appointment set':'green','under contract':'green','offer made':'gold',calling:'amber',new:'gray',contacted:'amber',dnc:'red',closed:'gold' }
  return m[s?.toLowerCase()] || 'gray'
}
function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : '—' }

const PAGE_SIZE = 20
const STATUS_OPTIONS = ['All','New','Contacted','Calling','Interested','Appointment Set','Offer Made','Under Contract','DNC','Closed']
const SCORE_OPTIONS  = [
  { label: 'All Scores', min: 0,  max: 100 },
  { label: 'Hot (70+)',  min: 70, max: 100 },
  { label: 'Warm (40–69)', min: 40, max: 69 },
  { label: 'Cold (<40)', min: 0,  max: 39 },
]

// ─── Lead Detail Panel (slide-in from right, replaces old drawer) ─────────────
function LeadPanel({ lead, onClose, onNavigate }) {
  const [tab, setTab]         = useState('overview')
  const [callLog, setCallLog] = useState([])
  const [notes, setNotes]     = useState(lead.notes || '')
  const [saving, setSaving]   = useState(false)
  const [dialing, setDialing] = useState(false)
  const [creatingDeal, setCreatingDeal] = useState(false)
  const [tracing, setTracing] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [mailing, setMailing] = useState(false)

  useEffect(() => {
    setNotes(lead.notes || '')
    setTab('overview')
    setCallLog([])
  }, [lead.id])

  useEffect(() => {
    if (tab === 'calls') {
      callsApi.getCalls({ lead_id: lead.id }).then(r => {
        const raw = r.data?.data ?? r.data?.calls ?? r.data
        setCallLog(Array.isArray(raw) ? raw : [])
      }).catch(() => {})
    }
  }, [tab, lead.id])

  const saveNotes = async () => {
    setSaving(true)
    try { await leads.updateLead(lead.id, { notes }); toast.success('Notes saved') }
    catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  const dialNow = async () => {
    if (lead.is_on_dnc) { toast.error('Lead is on DNC list'); return }
    setDialing(true)
    try {
      await callsApi.initiateCall({ lead_id: lead.id })
      toast.success('Call initiated — check Live Monitor')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Call failed')
    } finally { setDialing(false) }
  }

  const runSkipTrace = async () => {
    setTracing(true)
    try {
      const r = await leads.skipTrace(lead.id)
      const d = r.data?.data || r.data
      if (d?.simulated) {
        toast('Skip trace: set BATCH_SKIP_TRACE_API_KEY to enable', { icon: '⚠️' })
      } else {
        toast.success(`Found ${d?.phones?.length || 0} phones, ${d?.emails?.length || 0} emails`)
      }
    } catch { toast.error('Skip trace failed') }
    finally { setTracing(false) }
  }

  const dropVm = async () => {
    if (lead.is_on_dnc) { toast.error('Lead is on DNC list'); return }
    if (!lead.phone) { toast.error('No phone number — run skip trace first'); return }
    setDropping(true)
    try {
      await leads.dropVoicemail(lead.id, 'first_contact')
      toast.success('Voicemail drop initiated')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Voicemail drop failed')
    } finally { setDropping(false) }
  }

  const sendMail = async () => {
    if (!lead.property_address) { toast.error('No property address'); return }
    setMailing(true)
    try {
      const r = await leads.sendDirectMail(lead.id, 'no_answer')
      const d = r.data?.data || r.data
      if (d?.simulated) {
        toast('Direct mail simulated — set LOB_API_KEY to send real postcards', { icon: '📬' })
      } else {
        toast.success(`Postcard sent! Est. delivery: ${d?.expected_delivery || 'in 3-5 days'}`)
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Direct mail failed')
    } finally { setMailing(false) }
  }

  const createDeal = async () => {
    setCreatingDeal(true)
    try {
      const r = await dealsApi.createDeal({
        lead_id: lead.id,
        property_address: lead.property_address,
        property_city: lead.property_city,
        property_state: lead.property_state,
        property_zip: lead.property_zip,
        arv: lead.estimated_arv || lead.estimated_value,
        status: 'offer made',
      })
      const deal = r.data?.deal || r.data?.data || r.data
      toast.success('Deal created')
      onClose()
      if (deal?.id && onNavigate) onNavigate(`/deals/${deal.id}`)
    } catch { toast.error('Failed to create deal') }
    finally { setCreatingDeal(false) }
  }

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'calls',    label: 'Calls' },
    { id: 'notes',    label: 'Notes' },
  ]

  const score = lead.motivation_score

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      {/* Backdrop */}
      <div
        style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div style={{
        width: 460,
        background: 'var(--s1)',
        borderLeft: '1px solid var(--border-rest)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slide-right 0.18s ease-out',
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 20px 16px',
          borderBottom: '1px solid var(--border-rest)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)', marginBottom: 5 }}>
              {lead.first_name} {lead.last_name}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {lead.phone && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--t3)' }}>
                  <Phone size={10} strokeWidth={1.8} />
                  {lead.phone}
                </span>
              )}
              <Badge variant={statusBadge(lead.status)}>{lead.status || 'new'}</Badge>
              {lead.is_on_dnc && <Badge variant="red">DNC</Badge>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: 4, marginTop: -2, lineHeight: 1 }}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* Score + stats banner */}
        {score != null && (
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-rest)',
            background: 'var(--s2)',
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}>
            <div>
              <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 3 }}>
                Motivation Score
              </p>
              <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color: scoreColor(score), letterSpacing: '-0.03em' }}>
                {score}
              </p>
              {/* score bar */}
              <div style={{ width: 80, height: 3, background: 'var(--s4)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ width: `${score}%`, height: '100%', background: scoreColor(score), borderRadius: 2 }} />
              </div>
            </div>
            <div>
              <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 3 }}>
                Calls Made
              </p>
              <p style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, color: 'var(--t1)', letterSpacing: '-0.02em' }}>
                {lead.call_count || 0}
              </p>
            </div>
            {lead.seller_personality && (
              <div style={{ marginLeft: 'auto' }}>
                <Badge variant="amber">{lead.seller_personality}</Badge>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-rest)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              style={{ flex: 1 }}
              loading={dialing}
              disabled={!!lead.is_on_dnc}
              onClick={dialNow}
            >
              <Phone size={12} /> {lead.is_on_dnc ? 'DNC' : 'Dial Now'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              style={{ flex: 1 }}
              loading={creatingDeal}
              onClick={createDeal}
            >
              <FileText size={12} /> Create Deal
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" style={{ flex: 1 }} loading={dropping} onClick={dropVm} disabled={!!lead.is_on_dnc}>
              <Mic size={12} /> Drop VM
            </Button>
            <Button variant="secondary" size="sm" style={{ flex: 1 }} loading={tracing} onClick={runSkipTrace}>
              <Zap size={12} /> Skip Trace
            </Button>
            <Button variant="secondary" size="sm" style={{ flex: 1 }} loading={mailing} onClick={sendMail} disabled={!!lead.is_on_dnc || !lead.property_address}>
              <Mail size={12} /> Postcard
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-rest)',
          padding: '0 20px',
          gap: 4,
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 12px',
                fontSize: 12,
                fontWeight: 500,
                color: tab === t.id ? 'var(--t1)' : 'var(--t3)',
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${tab === t.id ? 'var(--green)' : 'transparent'}`,
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {tab === 'overview' && (
            <div>
              {[
                ['Property', [lead.property_address, lead.property_city, lead.property_state].filter(Boolean).join(', ')],
                ['Property Type', lead.property_type],
                ['Est. Value',    fmt$(lead.estimated_value)],
                ['Est. ARV',      fmt$(lead.estimated_arv)],
                ['Est. Equity',   fmt$(lead.estimated_equity)],
                ['Email',         lead.email],
                ['Source',        lead.source],
                ['Last Called',   lead.last_call_date ? formatDistanceToNow(new Date(lead.last_call_date), { addSuffix: true }) : 'Never'],
              ].filter(([, val]) => val).map(([label, val]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border-rest)',
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
                    textTransform: 'uppercase', color: 'var(--t3)',
                    width: 120, flexShrink: 0, paddingTop: 1,
                  }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--t2)', flex: 1, wordBreak: 'break-word' }}>
                    {val}
                  </span>
                </div>
              ))}

              {(lead.ai_summary || lead.notes) && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 8 }}>
                    AI Summary
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, background: 'var(--s2)', padding: '10px 12px', borderRadius: 6 }}>
                    {lead.ai_summary || lead.notes}
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === 'calls' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {callLog.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--t3)' }}>
                  <Phone size={22} style={{ margin: '0 auto 10px', display: 'block' }} strokeWidth={1.5} />
                  <p style={{ fontSize: 13 }}>No calls recorded yet</p>
                </div>
              )}
              {callLog.map(c => (
                <div
                  key={c.id}
                  style={{
                    background: 'var(--s2)',
                    border: '1px solid var(--border-rest)',
                    borderRadius: 6,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: c.ai_summary ? 6 : 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 500 }}>
                      {c.started_at ? formatDistanceToNow(new Date(c.started_at), { addSuffix: true }) : '—'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {c.duration_seconds && (
                        <span style={{ fontSize: 11, color: 'var(--t4)' }}>
                          {Math.floor(c.duration_seconds/60)}:{String(c.duration_seconds%60).padStart(2,'0')}
                        </span>
                      )}
                      <Badge variant={statusBadge(c.outcome)}>{c.outcome || 'no answer'}</Badge>
                      {c.motivation_score != null && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: scoreColor(c.motivation_score) }}>
                          {c.motivation_score}
                        </span>
                      )}
                    </div>
                  </div>
                  {c.ai_summary && (
                    <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>{c.ai_summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'notes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={10}
                placeholder="Add notes about this seller…"
                style={{
                  width: '100%',
                  background: 'var(--s2)',
                  border: '1px solid var(--border-rest)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 13,
                  color: 'var(--t1)',
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.6,
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(0,229,122,0.40)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border-rest)' }}
              />
              <Button loading={saving} onClick={saveNotes} variant="primary" size="sm">
                Save Notes
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Lead Row ─────────────────────────────────────────────────────────────────
function LeadRow({ lead, selected, onClick }) {
  const score = lead.motivation_score
  const [hov, setHov] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px 52px 110px 90px',
        alignItems: 'center',
        height: 44,
        padding: '0 16px',
        cursor: 'pointer',
        background: selected
          ? 'rgba(0,229,122,0.05)'
          : hov ? 'var(--s2)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--green)' : 'transparent'}`,
        transition: 'background 0.1s ease',
      }}
    >
      {/* Seller */}
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 500, color: 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {lead.first_name} {lead.last_name}
          {lead.is_on_dnc && (
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 600, color: 'var(--red)', letterSpacing: '0.05em' }}>DNC</span>
          )}
        </p>
        {lead.phone && (
          <p style={{ fontSize: 10, color: 'var(--t4)', marginTop: 1 }}>{lead.phone}</p>
        )}
      </div>

      {/* Property */}
      <div style={{ minWidth: 0 }}>
        {lead.property_address ? (
          <p style={{
            fontSize: 12, color: 'var(--t3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {lead.property_address}
          </p>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>—</span>
        )}
      </div>

      {/* Score */}
      <div style={{ textAlign: 'right' }}>
        {score != null ? (
          <span style={{
            fontSize: 14, fontWeight: 700, color: scoreColor(score),
            letterSpacing: '-0.01em',
          }}>
            {score}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>—</span>
        )}
      </div>

      {/* Status */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Badge variant={statusBadge(lead.status)}>{lead.status || 'new'}</Badge>
      </div>

      {/* Last call */}
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 11, color: 'var(--t4)' }}>
          {lead.last_call_date
            ? formatDistanceToNow(new Date(lead.last_call_date), { addSuffix: true })
            : 'Never'}
        </span>
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
  const [searchFocused, setSearchFocused] = useState(false)
  const fileRef  = useRef()
  const navigate = useNavigate()
  const setIntel = useIntelStore(s => s.setIntel)

  const load = async () => {
    setLoading(true)
    try {
      const r = await leads.getLeads({ limit: 500 })
      const raw = r.data?.leads ?? r.data?.data ?? r.data
      setAllLeads(Array.isArray(raw) ? raw : [])
    } catch { setAllLeads([]) }
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

  const selectLead = (lead) => {
    setSelected(lead)
    setIntel('lead', lead)
  }

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

  const selectStyle = {
    height: 32,
    background: 'var(--s2)',
    border: '1px solid var(--border-rest)',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 12,
    color: 'var(--t2)',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        padding: '20px 20px 0',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.02em' }}>
              Lead Management
            </h1>
            <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
              {allLeads.length.toLocaleString()} total · {filtered.length} shown
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
            <Button variant="secondary" size="sm" loading={importing} onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> Import CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => toast.info('Manual lead entry coming soon')}>
              <Plus size={13} /> Add Lead
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 0 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search
              size={12}
              strokeWidth={2}
              style={{
                position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--t3)',
              }}
            />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search leads…"
              style={{
                height: 32,
                background: 'var(--s2)',
                border: `1px solid ${searchFocused ? 'rgba(0,229,122,0.40)' : 'var(--border-rest)'}`,
                borderRadius: 6,
                paddingLeft: 28,
                paddingRight: 10,
                fontSize: 12,
                color: 'var(--t2)',
                outline: 'none',
                width: 200,
                fontFamily: 'inherit',
                transition: 'border-color 0.15s ease',
              }}
            />
          </div>

          {/* Status filter */}
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setPage(1) }}
            style={selectStyle}
          >
            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
          </select>

          {/* Score filter */}
          <select
            value={scoreFilter}
            onChange={e => { setScore(Number(e.target.value)); setPage(1) }}
            style={selectStyle}
          >
            {SCORE_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>

          {(search || status !== 'All' || scoreFilter !== 0) && (
            <button
              onClick={() => { setSearch(''); setStatus('All'); setScore(0); setPage(1) }}
              style={{
                background: 'none', border: 'none',
                fontSize: 11, color: 'var(--t4)', cursor: 'pointer', padding: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Column headers ───────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px 52px 110px 90px',
        alignItems: 'center',
        height: 32,
        padding: '0 16px',
        borderTop: '1px solid var(--border-rest)',
        borderBottom: '1px solid var(--border-rest)',
        marginTop: 12,
        flexShrink: 0,
      }}>
        {['Seller', 'Property', 'Score', 'Status', 'Last Call'].map((h, i) => (
          <span
            key={h}
            style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
              textTransform: 'uppercase', color: 'var(--t4)',
              textAlign: i >= 2 && i <= 2 ? 'right' : i === 4 ? 'right' : 'left',
              ...(i === 3 ? { textAlign: 'center' } : {}),
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* ── Lead rows ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--t3)', fontSize: 13 }}>
            Loading leads…
          </div>
        ) : paginated.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
          }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--t2)', marginBottom: 6 }}>
              {search || status !== 'All' ? 'No results' : 'No leads yet'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>
              Import a CSV to get started
            </p>
            {!search && (
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload size={13} /> Import CSV
              </Button>
            )}
          </div>
        ) : (
          paginated.map(l => (
            <LeadRow
              key={l.id}
              lead={l}
              selected={selected?.id === l.id}
              onClick={() => selectLead(l)}
            />
          ))
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {pages > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderTop: '1px solid var(--border-rest)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--t4)' }}>
            {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setPage(p => Math.max(1, p-1))}
              disabled={page === 1}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--s2)', border: '1px solid var(--border-rest)', borderRadius: 5,
                color: 'var(--t3)', cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.3 : 1,
              }}
            >
              <ChevronLeft size={13} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--t3)', minWidth: 50, textAlign: 'center' }}>
              {page} / {pages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pages, p+1))}
              disabled={page === pages}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--s2)', border: '1px solid var(--border-rest)', borderRadius: 5,
                color: 'var(--t3)', cursor: page === pages ? 'not-allowed' : 'pointer',
                opacity: page === pages ? 0.3 : 1,
              }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Lead Detail Panel ────────────────────────────────────────────── */}
      {selected && (
        <LeadPanel
          lead={selected}
          onClose={() => { setSelected(null) }}
          onNavigate={(path) => { setSelected(null); navigate(path) }}
        />
      )}
    </div>
  )
}
