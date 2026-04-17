import React, { useState, useEffect, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { X, Phone, FileText, Users, MapPin, Clock, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { deals } from '../services/api'

const COLUMNS = [
  { key: 'new', label: 'New', color: '#475569' },
  { key: 'calling', label: 'Calling', color: '#3B82F6' },
  { key: 'contacted', label: 'Contacted', color: '#F59E0B' },
  { key: 'offer_made', label: 'Offer Made', color: '#F97316' },
  { key: 'negotiating', label: 'Negotiating', color: '#8B5CF6' },
  { key: 'under_contract', label: 'Under Contract', color: '#10B981' },
  { key: 'buyer_search', label: 'Buyer Search', color: '#06B6D4' },
  { key: 'title', label: 'Title', color: '#EC4899' },
  { key: 'closed', label: 'Closed', color: '#10B981' },
]

function scoreBadgeVariant(score) {
  if (score == null) return 'gray'
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  return 'gray'
}

// Property Workspace Modal
function PropertyWorkspace({ deal, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState('Overview')
  const TABS = ['Overview', 'Calls', 'Offers', 'Contracts', 'Buyers', 'Title']

  if (!deal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-surface border border-border-subtle rounded-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              {deal.address || 'Property'}
            </h2>
            <p className="text-sm text-text-muted">{deal.seller_name || 'Unknown Seller'}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={scoreBadgeVariant(deal.score)}>{deal.score ?? '—'}</Badge>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-4">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'text-primary border-primary'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {activeTab === 'Overview' && (
            <>
              {/* Left — Property & Seller Details */}
              <div className="w-[30%] border-r border-border-subtle p-5 overflow-y-auto">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Property Info</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Address', value: deal.address },
                    { label: 'City', value: deal.city },
                    { label: 'State', value: deal.state },
                    { label: 'Zip', value: deal.zip },
                    { label: 'Type', value: deal.property_type },
                    { label: 'Bedrooms', value: deal.bedrooms },
                    { label: 'Bathrooms', value: deal.bathrooms },
                    { label: 'Sq Ft', value: deal.sqft ? `${Number(deal.sqft).toLocaleString()} sqft` : null },
                    { label: 'ARV', value: deal.arv ? `$${Number(deal.arv).toLocaleString()}` : null },
                    { label: 'MAO', value: deal.mao ? `$${Number(deal.mao).toLocaleString()}` : null },
                  ].filter(i => i.value).map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-text-muted">{label}</span>
                      <span className="text-text-primary font-medium text-right">{value}</span>
                    </div>
                  ))}
                </div>

                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 mt-5">Seller</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Name', value: deal.seller_name },
                    { label: 'Phone', value: deal.seller_phone },
                    { label: 'Email', value: deal.seller_email },
                    { label: 'Motivation', value: deal.motivation_reason },
                  ].filter(i => i.value).map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-text-muted">{label}</span>
                      <span className="text-text-primary font-medium text-right max-w-[160px] truncate">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Center — Timeline */}
              <div className="flex-1 border-r border-border-subtle p-5 overflow-y-auto">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Activity Timeline</h3>
                <div className="space-y-4">
                  {(deal.timeline || deal.activity || []).length === 0 ? (
                    <p className="text-text-muted text-sm text-center py-8">No activity yet</p>
                  ) : (
                    (deal.timeline || deal.activity || []).map((event, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 bg-elevated rounded-full flex items-center justify-center flex-shrink-0">
                            <ChevronRight size={14} className="text-primary" />
                          </div>
                          {i < (deal.timeline || []).length - 1 && (
                            <div className="w-px flex-1 bg-border-subtle mt-1" />
                          )}
                        </div>
                        <div className="pb-4">
                          <p className="text-sm text-text-primary font-medium">{event.description || event.title}</p>
                          <p className="text-xs text-text-muted mt-0.5">
                            {event.created_at
                              ? formatDistanceToNow(new Date(event.created_at), { addSuffix: true })
                              : ''}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right — Status & Actions */}
              <div className="w-[20%] p-5 overflow-y-auto">
                <div className="mb-5">
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Status</h3>
                  <Badge variant={scoreBadgeVariant(deal.score)} className="mb-2">
                    Score: {deal.score ?? '—'}
                  </Badge>
                  <p className="text-sm text-text-secondary capitalize">{deal.status || 'New'}</p>
                  {deal.days_in_stage != null && (
                    <p className="text-xs text-text-muted mt-1 flex items-center gap-1">
                      <Clock size={11} /> {deal.days_in_stage}d in stage
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Next Actions</h3>
                  <div className="space-y-2">
                    {(deal.next_actions || [
                      { label: 'Follow up call', done: false },
                      { label: 'Send offer', done: false },
                      { label: 'Property walkthrough', done: false },
                    ]).map((action, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={action.done}
                          onChange={() => {}}
                          className="rounded border-border-default"
                        />
                        <span className={action.done ? 'text-text-muted line-through' : 'text-text-secondary'}>
                          {action.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  <Button size="sm" variant="primary" className="w-full">
                    <FileText size={14} /> Generate Contract
                  </Button>
                  <Button size="sm" variant="secondary" className="w-full">
                    <Users size={14} /> Find Buyers
                  </Button>
                  <Button size="sm" variant="secondary" className="w-full">
                    <Phone size={14} /> Call Seller
                  </Button>
                </div>
              </div>
            </>
          )}

          {activeTab !== 'Overview' && (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <div className="text-center">
                <p className="font-medium">{activeTab}</p>
                <p className="text-sm mt-1">Coming soon</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Kanban Card
function DealCard({ deal, onDragStart, onClick }) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal)}
      onClick={() => onClick(deal)}
      className="bg-elevated border border-border-subtle rounded-lg p-3 cursor-pointer hover:border-primary/40 hover:bg-card transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 text-xs text-text-muted min-w-0">
          <MapPin size={11} className="flex-shrink-0" />
          <span className="truncate">{deal.address || 'Unknown address'}</span>
        </div>
        <Badge variant={scoreBadgeVariant(deal.score)} className="flex-shrink-0 text-xs">
          {deal.score ?? '—'}
        </Badge>
      </div>
      <p className="text-sm font-medium text-text-primary truncate mb-1">
        {deal.seller_name || 'Unknown Seller'}
      </p>
      {deal.offer_amount && (
        <p className="text-xs text-success font-medium">
          ${Number(deal.offer_amount).toLocaleString()}
        </p>
      )}
      <div className="flex items-center justify-between mt-2">
        {deal.days_in_stage != null && (
          <span className="text-xs text-text-muted flex items-center gap-1">
            <Clock size={10} /> {deal.days_in_stage}d
          </span>
        )}
        {deal.next_action && (
          <span className="text-xs text-primary truncate ml-1">{deal.next_action}</span>
        )}
      </div>
    </div>
  )
}

// Kanban Column
function KanbanColumn({ column, cards, onDrop, onDragStart, onCardClick }) {
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <div
      className={`flex-shrink-0 w-64 flex flex-col rounded-xl border transition-colors ${
        isDragOver ? 'border-primary/60 bg-primary/5' : 'border-border-subtle bg-card'
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop(column.key) }}
    >
      {/* Column Header */}
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: column.color }} />
          <span className="text-sm font-semibold text-text-primary">{column.label}</span>
        </div>
        <span className="text-xs font-bold text-text-muted bg-elevated rounded-full w-6 h-6 flex items-center justify-center">
          {cards.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-3 space-y-2 overflow-y-auto min-h-[120px] max-h-[calc(100vh-280px)]">
        {cards.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            onDragStart={onDragStart}
            onClick={onCardClick}
          />
        ))}
        {cards.length === 0 && (
          <div className="text-center py-6 text-text-muted text-xs">
            Drop deals here
          </div>
        )}
      </div>
    </div>
  )
}

export default function Pipeline() {
  const [allDeals, setAllDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(null)
  const [selectedDeal, setSelectedDeal] = useState(null)

  const fetchDeals = async () => {
    try {
      const res = await deals.getDeals()
      setAllDeals(res.data?.deals || res.data || [])
    } catch {
      toast.error('Failed to load pipeline')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDeals() }, [])

  const dealsByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.key] = allDeals.filter(d => {
      const s = (d.status || 'new').toLowerCase().replace(/\s+/g, '_')
      return s === col.key
    })
    return acc
  }, {})

  const handleDrop = async (targetStatus) => {
    if (!dragging) return
    const newStatus = targetStatus
    try {
      await deals.updateDeal(dragging.id, { status: newStatus })
      setAllDeals(prev =>
        prev.map(d => d.id === dragging.id ? { ...d, status: newStatus } : d)
      )
    } catch {
      toast.error('Failed to move deal')
    }
    setDragging(null)
  }

  return (
    <div className="p-8 h-screen flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Pipeline</h1>
          <p className="text-text-secondary text-sm mt-1">{allDeals.length} properties in pipeline</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              column={col}
              cards={dealsByStatus[col.key] || []}
              onDrop={handleDrop}
              onDragStart={setDragging}
              onCardClick={setSelectedDeal}
            />
          ))}
        </div>
      )}

      {selectedDeal && (
        <PropertyWorkspace
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onUpdate={(updated) => {
            setAllDeals(prev => prev.map(d => d.id === updated.id ? updated : d))
            setSelectedDeal(updated)
          }}
        />
      )}
    </div>
  )
}
