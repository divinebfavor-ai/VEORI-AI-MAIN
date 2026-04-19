import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ExternalLink, TrendingUp, TrendingDown, Minus, Flame } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { deals } from '../services/api'
import useIntelStore from '../store/intelStore'

const STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Title','Closed']

function stageBadge(s) {
  const m = { 'new':'gray','calling':'amber','contacted':'amber','offer made':'gold','negotiating':'amber','under contract':'green','buyer search':'amber','title':'green','closed':'green' }
  return m[s?.toLowerCase()] || 'gray'
}

function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : null }

// ─── Signal indicator ─────────────────────────────────────────────────────────
function Signal({ days }) {
  if (days === 0) return null
  if (days <= 2) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>
      <TrendingUp size={10} strokeWidth={2} /> Hot
    </span>
  )
  if (days <= 5) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--t4)', fontWeight: 500 }}>
      <Minus size={10} strokeWidth={2} /> {days}d
    </span>
  )
  if (days <= 10) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>
      <TrendingDown size={10} strokeWidth={2} /> Stalled
    </span>
  )
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--red)', fontWeight: 600 }}>
      <TrendingDown size={10} strokeWidth={2} /> Dying
    </span>
  )
}

// ─── Deal Row (velocity board row) ───────────────────────────────────────────
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
        gridTemplateColumns: '1fr 120px 100px 80px 80px 32px',
        alignItems: 'center',
        height: 48,
        padding: '0 16px',
        cursor: 'pointer',
        background: selected
          ? 'rgba(0,229,122,0.05)'
          : hov ? 'var(--s2)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--green)' : 'transparent'}`,
        transition: 'background 0.1s ease',
      }}
    >
      {/* Address + lead */}
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 500, color: 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {isClosed && <Flame size={11} style={{ color: 'var(--gold)', flexShrink: 0 }} strokeWidth={2} />}
          {deal.property_address || 'Address unknown'}
        </p>
        {deal.lead_name && (
          <p style={{ fontSize: 11, color: 'var(--t4)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deal.lead_name}
          </p>
        )}
      </div>

      {/* Stage badge */}
      <div>
        <Badge variant={stageBadge(deal.status)}>{deal.status || 'new'}</Badge>
      </div>

      {/* Offer price */}
      <div style={{ textAlign: 'right' }}>
        {deal.offer_price ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>
            {fmt$(deal.offer_price)}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>—</span>
        )}
      </div>

      {/* Assignment fee */}
      <div style={{ textAlign: 'right' }}>
        {deal.assignment_fee ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
            {fmt$(deal.assignment_fee)}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>—</span>
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
          color: hov ? 'var(--green)' : 'var(--t4)',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          padding: 0, transition: 'color 0.15s ease',
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{
        width: 420,
        background: 'var(--s1)',
        border: '1px solid var(--border-rest)',
        borderRadius: 10,
        padding: 24,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>
          {deal.property_address || 'Deal'}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 20 }}>
          {[deal.property_city, deal.property_state].filter(Boolean).join(', ')}
        </p>

        {/* Financial summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 20 }}>
          {[
            ['ARV',            fmt$(deal.arv)],
            ['Repair Est.',    fmt$(deal.repair_estimate)],
            ['Offer Price',    fmt$(deal.offer_price)],
            ['Seller Agreed',  fmt$(deal.seller_agreed_price)],
            ['Buyer Price',    fmt$(deal.buyer_price)],
            ['Assignment Fee', fmt$(deal.assignment_fee)],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '7px 0', borderBottom: '1px solid var(--border-rest)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)' }}>{k}</span>
              <span style={{
                fontSize: 13, fontWeight: 500,
                color: (k.includes('Fee')) ? 'var(--gold)' : 'var(--t1)',
              }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Stage selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', display: 'block', marginBottom: 6 }}>
            Pipeline Stage
          </label>
          <select
            value={stage}
            onChange={e => setStage(e.target.value)}
            style={{
              width: '100%', height: 40,
              background: 'var(--s2)',
              border: '1px solid var(--border-rest)',
              borderRadius: 6, padding: '0 10px',
              fontSize: 13, color: 'var(--t1)',
              outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {STAGES.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
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

// ─── Main: Velocity Board ─────────────────────────────────────────────────────
export default function Pipeline() {
  const [allDeals, setAllDeals] = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)
  const [stageFilter, setStageFilter] = useState('All')
  const [modalDeal, setModalDeal] = useState(null)
  const navigate   = useNavigate()
  const setIntel   = useIntelStore(s => s.setIntel)

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

  // Filter + sort: hot first (recently updated), then stalled, then dying
  const filtered = allDeals.filter(d => {
    if (stageFilter === 'All') return true
    return d.status?.toLowerCase() === stageFilter.toLowerCase()
  }).sort((a, b) => {
    const dA = a.updated_at ? Date.now() - new Date(a.updated_at) : 0
    const dB = b.updated_at ? Date.now() - new Date(b.updated_at) : 0
    return dA - dB // recently updated first
  })

  const totalValue    = allDeals.reduce((s, d) => s + (d.offer_price || 0), 0)
  const totalFees     = allDeals.reduce((s, d) => s + (d.assignment_fee || 0), 0)
  const stageCounts   = {}
  STAGES.forEach(s => { stageCounts[s] = 0 })
  allDeals.forEach(d => {
    const stage = STAGES.find(s => s.toLowerCase() === d.status?.toLowerCase()) || 'New'
    stageCounts[stage] = (stageCounts[stage] || 0) + 1
  })

  const selectStyle = {
    height: 30,
    background: 'var(--s2)',
    border: '1px solid var(--border-rest)',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 11,
    color: 'var(--t2)',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.02em' }}>
              Velocity Board
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3 }}>
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>{allDeals.length} deals</span>
              {totalValue > 0 && (
                <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 500 }}>
                  {fmt$(totalValue)} in pipeline
                </span>
              )}
              {totalFees > 0 && (
                <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>
                  {fmt$(totalFees)} fees
                </span>
              )}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => toast.info('Create deals from Lead profiles')}>
            <Plus size={13} /> Add Deal
          </Button>
        </div>

        {/* Stage filter chips */}
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
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
                  border: `1px solid ${active ? 'rgba(0,229,122,0.40)' : 'var(--border-rest)'}`,
                  background: active ? 'rgba(0,229,122,0.08)' : 'transparent',
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--green)' : 'var(--t3)',
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
                    color: active ? 'var(--green)' : 'var(--t4)',
                    minWidth: 14, textAlign: 'center',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Column headers ───────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px 100px 80px 80px 32px',
        alignItems: 'center',
        height: 30,
        padding: '0 16px',
        borderTop: '1px solid var(--border-rest)',
        borderBottom: '1px solid var(--border-rest)',
        marginTop: 10,
        flexShrink: 0,
      }}>
        {[['Property'], ['Stage'], ['Offer', 'right'], ['Fee', 'right'], ['Momentum', 'right'], ['']].map(([h, align]) => (
          <span
            key={h}
            style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
              textTransform: 'uppercase', color: 'var(--t4)',
              textAlign: align || 'left',
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* ── Deal rows ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--t3)', fontSize: 13 }}>
            Loading pipeline…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--t2)', marginBottom: 6 }}>
              {stageFilter !== 'All' ? `No deals in ${stageFilter}` : 'No deals yet'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--t3)' }}>
              Create deals from lead profiles
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

      {/* ── Stage editor modal ───────────────────────────────────────────── */}
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
