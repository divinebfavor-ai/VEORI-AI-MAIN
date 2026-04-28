import React, { useState, useEffect, useCallback } from 'react'
import { Phone, Mail, MessageSquare, CheckCircle2, Clock, Calendar, Building2, User, RefreshCw, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { followUps } from '../services/api'

const TYPE_META = {
  call:      { icon: Phone,          label: 'Call',   color: '#00C37A', bg: 'rgba(0,195,122,0.1)' },
  email:     { icon: Mail,           label: 'Email',  color: '#4C9EFF', bg: 'rgba(76,158,255,0.1)' },
  sms:       { icon: MessageSquare,  label: 'SMS',    color: '#C9A84C', bg: 'rgba(201,168,76,0.1)' },
  text:      { icon: MessageSquare,  label: 'Text',   color: '#C9A84C', bg: 'rgba(201,168,76,0.1)' },
  default:   { icon: Clock,          label: 'Task',   color: 'rgba(255,255,255,0.5)', bg: 'rgba(255,255,255,0.06)' },
}

const CONTACT_META = {
  title_company: { icon: Building2, label: 'Title Co.' },
  seller:        { icon: User,      label: 'Seller'    },
  buyer:         { icon: User,      label: 'Buyer'     },
}

function urgencyLevel(dateStr) {
  if (!dateStr) return 'normal'
  const diff = new Date(dateStr) - Date.now()
  if (diff < 0) return 'overdue'
  if (diff < 86400000) return 'today'
  if (diff < 3 * 86400000) return 'soon'
  return 'normal'
}

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  const now = new Date()
  const diff = d - now
  const abs = Math.abs(diff)

  if (abs < 60000) return 'Just now'
  if (abs < 3600000) return `${Math.round(abs / 60000)}m ${diff < 0 ? 'ago' : ''}`
  if (abs < 86400000) {
    const h = Math.round(abs / 3600000)
    return diff < 0 ? `${h}h ago` : `In ${h}h`
  }
  const days = Math.round(abs / 86400000)
  if (days === 1) return diff < 0 ? 'Yesterday' : 'Tomorrow'
  if (days < 7) return diff < 0 ? `${days}d ago` : `In ${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const URGENCY_STYLES = {
  overdue: 'border-danger/40 bg-danger/[0.04]',
  today:   'border-gold/40 bg-gold/[0.04]',
  soon:    'border-border-subtle',
  normal:  'border-border-subtle',
}

const URGENCY_BADGE = {
  overdue: { label: 'Overdue', cls: 'bg-danger/10 text-danger' },
  today:   { label: 'Due Today', cls: 'bg-gold/10 text-gold' },
  soon:    { label: 'Soon', cls: 'bg-surface text-text-muted' },
  normal:  { label: null },
}

function FollowUpCard({ item, onComplete, onSnooze }) {
  const urgency = urgencyLevel(item.next_follow_up_at)
  const typeMeta = TYPE_META[item.follow_up_type] || TYPE_META.default
  const contactMeta = CONTACT_META[item.contact_type] || CONTACT_META.seller
  const TypeIcon = typeMeta.icon
  const ContactIcon = contactMeta.icon
  const badge = URGENCY_BADGE[urgency]
  const [completing, setCompleting] = useState(false)

  const handleComplete = async () => {
    setCompleting(true)
    try {
      await followUps.updateFollowUp(item.id, { status: 'completed', completed_at: new Date().toISOString() })
      toast.success('Marked complete')
      onComplete(item.id)
    } catch { toast.error('Failed to update') }
    finally { setCompleting(false) }
  }

  return (
    <div className={`bg-card border rounded-xl p-5 transition-all hover:border-border-default ${URGENCY_STYLES[urgency]}`}>
      <div className="flex items-start gap-4">
        {/* Type icon */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: typeMeta.bg }}>
          <TypeIcon size={15} style={{ color: typeMeta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row */}
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-[14px] font-medium text-text-primary leading-snug">{item.reason}</p>
            {badge.label && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 text-[11px] text-text-muted flex-wrap">
            <span className="flex items-center gap-1">
              <ContactIcon size={10} />
              {contactMeta.label}
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              {fmtDate(item.next_follow_up_at)}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-surface border border-border-subtle capitalize">
              {typeMeta.label}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleComplete}
            disabled={completing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[12px] font-medium transition-colors disabled:opacity-50"
          >
            <CheckCircle2 size={13} />
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

const FILTERS = [
  { label: 'All',      value: 'all'     },
  { label: 'Pending',  value: 'pending' },
  { label: 'Overdue',  value: 'overdue' },
  { label: 'Today',    value: 'today'   },
]

const STATUS_QUERY = {
  all:     undefined,
  pending: 'pending',
  overdue: 'pending',
  today:   'pending',
}

export default function FollowUps() {
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter]       = useState('all')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await followUps.getAll({ status: STATUS_QUERY[filter] })
      let data = res.data?.follow_ups || []

      // Client-side filter for overdue / today
      if (filter === 'overdue') {
        data = data.filter(i => urgencyLevel(i.next_follow_up_at) === 'overdue')
      } else if (filter === 'today') {
        data = data.filter(i => urgencyLevel(i.next_follow_up_at) === 'today')
      }

      setItems(data)
    } catch { setItems([]) }
    finally { setLoading(false); setRefreshing(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  const handleComplete = (id) => setItems(prev => prev.filter(i => i.id !== id))

  const overdue = items.filter(i => urgencyLevel(i.next_follow_up_at) === 'overdue').length
  const today   = items.filter(i => urgencyLevel(i.next_follow_up_at) === 'today').length

  // Group by urgency
  const ordered = [
    ...items.filter(i => urgencyLevel(i.next_follow_up_at) === 'overdue'),
    ...items.filter(i => urgencyLevel(i.next_follow_up_at) === 'today'),
    ...items.filter(i => urgencyLevel(i.next_follow_up_at) === 'soon'),
    ...items.filter(i => urgencyLevel(i.next_follow_up_at) === 'normal'),
  ]

  return (
    <div className="p-6 lg:p-8 max-w-[860px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary tracking-tight">Follow-Ups</h1>
          <p className="text-[13px] text-text-muted mt-1">
            {items.length} task{items.length !== 1 ? 's' : ''}
            {overdue > 0 && <span className="text-danger ml-2">· {overdue} overdue</span>}
            {today > 0 && <span className="text-gold ml-2">· {today} due today</span>}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-text-muted hover:text-text-secondary text-[12px] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-surface border border-border-subtle rounded-lg p-1 w-fit mb-6">
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
              filter === f.value
                ? 'bg-card text-text-primary shadow-sm border border-border-subtle'
                : 'text-text-muted hover:text-text-secondary'
            }`}>
            {f.label}
            {f.value === 'overdue' && overdue > 0 && (
              <span className="ml-1.5 text-[10px] bg-danger/15 text-danger px-1.5 py-0.5 rounded-full">{overdue}</span>
            )}
            {f.value === 'today' && today > 0 && (
              <span className="ml-1.5 text-[10px] bg-gold/15 text-gold px-1.5 py-0.5 rounded-full">{today}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-[88px] rounded-xl bg-card border border-border-subtle animate-pulse" />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-xl py-24 text-center">
          <CheckCircle2 size={36} className="text-primary mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-text-primary mb-1">All caught up</p>
          <p className="text-[13px] text-text-muted">
            {filter === 'all'
              ? 'No follow-ups scheduled. Move deals to under contract to auto-generate tasks.'
              : `No ${filter} follow-ups right now.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map(item => (
            <FollowUpCard key={item.id} item={item} onComplete={handleComplete} />
          ))}
        </div>
      )}
    </div>
  )
}
