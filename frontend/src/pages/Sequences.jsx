/**
 * Sequences Page — View and manage follow-up sequences per lead.
 * Shows active/completed sequences and allows manual enrollment.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, PlayCircle, XCircle, Plus, CheckCircle2, Clock, MessageSquare, Phone, Mail, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { sequences as seqApi, leads as leadsApi } from '../services/api'

const SEQUENCE_TYPES = [
  { key: 'not_interested',     label: '7-Day Re-Engagement',    desc: 'For leads who said no or did not answer',  color: '#4C9EFF', steps: 6 },
  { key: 'callback_requested', label: 'Callback Follow-Up',      desc: 'Confirm and follow up on scheduled calls', color: '#C9A84C', steps: 3 },
  { key: 'offer_considering',  label: 'Offer Consideration',     desc: 'Nurture leads reviewing your offer',       color: '#9B59B6', steps: 4 },
  { key: 'contract_sent',      label: 'Contract Follow-Up',      desc: 'Remind seller to sign the contract',       color: '#FF9500', steps: 3 },
  { key: 'closed',             label: 'Post-Close Nurture',      desc: 'Stay top-of-mind for referrals',           color: '#00C37A', steps: 4 },
  { key: 'email_drip',         label: 'Cold Email Drip',         desc: 'Email-only nurture for leads (with unsubscribe)', color: '#1ABC9C', steps: 3 },
  { key: 'voicemail_touch',    label: 'Ringless Voicemail',      desc: 'Drops voicemails on a schedule (DNC + TCPA safe)', color: '#FF9500', steps: 3 },
]

const STATUS_META = {
  active:    { color: '#00C37A', bg: 'rgba(0,195,122,0.1)',   label: 'Active'    },
  completed: { color: '#4C9EFF', bg: 'rgba(76,158,255,0.1)',  label: 'Completed' },
  cancelled: { color: '#FF4444', bg: 'rgba(255,68,68,0.1)',   label: 'Cancelled' },
}

const STEP_ICONS = { call: Phone, sms: MessageSquare, email: Mail, default: Zap }

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  const diff = Math.floor((new Date(str) - Date.now()) / 86400000)
  if (diff < 0)  return `${Math.abs(diff)}d ago`
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return `in ${diff}d`
}

function fmtCreated(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function Sequences() {
  const [seqs, setSeqs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [enrollOpen, setEnrollOpen]   = useState(false)
  const [enrollLeadId, setEnrollLeadId] = useState('')
  const [enrollType, setEnrollType]   = useState('not_interested')
  const [enrolling, setEnrolling]     = useState(false)
  const [filter, setFilter]           = useState('all')
  const [allLeads, setAllLeads]       = useState([])
  const [leadSearch, setLeadSearch]   = useState('')

  const load = useCallback(async () => {
    try {
      const res = await seqApi.getAll()
      setSeqs(res.data?.sequences || [])
    } catch {
      toast.error('Failed to load sequences')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLeads = useCallback(async () => {
    try {
      const res = await leadsApi.getLeads({ limit: 200 })
      const raw = res.data?.data || res.data || []
      setAllLeads(Array.isArray(raw) ? raw : [])
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const handleEnroll = async () => {
    if (!enrollLeadId || !enrollType) {
      toast.error('Select a lead and sequence type')
      return
    }
    setEnrolling(true)
    try {
      await seqApi.enroll(enrollLeadId, enrollType)
      toast.success('Lead enrolled in sequence')
      setEnrollOpen(false)
      setEnrollLeadId('')
      setEnrollType('not_interested')
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Enrollment failed')
    } finally {
      setEnrolling(false)
    }
  }

  const handleCancel = async (id) => {
    try {
      await seqApi.cancel(id)
      toast.success('Sequence cancelled')
      setSeqs(prev => prev.map(s => s.id === id ? { ...s, status: 'cancelled' } : s))
    } catch {
      toast.error('Failed to cancel sequence')
    }
  }

  const filtered = seqs.filter(s => filter === 'all' || s.status === filter)

  const stats = {
    active:    seqs.filter(s => s.status === 'active').length,
    completed: seqs.filter(s => s.status === 'completed').length,
    cancelled: seqs.filter(s => s.status === 'cancelled').length,
  }

  const filteredLeads = allLeads.filter(l => {
    if (!leadSearch) return true
    const q = leadSearch.toLowerCase()
    return (
      (l.first_name || '').toLowerCase().includes(q) ||
      (l.last_name  || '').toLowerCase().includes(q) ||
      (l.phone || '').includes(q)
    )
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 20px 14px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Follow-Up Sequences
            </h1>
            <div style={{ display: 'flex', gap: 16 }}>
              {[
                { label: 'Active',    val: stats.active,    color: '#00C37A' },
                { label: 'Completed', val: stats.completed, color: '#4C9EFF' },
                { label: 'Cancelled', val: stats.cancelled, color: '#FF4444' },
              ].map(s => (
                <span key={s.label} style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>
                  {s.val} {s.label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={load}
              style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 6 }}
            >
              <RefreshCw size={14} strokeWidth={1.8} />
            </button>
            <button
              onClick={() => { setEnrollOpen(true); loadLeads() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(0,195,122,0.1)',
                border: '1px solid rgba(0,195,122,0.3)',
                borderRadius: 8, padding: '7px 14px',
                fontSize: 12, fontWeight: 600, color: '#00C37A',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Plus size={13} strokeWidth={2} /> Enroll Lead
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                height: 26, padding: '0 10px', borderRadius: 13,
                border: `1px solid ${filter === k ? 'rgba(0,195,122,0.4)' : 'var(--border)'}`,
                background: filter === k ? 'rgba(0,195,122,0.08)' : 'var(--border)',
                fontSize: 10, fontWeight: filter === k ? 600 : 400,
                color: filter === k ? '#00C37A' : 'var(--t3)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Sequence definitions ─────────────────────────────────────────────── */}
      <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 8 }}>
          Available Sequences
        </p>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
          {SEQUENCE_TYPES.map(s => (
            <div
              key={s.key}
              style={{
                flexShrink: 0,
                background: 'var(--surface-bg-2)',
                border: `1px solid var(--border)`,
                borderRadius: 8, padding: '8px 12px',
                minWidth: 180,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Zap size={10} color={s.color} />
                <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label}</span>
                <span style={{ fontSize: 9, color: 'var(--t4)', marginLeft: 'auto' }}>{s.steps} steps</span>
              </div>
              <p style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1.4 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sequence list ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px 20px' }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ height: 64, borderRadius: 10, background: 'var(--surface-bg-2)', marginBottom: 8, animation: `skeleton-pulse 1.4s ease infinite ${i * 0.07}s` }} />
          ))
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <PlayCircle size={22} strokeWidth={1.3} color="#00C37A" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>No sequences yet</p>
            <p style={{ fontSize: 12, color: 'var(--t4)' }}>Sequences enroll automatically when calls end, or click Enroll Lead to start one manually.</p>
          </div>
        ) : (
          filtered.map(seq => {
            const statusMeta = STATUS_META[seq.status] || STATUS_META.active
            const seqDef = SEQUENCE_TYPES.find(s => s.key === seq.sequence_type)
            const lead = seq.leads
            const leadName = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.property_address : 'Unknown Lead'
            const totalSteps = seqDef?.steps || 0
            const progress = totalSteps > 0 ? Math.min(100, Math.round(((seq.current_step || 0) / totalSteps) * 100)) : 0

            return (
              <div
                key={seq.id}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, marginBottom: 8,
                  padding: '12px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
                        {leadName}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: statusMeta.bg, color: statusMeta.color,
                      }}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--t3)' }}>
                      {seqDef?.label || seq.sequence_type} · Step {(seq.current_step || 0) + 1} of {totalSteps}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {seq.next_action_at && seq.status === 'active' && (
                      <span style={{ fontSize: 10, color: 'var(--t4)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={10} />
                        {fmtDate(seq.next_action_at)}
                      </span>
                    )}
                    {seq.status === 'active' && (
                      <button
                        onClick={() => handleCancel(seq.id)}
                        title="Cancel sequence"
                        style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 2 }}
                      >
                        <XCircle size={14} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {totalSteps > 0 && (
                  <div style={{ height: 3, background: 'var(--surface-bg-3)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${progress}%`,
                      background: seq.status === 'completed' ? '#4C9EFF' : seqDef?.color || '#00C37A',
                      borderRadius: 2,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                )}

                <p style={{ fontSize: 9, color: 'var(--t4)', marginTop: 5 }}>
                  Started {fmtCreated(seq.created_at)}
                </p>
              </div>
            )
          })
        )}
      </div>

      {/* ── Enroll Modal ─────────────────────────────────────────────────────── */}
      {enrollOpen && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{
            width: 460,
            background: 'var(--card-bg)',
            backdropFilter: 'blur(32px) saturate(160%)',
            WebkitBackdropFilter: 'blur(32px) saturate(160%)',
            border: '1px solid var(--border)',
            borderRadius: 16, padding: 28,
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}>
            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,195,122,0.40), transparent)', margin: '-28px -28px 24px' }} />

            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 18 }}>
              Enroll Lead in Sequence
            </h2>

            {/* Lead search + select */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', display: 'block', marginBottom: 6 }}>
                Lead
              </label>
              <input
                value={leadSearch}
                onChange={e => setLeadSearch(e.target.value)}
                placeholder="Search leads..."
                style={{
                  width: '100%', height: 36, background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '0 12px', fontSize: 12, color: 'var(--t1)',
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  marginBottom: 6,
                }}
              />
              <select
                value={enrollLeadId}
                onChange={e => setEnrollLeadId(e.target.value)}
                style={{
                  width: '100%', height: 40, background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px',
                  fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none',
                  appearance: 'none',
                }}
              >
                <option value="">Select a lead...</option>
                {filteredLeads.slice(0, 50).map(l => (
                  <option key={l.id} value={l.id} style={{ background: 'var(--card-bg)' }}>
                    {[l.first_name, l.last_name].filter(Boolean).join(' ') || l.phone || l.id.slice(0, 8)} — {l.property_address || 'No address'}
                  </option>
                ))}
              </select>
            </div>

            {/* Sequence type */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', display: 'block', marginBottom: 6 }}>
                Sequence
              </label>
              {SEQUENCE_TYPES.map(s => (
                <label
                  key={s.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', marginBottom: 4,
                    background: enrollType === s.key ? s.bg || 'rgba(0,195,122,0.06)' : 'var(--surface-bg-2)',
                    border: `1px solid ${enrollType === s.key ? s.color || '#00C37A' : 'var(--border)'}`,
                    borderRadius: 8, cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  <input
                    type="radio"
                    name="seqType"
                    value={s.key}
                    checked={enrollType === s.key}
                    onChange={() => setEnrollType(s.key)}
                    style={{ accentColor: s.color || '#00C37A' }}
                  />
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: s.color, marginBottom: 1 }}>{s.label}</p>
                    <p style={{ fontSize: 10, color: 'var(--t4)' }}>{s.desc} · {s.steps} steps</p>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setEnrollOpen(false); setEnrollLeadId(''); setLeadSearch('') }}
                style={{
                  flex: 1, height: 40, background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  fontSize: 13, fontWeight: 600, color: 'var(--t2)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEnroll}
                disabled={enrolling || !enrollLeadId}
                style={{
                  flex: 1, height: 40,
                  background: enrollLeadId ? 'rgba(0,195,122,0.15)' : 'var(--surface-bg-3)',
                  border: `1px solid ${enrollLeadId ? 'rgba(0,195,122,0.4)' : 'var(--border)'}`,
                  borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  color: enrollLeadId ? '#00C37A' : 'var(--t4)',
                  cursor: enrollLeadId ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >
                {enrolling ? 'Enrolling…' : 'Enroll'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
