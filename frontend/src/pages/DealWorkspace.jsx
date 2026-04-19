import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, FileText, Send, Users, Shield,
  ChevronDown, ChevronUp, Edit2, Check, X, Wrench
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import RepairEstimator from '../components/ui/RepairEstimator'
import { deals as dealsApi, buyers as buyersApi, titleCompanies as titleApi, compliance as complianceApi } from '../services/api'

const STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Title','Closed']

function stageBadge(s) {
  const m = { 'new':'gray','calling':'amber','contacted':'amber','offer made':'gold','negotiating':'amber','under contract':'green','buyer search':'amber','title':'green','closed':'green' }
  return m[s?.toLowerCase()] || 'gray'
}

function scoreColor(s) {
  if (s == null) return 'var(--t4)'
  if (s >= 70) return 'var(--green)'
  if (s >= 40) return 'var(--amber)'
  return 'var(--red)'
}

function fieldKey(label) {
  const m = {
    'ARV': 'arv',
    'Repair Estimate': 'repair_estimate',
    'Offer Price': 'offer_price',
    'Agreed Price': 'seller_agreed_price',
    'Buyer Price': 'buyer_price',
    'Assignment Fee': 'assignment_fee',
    'Closing Date': 'closing_date',
  }
  return m[label] || label.toLowerCase().replace(/\s+/g, '_')
}

function fmt$(n) { return n ? '$' + Math.round(Number(n)).toLocaleString() : '—' }

// ─── Collapsible Section ──────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{
      background: 'var(--s1)',
      border: '1px solid var(--border-rest)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          transition: 'background 0.12s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Icon && <Icon size={13} strokeWidth={1.5} style={{ color: 'var(--t3)' }} />}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{title}</span>
        </div>
        {open
          ? <ChevronUp size={13} style={{ color: 'var(--t4)' }} />
          : <ChevronDown size={13} style={{ color: 'var(--t4)' }} />
        }
      </button>
      {open && (
        <div style={{ padding: '4px 18px 18px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Inline Editable Field ────────────────────────────────────────────────────
function EditableField({ label, value, onSave, type = 'text', prefix = '', highlight }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value || '')
  const [hov, setHov]         = useState(false)

  const save = () => { onSave(draft); setEditing(false) }
  const cancel = () => { setDraft(value || ''); setEditing(false) }

  const displayVal = prefix === '$' && value
    ? '$' + Number(value).toLocaleString()
    : (value || '—')

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid var(--border-rest)',
      }}
    >
      <span style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
        textTransform: 'uppercase', color: 'var(--t3)',
        width: 140, flexShrink: 0,
      }}>
        {label}
      </span>

      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
          {prefix && <span style={{ fontSize: 13, color: 'var(--t3)' }}>{prefix}</span>}
          <input
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            style={{
              width: 120, height: 28,
              background: 'var(--s2)',
              border: '1px solid rgba(0,229,122,0.40)',
              borderRadius: 4,
              padding: '0 8px',
              fontSize: 13, color: 'var(--t1)',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button onClick={save}   style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', lineHeight: 1 }}><Check size={13} /></button>
          <button onClick={cancel} style={{ background: 'none', border: 'none', color: 'var(--t4)',   cursor: 'pointer', lineHeight: 1 }}><X size={13} /></button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 14, fontWeight: highlight ? 700 : 500,
            color: highlight || 'var(--t1)',
          }}>
            {displayVal}
          </span>
          {hov && (
            <button
              onClick={() => setEditing(true)}
              style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', lineHeight: 1, padding: 0 }}
            >
              <Edit2 size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Scenario Card ────────────────────────────────────────────────────────────
function ScenarioCard({ label, arv, repairs, accent }) {
  const mao        = Math.round(arv * 0.70 - repairs)
  const firstOffer = Math.round(mao * 0.85)
  const buyerProfit= Math.round(arv - mao - repairs)

  return (
    <div style={{
      background: 'var(--s2)',
      border: '1px solid var(--border-rest)',
      borderRadius: 6,
      padding: '12px 14px',
    }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: accent, marginBottom: 10 }}>
        {label}
      </p>
      {[
        ['ARV',          fmt$(arv),         'var(--t2)'],
        ['Repairs',      fmt$(repairs),     'var(--t2)'],
        ['MAO',          fmt$(mao),         'var(--gold)'],
        ['First Offer',  fmt$(firstOffer),  'var(--gold)'],
        ['Buyer Profit', fmt$(buyerProfit), 'var(--t2)'],
      ].map(([k, v, color]) => (
        <div key={k} style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '5px 0', borderBottom: '1px solid var(--border-rest)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--t4)' }}>{k}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Milestone Timeline ───────────────────────────────────────────────────────
function MilestoneBar({ stage }) {
  const idx = STAGES.findIndex(s => s.toLowerCase() === stage?.toLowerCase())
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20 }}>
      {STAGES.map((s, i) => {
        const done   = i < idx
        const active = i === idx
        return (
          <React.Fragment key={s}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              flex: 1,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: done || active ? 'var(--green)' : 'var(--s3)',
                border: active ? '2px solid var(--green)' : 'none',
                boxShadow: active ? '0 0 0 3px rgba(0,229,122,0.18)' : 'none',
                flexShrink: 0,
                transition: 'all 0.2s ease',
              }} />
              <span style={{
                fontSize: 8, fontWeight: active ? 700 : 400,
                color: active ? 'var(--green)' : done ? 'var(--t3)' : 'var(--t4)',
                letterSpacing: '0.04em', textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {s}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div style={{
                height: 1, flex: 0.5, marginBottom: 16,
                background: i < idx ? 'var(--green)' : 'var(--s3)',
                transition: 'background 0.2s ease',
              }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Main: Deal Workspace (Narrative Engine) ──────────────────────────────────
export default function DealWorkspace() {
  const { id }    = useParams()
  const navigate  = useNavigate()

  const [deal,        setDeal]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [buyers,      setBuyers]      = useState([])
  const [titleCos,    setTitleCos]    = useState([])
  const [compliance,  setCompliance]  = useState(null)
  const [stage,       setStage]       = useState('')
  const [savingStage, setSavingStage] = useState(false)
  const [genContract, setGenContract] = useState(false)
  const [showRepairs, setShowRepairs] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    dealsApi.getDeal(id)
      .then(r => {
        const d = r.data?.deal || r.data?.data || r.data
        setDeal(d)
        setStage(d?.status || 'new')
        if (d?.property_state) {
          complianceApi.getState(d.property_state)
            .then(cr => setCompliance(cr.data?.compliance || cr.data))
            .catch(() => {})
        }
      })
      .catch(() => toast.error('Deal not found'))
      .finally(() => setLoading(false))

    buyersApi.getBuyers().then(r => {
      const raw = r.data?.buyers ?? r.data?.data ?? r.data
      setBuyers(Array.isArray(raw) ? raw : [])
    }).catch(() => {})

    titleApi.getAll().then(r => {
      const raw = r.data?.companies ?? r.data?.data ?? r.data
      setTitleCos(Array.isArray(raw) ? raw : [])
    }).catch(() => {})
  }, [id])

  const updateDeal = async (updates) => {
    try {
      await dealsApi.updateDeal(id, updates)
      setDeal(d => ({ ...d, ...updates }))
      toast.success('Saved')
    } catch { toast.error('Save failed') }
  }

  const saveStage = async () => {
    setSavingStage(true)
    try { await updateDeal({ status: stage }) }
    finally { setSavingStage(false) }
  }

  const generateContract = async (type) => {
    setGenContract(true)
    try {
      const r = await dealsApi.generateContract(id, type)
      const url = r.data?.download_url || r.data?.url
      if (url) window.open(url, '_blank')
      else toast.success(`${type.toUpperCase()} generated`)
    } catch { toast.error('Contract generation failed') }
    finally { setGenContract(false) }
  }

  const sendContract = async (type) => {
    try {
      await dealsApi.sendContract(id, type)
      toast.success('Contract sent to seller')
      updateDeal({ contract_status: 'sent' })
    } catch { toast.error('Failed to send contract') }
  }

  const applyRepairEstimate = (midpoint) => {
    updateDeal({ repair_estimate: midpoint })
    setShowRepairs(false)
    toast.success(`Repair estimate set to ${fmt$(midpoint)}`)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--t3)', fontSize: 13 }}>
      Loading deal…
    </div>
  )
  if (!deal) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--t3)', fontSize: 13 }}>
      Deal not found
    </div>
  )

  const arv       = deal.arv || 0
  const repairs   = deal.repair_estimate || 0
  const mao       = Math.round(arv * 0.70 - repairs)
  const assignFee = Math.max(0, (deal.buyer_price || 0) - (deal.seller_agreed_price || deal.offer_price || 0))

  const matchedBuyers = buyers.filter(b => {
    if (!b.buy_box_states?.length) return true
    return b.buy_box_states.some(s => s.toUpperCase() === deal.property_state?.toUpperCase())
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Top nav bar ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-rest)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/pipeline')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12, color: 'var(--t3)',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, transition: 'color 0.15s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--t2)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}
          >
            <ArrowLeft size={13} strokeWidth={1.8} /> Pipeline
          </button>
          <span style={{ color: 'var(--border-active)', fontSize: 12 }}>/</span>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.01em' }}>
            {deal.property_address || 'Deal Workspace'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--t3)' }}>
            {[deal.property_city, deal.property_state].filter(Boolean).join(', ')}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Badge variant={stageBadge(deal.status)}>{deal.status || 'new'}</Badge>
          {assignFee > 0 && (
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>
              {fmt$(assignFee)} fee
            </span>
          )}
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

        {/* Milestone timeline */}
        <MilestoneBar stage={deal.status} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>

          {/* ── Left: Main content ───────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Financials */}
            <Section title="Deal Financials" icon={FileText}>
              {[
                { label: 'ARV',             value: deal.arv,                 prefix: '$' },
                { label: 'Repair Estimate', value: deal.repair_estimate,     prefix: '$' },
                { label: 'MAO (Computed)',  value: mao,                      prefix: '$', highlight: 'var(--gold)', readOnly: true },
                { label: 'Offer Price',     value: deal.offer_price,         prefix: '$' },
                { label: 'Agreed Price',    value: deal.seller_agreed_price, prefix: '$' },
                { label: 'Buyer Price',     value: deal.buyer_price,         prefix: '$' },
                { label: 'Assignment Fee',  value: assignFee || null,        prefix: '$', highlight: 'var(--green)', readOnly: true },
                { label: 'Closing Date',    value: deal.closing_date,        prefix: '' },
              ].filter(f => f.value != null && f.value !== 0 && f.value !== '').map(f => (
                <EditableField
                  key={f.label}
                  label={f.label}
                  value={f.prefix === '$' ? f.value : f.value}
                  prefix={f.prefix}
                  type={f.prefix === '$' ? 'number' : 'text'}
                  highlight={f.highlight}
                  onSave={val => !f.readOnly && updateDeal({ [fieldKey(f.label)]: f.prefix === '$' ? Number(val) : val })}
                />
              ))}

              {arv > 0 && (
                <button
                  onClick={() => setShowRepairs(v => !v)}
                  style={{
                    marginTop: 12,
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: 'var(--t3)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    transition: 'color 0.15s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--green)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}
                >
                  <Wrench size={12} strokeWidth={1.8} />
                  {showRepairs ? 'Hide' : 'Open'} Repair Estimator
                </button>
              )}

              {showRepairs && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-rest)', paddingTop: 14 }}>
                  <RepairEstimator onEstimate={applyRepairEstimate} />
                </div>
              )}
            </Section>

            {/* Three-scenario analysis */}
            {arv > 0 && (
              <Section title="Scenario Analysis" icon={FileText}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <ScenarioCard label="Conservative" arv={Math.round(arv * 0.90)} repairs={Math.round(repairs * 1.20)} accent="var(--red)" />
                  <ScenarioCard label="Moderate"     arv={arv}                     repairs={repairs}                     accent="var(--amber)" />
                  <ScenarioCard label="Aggressive"   arv={Math.round(arv * 1.05)} repairs={Math.round(repairs * 0.90)} accent="var(--green)" />
                </div>
              </Section>
            )}

            {/* Contracts */}
            <Section title="Contracts" icon={FileText}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  {
                    key: 'psa',
                    title: 'Purchase & Sale Agreement',
                    sub: 'Between you and the seller',
                  },
                  {
                    key: 'assignment',
                    title: 'Assignment Agreement',
                    sub: 'Transfer contract to your buyer',
                  },
                ].map(contract => (
                  <div
                    key={contract.key}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: 'var(--s2)',
                      border: '1px solid var(--border-rest)',
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', marginBottom: 2 }}>
                        {contract.title}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--t4)' }}>{contract.sub}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="secondary" size="sm" loading={genContract} onClick={() => generateContract(contract.key)}>
                        <FileText size={11} /> Generate
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => sendContract(contract.key)}>
                        <Send size={11} /> Send
                      </Button>
                    </div>
                  </div>
                ))}

                {deal.contract_status && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px',
                    background: 'rgba(0,229,122,0.04)',
                    border: '1px solid rgba(0,229,122,0.18)',
                    borderRadius: 5,
                  }}>
                    <Check size={12} style={{ color: 'var(--green)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--t2)' }}>
                      Contract status: <strong style={{ color: 'var(--t1)' }}>{deal.contract_status}</strong>
                    </span>
                  </div>
                )}
              </div>
            </Section>

            {/* Buyer matching */}
            <Section title="Buyer Matching" icon={Users}>
              {buyers.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--t3)' }}>No buyers in your list yet</p>
              ) : matchedBuyers.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--t3)' }}>No buyers match {deal.property_state}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {matchedBuyers.slice(0, 8).map(b => (
                    <div
                      key={b.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: 'var(--s2)',
                        border: '1px solid var(--border-rest)',
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', marginBottom: 2 }}>
                          {b.name}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--t4)' }}>
                          {b.phone}
                          {b.max_price ? ` · Max ${fmt$(b.max_price)}` : ''}
                        </p>
                      </div>
                      <Button
                        variant="secondary" size="sm"
                        onClick={() => {
                          updateDeal({ buyer_id: b.id })
                          toast.success(`${b.name} assigned to deal`)
                        }}
                      >
                        Assign
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* ── Right: Sidebar ───────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Stage control */}
            <div style={{
              background: 'var(--s1)',
              border: '1px solid var(--border-rest)',
              borderRadius: 8,
              padding: '14px 16px',
            }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 10 }}>
                Pipeline Stage
              </p>
              <select
                value={stage}
                onChange={e => setStage(e.target.value)}
                style={{
                  width: '100%', height: 36,
                  background: 'var(--s2)',
                  border: '1px solid var(--border-rest)',
                  borderRadius: 6,
                  padding: '0 10px',
                  fontSize: 13, color: 'var(--t1)',
                  outline: 'none', fontFamily: 'inherit',
                  cursor: 'pointer', marginBottom: 10,
                }}
              >
                {STAGES.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
              </select>
              <Button variant="primary" size="sm" style={{ width: '100%' }} loading={savingStage} onClick={saveStage}>
                Update Stage
              </Button>
            </div>

            {/* Seller info */}
            {deal.leads && (
              <div style={{
                background: 'var(--s1)',
                border: '1px solid var(--border-rest)',
                borderRadius: 8,
                padding: '14px 16px',
              }}>
                <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 10 }}>
                  Seller
                </p>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)', marginBottom: 4 }}>
                  {deal.leads.first_name} {deal.leads.last_name}
                </p>
                {deal.leads.phone && (
                  <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 2 }}>{deal.leads.phone}</p>
                )}
                {deal.leads.email && (
                  <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>{deal.leads.email}</p>
                )}
                {deal.leads.motivation_score != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t4)' }}>
                      Motivation
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: scoreColor(deal.leads.motivation_score) }}>
                      {deal.leads.motivation_score}
                    </span>
                  </div>
                )}
                {deal.leads.seller_personality && (
                  <Badge variant="amber">{deal.leads.seller_personality}</Badge>
                )}
              </div>
            )}

            {/* Title company */}
            <div style={{
              background: 'var(--s1)',
              border: '1px solid var(--border-rest)',
              borderRadius: 8,
              padding: '14px 16px',
            }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 10 }}>
                Title Company
              </p>
              {deal.title_company_id && titleCos.find(t => t.id === deal.title_company_id) ? (() => {
                const t = titleCos.find(tc => tc.id === deal.title_company_id)
                return (
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', marginBottom: 3 }}>{t.name}</p>
                    {t.contact_name && <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 1 }}>{t.contact_name}</p>}
                    {t.phone && <p style={{ fontSize: 11, color: 'var(--t3)' }}>{t.phone}</p>}
                  </div>
                )
              })() : (
                <select
                  onChange={e => { if (e.target.value) updateDeal({ title_company_id: e.target.value }) }}
                  defaultValue=""
                  style={{
                    width: '100%', height: 34,
                    background: 'var(--s2)',
                    border: '1px solid var(--border-rest)',
                    borderRadius: 6,
                    padding: '0 10px',
                    fontSize: 12, color: 'var(--t2)',
                    outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >
                  <option value="">{titleCos.length === 0 ? 'No title companies added' : 'Select title company…'}</option>
                  {titleCos.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Compliance */}
            {compliance && (
              <div style={{
                background: 'var(--s1)',
                border: `1px solid ${
                  compliance.risk_level === 'high'   ? 'rgba(255,59,78,0.35)' :
                  compliance.risk_level === 'medium' ? 'rgba(255,140,0,0.35)' :
                  'var(--border-rest)'
                }`,
                borderRadius: 8,
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Shield size={12} strokeWidth={1.5} style={{
                    color: compliance.risk_level === 'high' ? 'var(--red)'
                         : compliance.risk_level === 'medium' ? 'var(--amber)'
                         : 'var(--green)',
                  }} />
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>
                    {deal.property_state} Compliance
                  </p>
                  <Badge variant={
                    compliance.risk_level === 'high' ? 'red' :
                    compliance.risk_level === 'medium' ? 'amber' : 'green'
                  }>
                    {compliance.risk_level} risk
                  </Badge>
                </div>

                {compliance.notes && (
                  <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.6, marginBottom: 8 }}>
                    {compliance.notes}
                  </p>
                )}

                {compliance.cancellation_period_days > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500, marginBottom: 8 }}>
                    ⚠️ Seller has {compliance.cancellation_period_days}-day cancel right
                  </p>
                )}

                {compliance.disclosure_language && (
                  <div style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    background: 'var(--s2)',
                    borderRadius: 4,
                    border: '1px solid var(--border-rest)',
                  }}>
                    <p style={{ fontSize: 10, color: 'var(--t4)', lineHeight: 1.6 }}>
                      {compliance.disclosure_language}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
