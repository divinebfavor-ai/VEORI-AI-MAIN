import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import { formatDistanceToNow } from 'date-fns'
import { Search, Upload, Plus, X, ChevronLeft, ChevronRight, Phone, FileText, Mic, Zap, Mail, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { leads, calls as callsApi, deals as dealsApi } from '../services/api'
import useIntelStore from '../store/intelStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return 'rgba(255,255,255,0.25)'
  if (s >= 70) return '#00C37A'
  if (s >= 40) return '#FF9500'
  return '#FF4444'
}
function statusBadge(s) {
  const m = { interested: 'green', 'appointment set': 'green', 'under contract': 'green', 'offer made': 'gold', calling: 'amber', new: 'gray', contacted: 'amber', dnc: 'red', closed: 'gold' }
  return m[s?.toLowerCase()] || 'gray'
}
function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : '—' }
function initials(first, last) { return `${(first||'')[0]||''}${(last||'')[0]||''}`.toUpperCase() || '?' }

const PAGE_SIZE = 20
const STATUS_OPTIONS = ['All', 'New', 'Contacted', 'Calling', 'Interested', 'Appointment Set', 'Offer Made', 'Under Contract', 'DNC', 'Closed']
const SCORE_OPTIONS = [
  { label: 'All Scores', min: 0, max: 100 },
  { label: 'Hot (70+)',   min: 70, max: 100 },
  { label: 'Warm (40–69)', min: 40, max: 69 },
  { label: 'Cold (<40)', min: 0, max: 39 },
]

// ─── Lead Detail Panel ────────────────────────────────────────────────────────
function LeadPanel({ lead, onClose, onNavigate }) {
  const [tab, setTab]             = useState('overview')
  const [callLog, setCallLog]     = useState([])
  const [notes, setNotes]         = useState(lead.notes || '')
  const [saving, setSaving]       = useState(false)
  const [dialing, setDialing]     = useState(false)
  const [creatingDeal, setCreatingDeal] = useState(false)
  const [tracing, setTracing]     = useState(false)
  const [dropping, setDropping]   = useState(false)
  const [mailing, setMailing]     = useState(false)

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
    { id: 'calls',    label: 'Call History' },
    { id: 'notes',    label: 'Notes' },
  ]

  const score = lead.motivation_score
  const color = scoreColor(score)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      {/* Backdrop */}
      <div
        style={{ flex: 1, background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div style={{
        width: 480,
        background: 'var(--card-bg)',
        backdropFilter: 'blur(32px) saturate(160%)',
        WebkitBackdropFilter: 'blur(32px) saturate(160%)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slide-in-right 0.22s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.60)',
        overflowY: 'hidden',
      }}>

        {/* Glass top edge */}
        <div style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(0,195,122,0.40), transparent)',
        }} />

        {/* Header */}
        <div style={{
          padding: '20px 24px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Avatar */}
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `rgba(${score >= 70 ? '0,195,122' : score >= 40 ? '255,149,0' : '255,68,68'},0.10)`,
              border: `1.5px solid ${color}33`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
                {initials(lead.first_name, lead.last_name)}
              </span>
            </div>
            <div>
              <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 5 }}>
                {lead.first_name} {lead.last_name}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {lead.phone && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--t4)' }}>
                    <Phone size={10} strokeWidth={1.8} />
                    {lead.phone}
                  </span>
                )}
                <Badge variant={statusBadge(lead.status)}>{lead.status || 'new'}</Badge>
                {lead.is_on_dnc && <Badge variant="red">DNC</Badge>}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'var(--surface-bg)',
              border: '1px solid var(--border)',
              color: 'var(--t3)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginTop: -2, flexShrink: 0,
            }}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Score + stats banner */}
        {score != null && (
          <div style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-bg)',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
          }}>
            <div>
              <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 4 }}>
                Motivation Score
              </p>
              <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                {score}
              </p>
              <div style={{ width: 60, height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                <div style={{
                  width: `${score}%`, height: '100%',
                  background: color,
                  borderRadius: 2,
                  boxShadow: `0 0 6px ${color}80`,
                }} />
              </div>
            </div>
            <div>
              <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 4 }}>
                Calls Made
              </p>
              <p style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, color: 'var(--t1)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
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
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="sm" style={{ flex: 1 }} loading={dialing} disabled={!!lead.is_on_dnc} onClick={dialNow}>
              <Phone size={12} /> {lead.is_on_dnc ? 'DNC' : 'Dial Now'}
            </Button>
            <Button variant="secondary" size="sm" style={{ flex: 1 }} loading={creatingDeal} onClick={createDeal}>
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
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px', gap: 2, flexShrink: 0 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '11px 14px',
                fontSize: 12, fontWeight: 500,
                color: tab === t.id ? 'var(--t1)' : 'var(--t4)',
                background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === t.id ? '#00C37A' : 'transparent'}`,
                cursor: 'pointer',
                transition: 'color 0.15s ease',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>

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
                <div key={label} style={{
                  display: 'flex', gap: 12,
                  padding: '9px 0',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
                    textTransform: 'uppercase', color: 'var(--t4)',
                    width: 110, flexShrink: 0, paddingTop: 1,
                  }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--t2)', flex: 1, wordBreak: 'break-word', lineHeight: 1.4 }}>
                    {val}
                  </span>
                </div>
              ))}

              {(lead.ai_summary || lead.notes) && (
                <div style={{ marginTop: 18 }}>
                  <p style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 8 }}>
                    AI Summary
                  </p>
                  <div style={{
                    fontSize: 12, color: 'var(--t3)', lineHeight: 1.65,
                    background: 'rgba(0,195,122,0.04)',
                    border: '1px solid rgba(0,195,122,0.12)',
                    padding: '12px 14px', borderRadius: 8,
                    borderLeft: '2px solid rgba(0,195,122,0.40)',
                  }}>
                    {lead.ai_summary || lead.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'calls' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {callLog.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--t4)' }}>
                  <Phone size={22} style={{ margin: '0 auto 10px', display: 'block' }} strokeWidth={1.5} />
                  <p style={{ fontSize: 13 }}>No calls recorded yet</p>
                </div>
              ) : callLog.map(c => (
                <div key={c.id} style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: c.ai_summary ? 6 : 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 500 }}>
                      {c.started_at ? formatDistanceToNow(new Date(c.started_at), { addSuffix: true }) : '—'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {c.duration_seconds && (
                        <span style={{ fontSize: 11, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>
                          {Math.floor(c.duration_seconds / 60)}:{String(c.duration_seconds % 60).padStart(2, '0')}
                        </span>
                      )}
                      <Badge variant={statusBadge(c.outcome)}>{c.outcome || 'no answer'}</Badge>
                      {c.motivation_score != null && (
                        <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(c.motivation_score), fontVariantNumeric: 'tabular-nums' }}>
                          {c.motivation_score}
                        </span>
                      )}
                    </div>
                  </div>
                  {c.ai_summary && (
                    <p style={{ fontSize: 11, color: 'var(--t4)', lineHeight: 1.5 }}>{c.ai_summary}</p>
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
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 13,
                  color: 'var(--t2)',
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.65,
                  transition: 'border-color 0.15s ease',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(0,195,122,0.40)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
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
  const color = scoreColor(score)
  const [hov, setHov] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 190px 72px 120px 96px',
        alignItems: 'center',
        height: 52,
        padding: '0 20px',
        cursor: 'pointer',
        background: selected
          ? 'rgba(0,195,122,0.06)'
          : hov ? 'var(--surface-bg-3)' : 'transparent',
        borderLeft: `2px solid ${selected ? '#00C37A' : 'transparent'}`,
        borderBottom: '1px solid var(--border)',
        transition: 'all 0.15s ease',
        transform: hov && !selected ? 'translateY(-0.5px)' : 'none',
      }}
    >
      {/* Seller — avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: `rgba(${score >= 70 ? '0,195,122' : score >= 40 ? '255,149,0' : score != null ? '255,68,68' : '255,255,255'},0.09)`,
          border: `1px solid ${score != null ? color + '33' : 'rgba(255,255,255,0.08)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: score != null ? color : 'rgba(255,255,255,0.40)', letterSpacing: '-0.01em' }}>
            {initials(lead.first_name, lead.last_name)}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.90)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
          }}>
            {lead.first_name} {lead.last_name}
            {lead.is_on_dnc && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#FF4444', letterSpacing: '0.06em' }}>DNC</span>
            )}
          </p>
          {lead.phone && (
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', fontVariantNumeric: 'tabular-nums' }}>{lead.phone}</p>
          )}
        </div>
      </div>

      {/* Property */}
      <div style={{ minWidth: 0 }}>
        {lead.property_address ? (
          <p style={{
            fontSize: 12, color: 'rgba(255,255,255,0.45)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {lead.property_address}
          </p>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)' }}>—</span>
        )}
      </div>

      {/* Score — large number + mini bar */}
      <div style={{ textAlign: 'right' }}>
        {score != null ? (
          <div>
            <span style={{
              fontSize: 16, fontWeight: 700, color,
              letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
              display: 'block', lineHeight: 1, marginBottom: 4,
            }}>
              {score}
            </span>
            <div style={{ width: 36, height: 2.5, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginLeft: 'auto', overflow: 'hidden' }}>
              <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)' }}>—</span>
        )}
      </div>

      {/* Status */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Badge variant={statusBadge(lead.status)}>{lead.status || 'new'}</Badge>
      </div>

      {/* Last call */}
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>
          {lead.last_call_date
            ? formatDistanceToNow(new Date(lead.last_call_date), { addSuffix: true })
            : 'Never'}
        </span>
      </div>
    </div>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 190px 72px 120px 96px',
      alignItems: 'center',
      height: 52, padding: '0 20px',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', animation: 'skeleton-pulse 1.4s ease infinite' }} />
        <div>
          <div style={{ width: 110, height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginBottom: 5, animation: 'skeleton-pulse 1.4s ease infinite' }} />
          <div style={{ width: 72, height: 9, borderRadius: 4, background: 'rgba(255,255,255,0.03)', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
        </div>
      </div>
      <div style={{ width: 120, height: 10, borderRadius: 4, background: 'rgba(255,255,255,0.04)', animation: 'skeleton-pulse 1.4s ease infinite 0.05s' }} />
      <div style={{ width: 28, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
      <div style={{ width: 56, height: 18, borderRadius: 5, background: 'rgba(255,255,255,0.04)', margin: '0 auto', animation: 'skeleton-pulse 1.4s ease infinite 0.15s' }} />
      <div style={{ width: 50, height: 10, borderRadius: 4, background: 'rgba(255,255,255,0.03)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.2s' }} />
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
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const selectLead = (lead) => {
    setSelected(lead)
    setIntel('lead', lead)
  }

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

  const inputStyle = {
    height: 34,
    background: 'var(--surface-bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 10px',
    fontSize: 12,
    color: 'var(--t2)',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s ease',
    appearance: 'none',
    WebkitAppearance: 'none',
  }

  // Quick stats
  const hotCount  = allLeads.filter(l => l.motivation_score >= 70).length
  const warmCount = allLeads.filter(l => l.motivation_score >= 40 && l.motivation_score < 70).length
  const liveCount = allLeads.filter(l => l.status?.toLowerCase() === 'calling').length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '22px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.03em', marginBottom: 4 }}>
              Lead Intelligence
            </h1>
            <p style={{ fontSize: 12, color: 'var(--t4)' }}>
              {allLeads.length.toLocaleString()} total ·{' '}
              <span style={{ color: '#00C37A' }}>{hotCount} hot</span> ·{' '}
              <span style={{ color: '#FF9500' }}>{warmCount} warm</span>
              {liveCount > 0 && <> · <span style={{ color: '#00C37A' }}>{liveCount} live</span></>}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search
              size={12} strokeWidth={2}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }}
            />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              onFocus={e => { setSearchFocused(true); e.target.style.borderColor = 'rgba(0,195,122,0.40)' }}
              onBlur={e => { setSearchFocused(false); e.target.style.borderColor = 'var(--border)' }}
              placeholder="Search leads…"
              style={{
                ...inputStyle,
                paddingLeft: 30,
                paddingRight: 10,
                width: 220,
                cursor: 'text',
              }}
            />
          </div>

          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} style={inputStyle}>
            {STATUS_OPTIONS.map(s => <option key={s} style={{ background: '#0a101a' }}>{s}</option>)}
          </select>

          <select value={scoreFilter} onChange={e => { setScore(Number(e.target.value)); setPage(1) }} style={inputStyle}>
            {SCORE_OPTIONS.map((o, i) => <option key={o.label} value={i} style={{ background: '#0a101a' }}>{o.label}</option>)}
          </select>

          {(search || status !== 'All' || scoreFilter !== 0) && (
            <button
              onClick={() => { setSearch(''); setStatus('All'); setScore(0); setPage(1) }}
              style={{
                background: 'none', border: 'none',
                fontSize: 11, color: 'var(--t4)', cursor: 'pointer',
                padding: '0 4px',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Column headers ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 190px 72px 120px 96px',
        alignItems: 'center',
        height: 30,
        padding: '0 20px',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        marginTop: 14,
        flexShrink: 0,
        background: 'var(--surface-bg)',
      }}>
        {[
          { label: 'Seller', align: 'left' },
          { label: 'Property', align: 'left' },
          { label: 'Score', align: 'right' },
          { label: 'Status', align: 'center' },
          { label: 'Last Call', align: 'right' },
        ].map(h => (
          <span key={h.label} style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
            textTransform: 'uppercase', color: 'var(--t4)',
            textAlign: h.align,
          }}>
            {h.label}
          </span>
        ))}
      </div>

      {/* ── Lead rows ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
        ) : paginated.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(0,195,122,0.06)',
              border: '1px solid rgba(0,195,122,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Users size={22} strokeWidth={1.5} color="#00C37A" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>
              {search || status !== 'All' ? 'No results match your filters' : 'No leads yet'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--t4)', marginBottom: 20 }}>
              {search || status !== 'All' ? 'Try adjusting your search or filters' : 'Import a CSV to get started'}
            </p>
            {!search && status === 'All' && (
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

      {/* ── Pagination ────────────────────────────────────────────────────────── */}
      {pages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontVariantNumeric: 'tabular-nums' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'rgba(255,255,255,0.50)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.3 : 1, transition: 'opacity 0.15s',
              }}
            >
              <ChevronLeft size={13} />
            </button>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
              {page} / {pages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              style={{
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'rgba(255,255,255,0.50)',
                cursor: page === pages ? 'not-allowed' : 'pointer',
                opacity: page === pages ? 0.3 : 1, transition: 'opacity 0.15s',
              }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Lead Detail Panel ─────────────────────────────────────────────────── */}
      {selected && (
        <LeadPanel
          lead={selected}
          onClose={() => setSelected(null)}
          onNavigate={(path) => { setSelected(null); navigate(path) }}
        />
      )}
    </div>
  )
}
