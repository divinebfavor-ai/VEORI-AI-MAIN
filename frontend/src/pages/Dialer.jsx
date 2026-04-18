import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, Search, Mic, MicOff, Clock, Star, AlertCircle, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { leads as leadsApi, calls as callsApi, phones as phonesApi } from '../services/api'

const OUTCOMES = [
  { value: 'not_home',           label: 'No Answer / VM',  color: 'gray'  },
  { value: 'not_interested',     label: 'Not Interested',  color: 'red'   },
  { value: 'callback_requested', label: 'Callback',        color: 'amber' },
  { value: 'appointment',        label: 'Appointment Set', color: 'green' },
  { value: 'offer_made',         label: 'Offer Made',      color: 'gold'  },
  { value: 'verbal_yes',         label: 'Verbal Yes!',     color: 'green' },
]

function scoreColor(s) {
  if (s == null) return 'text-text-muted'
  if (s >= 70) return 'text-primary'
  if (s >= 40) return 'text-warning'
  return 'text-danger'
}

function MotivationBar({ score }) {
  const pct = Math.min(100, Math.max(0, score || 0))
  const color = pct >= 70 ? 'bg-primary' : pct >= 40 ? 'bg-warning' : 'bg-danger'
  return (
    <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function Dialer() {
  const [searchQ,       setSearchQ]     = useState('')
  const [searchResults, setResults]     = useState([])
  const [searching,     setSearching]   = useState(false)
  const [selectedLead,  setLead]        = useState(null)
  const [phones,        setPhones]      = useState([])
  const [selectedPhone, setPhone]       = useState('')
  const [callState,     setCallState]   = useState('idle') // idle | ringing | active | ended
  const [callId,        setCallId]      = useState(null)
  const [transcript,    setTranscript]  = useState([])
  const [score,         setScore]       = useState(null)
  const [duration,      setDuration]    = useState(0)
  const [outcome,       setOutcome]     = useState('')
  const [notes,         setNotes]       = useState('')
  const [saving,        setSaving]      = useState(false)
  const pollRef   = useRef(null)
  const timerRef  = useRef(null)
  const transcriptEndRef = useRef(null)

  // Load phone numbers
  useEffect(() => {
    phonesApi.getPhones().then(r => {
      const raw = r.data?.numbers ?? r.data?.data ?? r.data
      const list = Array.isArray(raw) ? raw : []
      setPhones(list)
      if (list.length > 0) setPhone(list[0].id)
    }).catch(() => {})
  }, [])

  // Search leads
  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await leadsApi.getLeads({ search: searchQ, limit: 8 })
        const raw = r.data?.leads ?? r.data?.data ?? r.data
        setResults(Array.isArray(raw) ? raw : [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQ])

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  const startTimer = useCallback(() => {
    setDuration(0)
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const startPolling = useCallback((cid) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await callsApi.getCall(cid)
        const call = r.data?.data || r.data
        if (!call) return

        // Update transcript
        if (call.transcript) {
          const lines = call.transcript.split('\n').filter(Boolean).map(line => {
            const isAlex = line.startsWith('Alex:')
            return { speaker: isAlex ? 'alex' : 'seller', text: line.replace(/^(Alex:|Seller:)\s*/, '') }
          })
          setTranscript(lines)
        }

        // Update score
        if (call.motivation_score != null) setScore(call.motivation_score)

        // Call ended?
        if (call.status === 'ended' || call.status === 'completed') {
          clearInterval(pollRef.current)
          stopTimer()
          setCallState('ended')
          if (call.outcome) setOutcome(call.outcome)
        }
      } catch {}
    }, 2500)
  }, [stopTimer])

  const dial = async () => {
    if (!selectedLead) { toast.error('Select a lead first'); return }
    setCallState('ringing')
    setTranscript([])
    setScore(null)
    setDuration(0)
    setOutcome('')
    setNotes('')
    try {
      const r = await callsApi.initiateCall({ lead_id: selectedLead.id, phone_number_id: selectedPhone || undefined })
      const call = r.data?.call || r.data?.data || r.data
      const cid = call?.id || call?.call_id
      setCallId(cid)
      setCallState('active')
      startTimer()
      startPolling(cid)
      toast.success('Call initiated')
    } catch (err) {
      setCallState('idle')
      toast.error(err.response?.data?.error || 'Failed to initiate call')
    }
  }

  const endCall = async () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    stopTimer()
    setCallState('ended')
    if (callId) {
      callsApi.endCall?.(callId).catch(() => {})
    }
  }

  const saveOutcome = async () => {
    if (!outcome) { toast.error('Select a call outcome'); return }
    setSaving(true)
    try {
      if (callId) {
        await callsApi.updateCall?.(callId, { outcome, notes, motivation_score: score })
      }
      if (selectedLead?.id) {
        await leadsApi.updateLead(selectedLead.id, {
          status: outcomeToStatus(outcome),
          last_call_date: new Date().toISOString(),
        })
      }
      toast.success('Call saved')
      setCallState('idle')
      setCallId(null)
      setTranscript([])
      setScore(null)
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    stopTimer()
    setCallState('idle')
    setCallId(null)
    setTranscript([])
    setScore(null)
    setOutcome('')
    setNotes('')
  }

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="p-8 max-w-[1100px] mx-auto">
      <div className="mb-8">
        <h1 className="text-[28px] font-medium text-white">Manual Dialer</h1>
        <p className="text-[13px] text-text-muted mt-1">Call a lead directly — AI transcription and scoring in real time</p>
      </div>

      <div className="grid grid-cols-[380px,1fr] gap-6">
        {/* ── Left panel ── */}
        <div className="space-y-4">
          {/* Lead search */}
          <div className="bg-card border border-border-subtle rounded-lg p-5">
            <h2 className="text-[13px] font-semibold text-white mb-3">Select Lead</h2>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search by name or address…"
                disabled={callState !== 'idle'}
                className="w-full h-[38px] bg-surface border border-border-subtle rounded-[6px] pl-8 pr-3 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary disabled:opacity-50"
              />
            </div>

            {searching && <p className="text-[12px] text-text-muted text-center py-2">Searching…</p>}

            {searchResults.length > 0 && !selectedLead && (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {searchResults.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => { setLead(lead); setSearchQ(''); setResults([]) }}
                    className="w-full text-left p-2.5 rounded-[6px] hover:bg-elevated transition-colors group"
                  >
                    <p className="text-[13px] font-medium text-text-primary group-hover:text-white">
                      {lead.first_name} {lead.last_name}
                    </p>
                    <p className="text-[11px] text-text-muted truncate">{lead.property_address}</p>
                    {lead.phone && <p className="text-[11px] text-text-muted">{lead.phone}</p>}
                  </button>
                ))}
              </div>
            )}

            {selectedLead && (
              <div className="bg-elevated border border-border-default rounded-[6px] p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-white">
                      {selectedLead.first_name} {selectedLead.last_name}
                    </p>
                    <p className="text-[12px] text-text-muted truncate">{selectedLead.property_address}</p>
                    <p className="text-[12px] text-primary font-mono mt-1">{selectedLead.phone}</p>
                  </div>
                  {callState === 'idle' && (
                    <button onClick={() => setLead(null)} className="text-text-muted hover:text-text-primary text-[11px] ml-2">✕</button>
                  )}
                </div>
                {selectedLead.motivation_score != null && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="label-caps">Score</span>
                    <span className={`text-[13px] font-bold ${scoreColor(selectedLead.motivation_score)}`}>
                      {selectedLead.motivation_score}
                    </span>
                  </div>
                )}
                {selectedLead.is_on_dnc && (
                  <div className="mt-2 flex items-center gap-1.5 text-danger">
                    <AlertCircle size={12} />
                    <span className="text-[11px] font-medium">On DNC list — cannot call</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Phone number selector */}
          <div className="bg-card border border-border-subtle rounded-lg p-5">
            <h2 className="text-[13px] font-semibold text-white mb-3">Caller ID</h2>
            {phones.length === 0 ? (
              <p className="text-[12px] text-text-muted">No phone numbers configured</p>
            ) : (
              <select
                value={selectedPhone}
                onChange={e => setPhone(e.target.value)}
                disabled={callState !== 'idle'}
                className="w-full h-[38px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary disabled:opacity-50"
              >
                {phones.map(p => (
                  <option key={p.id} value={p.id}>{p.number} {p.health_status === 'healthy' ? '✅' : '⚠️'}</option>
                ))}
              </select>
            )}
          </div>

          {/* Call control */}
          <div className="bg-card border border-border-subtle rounded-lg p-5">
            {callState === 'idle' && (
              <Button
                className="w-full"
                onClick={dial}
                disabled={!selectedLead || selectedLead?.is_on_dnc}
              >
                <Phone size={15} /> Dial Now
              </Button>
            )}

            {callState === 'ringing' && (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-3 animate-pulse">
                  <Phone size={20} className="text-primary" />
                </div>
                <p className="text-[14px] text-text-primary font-medium">Ringing…</p>
                <p className="text-[12px] text-text-muted mt-1">{selectedLead?.first_name} {selectedLead?.last_name}</p>
                <button onClick={endCall} className="mt-4 text-[12px] text-danger hover:underline">Cancel</button>
              </div>
            )}

            {callState === 'active' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-[13px] text-primary font-medium">LIVE</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-text-muted">
                    <Clock size={12} />
                    <span className="text-[13px] font-mono">{fmt(duration)}</span>
                  </div>
                </div>
                {score != null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="label-caps">Motivation</span>
                      <span className={`text-[15px] font-bold ${scoreColor(score)}`}>{score}</span>
                    </div>
                    <MotivationBar score={score} />
                  </div>
                )}
                <Button variant="danger" className="w-full" onClick={endCall}>
                  <PhoneOff size={14} /> End Call
                </Button>
              </div>
            )}

            {callState === 'ended' && (
              <div className="space-y-3">
                <p className="text-[13px] text-text-secondary font-medium">Call ended · {fmt(duration)}</p>
                <div>
                  <label className="label-caps block mb-2">Outcome</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {OUTCOMES.map(o => (
                      <button
                        key={o.value}
                        onClick={() => setOutcome(o.value)}
                        className={`text-[11px] px-2 py-1.5 rounded-[4px] border text-left transition-colors ${
                          outcome === o.value
                            ? 'border-primary bg-primary/10 text-white'
                            : 'border-border-subtle text-text-muted hover:border-primary/40'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label-caps block mb-1.5">Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Key points, next steps…"
                    className="w-full bg-surface border border-border-subtle rounded-[6px] px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={reset}>Discard</Button>
                  <Button className="flex-1" loading={saving} onClick={saveOutcome}>Save</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: Live transcript ── */}
        <div className="bg-card border border-border-subtle rounded-lg flex flex-col" style={{ minHeight: '500px' }}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle flex-shrink-0">
            <h2 className="text-[13px] font-semibold text-white">Live Transcript</h2>
            {callState === 'active' && (
              <div className="flex items-center gap-1.5 text-primary text-[11px]">
                <Mic size={12} className="animate-pulse" />
                AI transcribing
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {transcript.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center py-16">
                {callState === 'idle' ? (
                  <>
                    <Mic size={32} className="text-text-muted mb-3" strokeWidth={1.5} />
                    <p className="text-[14px] text-text-muted">Transcript will appear here</p>
                    <p className="text-[12px] text-text-muted mt-1">Select a lead and dial to begin</p>
                  </>
                ) : (
                  <p className="text-[13px] text-text-muted">Waiting for conversation to begin…</p>
                )}
              </div>
            )}

            {transcript.map((line, i) => (
              <div key={i} className={`flex ${line.speaker === 'alex' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-[13px] ${
                  line.speaker === 'alex'
                    ? 'bg-primary/10 border border-primary/20 text-text-primary rounded-br-sm'
                    : 'bg-elevated border border-border-default text-text-primary rounded-bl-sm'
                }`}>
                  <p className={`text-[10px] font-semibold mb-1 ${line.speaker === 'alex' ? 'text-primary' : 'text-text-muted'}`}>
                    {line.speaker === 'alex' ? 'ALEX' : (selectedLead ? `${selectedLead.first_name?.toUpperCase()} (SELLER)` : 'SELLER')}
                  </p>
                  <p className="leading-relaxed">{line.text}</p>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function outcomeToStatus(outcome) {
  const m = {
    not_home: 'new', not_interested: 'contacted', callback_requested: 'contacted',
    appointment: 'appointment_set', offer_made: 'offer_made', verbal_yes: 'under_contract',
  }
  return m[outcome] || 'contacted'
}
