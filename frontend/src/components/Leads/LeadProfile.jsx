import React, { useState, useEffect } from 'react'
import {
  X, Phone, MapPin, Copy, Check, Flame, Ban, Calendar, Plus,
  MessageSquare, PhoneCall, Image as ImageIcon, FileText, Activity, UserCheck,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { leads as leadsApi } from '../../services/api'

function scoreBadgeVariant(score) {
  if (score == null) return 'gray'
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  return 'gray'
}

function scoreRingColor(score) {
  if (score == null) return '#475569'
  if (score >= 85) return '#F97316'
  if (score >= 70) return '#10B981'
  if (score >= 40) return '#F59E0B'
  return '#475569'
}

const TABS = ['Timeline', 'Overview', 'Call History', 'Transcripts', 'Offers', 'Notes']

// One visual style per timeline event type — the unified seller "chat".
const EVENT_STYLE = {
  sms_out:  { icon: MessageSquare, color: '#3B82F6', label: 'Text sent' },
  sms_in:   { icon: MessageSquare, color: '#10B981', label: 'Text received' },
  call:     { icon: PhoneCall,     color: '#8B5CF6', label: 'Call' },
  photo:    { icon: ImageIcon,     color: '#F59E0B', label: 'Photo' },
  document: { icon: FileText,      color: '#06B6D4', label: 'Document' },
  activity: { icon: Activity,      color: '#64748B', label: 'Activity' },
}

export default function LeadProfile({ lead, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState('Timeline')
  const [notes, setNotes] = useState(lead?.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expandedCall, setExpandedCall] = useState(null)

  // Unified timeline — every text, call, photo, document, and the assigned buyer.
  const [timeline, setTimeline] = useState([])
  const [tlCounts, setTlCounts] = useState(null)
  const [tlLoading, setTlLoading] = useState(false)
  const [tlError, setTlError] = useState(false)
  const [tlLoadedFor, setTlLoadedFor] = useState(null)
  const [expandedEvent, setExpandedEvent] = useState(null)

  useEffect(() => {
    setNotes(lead?.notes || '')
    // Reset timeline cache when switching to a different lead.
    setTimeline([])
    setTlCounts(null)
    setTlError(false)
    setTlLoadedFor(null)
    setExpandedEvent(null)
  }, [lead?.id])

  // Lazy-load the timeline the first time the tab is opened for this lead.
  useEffect(() => {
    if (activeTab !== 'Timeline' || !lead?.id) return
    if (tlLoadedFor === lead.id || tlLoading) return
    let cancelled = false
    setTlLoading(true)
    setTlError(false)
    leadsApi.getLeadTimeline(lead.id)
      .then((res) => {
        if (cancelled) return
        const data = res?.data || res || {}
        setTimeline(Array.isArray(data.timeline) ? data.timeline : [])
        setTlCounts(data.counts || null)
        setTlLoadedFor(lead.id)
      })
      .catch(() => { if (!cancelled) setTlError(true) })
      .finally(() => { if (!cancelled) setTlLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, lead?.id, tlLoadedFor, tlLoading])

  // Most-recent buyer assignment pulled from the activity lane (meta.buyer_name).
  const assignedBuyer = timeline.find(
    (e) => e.type === 'activity' && e.title === 'buyer_assigned'
  )?.meta?.buyer_name || null

  if (!lead) return null

  const copyPhone = () => {
    navigator.clipboard.writeText(lead.phone || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Phone copied!')
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await leadsApi.updateLead(lead.id, { notes })
      toast.success('Notes saved')
      onUpdate?.({ ...lead, notes })
    } catch {
      toast.error('Failed to save notes')
    } finally {
      setSavingNotes(false)
    }
  }

  const markHot = async () => {
    try {
      await leadsApi.updateLead(lead.id, { score: 90, status: 'interested' })
      toast.success('Lead marked as hot!')
      onUpdate?.({ ...lead, score: 90 })
    } catch {
      toast.error('Failed to update lead')
    }
  }

  const flagDNC = async () => {
    if (!window.confirm('Add this lead to Do Not Call list?')) return
    try {
      await leadsApi.addToDNC(lead.id, 'Manually flagged')
      toast.success('Added to DNC list')
      onUpdate?.({ ...lead, dnc: true, status: 'dnc' })
    } catch {
      toast.error('Failed to add to DNC')
    }
  }

  const calls = lead.calls || lead.call_history || []
  const score = lead.motivation_score ?? lead.score

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="w-[420px] bg-surface border-l border-border-subtle flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-text-primary truncate">
                {lead.first_name} {lead.last_name}
              </h2>
              <button
                onClick={copyPhone}
                className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary mt-1 transition-colors"
              >
                <Phone size={13} />
                {lead.phone || '-'}
                {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              </button>
              {lead.address && (
                <div className="flex items-center gap-1.5 text-xs text-text-muted mt-1">
                  <MapPin size={12} />
                  {lead.address}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors ml-3 flex-shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Score ring */}
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex items-center justify-center">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="#1E2D45" strokeWidth="6" />
                <circle
                  cx="32" cy="32" r="28"
                  fill="none"
                  stroke={scoreRingColor(score)}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${(score || 0) * 1.759} 175.9`}
                  strokeDashoffset="0"
                  transform="rotate(-90 32 32)"
                />
              </svg>
              <span className="absolute text-lg font-black text-text-primary">{score ?? '?'}</span>
            </div>
            <div>
              <div className="text-xs text-text-muted mb-1">Motivation Score</div>
              <Badge variant={lead.dnc ? 'red' : scoreBadgeVariant(score)}>
                {lead.dnc ? 'DNC' : score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold'}
              </Badge>
              <div className="text-xs text-text-muted mt-1">
                {lead.status && `Status: ${lead.status}`}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="secondary" onClick={() => {}}>
              <Plus size={13} /> Campaign
            </Button>
            <Button size="sm" variant="secondary" onClick={() => {}}>
              <Calendar size={13} /> Callback
            </Button>
            <Button size="sm" variant="warning" onClick={markHot}>
              <Flame size={13} /> Hot
            </Button>
            <Button size="sm" variant="danger" onClick={flagDNC}>
              <Ban size={13} /> DNC
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'text-primary border-primary'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'Timeline' && (
            <div className="space-y-4">
              {/* Assigned-buyer banner — WHO this deal is going to, always on top. */}
              {assignedBuyer && (
                <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2.5">
                  <UserCheck size={16} className="text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-text-muted">Assigned to buyer</div>
                    <div className="text-sm font-semibold text-text-primary truncate">{assignedBuyer}</div>
                  </div>
                </div>
              )}

              {/* Count chips — one glance at the whole relationship. */}
              {tlCounts && (
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { k: 'texts', label: 'Texts' },
                    { k: 'calls', label: 'Calls' },
                    { k: 'photos', label: 'Photos' },
                    { k: 'documents', label: 'Docs' },
                    { k: 'activity', label: 'Events' },
                  ].map(({ k, label }) => (
                    <span key={k} className="text-xs px-2 py-1 rounded-md bg-elevated text-text-secondary">
                      {label}: <span className="text-text-primary font-medium">{tlCounts[k] ?? 0}</span>
                    </span>
                  ))}
                </div>
              )}

              {tlLoading && (
                <div className="text-center py-8 text-text-muted text-sm">Loading timeline…</div>
              )}
              {tlError && !tlLoading && (
                <div className="text-center py-8 text-danger text-sm">Couldn't load the timeline. Try reopening this tab.</div>
              )}
              {!tlLoading && !tlError && timeline.length === 0 && (
                <div className="text-center py-8 text-text-muted text-sm">No activity yet for this lead.</div>
              )}

              {/* The chronological feed — newest first. */}
              {!tlLoading && timeline.length > 0 && (
                <div className="space-y-2">
                  {timeline.map((ev, i) => {
                    const style = EVENT_STYLE[ev.type] || EVENT_STYLE.activity
                    const Icon = style.icon
                    const transcript = ev.meta?.transcript
                    const photoUrl = ev.type === 'photo' ? ev.meta?.url : null
                    const expandable = !!transcript
                    const isOpen = expandedEvent === i
                    return (
                      <div key={i} className="flex gap-3">
                        {/* Rail */}
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: `${style.color}22` }}
                          >
                            <Icon size={14} style={{ color: style.color }} />
                          </div>
                          {i < timeline.length - 1 && (
                            <div className="w-px flex-1 bg-border-subtle mt-1" style={{ minHeight: 12 }} />
                          )}
                        </div>

                        {/* Card */}
                        <div className="flex-1 min-w-0 bg-elevated rounded-lg p-3 mb-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium text-text-primary truncate">{ev.title}</div>
                            <div className="text-xs text-text-muted flex-shrink-0">
                              {ev.at ? formatDistanceToNow(new Date(ev.at), { addSuffix: true }) : ''}
                            </div>
                          </div>

                          {ev.body && (
                            <div className="text-xs text-text-secondary leading-relaxed mt-1 whitespace-pre-wrap break-words">
                              {ev.body}
                            </div>
                          )}

                          {photoUrl && (
                            <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="block mt-2">
                              <img
                                src={photoUrl}
                                alt={ev.meta?.file_name || 'Seller photo'}
                                className="rounded-md max-h-40 w-auto object-cover border border-border-subtle"
                                loading="lazy"
                              />
                            </a>
                          )}

                          {ev.type === 'call' && ev.meta?.minutes != null && (
                            <div className="text-xs text-text-muted mt-1">
                              {ev.meta.minutes}m
                              {ev.meta.motivation_score != null ? ` · score ${ev.meta.motivation_score}` : ''}
                            </div>
                          )}

                          {expandable && (
                            <>
                              <button
                                onClick={() => setExpandedEvent(isOpen ? null : i)}
                                className="text-xs text-primary hover:underline mt-2"
                              >
                                {isOpen ? 'Hide transcript' : 'View transcript'}
                              </button>
                              {isOpen && (
                                <div className="text-xs text-text-secondary leading-relaxed mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-border-subtle pt-2">
                                  {transcript}
                                </div>
                              )}
                            </>
                          )}

                          {ev.meta?.status && ev.type !== 'call' && (
                            <div className="text-[10px] text-text-muted mt-1 uppercase tracking-wide">
                              {ev.meta.status}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'Overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Email', value: lead.email },
                  { label: 'State', value: lead.state },
                  { label: 'City', value: lead.city },
                  { label: 'Zip', value: lead.zip },
                  { label: 'Property Type', value: lead.property_type },
                  { label: 'Bedrooms', value: lead.bedrooms },
                  { label: 'ARV', value: lead.arv ? `$${Number(lead.arv).toLocaleString()}` : null },
                  { label: 'Asking Price', value: lead.asking_price ? `$${Number(lead.asking_price).toLocaleString()}` : null },
                  { label: 'Source', value: lead.source },
                  { label: 'Imported', value: lead.created_at ? format(new Date(lead.created_at), 'MMM d, yyyy') : null },
                ].map(({ label, value }) => value ? (
                  <div key={label} className="bg-elevated rounded-lg p-3">
                    <div className="text-xs text-text-muted mb-1">{label}</div>
                    <div className="text-sm text-text-primary font-medium">{value}</div>
                  </div>
                ) : null)}
              </div>

              {lead.motivation_reason && (
                <div className="bg-elevated rounded-lg p-3">
                  <div className="text-xs text-text-muted mb-1">Motivation Reason</div>
                  <div className="text-sm text-text-primary">{lead.motivation_reason}</div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'Call History' && (
            <div className="space-y-3">
              {calls.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">No calls yet</div>
              ) : (
                calls.map((call, i) => (
                  <div key={i} className="bg-elevated rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-card transition-colors text-left"
                      onClick={() => setExpandedCall(expandedCall === i ? null : i)}
                    >
                      <div>
                        <div className="text-sm text-text-primary font-medium">
                          {call.created_at
                            ? format(new Date(call.created_at), 'MMM d, yyyy h:mm a')
                            : 'Unknown date'}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                          {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '-'}
                        </div>
                      </div>
                      <Badge variant={scoreBadgeVariant(call.score)}>
                        {call.outcome || 'Called'}
                      </Badge>
                    </button>
                    {expandedCall === i && call.transcript && (
                      <div className="px-3 pb-3 border-t border-border-subtle">
                        <div className="text-xs text-text-muted mt-2 mb-1">Transcript</div>
                        <div className="text-xs text-text-secondary leading-relaxed max-h-40 overflow-y-auto">
                          {call.transcript}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'Transcripts' && (
            <div className="space-y-4">
              {calls.filter(c => c.transcript).length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">No transcripts available</div>
              ) : (
                calls.filter(c => c.transcript).map((call, i) => (
                  <div key={i} className="bg-elevated rounded-lg p-3">
                    <div className="text-xs text-text-muted mb-3">
                      {call.created_at ? format(new Date(call.created_at), 'MMM d, yyyy h:mm a') : 'Call'}
                    </div>
                    <div className="space-y-2">
                      {(call.transcript_lines || [{ speaker: 'System', text: call.transcript }]).map((line, j) => (
                        <div key={j} className="text-xs leading-relaxed">
                          <span className={`font-semibold mr-1 ${line.speaker === 'AI' || line.speaker === 'Alex' ? 'text-primary' : 'text-text-primary'}`}>
                            {line.speaker}:
                          </span>
                          <span className="text-text-secondary">{line.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'Offers' && (
            <div className="space-y-3">
              {(lead.offers || []).length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">No offers made yet</div>
              ) : (
                (lead.offers || []).map((offer, i) => (
                  <div key={i} className="bg-elevated rounded-lg p-4">
                    <div className="text-2xl font-bold text-text-primary">
                      ${Number(offer.amount).toLocaleString()}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {offer.date ? format(new Date(offer.date), 'MMM d, yyyy') : ''}
                    </div>
                    <Badge variant={offer.accepted ? 'green' : offer.rejected ? 'red' : 'yellow'} className="mt-2">
                      {offer.accepted ? 'Accepted' : offer.rejected ? 'Rejected' : 'Pending'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'Notes' && (
            <div className="space-y-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this lead..."
                className="w-full h-48 bg-elevated border border-border-default rounded-lg p-3 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
              <Button onClick={saveNotes} loading={savingNotes} size="sm">
                Save Notes
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
