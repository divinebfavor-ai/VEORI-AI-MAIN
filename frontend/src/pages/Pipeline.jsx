import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ExternalLink, TrendingUp, TrendingDown, Minus, Flame, BarChart3 } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { deals } from '../services/api'
import useIntelStore from '../store/intelStore'

const STAGES = ['New', 'Calling', 'Contacted', 'Offer Made', 'Negotiating', 'Under Contract', 'Buyer Search', 'Title', 'Closed']

function stageBadge(s) {
  const m = { new: 'gray', calling: 'amber', contacted: 'amber', 'offer made': 'gold', negotiating: 'amber', 'under contract': 'green', 'buyer search': 'amber', title: 'green', closed: 'green' }
  return m[s?.toLowerCase()] || 'gray'
}

function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : null }

// ─── Signal indicator ─────────────────────────────────────────────────────────
function Signal({ days }) {
  if (days === 0) return null
  if (days <= 2) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#00C37A', fontWeight: 600 }}>
      <TrendingUp size={10} strokeWidth={2} /> Hot
    </span>
  )
  if (days <= 5) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>
      <Minus size={10} strokeWidth={2} /> {days}d
    </span>
  )
  if (days <= 10) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#FF9500', fontWeight: 600 }}>
      <TrendingDown size={10} strokeWidth={2} /> Stalled
    </span>
  )
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#FF4444', fontWeight: 600 }}>
      <TrendingDown size={10} strokeWidth={2} /> Dying
    </span>
  )
}

// ─── Deal Row ─────────────────────────────────────────────────────────────────
function DealRow({ deal, selected, onClick, onOpen }) {
  const [hov, setHov] = useState(false)
  const daysInStage = deal.updated_at
    ? Math.floor((Date.now() - new Date(deal.updated_at)) / 86400000)
    : 0
  const isClosed = deal.status?.toLowerCase() === 'closed'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 110px 90px 90px 34px',
        alignItems: 'center',
        height: 52,
        padding: '0 20px',
        cursor: 'pointer',
        background: selected
          ? 'rgba(0,195,122,0.06)'
          : hov ? 'rgba(255,255,255,0.025)' : 'transparent',
        borderLeft: `2px solid ${selected ? '#00C37A' : 'transparent'}`,
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        transition: 'all 0.15s ease',
        transform: hov && !selected ? 'translateY(-0.5px)' : 'none',
      }}
    >
      {/* Address + lead */}
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.90)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
        }}>
          {isClosed && <Flame size={11} style={{ color: '#C9A84C', flexShrink: 0 }} strokeWidth={2} />}
          {deal.property_address || 'Address unknown'}
        </p>
        {deal.lead_name && (
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deal.lead_name}
          </p>
        )}
      </div>

      {/* Stage */}
      <div>
        <Badge variant={stageBadge(deal.status)}>{deal.status || 'new'}</Badge>
      </div>

      {/* Offer price */}
      <div style={{ textAlign: 'right' }}>
        {deal.offer_price ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#C9A84C', fontVariantNumeric: 'tabular-nums' }}>
            {fmt$(deal.offer_price)}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)' }}>—</span>
        )}
      </div>

      {/* Assignment fee */}
      <div style={{ textAlign: 'right' }}>
        {deal.assignment_fee ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#00C37A', fontVariantNumeric: 'tabular-nums' }}>
            {fmt$(deal.assignment_fee)}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)' }}>—</span>
        )}
      </div>

      {/* Signal */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Signal days={daysInStage} />
      </div>

      {/* Open deal workspace */}
      <button
        onClick={e => { e.stopPropagation(); onOpen(deal.id) }}
        style={{
          background: 'none', border: 'none',
          color: hov ? '#00C37A' : 'rgba(255,255,255,0.25)',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          padding: 4, borderRadius: 5,
          transition: 'color 0.15s ease',
        }}
        title="Open deal workspace"
      >
        <ExternalLink size={12} strokeWidth={1.8} />
      </button>
    </div>
  )
}

// ─── Stage editor modal ───────────────────────────────────────────────────────
function StageModal({ deal, onClose, onSaved }) {
  const [stage, setStage] = useState(deal.status || 'new')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await deals.updateDeal(deal.id, { status: stage })
      toast.success('Stage updated')
      onSaved()
      onClose()
    } catch { toast.error('Failed to update') }
    finally { setSaving(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.65)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div style={{
        width: 440,
        background: 'rgba(10,16,26,0.96)',
        backdropFilter: 'blur(32px) saturate(160%)',
        WebkitBackdropFilter: 'blur(32px) saturate(160%)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 16,
        padding: 28,
        boxShadow: '0 24px 80px rgba(0,0,0,0.60)',
      }}>
        {/* Top accent */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,195,122,0.40), transparent)', margin: '-28px -28px 24px' }} />

        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 4 }}>
          {deal.property_address || 'Deal'}
        </h2>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 22 }}>
          {[deal.property_city, deal.property_state].filter(Boolean).join(', ')}
        </p>

        {/* Financial summary */}
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 22 }}>
          {[
            ['ARV', fmt$(deal.arv)],
            ['Repair Est.', fmt$(deal.repair_estimate)],
            ['Offer Price', fmt$(deal.offer_price)],
            ['Seller Agreed', fmt$(deal.seller_agreed_price)],
            ['Buyer Price', fmt$(deal.buyer_price)],
            ['Assignment Fee', fmt$(deal.assignment_fee)],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)' }}>{k}</span>
              <span style={{
                fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                color: k.includes('Fee') ? '#C9A84C' : k.includes('Offer') || k.includes('Buyer') ? '#00C37A' : 'rgba(255,255,255,0.80)',
              }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Stage selector */}
        <div style={{ marginBottom: 22 }}>
          <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', display: 'block', marginBottom: 8 }}>
            Pipeline Stage
          </label>
          <select
            value={stage}
            onChange={e => setStage(e.target.value)}
            style={{
              width: '100%', height: 44,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8, padding: '0 12px',
              fontSize: 13, color: 'rgba(255,255,255,0.85)',
              outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
              appearance: 'none',
            }}
          >
            {STAGES.map(s => <option key={s} value={s.toLowerCase()} style={{ background: '#0a101a' }}>{s}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          <Button variant="primary" style={{ flex: 1 }} loading={saving} onClick={save}>Save Changes</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 130px 110px 90px 90px 34px',
      alignItems: 'center',
      height: 52, padding: '0 20px',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      <div>
        <div style={{ width: 140, height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginBottom: 5, animation: 'skeleton-pulse 1.4s ease infinite' }} />
        <div style={{ width: 80, height: 9, borderRadius: 4, background: 'rgba(255,255,255,0.03)', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
      </div>
      <div style={{ width: 60, height: 18, borderRadius: 5, background: 'rgba(255,255,255,0.04)', animation: 'skeleton-pulse 1.4s ease infinite 0.05s' }} />
      <div style={{ width: 60, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
      <div style={{ width: 50, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.04)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.15s' }} />
      <div style={{ width: 36, height: 10, borderRadius: 4, background: 'rgba(255,255,255,0.03)', marginLeft: 'auto', animation: 'skeleton-pulse 1.4s ease infinite 0.2s' }} />
      <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.03)', animation: 'skeleton-pulse 1.4s ease infinite 0.25s' }} />
    </div>
  )
}

// ─── Main: Velocity Board ─────────────────────────────────────────────────────
export default function Pipeline() {
  const [allDeals, setAllDeals]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)
  const [stageFilter, setStageFilter] = useState('All')
  const [modalDeal, setModalDeal]   = useState(null)
  const navigate = useNavigate()
  const setIntel = useIntelStore(s => s.setIntel)

  const load = () => {
    deals.getDeals({ limit: 500 })
      .then(r => {
        const raw = r.data?.deals ?? r.data?.data ?? r.data
        setAllDeals(Array.isArray(raw) ? raw : [])
      })
      .catch(() => setAllDeals([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const selectDeal = (deal) => {
    setSelected(deal)
    setIntel('deal', deal)
  }

  // Filter + sort: hot first
  const filtered = allDeals.filter(d => {
    if (stageFilter === 'All') return true
    return d.status?.toLowerCase() === stageFilter.toLowerCase()
  }).sort((a, b) => {
    const dA = a.updated_at ? Date.now() - new Date(a.updated_at) : 0
    const dB = b.updated_at ? Date.now() - new Date(b.updated_at) : 0
    return dA - dB
  })

  const totalValue = allDeals.reduce((s, d) => s + (d.offer_price || 0), 0)
  const totalFees  = allDeals.reduce((s, d) => s + (d.assignment_fee || 0), 0)

  const stageCounts = {}
  STAGES.forEach(s => { stageCounts[s] = 0 })
  allDeals.forEach(d => {
    const stage = STAGES.find(s => s.toLowerCase() === d.status?.toLowerCase()) || 'New'
    stageCounts[stage] = (stageCounts[stage] || 0) + 1
  })

  // Pipeline velocity bar data
  const stageColors = {
    New: '#rgba(255,255,255,0.20)',
    Calling: '#FF9500',
    Contacted: '#FF9500',
    'Offer Made': '#C9A84C',
    Negotiating: '#C9A84C',
    'Under Contract': '#00C37A',
    'Buyer Search': '#00C37A',
    Title: '#00C37A',
    Closed: '#00C37A',
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '22px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.03em', marginBottom: 4 }}>
              Velocity Board
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{allDeals.length} deals</span>
              {totalValue > 0 && (
                <span style={{ fontSize: 12, color: '#C9A84C', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt$(totalValue)} in pipeline
                </span>
              )}
              {totalFees > 0 && (
                <span style={{ fontSize: 12, color: '#00C37A', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt$(totalFees)} fees
                </span>
              )}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => toast.info('Create deals from Lead profiles')}>
            <Plus size={13} /> Add Deal
          </Button>
        </div>

        {/* Pipeline velocity bar */}
        {allDeals.length > 0 && (
          <div style={{ display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden', marginBottom: 14, gap: 1 }}>
            {STAGES.map(s => {
              const count = stageCounts[s] || 0
              if (count === 0) return null
              const pct = (count / allDeals.length) * 100
              const colorMap = { New: 'rgba(255,255,255,0.15)', Calling: '#FF9500', Contacted: '#FF9500', 'Offer Made': '#C9A84C', Negotiating: '#C9A84C', 'Under Contract': '#00C37A', 'Buyer Search': '#00C37A', Title: '#00C37A', Closed: '#00C37A' }
              return (
                <div
                  key={s}
                  style={{ flex: pct, background: colorMap[s] || 'rgba(255,255,255,0.15)', borderRadius: 2 }}
                  title={`${s}: ${count}`}
                />
              )
            })}
          </div>
        )}

        {/* Stage filter chips */}
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
          {['All', ...STAGES].map(s => {
            const count = s === 'All' ? allDeals.length : (stageCounts[s] || 0)
            const active = stageFilter === s
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                style={{
                  height: 26, padding: '0 10px',
                  borderRadius: 13,
                  border: `1px solid ${active ? 'rgba(0,195,122,0.40)' : 'rgba(255,255,255,0.08)'}`,
                  background: active ? 'rgba(0,195,122,0.08)' : 'rgba(255,255,255,0.03)',
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  color: active ? '#00C37A' : 'rgba(255,255,255,0.40)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  display: 'flex', alignItems: 'center', gap: 5,
                  flexShrink: 0,
                  fontFamily: 'inherit',
                }}
              >
                {s}
                {count > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    color: active ? '#00C37A' : 'rgba(255,255,255,0.25)',
                    minWidth: 14, textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Column headers ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 110px 90px 90px 34px',
        alignItems: 'center',
        height: 30,
        padding: '0 20px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        marginTop: 10,
        flexShrink: 0,
        background: 'rgba(255,255,255,0.015)',
      }}>
        {[
          { label: 'Property', align: 'left' },
          { label: 'Stage', align: 'left' },
          { label: 'Offer', align: 'right' },
          { label: 'Fee', align: 'right' },
          { label: 'Momentum', align: 'right' },
          { label: '', align: 'left' },
        ].map(h => (
          <span key={h.label} style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)',
            textAlign: h.align,
          }}>
            {h.label}
          </span>
        ))}
      </div>

      {/* ── Deal rows ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(201,168,76,0.06)',
              border: '1px solid rgba(201,168,76,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <BarChart3 size={22} strokeWidth={1.5} color="#C9A84C" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.60)', marginBottom: 6 }}>
              {stageFilter !== 'All' ? `No deals in ${stageFilter}` : 'No deals yet'}
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
              Create deals from lead profiles to track your pipeline
            </p>
          </div>
        ) : (
          filtered.map(d => (
            <DealRow
              key={d.id}
              deal={d}
              selected={selected?.id === d.id}
              onClick={() => selectDeal(d)}
              onOpen={id => navigate(`/deals/${id}`)}
            />
          ))
        )}
      </div>

      {/* ── Stage editor modal ────────────────────────────────────────────────── */}
      {modalDeal && (
        <StageModal
          deal={modalDeal}
          onClose={() => setModalDeal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
