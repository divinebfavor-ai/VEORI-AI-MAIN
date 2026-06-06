/**
 * Lead Pipeline — Kanban board for lead stages
 * Five columns: New / Contacted / Interested / Offer Made / Closed
 * Click card to move stage. Drag not used (HTML5 DnD for zero-dependency move).
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Search, Users, Flame } from 'lucide-react'
import toast from 'react-hot-toast'
import { leads as leadsApi } from '../services/api'

const STAGES = [
  { key: 'new',        label: 'New',        color: '#4C9EFF', bg: 'rgba(76,158,255,0.08)',  border: 'rgba(76,158,255,0.25)' },
  { key: 'contacted',  label: 'Contacted',  color: '#FF9500', bg: 'rgba(255,149,0,0.08)',   border: 'rgba(255,149,0,0.25)' },
  { key: 'interested', label: 'Interested', color: '#C9A84C', bg: 'rgba(201,168,76,0.08)',  border: 'rgba(201,168,76,0.25)' },
  { key: 'offer_made', label: 'Offer Made', color: '#9B59B6', bg: 'rgba(155,89,182,0.08)',  border: 'rgba(155,89,182,0.25)' },
  { key: 'closed',     label: 'Closed',     color: '#00C37A', bg: 'rgba(0,195,122,0.08)',   border: 'rgba(0,195,122,0.25)' },
]

// Stage keys that match existing lead statuses
const STATUS_TO_STAGE = {
  new:             'new',
  calling:         'new',
  contacted:       'contacted',
  appointment_set: 'interested',
  interested:      'interested',
  offer_made:      'offer_made',
  under_contract:  'closed',
  closed:          'closed',
}

function scoreColor(score) {
  if (!score) return 'var(--t4)'
  if (score >= 70) return '#00C37A'
  if (score >= 40) return '#FF9500'
  return '#FF4444'
}

function fmtDate(str) {
  if (!str) return null
  const d = new Date(str)
  const diff = Math.floor((Date.now() - d) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return '1d ago'
  if (diff < 30) return `${diff}d ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function LeadCard({ lead, stageMeta, onMove, onOpen, isDragging, onDragStart, onDragEnd }) {
  const [hov, setHov] = useState(false)

  return (
    <div
      draggable
      onDragStart={() => onDragStart(lead)}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? 'var(--surface-bg-3)' : 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        transition: 'all 0.15s',
        boxShadow: hov ? '0 4px 16px rgba(0,0,0,0.3)' : 'none',
      }}
    >
      {/* Name + score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', flex: 1, lineHeight: 1.3, paddingRight: 8 }}>
          {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown'}
        </p>
        {lead.motivation_score > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(lead.motivation_score), flexShrink: 0 }}>
            {lead.motivation_score >= 70 && <Flame size={9} style={{ marginRight: 2, display: 'inline' }} />}
            {lead.motivation_score}
          </span>
        )}
      </div>

      {/* Address */}
      {lead.property_address && (
        <p style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.property_address}
        </p>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--t4)' }}>
          {fmtDate(lead.last_call_date || lead.created_at)}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* Move stage dropdown */}
          <select
            onClick={e => e.stopPropagation()}
            onChange={e => { if (e.target.value) onMove(lead.id, e.target.value) }}
            value=""
            style={{
              background: 'var(--surface-bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 5, padding: '2px 4px',
              fontSize: 9, color: 'var(--t3)',
              cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
            }}
          >
            <option value="" disabled>Move</option>
            {STAGES.filter(s => s.key !== stageMeta.key).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          {/* Open lead */}
          <button
            onClick={e => { e.stopPropagation(); onOpen(lead.id) }}
            style={{
              background: 'var(--surface-bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 5, padding: '2px 6px',
              fontSize: 9, color: 'var(--t3)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            View
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LeadPipeline() {
  const [allLeads, setAllLeads]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [dragLead, setDragLead]     = useState(null)
  const [dragOver, setDragOver]     = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      // Load first 500 leads, sorted by motivation score
      const res = await leadsApi.getLeads({ limit: 500 })
      const raw = res.data?.data || res.data || []
      setAllLeads(Array.isArray(raw) ? raw : [])
    } catch {
      toast.error('Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Resolve which stage a lead belongs to
  function getStage(lead) {
    // Use pipeline_stage if set, else map from status
    if (lead.pipeline_stage && STAGES.find(s => s.key === lead.pipeline_stage)) {
      return lead.pipeline_stage
    }
    return STATUS_TO_STAGE[lead.status] || 'new'
  }

  // Move lead to a new stage
  const moveToStage = async (leadId, newStage) => {
    // Optimistic update
    setAllLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipeline_stage: newStage } : l))
    try {
      await leadsApi.updateLead(leadId, { pipeline_stage: newStage })
      toast.success(`Moved to ${STAGES.find(s => s.key === newStage)?.label}`)
    } catch {
      toast.error('Failed to move lead')
      load() // revert by reloading
    }
  }

  // Drag + drop handlers
  const handleDragStart = (lead) => setDragLead(lead)
  const handleDragEnd   = () => { setDragLead(null); setDragOver(null) }
  const handleDragOver  = (e, stageKey) => { e.preventDefault(); setDragOver(stageKey) }
  const handleDrop      = (e, stageKey) => {
    e.preventDefault()
    if (dragLead && getStage(dragLead) !== stageKey) {
      moveToStage(dragLead.id, stageKey)
    }
    setDragOver(null)
    setDragLead(null)
  }

  // Filtered leads
  const filteredLeads = allLeads.filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (l.first_name || '').toLowerCase().includes(q) ||
      (l.last_name  || '').toLowerCase().includes(q) ||
      (l.phone      || '').includes(q) ||
      (l.property_address || '').toLowerCase().includes(q)
    )
  })

  // Build per-stage arrays
  const byStage = {}
  for (const s of STAGES) byStage[s.key] = []
  for (const lead of filteredLeads) {
    const stage = getStage(lead)
    if (byStage[stage]) byStage[stage].push(lead)
  }

  const totalLeads = allLeads.length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 20px 14px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 3 }}>
              Lead Pipeline
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>{totalLeads} leads</span>
              {STAGES.map(s => (
                <span key={s.key} style={{ fontSize: 11, color: s.color }}>
                  {byStage[s.key].length} {s.label}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={load}
            style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 6 }}
          >
            <RefreshCw size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 320 }}>
          <Search size={12} strokeWidth={1.8} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads..."
            style={{
              width: '100%', height: 32, background: 'var(--surface-bg-2)',
              border: '1px solid var(--border)', borderRadius: 8,
              paddingLeft: 30, paddingRight: 12,
              fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* ── Kanban columns ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', padding: '14px 16px', gap: 12 }}>
        {loading ? (
          STAGES.map(s => (
            <div key={s.key} style={{ width: 220, flexShrink: 0 }}>
              <div style={{ height: 8, background: s.color, borderRadius: '6px 6px 0 0', marginBottom: 8 }} />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ height: 80, borderRadius: 10, background: 'var(--surface-bg-2)', marginBottom: 8, animation: `skeleton-pulse 1.4s ease infinite ${i * 0.1}s` }} />
              ))}
            </div>
          ))
        ) : (
          STAGES.map(stage => {
            const cards = byStage[stage.key] || []
            const isDropTarget = dragOver === stage.key && dragLead && getStage(dragLead) !== stage.key
            return (
              <div
                key={stage.key}
                onDragOver={e => handleDragOver(e, stage.key)}
                onDrop={e => handleDrop(e, stage.key)}
                style={{
                  width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
                  maxHeight: '100%',
                }}
              >
                {/* Column header */}
                <div style={{
                  background: stage.bg,
                  border: `1px solid ${isDropTarget ? stage.color : stage.border}`,
                  borderRadius: '8px 8px 0 0',
                  padding: '8px 12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'border-color 0.15s',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: stage.color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {stage.label}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: stage.color, background: stage.bg, border: `1px solid ${stage.border}`, borderRadius: 10, padding: '1px 7px' }}>
                    {cards.length}
                  </span>
                </div>

                {/* Cards area */}
                <div
                  style={{
                    flex: 1, overflowY: 'auto',
                    background: isDropTarget ? stage.bg : 'var(--surface-bg)',
                    border: `1px solid ${isDropTarget ? stage.color : stage.border}`,
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    padding: 8,
                    display: 'flex', flexDirection: 'column', gap: 8,
                    minHeight: 120,
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  {cards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 8px' }}>
                      <Users size={18} strokeWidth={1.2} color="var(--t4)" style={{ marginBottom: 6 }} />
                      <p style={{ fontSize: 10, color: 'var(--t4)' }}>
                        {dragLead ? 'Drop here' : 'No leads'}
                      </p>
                    </div>
                  ) : (
                    cards.map(lead => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        stageMeta={stage}
                        onMove={moveToStage}
                        onOpen={id => navigate(`/leads`)}
                        isDragging={dragLead?.id === lead.id}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
