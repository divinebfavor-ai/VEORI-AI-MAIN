import React, { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Plus, X, Star } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { deals } from '../services/api'

const STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Title','Closed']

function scoreColor(s) {
  if (s == null) return 'text-text-muted'
  if (s >= 70) return 'text-primary'
  if (s >= 40) return 'text-warning'
  return 'text-danger'
}

function stageBadge(s) {
  const m = { 'new':'gray','calling':'amber','contacted':'amber','offer made':'gold','negotiating':'amber','under contract':'green','buyer search':'amber','title':'green','closed':'green' }
  return m[s?.toLowerCase()] || 'gray'
}

function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : null }

// ─── Deal Detail Modal ────────────────────────────────────────────────────────
function DealModal({ deal, onClose }) {
  const [stage, setStage] = useState(deal.status || 'new')
  const [saving, setSaving] = useState(false)

  const updateStage = async () => {
    setSaving(true)
    try { await deals.updateDeal(deal.id, { status: stage }); toast.success('Stage updated'); onClose() }
    catch { toast.error('Failed to update') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
      <div className="w-full max-w-[600px] bg-card border border-border-subtle rounded-xl p-8 max-h-[80vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-[20px] font-medium text-white">{deal.property_address}</h2>
            <p className="text-[13px] text-text-muted mt-0.5">{[deal.property_city, deal.property_state].filter(Boolean).join(', ')}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-0 mb-6">
          {[
            ['ARV',          fmt$(deal.arv)],
            ['Repair Est.',  fmt$(deal.repair_estimate)],
            ['MAO',          fmt$(deal.mao)],
            ['Offer Price',  fmt$(deal.offer_price)],
            ['Agreed Price', fmt$(deal.seller_agreed_price)],
            ['Buyer Price',  fmt$(deal.buyer_price)],
            ['Assignment Fee', fmt$(deal.assignment_fee)],
            ['Closing Date', deal.closing_date],
          ].filter(([,v]) => v).map(([k,v]) => (
            <div key={k} className="flex justify-between py-2.5 border-b border-border-subtle">
              <span className="label-caps">{k}</span>
              <span className={`text-[13px] font-medium ${k.includes('Fee') || k.includes('Value') ? 'text-gold' : 'text-text-primary'}`}>{v}</span>
            </div>
          ))}
        </div>

        {/* Stage selector */}
        <div className="mb-6">
          <label className="label-caps block mb-2">Pipeline Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)}
            className="w-full h-[44px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary">
            {STAGES.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
          </select>
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" loading={saving} onClick={updateStage}>Save Changes</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Deal Card ────────────────────────────────────────────────────────────────
function DealCard({ deal, onClick }) {
  const isClosed = deal.status?.toLowerCase() === 'closed'
  const daysInStage = deal.updated_at
    ? Math.floor((Date.now() - new Date(deal.updated_at)) / 86400000)
    : 0

  return (
    <div onClick={onClick}
      className="bg-elevated border border-border-subtle hover:border-border-default rounded-lg p-4 mb-2 cursor-pointer transition-colors group">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium text-text-primary truncate group-hover:text-white transition-colors">
            {deal.property_address || 'Address unknown'}
          </p>
          {deal.lead_name && <p className="text-[11px] text-text-muted mt-0.5 truncate">{deal.lead_name}</p>}
        </div>
        {isClosed && <Star size={13} className="text-gold flex-shrink-0 ml-2 fill-gold" />}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {deal.motivation_score != null && (
            <span className={`text-[12px] font-semibold ${scoreColor(deal.motivation_score)}`}>{deal.motivation_score}</span>
          )}
        </div>
        {deal.offer_price && (
          <span className="text-[13px] font-semibold text-gold">{fmt$(deal.offer_price)}</span>
        )}
      </div>

      {daysInStage > 0 && (
        <p className="text-[10px] text-text-muted mt-2">{daysInStage}d in stage</p>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Pipeline() {
  const [allDeals, setAllDeals] = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    deals.getDeals({ limit: 500 }).then(r => {
      setAllDeals(r.data?.deals || r.data || [])
    }).catch(() => setAllDeals([])).finally(() => setLoading(false))
  }, [])

  // Group by stage
  const grouped = {}
  STAGES.forEach(s => { grouped[s] = [] })
  allDeals.forEach(d => {
    const stage = STAGES.find(s => s.toLowerCase() === d.status?.toLowerCase()) || 'New'
    if (!grouped[stage]) grouped[stage] = []
    grouped[stage].push(d)
  })

  const totalValue = allDeals.reduce((sum, d) => sum + (d.offer_price || 0), 0)

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-[28px] font-medium text-white">Pipeline</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-[13px] text-text-muted">{allDeals.length} deals</p>
            {totalValue > 0 && (
              <p className="text-[13px] text-gold font-medium">${Number(totalValue).toLocaleString()} total value</p>
            )}
          </div>
        </div>
        <Button onClick={() => toast.info('Create deals from Lead profiles')} variant="secondary">
          <Plus size={14} /> Add Deal
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-text-muted">Loading pipeline…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-6 flex-1" style={{ minHeight: 0 }}>
          {STAGES.map(stage => {
            const stageDels  = grouped[stage] || []
            const stageValue = stageDels.reduce((s, d) => s + (d.offer_price || 0), 0)

            return (
              <div key={stage} className="flex-shrink-0 w-[260px] flex flex-col">
                {/* Column header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="label-caps">{stage}</span>
                    {stageValue > 0 && (
                      <span className="text-[11px] text-gold ml-2">{fmt$(stageValue)}</span>
                    )}
                  </div>
                  <span className="text-[12px] font-medium text-text-muted bg-elevated border border-border-subtle w-6 h-6 flex items-center justify-center rounded-full">
                    {stageDels.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto scrollbar-hide min-h-[200px] bg-surface/30 rounded-lg p-2 border border-border-subtle/50">
                  {stageDels.map(d => (
                    <DealCard key={d.id} deal={d} onClick={() => setSelected(d)} />
                  ))}
                  {stageDels.length === 0 && (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-[11px] text-text-muted">Empty</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && <DealModal deal={selected} onClose={() => { setSelected(null); deals.getDeals({limit:500}).then(r => setAllDeals(r.data?.deals||r.data||[])) }} />}
    </div>
  )
}
