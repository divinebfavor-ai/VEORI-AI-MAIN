import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, FileText, Send, Building2, Users, Shield,
  ChevronDown, ChevronUp, Edit2, Check, X, Plus, Wrench
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import RepairEstimator from '../components/ui/RepairEstimator'
import { deals as dealsApi, buyers as buyersApi, titleCompanies as titleApi, compliance as complianceApi } from '../services/api'

const STAGES = ['New','Calling','Contacted','Offer Made','Negotiating','Under Contract','Buyer Search','Title','Closed']

function fmt$(n) { return n ? '$' + Math.round(Number(n)).toLocaleString() : '—' }

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {Icon && <Icon size={14} className="text-text-muted" strokeWidth={1.5} />}
          <span className="text-[14px] font-semibold text-white">{title}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  )
}

function EditableField({ label, value, onSave, type = 'text', prefix = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value || '')

  const save = () => { onSave(draft); setEditing(false) }
  const cancel = () => { setDraft(value || ''); setEditing(false) }

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border-subtle last:border-0">
      <span className="label-caps w-36 flex-shrink-0">{label}</span>
      {editing ? (
        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="flex items-center">
            {prefix && <span className="text-text-muted text-[13px] mr-1">{prefix}</span>}
            <input
              type={type}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              autoFocus
              className="w-36 h-7 bg-surface border border-primary rounded-[4px] px-2 text-[13px] text-text-primary focus:outline-none"
            />
          </div>
          <button onClick={save}   className="text-primary hover:text-white"><Check size={13} /></button>
          <button onClick={cancel} className="text-text-muted hover:text-text-primary"><X size={13} /></button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-text-primary">{prefix}{value ? Number(value).toLocaleString?.() ?? value : '—'}</span>
          <button onClick={() => setEditing(true)} className="text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            <Edit2 size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

function ScenarioCard({ label, arv, repairs, color }) {
  const mao        = Math.round(arv * 0.70 - repairs)
  const firstOffer = Math.round(mao * 0.85)
  const buyerProfit= Math.round(arv - mao - repairs)
  return (
    <div className="bg-elevated border border-border-subtle rounded-lg p-4">
      <p className={`text-[12px] font-bold mb-3 ${color}`}>{label}</p>
      {[
        ['ARV',         fmt$(arv)],
        ['Repairs',     fmt$(repairs)],
        ['MAO',         fmt$(mao)],
        ['First Offer', fmt$(firstOffer)],
        ['Buyer Profit',fmt$(buyerProfit)],
      ].map(([k, v]) => (
        <div key={k} className="flex justify-between py-1.5 border-b border-border-subtle/50 last:border-0">
          <span className="text-[11px] text-text-muted">{k}</span>
          <span className={`text-[12px] font-semibold ${k === 'MAO' || k === 'First Offer' ? 'text-gold' : 'text-text-primary'}`}>{v}</span>
        </div>
      ))}
    </div>
  )
}

export default function DealWorkspace() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [deal,         setDeal]        = useState(null)
  const [loading,      setLoading]     = useState(true)
  const [buyers,       setBuyers]      = useState([])
  const [titleCos,     setTitleCos]    = useState([])
  const [compliance,   setCompliance]  = useState(null)
  const [stage,        setStage]       = useState('')
  const [savingStage,  setSavingStage] = useState(false)
  const [genContract,  setGenContract] = useState(false)
  const [showRepairs,  setShowRepairs] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    dealsApi.getDeal(id)
      .then(r => {
        const d = r.data?.deal || r.data?.data || r.data
        setDeal(d)
        setStage(d?.status || 'new')
        // Load compliance for state
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
    try { await updateDeal({ status: stage }); toast.success('Stage updated') }
    finally { setSavingStage(false) }
  }

  const generateContract = async (type) => {
    setGenContract(true)
    try {
      const r = await dealsApi.generateContract(id, type)
      const url = r.data?.download_url || r.data?.url
      if (url) {
        window.open(url, '_blank')
      } else {
        toast.success(`${type.toUpperCase()} generated`)
      }
    } catch {
      toast.error('Contract generation failed')
    } finally { setGenContract(false) }
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

  if (loading) return <div className="p-8 text-center text-text-muted py-24">Loading deal…</div>
  if (!deal)   return <div className="p-8 text-center text-text-muted py-24">Deal not found</div>

  const arv     = deal.arv || 0
  const repairs = deal.repair_estimate || 0
  const mao     = Math.round(arv * 0.70 - repairs)
  const assignFee = (deal.buyer_price || 0) - (deal.seller_agreed_price || deal.offer_price || 0)

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/pipeline')}
            className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-secondary mb-3 transition-colors"
          >
            <ArrowLeft size={13} /> Back to Pipeline
          </button>
          <h1 className="text-[26px] font-medium text-white leading-tight">{deal.property_address}</h1>
          <p className="text-[13px] text-text-muted mt-0.5">
            {[deal.property_city, deal.property_state, deal.property_zip].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={stageBadge(deal.status)}>{deal.status || 'new'}</Badge>
          {assignFee > 0 && (
            <span className="text-[15px] font-bold text-gold">{fmt$(assignFee)} fee</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr,340px] gap-5">
        {/* ── Main column ── */}
        <div className="space-y-4">

          {/* Financials */}
          <Section title="Deal Financials" icon={FileText}>
            <div className="group">
              {[
                ['ARV',              deal.arv,                 '$'],
                ['Repair Estimate',  deal.repair_estimate,     '$'],
                ['MAO',              mao,                      '$'],
                ['Offer Price',      deal.offer_price,         '$'],
                ['Agreed Price',     deal.seller_agreed_price, '$'],
                ['Buyer Price',      deal.buyer_price,         '$'],
                ['Assignment Fee',   assignFee > 0 ? assignFee : null, '$'],
                ['Closing Date',     deal.closing_date,        ''],
              ].filter(([,v]) => v != null && v !== 0).map(([k, v, pfx]) => (
                <EditableField
                  key={k}
                  label={k}
                  value={pfx === '$' ? v : v}
                  prefix={pfx}
                  type={pfx === '$' ? 'number' : 'text'}
                  onSave={val => updateDeal({ [fieldKey(k)]: pfx === '$' ? Number(val) : val })}
                />
              ))}
            </div>

            {arv > 0 && (
              <button
                onClick={() => setShowRepairs(v => !v)}
                className="mt-4 flex items-center gap-1.5 text-[12px] text-text-muted hover:text-primary transition-colors"
              >
                <Wrench size={12} />
                {showRepairs ? 'Hide' : 'Open'} Repair Estimator
              </button>
            )}

            {showRepairs && (
              <div className="mt-4 border-t border-border-subtle pt-4">
                <RepairEstimator onEstimate={applyRepairEstimate} />
              </div>
            )}
          </Section>

          {/* Three scenarios */}
          {arv > 0 && (
            <Section title="Three-Scenario Analysis" icon={FileText}>
              <div className="grid grid-cols-3 gap-3">
                <ScenarioCard label="Conservative" color="text-danger"
                  arv={Math.round(arv * 0.90)} repairs={Math.round(repairs * 1.20)} />
                <ScenarioCard label="Moderate" color="text-warning"
                  arv={arv} repairs={repairs} />
                <ScenarioCard label="Aggressive" color="text-primary"
                  arv={Math.round(arv * 1.05)} repairs={Math.round(repairs * 0.90)} />
              </div>
            </Section>
          )}

          {/* Contract management */}
          <Section title="Contracts" icon={FileText}>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-elevated rounded-lg border border-border-subtle">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Purchase & Sale Agreement (PSA)</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Between you and the seller</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" loading={genContract} onClick={() => generateContract('psa')}>
                    <FileText size={12} /> Generate
                  </Button>
                  <Button size="sm" onClick={() => sendContract('psa')}>
                    <Send size={12} /> Send
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-elevated rounded-lg border border-border-subtle">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Assignment Agreement</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Transfer contract to your buyer</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" loading={genContract} onClick={() => generateContract('assignment')}>
                    <FileText size={12} /> Generate
                  </Button>
                  <Button size="sm" onClick={() => sendContract('assignment')}>
                    <Send size={12} /> Send
                  </Button>
                </div>
              </div>

              {deal.contract_status && (
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-[6px]">
                  <Check size={12} className="text-primary" />
                  <span className="text-[12px] text-text-secondary">Contract status: <strong>{deal.contract_status}</strong></span>
                </div>
              )}
            </div>
          </Section>

          {/* Buyer matching */}
          <Section title="Buyer Matching" icon={Users}>
            {buyers.length === 0 ? (
              <p className="text-[13px] text-text-muted">No buyers in your list yet</p>
            ) : (
              <div className="space-y-2">
                {buyers
                  .filter(b => {
                    if (!b.buy_box_states?.length) return true
                    return b.buy_box_states.some(s =>
                      s.toUpperCase() === deal.property_state?.toUpperCase()
                    )
                  })
                  .slice(0, 8)
                  .map(b => (
                    <div key={b.id} className="flex items-center justify-between p-3 bg-elevated rounded-[6px] border border-border-subtle hover:border-border-default transition-colors">
                      <div>
                        <p className="text-[13px] font-medium text-text-primary">{b.name}</p>
                        <p className="text-[11px] text-text-muted">
                          {b.phone} {b.max_price ? `· Max ${fmt$(b.max_price)}` : ''}
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
                  ))
                }
                {buyers.filter(b => !b.buy_box_states?.length || b.buy_box_states.some(s => s.toUpperCase() === deal.property_state?.toUpperCase())).length === 0 && (
                  <p className="text-[13px] text-text-muted">No buyers match {deal.property_state}</p>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">

          {/* Stage control */}
          <div className="bg-card border border-border-subtle rounded-lg p-5">
            <h2 className="text-[13px] font-semibold text-white mb-3">Pipeline Stage</h2>
            <select
              value={stage}
              onChange={e => setStage(e.target.value)}
              className="w-full h-[38px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary mb-3"
            >
              {STAGES.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
            </select>
            <Button className="w-full" size="sm" loading={savingStage} onClick={saveStage}>
              Update Stage
            </Button>
          </div>

          {/* Lead info */}
          {deal.leads && (
            <div className="bg-card border border-border-subtle rounded-lg p-5">
              <h2 className="text-[13px] font-semibold text-white mb-3">Seller</h2>
              <div className="space-y-1.5">
                <p className="text-[14px] font-medium text-text-primary">
                  {deal.leads.first_name} {deal.leads.last_name}
                </p>
                {deal.leads.phone && (
                  <p className="text-[12px] text-text-muted">{deal.leads.phone}</p>
                )}
                {deal.leads.email && (
                  <p className="text-[12px] text-text-muted">{deal.leads.email}</p>
                )}
                {deal.leads.motivation_score != null && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="label-caps">Motivation</span>
                    <span className={`text-[14px] font-bold ${scoreColor(deal.leads.motivation_score)}`}>
                      {deal.leads.motivation_score}
                    </span>
                  </div>
                )}
                {deal.leads.seller_personality && (
                  <Badge variant="gray">{deal.leads.seller_personality}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Title company */}
          <div className="bg-card border border-border-subtle rounded-lg p-5">
            <h2 className="text-[13px] font-semibold text-white mb-3">Title Company</h2>
            {deal.title_company_id ? (
              <div>
                {titleCos.find(t => t.id === deal.title_company_id) && (() => {
                  const t = titleCos.find(tc => tc.id === deal.title_company_id)
                  return (
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">{t.name}</p>
                      {t.contact_name && <p className="text-[11px] text-text-muted">{t.contact_name}</p>}
                      {t.phone && <p className="text-[11px] text-text-muted">{t.phone}</p>}
                    </div>
                  )
                })()}
              </div>
            ) : (
              <div>
                {titleCos.length === 0 ? (
                  <p className="text-[12px] text-text-muted">No title companies added yet</p>
                ) : (
                  <select
                    onChange={e => { if (e.target.value) updateDeal({ title_company_id: e.target.value }) }}
                    defaultValue=""
                    className="w-full h-[36px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                  >
                    <option value="">Select title company…</option>
                    {titleCos.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* State compliance */}
          {compliance && (
            <div className={`bg-card border rounded-lg p-5 ${
              compliance.risk_level === 'high' ? 'border-danger/40' :
              compliance.risk_level === 'medium' ? 'border-warning/40' : 'border-border-subtle'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                <Shield size={13} className={
                  compliance.risk_level === 'high' ? 'text-danger' :
                  compliance.risk_level === 'medium' ? 'text-warning' : 'text-primary'
                } />
                <h2 className="text-[13px] font-semibold text-white">
                  {deal.property_state} Compliance
                </h2>
                <Badge variant={compliance.risk_level === 'high' ? 'red' : compliance.risk_level === 'medium' ? 'amber' : 'green'}>
                  {compliance.risk_level} risk
                </Badge>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed mb-2">{compliance.notes}</p>
              {compliance.cancellation_period_days > 0 && (
                <p className="text-[11px] text-warning font-medium">
                  ⚠️ Seller has {compliance.cancellation_period_days}-day cancel right
                </p>
              )}
              {compliance.disclosure_language && (
                <div className="mt-3 p-2.5 bg-surface rounded-[4px] border border-border-subtle">
                  <p className="text-[10px] text-text-muted leading-relaxed">{compliance.disclosure_language}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function stageBadge(s) {
  const m = { 'new':'gray','calling':'amber','contacted':'amber','offer made':'gold','negotiating':'amber','under contract':'green','buyer search':'amber','title':'green','closed':'green' }
  return m[s?.toLowerCase()] || 'gray'
}

function scoreColor(s) {
  if (s == null) return 'text-text-muted'
  if (s >= 70) return 'text-primary'
  if (s >= 40) return 'text-warning'
  return 'text-danger'
}

function fieldKey(label) {
  const m = {
    'ARV': 'arv',
    'Repair Estimate': 'repair_estimate',
    'MAO': 'mao',
    'Offer Price': 'offer_price',
    'Agreed Price': 'seller_agreed_price',
    'Buyer Price': 'buyer_price',
    'Assignment Fee': 'assignment_fee',
    'Closing Date': 'closing_date',
  }
  return m[label] || label.toLowerCase().replace(/\s+/g, '_')
}
