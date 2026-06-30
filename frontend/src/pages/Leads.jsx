import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Papa from 'papaparse'
import { formatDistanceToNow } from 'date-fns'
import { Search, Upload, Plus, X, ChevronLeft, ChevronRight, Phone, FileText, Mic, Zap, Mail, Users, Camera, Image, Copy, GitMerge } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { leads, calls as callsApi, deals as dealsApi, leadPhotos as leadPhotosApi } from '../services/api'
import useIntelStore from '../store/intelStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return 'var(--t4)'
  if (s >= 70) return '#00C37A'
  if (s >= 40) return '#FF9500'
  return '#FF4444'
}
function statusBadge(s) {
  const m = { interested: 'green', 'appointment set': 'green', 'under contract': 'green', 'offer made': 'gold', calling: 'amber', new: 'gray', contacted: 'amber', dnc: 'red', closed: 'gold' }
  return m[s?.toLowerCase()] || 'gray'
}
function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : '-' }
function initials(first, last) { return `${(first||'')[0]||''}${(last||'')[0]||''}`.toUpperCase() || '?' }

const PAGE_SIZE = 20
const STATUS_OPTIONS = ['All', 'New', 'Contacted', 'Calling', 'Interested', 'Appointment Set', 'Offer Made', 'Under Contract', 'DNC', 'Closed']
const SCORE_OPTIONS = [
  { label: 'All Scores', min: 0, max: 100 },
  { label: 'Hot (70+)',   min: 70, max: 100 },
  { label: 'Warm (40–69)', min: 40, max: 69 },
  { label: 'Cold (<40)', min: 0, max: 39 },
]

// ─── Call Card (extracted to avoid hook-in-loop violation) ───────────────────
function CallCard({ call: c }) {
  const [showTx, setShowTx] = useState(false)
  const audioRef = useRef(null)
  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  const fmtDur = c.duration_seconds != null
    ? `${Math.floor(c.duration_seconds / 60)}:${String(c.duration_seconds % 60).padStart(2, '0')}`
    : null
  const outcomeLabel = (c.outcome || '').replace(/_/g, ' ') || 'no answer'
  const outcomeColor = {
    appointment: '#00C37A', verbal_yes: '#00C37A', offer_made: '#00C37A',
    callback_requested: '#4D9EFF', voicemail: '#FF9500', no_answer: '#FF9500',
    not_home: '#FF9500', not_interested: '#FF4444',
  }[c.outcome] || 'var(--t4)'

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  const fmtTime = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  return (
    <div style={{ background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>

      {/* Row 1 - time + outcome + score + duration */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 500 }}>
          {c.started_at ? formatDistanceToNow(new Date(c.started_at), { addSuffix: true }) : '-'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {fmtDur && <span style={{ fontSize: 11, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur}</span>}
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: outcomeColor, background: `${outcomeColor}18`,
            border: `1px solid ${outcomeColor}30`, borderRadius: 5, padding: '2px 7px',
          }}>{outcomeLabel}</span>
          {c.motivation_score != null && (
            <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(c.motivation_score), fontVariantNumeric: 'tabular-nums' }}>
              {c.motivation_score}
            </span>
          )}
        </div>
      </div>

      {/* AI Summary */}
      {c.ai_summary && (
        <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5, marginBottom: 8 }}>{c.ai_summary}</p>
      )}

      {/* Audio player */}
      {c.recording_url && (
        <div style={{
          background: 'var(--surface-bg-2)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 10px', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <audio
            ref={audioRef}
            src={c.recording_url}
            onTimeUpdate={() => setProgress(audioRef.current?.currentTime || 0)}
            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
            onEnded={() => setPlaying(false)}
          />
          <button
            onClick={togglePlay}
            style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: '#00C37A', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000',
            }}
          >
            {playing
              ? <span style={{ fontSize: 8 }}>&#9646;&#9646;</span>
              : <span style={{ fontSize: 10, marginLeft: 2 }}>&#9654;</span>
            }
          </button>
          <input
            type="range" min={0} max={duration || 1} step={0.1} value={progress}
            onChange={e => { if (audioRef.current) { audioRef.current.currentTime = Number(e.target.value); setProgress(Number(e.target.value)) } }}
            style={{ flex: 1, accentColor: '#00C37A', height: 3 }}
          />
          <span style={{ fontSize: 10, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {fmtTime(progress)} / {fmtTime(duration)}
          </span>
          <a
            href={c.recording_url}
            download
            title="Download recording"
            style={{ color: 'var(--t4)', display: 'flex', alignItems: 'center' }}
          >
            <Mic size={11} />
          </a>
        </div>
      )}

      {/* Transcript toggle */}
      {c.transcript && (
        <>
          <button
            onClick={() => setShowTx(v => !v)}
            style={{
              fontSize: 10, color: '#00C37A', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <FileText size={9} /> {showTx ? 'Hide' : 'View'} transcript
          </button>
          {showTx && (
            <div style={{
              marginTop: 8, fontSize: 11, color: 'var(--t3)', lineHeight: 1.65,
              background: 'var(--surface-bg-2)', borderRadius: 6, padding: '10px 12px',
              maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {c.transcript.split('\n').filter(Boolean).map((line, i) => {
                const isAlex = /^(alex|agent):/i.test(line)
                return (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, flexShrink: 0, width: 36, marginTop: 2,
                      color: isAlex ? '#00C37A' : '#4D9EFF', letterSpacing: '0.06em',
                    }}>{isAlex ? 'ALEX' : 'SELL'}</span>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--t2)', lineHeight: 1.5 }}>
                      {line.replace(/^(alex|agent|seller):\s*/i, '')}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Lead Detail Panel ────────────────────────────────────────────────────────
function LeadPanel({ lead, onClose, onNavigate }) {
  const [tab, setTab]             = useState('overview')
  const [callLog, setCallLog]     = useState([])
  const [syncing, setSyncing]     = useState(false)
  const [notes, setNotes]         = useState(lead.notes || '')
  const [saving, setSaving]       = useState(false)
  const [dialing, setDialing]         = useState(false)
  const [creatingDeal, setCreatingDeal] = useState(false)
  const [tracing, setTracing]         = useState(false)
  const [dropping, setDropping]       = useState(false)
  const [mailing, setMailing]         = useState(false)
  const [photos, setPhotos]           = useState([])
  const [sendingPhotoReq, setSendingPhotoReq] = useState(false)
  const [photoLink, setPhotoLink]     = useState(null)

  useEffect(() => {
    setNotes(lead.notes || '')
    setTab('overview')
    setCallLog([])
    setPhotos([])
    setPhotoLink(null)
  }, [lead.id])

  const loadCallLog = () => {
    callsApi.getCalls({ lead_id: lead.id, limit: 50 }).then(r => {
      const raw = r.data?.data ?? r.data?.calls ?? r.data
      setCallLog(Array.isArray(raw) ? raw : [])
    }).catch(() => {})
  }

  useEffect(() => {
    if (tab === 'calls') loadCallLog()
    if (tab === 'photos') {
      leadPhotosApi.getPhotos(lead.id)
        .then(r => setPhotos(r.data?.photos || []))
        .catch(() => {})
    }
  }, [tab, lead.id])

  const syncCalls = async () => {
    setSyncing(true)
    try {
      const r = await callsApi.syncFromVapi()
      const { synced = 0 } = r.data || {}
      toast.success(synced > 0 ? `Synced ${synced} calls` : 'Already up to date')
      loadCallLog()
    } catch { toast.error('Sync failed') }
    finally { setSyncing(false) }
  }

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
      toast.success('Call initiated - check Live Monitor')
    } catch (err) {
      const errCode = err.response?.data?.error_code
      if (errCode === 'FREE_LIMIT_REACHED') {
        toast.error('Free daily limit reached', { duration: 5000 })
        setTimeout(() => {
          if (window.confirm('You have used your 10 free calls for today.\n\nSubscribe to unlock more calls and choose a plan that fits you.\n\nSee plans now?')) {
            window.location.href = '/billing'
          }
        }, 300)
      } else {
        toast.error(err.response?.data?.error || 'Call failed')
      }
    } finally { setDialing(false) }
  }

  const runSkipTrace = async () => {
    setTracing(true)
    try {
      const r = await leads.skipTrace(lead.id)
      const d = r.data?.data || r.data
      const phones = d?.phones?.length || 0
      const emails = d?.emails?.length || 0
      toast.success(`Skip trace complete - ${phones} phone${phones !== 1 ? 's' : ''}, ${emails} email${emails !== 1 ? 's' : ''} found`)
    } catch { toast.error('Skip trace failed') }
    finally { setTracing(false) }
  }

  const dropVm = async () => {
    if (lead.is_on_dnc) { toast.error('Lead is on DNC list'); return }
    if (!lead.phone) { toast.error('No phone number - run skip trace first'); return }
    setDropping(true)
    try {
      const r = await leads.dropVoicemail(lead.id, 'first_contact')
      const d = r.data?.data || r.data
      if (d?.skipped) {
        const why = d.reason === 'dnc' || d.reason === 'federal_dnc'
          ? 'Number is on the DNC list'
          : d.reason === 'tcpa_quiet_hours'
            ? 'Outside calling hours (8 AM–9 PM local) — try again in-window'
            : 'Voicemail not sent'
        toast.error(why)
      } else {
        toast.success(d?.simulated ? 'Voicemail queued' : 'Voicemail drop initiated')
      }
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
      toast.success(d?.simulated
        ? 'Postcard queued (live sending active once LOB_API_KEY is set)'
        : `Postcard sent! Est. delivery: ${d?.expected_delivery || 'in 3–5 days'}`)
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

  const sendPhotoRequest = async () => {
    setSendingPhotoReq(true)
    try {
      const r = await leadPhotosApi.sendPhotoRequest(lead.id)
      const d = r.data
      if (d.url) setPhotoLink(d.url)
      const via = d.sent_via === 'sms' ? `SMS to ${d.phone}` : d.sent_via === 'email' ? `email to ${d.email}` : 'link generated'
      toast.success(`Photo request sent via ${via}`)
      setTab('photos')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send photo request')
    } finally { setSendingPhotoReq(false) }
  }

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'calls',    label: 'Call History' },
    { id: 'photos',   label: 'Photos' },
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
          <Button variant="secondary" size="sm" style={{ width: '100%' }} loading={sendingPhotoReq} onClick={sendPhotoRequest} disabled={!!lead.is_on_dnc}>
            <Camera size={12} /> Request Property Photos
          </Button>
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
              {/* Sync bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--t4)' }}>{callLog.length} call{callLog.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={syncCalls}
                  disabled={syncing}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: 'none', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '4px 10px',
                    fontSize: 11, color: syncing ? 'var(--t4)' : '#00C37A',
                    cursor: syncing ? 'default' : 'pointer',
                  }}
                >
                  <Zap size={10} /> {syncing ? 'Syncing…' : 'Sync Calls'}
                </button>
              </div>

              {callLog.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--t4)' }}>
                  <Phone size={22} style={{ margin: '0 auto 10px', display: 'block' }} strokeWidth={1.5} />
                  <p style={{ fontSize: 13, marginBottom: 8 }}>No calls recorded yet</p>
                  <p style={{ fontSize: 11, color: 'var(--t4)' }}>Hit "Sync Calls" to pull any existing call data</p>
                </div>
              ) : callLog.map(c => <CallCard key={c.id} call={c} />)}
            </div>
          )}

          {tab === 'photos' && (
            <div>
              {/* Photo link copy box */}
              {photoLink && (
                <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.20)', borderRadius: 10 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: '#00C37A', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '0 0 6px' }}>Upload Link</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <code style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1, wordBreak: 'break-all' }}>{photoLink}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(photoLink); toast.success('Link copied') }}
                      style={{ fontSize: 11, color: '#00C37A', background: 'none', border: '1px solid rgba(0,195,122,0.30)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {/* Photos grid */}
              {photos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <Image size={28} style={{ margin: '0 auto 12px', display: 'block', color: 'var(--t4)' }} strokeWidth={1.5} />
                  <p style={{ fontSize: 13, color: 'var(--t4)', margin: '0 0 6px' }}>No photos yet</p>
                  <p style={{ fontSize: 11, color: 'var(--t4)' }}>Click "Request Property Photos" to send the seller an upload link</p>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: 'var(--t4)', marginBottom: 12 }}>{photos.length} photo{photos.length !== 1 ? 's' : ''} from seller</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {photos.map(p => (
                      <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', aspectRatio: '4/3', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-bg)' }}>
                        <img src={p.url} alt="Property" style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s' }}
                          onMouseEnter={e => e.target.style.transform = 'scale(1.04)'}
                          onMouseLeave={e => e.target.style.transform = 'scale(1)'}
                        />
                      </a>
                    ))}
                  </div>
                </>
              )}
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
      {/* Seller - avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: score != null
            ? `rgba(${score >= 70 ? '0,195,122' : score >= 40 ? '255,149,0' : '255,68,68'},0.09)`
            : 'var(--surface-bg-3)',
          border: `1px solid ${score != null ? color + '33' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: score != null ? color : 'var(--t3)', letterSpacing: '-0.01em' }}>
            {initials(lead.first_name, lead.last_name)}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontSize: 13, fontWeight: 500, color: 'var(--t1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
          }}>
            {lead.first_name} {lead.last_name}
            {lead.is_on_dnc && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#FF4444', letterSpacing: '0.06em' }}>DNC</span>
            )}
          </p>
          {lead.phone && (
            <p style={{ fontSize: 10, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{lead.phone}</p>
          )}
        </div>
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
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>-</span>
        )}
      </div>

      {/* Score - large number + mini bar */}
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
            <div style={{ width: 36, height: 2.5, background: 'var(--border)', borderRadius: 2, marginLeft: 'auto', overflow: 'hidden' }}>
              <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>-</span>
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
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-bg-2)', animation: 'skeleton-pulse 1.4s ease infinite' }} />
        <div>
          <div style={{ width: 110, height: 12, borderRadius: 4, background: 'var(--surface-bg-2)', marginBottom: 5, animation: 'skeleton-pulse 1.4s ease infinite' }} />
          <div style={{ width: 72, height: 9, borderRadius: 4, background: 'var(--surface-bg)', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
        </div>
      </div>
      <div style={{ width: 120, height: 10, borderRadius: 4, background: 'var(--surface-bg)', animation: 'skeleton-pulse 1.4s ease infinite 0.05s' }} />
      <div style={{ width: 28, height: 14, borderRadius: 4, background: 'var(--surface-bg-2)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
      <div style={{ width: 56, height: 18, borderRadius: 5, background: 'var(--surface-bg)', margin: '0 auto', animation: 'skeleton-pulse 1.4s ease infinite 0.15s' }} />
      <div style={{ width: 50, height: 10, borderRadius: 4, background: 'var(--surface-bg)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.2s' }} />
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
  const [showAddLead, setShowAddLead] = useState(false)
  const [showDupes, setShowDupes]     = useState(false)
  const fileRef  = useRef()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setIntel = useIntelStore(s => s.setIntel)

  const load = async () => {
    setLoading(true)
    try {
      // Silently fix any leads stuck in "calling" with no active call
      leads.resetStaleCallingStatus().catch(() => {})
      const r = await leads.getLeads({ limit: 500 })
      const raw = r.data?.leads ?? r.data?.data ?? r.data
      setAllLeads(Array.isArray(raw) ? raw : [])
      return Array.isArray(raw) ? raw : []
    } catch { setAllLeads([]); return [] }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load().then(allLoaded => {
      // Auto-open lead profile when navigated from Live Monitor (?highlight=id)
      const highlightId = searchParams.get('highlight')
      if (highlightId && allLoaded.length) {
        const target = allLoaded.find(l => l.id === highlightId)
        if (target) { setSelected(target); setIntel('lead', target) }
      }
    })
  }, [])

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

    // Normalize a value - trim whitespace, return empty string if falsy
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
            first_name: v(r, 'first_name', 'First Name', 'FirstName', 'fname', 'Owner First Name', 'Contact First Name'),
            last_name:  v(r, 'last_name',  'Last Name',  'LastName',  'lname', 'Owner Last Name',  'Contact Last Name'),
            phone:      v(r, 'phone', 'Phone', 'phone_number', 'Phone Number', 'PhoneNumber', 'Mobile', 'Cell', 'cell_phone', 'mobile_phone', 'Contact Phone', 'Owner Phone', 'Primary Phone'),
            email:      v(r, 'email', 'Email', 'Email Address', 'EmailAddress', 'Contact Email'),
            property_address: v(r, 'property_address', 'Property Address', 'Address', 'address', 'Mailing Address', 'Street Address', 'Street'),
            property_city:    v(r, 'property_city', 'city', 'City', 'Mailing City', 'Property City'),
            property_state:   v(r, 'property_state', 'state', 'State', 'Mailing State', 'Property State'),
            property_zip:     v(r, 'property_zip', 'zip', 'Zip', 'ZIP', 'Zip Code', 'Postal Code'),
            estimated_value:  v(r, 'estimated_value', 'Estimated Value', 'AVM', 'Property Value', 'Market Value'),
            estimated_equity: v(r, 'estimated_equity', 'Estimated Equity', 'Equity', 'equity'),
          })).filter(r => r.phone)

          if (!mapped.length) {
            toast.error('No leads found with a phone number. Check your CSV column headers.')
            setImporting(false)
            return
          }

          const res = await leads.bulkImportLeads(mapped)
          const { imported = mapped.length, duplicates_skipped = 0, dnc_flagged = 0 } = res.data || {}

          let msg = `${imported} leads imported`
          if (duplicates_skipped > 0) msg += ` · ${duplicates_skipped} duplicates skipped`
          if (dnc_flagged > 0) msg += ` · ${dnc_flagged} DNC flagged`
          toast.success(msg)
          load()
        } catch (err) {
          const msg = err?.response?.data?.error || err?.message || 'Import failed'
          toast.error(msg)
        }
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
            <Button variant="secondary" size="sm" onClick={() => setShowDupes(true)}>
              <Copy size={13} /> Find Duplicates
            </Button>
            <Button variant="secondary" size="sm" loading={importing} onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> Import CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowAddLead(true)}>
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

      {/* ── Add Lead Modal ────────────────────────────────────────────────────── */}
      {showAddLead && <AddLeadModal onClose={() => setShowAddLead(false)} onSaved={(lead) => { setShowAddLead(false); load().then(() => setSelected(lead)) }} />}

      {/* ── Duplicate Leads Modal ─────────────────────────────────────────────── */}
      {showDupes && <DuplicatesModal onClose={() => setShowDupes(false)} onMerged={() => load()} />}
    </div>
  )
}

// ─── Duplicate Leads Modal ────────────────────────────────────────────────────
// Surfaces duplicate groups (same phone, or same name+address when phone-less) and
// lets the operator collapse each group down to ONE canonical lead. Read-only until
// the operator clicks Merge; merging re-homes all child rows server-side then deletes
// the copies. Additive — touches no existing modal or row.
function DuplicatesModal({ onClose, onMerged }) {
  const [loading, setLoading] = useState(true)
  const [groups, setGroups]   = useState([])
  const [summary, setSummary] = useState({ group_count: 0, duplicate_leads: 0 })
  const [merging, setMerging] = useState(false)
  const [done, setDone]       = useState(false)

  const fetchDupes = async () => {
    setLoading(true)
    try {
      const r = await leads.findDuplicates()
      const d = r.data || {}
      setGroups(Array.isArray(d.groups) ? d.groups : [])
      setSummary({ group_count: d.group_count || 0, duplicate_leads: d.duplicate_leads || 0 })
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not scan for duplicates')
      setGroups([])
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchDupes() }, [])

  const leadLabel = (l) => {
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim()
    return name || l.phone || l.property_address || 'Unnamed lead'
  }

  const mergeOne = async (g) => {
    setMerging(true)
    try {
      await leads.mergeDuplicates({ canonical_id: g.canonical_id, merge_ids: g.merge_ids })
      toast.success(`Merged ${g.merge_ids.length + 1} → 1`)
      setGroups(prev => prev.filter(x => x.key !== g.key))
      onMerged?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Merge failed')
    } finally { setMerging(false) }
  }

  const mergeAll = async () => {
    if (!groups.length) return
    setMerging(true)
    try {
      const payload = { groups: groups.map(g => ({ canonical_id: g.canonical_id, merge_ids: g.merge_ids })) }
      const r = await leads.mergeDuplicates(payload)
      const removed = r.data?.merged_leads ?? 0
      toast.success(`Cleaned up ${removed} duplicate${removed === 1 ? '' : 's'}`)
      setGroups([])
      setDone(true)
      onMerged?.()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Merge failed')
    } finally { setMerging(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Copy size={16} /> Duplicate Leads
            </h2>
            <p style={{ fontSize: 12, color: 'var(--t4)', marginTop: 3 }}>
              {loading ? 'Scanning…'
                : summary.group_count === 0 ? 'No duplicates found — your list is clean.'
                : `${summary.group_count} group${summary.group_count === 1 ? '' : 's'} · ${summary.duplicate_leads} extra row${summary.duplicate_leads === 1 ? '' : 's'} to merge away`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: 4 }}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--t4)', fontSize: 13, padding: '40px 0' }}>Scanning your leads…</div>
          )}

          {!loading && groups.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--t4)', fontSize: 13, padding: '40px 0' }}>
              {done ? 'All duplicates merged.' : 'Nothing to merge — no duplicate leads detected.'}
            </div>
          )}

          {!loading && groups.map(g => {
            const canonical = g.canonical || g.members?.find(m => m.id === g.canonical_id)
            const copies = (g.members || []).filter(m => m.id !== g.canonical_id)
            return (
              <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'var(--surface-bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Matched on {g.match_on === 'phone' ? 'phone number' : 'name + address'} · {g.count} copies
                  </span>
                  <Button variant="primary" size="sm" loading={merging} onClick={() => mergeOne(g)}>
                    <GitMerge size={12} /> Merge {g.count} → 1
                  </Button>
                </div>

                {/* Canonical survivor */}
                {canonical && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, background: 'rgba(0,195,122,0.08)', marginBottom: 4 }}>
                    <Badge color="green">Keep</Badge>
                    <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{leadLabel(canonical)}</span>
                    <span style={{ fontSize: 11, color: 'var(--t4)', marginLeft: 'auto' }}>{canonical.phone || '—'}</span>
                  </div>
                )}

                {/* Copies that get folded in */}
                {copies.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, opacity: 0.6 }}>
                    <Badge color="red">Merge</Badge>
                    <span style={{ fontSize: 13, color: 'var(--t2)' }}>{leadLabel(c)}</span>
                    <span style={{ fontSize: 11, color: 'var(--t4)', marginLeft: 'auto' }}>{c.phone || '—'}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {!loading && groups.length > 0 && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--t4)' }}>Keeps the most complete record · re-links calls, texts & deals</span>
            <Button variant="primary" size="sm" loading={merging} onClick={mergeAll}>
              <GitMerge size={13} /> Merge All ({summary.duplicate_leads})
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Add Lead Modal ───────────────────────────────────────────────────────────
function AddLeadModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', property_address: '', property_city: '', property_state: '', property_zip: '' })
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!form.first_name || !form.phone) { toast.error('First name and phone are required'); return }
    setSaving(true)
    try {
      const { data } = await leads.createLead(form)
      toast.success('Lead added')
      onSaved(data?.lead || data?.data || form)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add lead')
    } finally { setSaving(false) }
  }

  const inp = {
    width: '100%', padding: '9px 12px', background: 'var(--input-bg)',
    border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 13,
    color: 'var(--input-text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}>
      <div style={{ width: 480, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>Add New Lead</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: 0 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>FIRST NAME *</label>
              <input style={inp} value={form.first_name} onChange={set('first_name')} placeholder="John" autoFocus />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>LAST NAME</label>
              <input style={inp} value={form.last_name} onChange={set('last_name')} placeholder="Smith" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>PHONE *</label>
              <input style={inp} value={form.phone} onChange={set('phone')} placeholder="+1 (704) 555-0000" type="tel" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>EMAIL</label>
              <input style={inp} value={form.email} onChange={set('email')} placeholder="john@email.com" type="email" />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>PROPERTY ADDRESS</label>
            <input style={inp} value={form.property_address} onChange={set('property_address')} placeholder="123 Main St" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>CITY</label>
              <input style={inp} value={form.property_city} onChange={set('property_city')} placeholder="Charlotte" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>STATE</label>
              <input style={inp} value={form.property_state} onChange={set('property_state')} placeholder="NC" maxLength={2} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--t4)', marginBottom: 5, fontWeight: 600, letterSpacing: '0.06em' }}>ZIP</label>
              <input style={inp} value={form.property_zip} onChange={set('property_zip')} placeholder="28202" />
            </div>
          </div>
        </div>
        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--surface-bg)', border: '1px solid var(--border)', color: 'var(--t3)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} style={{ padding: '9px 22px', borderRadius: 8, background: '#00C37A', border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : 'Add Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
