import React, { useState, useEffect } from 'react'
import { X, Phone, MapPin, Copy, Check, Flame, Ban, Calendar, Plus } from 'lucide-react'
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

const TABS = ['Overview', 'Call History', 'Transcripts', 'Offers', 'Notes']

export default function LeadProfile({ lead, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState('Overview')
  const [notes, setNotes] = useState(lead?.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expandedCall, setExpandedCall] = useState(null)

  useEffect(() => {
    setNotes(lead?.notes || '')
  }, [lead?.id])

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
                {lead.phone || '—'}
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
                          {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '—'}
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
