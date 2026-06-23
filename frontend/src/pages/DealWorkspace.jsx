import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, FileText, Send, Users, Shield,
  ChevronDown, ChevronUp, Edit2, Check, X, Wrench, Image as ImageIcon, Upload, Zap, BookOpen, Download
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import RepairEstimator from '../components/ui/RepairEstimator'
import { deals as dealsApi, buyers as buyersApi, titleCompanies as titleApi, compliance as complianceApi, followUps as followUpsApi, propertyPhotos as propertyPhotosApi } from '../services/api'
import api from '../services/api'

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

function fmt$(n) { return n ? '$' + Math.round(Number(n)).toLocaleString() : '-' }

function formatTimestamp(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

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
function EditableField({ label, value, onSave, type = 'text', prefix = '', highlight, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value || '')
  const [hov, setHov]         = useState(false)

  const save = () => { onSave(draft); setEditing(false) }
  const cancel = () => { setDraft(value || ''); setEditing(false) }

  const displayVal = prefix === '$' && value
    ? '$' + Number(value).toLocaleString()
    : (value || '-')

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
          {hov && !readOnly && (
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
  const [activity,    setActivity]    = useState([])
  const [titleLog,    setTitleLog]    = useState(null)
  const [followUps,   setFollowUps]   = useState([])
  const [photos,      setPhotos]      = useState([])
  const [followUpAt,  setFollowUpAt]  = useState('')
  const [followUpReason, setFollowUpReason] = useState('')
  const [followUpType, setFollowUpType] = useState('text')
  const [stage,       setStage]       = useState('')
  const [savingStage, setSavingStage] = useState(false)
  const [genContract, setGenContract] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(null)
  const [previewContract, setPreviewContract] = useState(null)
  const [sendingToTitle, setSendingToTitle] = useState(false)
  const [schedulingFollowUp, setSchedulingFollowUp] = useState(false)
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [showRepairs, setShowRepairs] = useState(false)
  const [velocityScore, setVelocityScore] = useState(null)
  const [dealBrief, setDealBrief] = useState(null)
  const [loadingBrief, setLoadingBrief] = useState(false)
  // Post-contract lifecycle — EMD + assignment-fee suggester + wire instructions
  const [feeSuggestion, setFeeSuggestion] = useState(null)
  const [loadingFee, setLoadingFee] = useState(false)
  const [applyingFee, setApplyingFee] = useState(false)
  const [confirmingEMD, setConfirmingEMD] = useState(false)
  const [emdAmountDraft, setEmdAmountDraft] = useState('')
  const [emdHeldByDraft, setEmdHeldByDraft] = useState('title')
  const [wire, setWire] = useState(null)
  const [wireSource, setWireSource] = useState(null)
  const [wireDraft, setWireDraft] = useState(null)
  const [savingWire, setSavingWire] = useState(false)

  const loadWire = () => {
    dealsApi.getWire(id).then(r => {
      const d = r.data?.data || r.data
      setWire(d?.wire || null)
      setWireSource(d?.source || null)
    }).catch(() => { setWire(null); setWireSource(null) })
  }

  const loadActivity = () => {
    dealsApi.getDealActivity(id).then(r => {
      const raw = r.data?.activity ?? r.data?.data ?? r.data
      setActivity(Array.isArray(raw) ? raw : [])
    }).catch(() => setActivity([]))
  }

  const loadTitleLog = () => {
    dealsApi.getTitleLog(id).then(r => {
      setTitleLog(r.data?.title_log || null)
    }).catch(() => setTitleLog(null))
  }

  const loadFollowUps = () => {
    followUpsApi.getAll({ deal_id: id }).then(r => {
      const raw = r.data?.follow_ups ?? r.data?.data ?? r.data
      setFollowUps(Array.isArray(raw) ? raw : [])
    }).catch(() => setFollowUps([]))
  }

  const loadPhotos = () => {
    propertyPhotosApi.getByDeal(id).then(r => {
      setPhotos(Array.isArray(r.data?.photos) ? r.data.photos : [])
    }).catch(() => setPhotos([]))
  }

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

    loadActivity()
    loadTitleLog()
    loadFollowUps()
    loadPhotos()
    loadWire()

    // Load velocity score
    api.get(`/api/deals/${id}/velocity-score`).then(r => {
      setVelocityScore(r.data?.velocity_score ?? r.data?.score ?? null)
    }).catch(() => {})

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
      const r = await dealsApi.updateDeal(id, updates)
      const updated = r.data?.data || r.data
      setDeal(d => ({ ...d, ...(updated || updates) }))
      loadActivity()
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
      const result = r.data?.data || r.data || {}
      if (result.content) {
        setPreviewContract({ type, ...result })
        if (Array.isArray(result.missing) && result.missing.length) {
          toast(`Generated as draft — fill in: ${result.missing.join(', ')}`, { icon: '⚠️' })
        } else {
          toast.success(`${(result.doc_title || type).toString()} ready`)
        }
      } else {
        toast.success(`${type.toUpperCase()} generated`)
      }
    } catch { toast.error('Contract generation failed') }
    finally { setGenContract(false) }
  }

  const downloadContractPdf = async (type) => {
    setDownloadingPdf(type)
    try {
      const r = await dealsApi.downloadContractPdf(id, type)
      const blob = new Blob([r.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const addr = (deal.property_address || 'contract').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'contract'
      a.download = `${addr}-${type}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch { toast.error('PDF download failed') }
    finally { setDownloadingPdf(null) }
  }

  const sendContract = async (type) => {
    try {
      const r = await dealsApi.sendContract(id, type)
      toast.success('Contract sent to seller')
      await updateDeal({ contract_status: 'sent' })
      const signingUrl = r.data?.data?.signing_url || r.data?.signing_url
      if (signingUrl) window.open(signingUrl, '_blank', 'noopener,noreferrer')
    } catch { toast.error('Failed to send contract') }
  }

  const sendToTitle = async () => {
    if (!deal.title_company_id) {
      toast.error('Select a title company first')
      return
    }

    setSendingToTitle(true)
    try {
      const r = await dealsApi.sendToTitle(id, {
        title_company_id: deal.title_company_id,
        closing_date: deal.closing_date || null,
      })
      const payload = r.data?.data || {}
      if (payload.deal) setDeal(d => ({ ...d, ...payload.deal }))
      setTitleLog(payload.title_log || null)
      loadActivity()
      toast.success('Deal sent to title')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send to title')
    } finally {
      setSendingToTitle(false)
    }
  }

  // ── Assignment-fee suggester ─────────────────────────────────────────────
  const loadFeeSuggestion = async () => {
    setLoadingFee(true)
    try {
      const r = await dealsApi.getFeeSuggestion(id)
      setFeeSuggestion(r.data?.data || r.data || null)
    } catch { toast.error('Fee suggestion failed') }
    finally { setLoadingFee(false) }
  }

  const applyFee = async () => {
    if (!feeSuggestion || feeSuggestion.suggested == null) return
    setApplyingFee(true)
    try {
      const r = await dealsApi.applyFeeSuggestion(id, { assignment_fee: feeSuggestion.suggested })
      const updated = r.data?.data?.deal || r.data?.deal || null
      if (updated) setDeal(d => ({ ...d, ...updated }))
      else setDeal(d => ({ ...d, assignment_fee: feeSuggestion.suggested, assignment_fee_suggested: feeSuggestion.suggested, assignment_fee_basis: feeSuggestion.basis }))
      loadActivity()
      toast.success(`Assignment fee set to ${fmt$(feeSuggestion.suggested)}`)
    } catch { toast.error('Failed to apply fee') }
    finally { setApplyingFee(false) }
  }

  // ── EMD confirm ──────────────────────────────────────────────────────────
  const confirmEMD = async () => {
    setConfirmingEMD(true)
    try {
      const body = {}
      if (emdAmountDraft) body.emd_amount = Number(emdAmountDraft)
      if (emdHeldByDraft) body.emd_held_by = emdHeldByDraft
      const r = await dealsApi.confirmEMD(id, body)
      const updated = r.data?.data?.deal || r.data?.deal || null
      if (updated) setDeal(d => ({ ...d, ...updated }))
      else setDeal(d => ({ ...d, emd_status: 'received', emd_received_at: new Date().toISOString() }))
      loadActivity()
      toast.success('EMD confirmed received')
    } catch { toast.error('Failed to confirm EMD') }
    finally { setConfirmingEMD(false) }
  }

  // ── Wire instructions (per-deal override) ─────────────────────────────────
  const startWireEdit = () => {
    setWireDraft({
      wire_bank_name:     wire?.wire_bank_name || '',
      wire_account_name:  wire?.wire_account_name || '',
      wire_routing_last4: wire?.wire_routing_last4 || '',
      wire_account_last4: wire?.wire_account_last4 || '',
      wire_instructions:  wire?.wire_instructions || '',
    })
  }

  const saveWire = async () => {
    if (!wireDraft) return
    setSavingWire(true)
    try {
      await dealsApi.saveWire(id, wireDraft)
      loadWire()
      loadActivity()
      setWireDraft(null)
      toast.success('Wire instructions saved for this deal')
    } catch { toast.error('Failed to save wire instructions') }
    finally { setSavingWire(false) }
  }

  const scheduleFollowUp = async () => {
    if (!followUpAt || !followUpReason.trim()) {
      toast.error('Pick a time and add a reason')
      return
    }
    setSchedulingFollowUp(true)
    try {
      await followUpsApi.createFollowUp({
        deal_id: id,
        contact_id: deal.lead_id || null,
        contact_type: 'seller',
        follow_up_type: followUpType,
        next_follow_up_at: new Date(followUpAt).toISOString(),
        reason: followUpReason.trim(),
      })
      setFollowUpReason('')
      setFollowUpAt('')
      setFollowUpType('text')
      loadFollowUps()
      loadActivity()
      toast.success('Follow-up scheduled')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to schedule follow-up')
    } finally {
      setSchedulingFollowUp(false)
    }
  }

  const uploadPhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    setUploadingPhotos(true)
    try {
      const serialized = await Promise.all(files.slice(0, 12).map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result || '')
          const [, base64 = ''] = result.split(',')
          resolve({
            filename: file.name,
            content_type: file.type || 'image/jpeg',
            data_base64: base64,
            caption: file.name,
          })
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })))

      await propertyPhotosApi.upload({
        deal_id: id,
        photos: serialized,
      })
      loadPhotos()
      loadActivity()
      toast.success('Property photos uploaded')
      event.target.value = ''
    } catch (err) {
      toast.error(err.response?.data?.error || 'Photo upload failed')
    } finally {
      setUploadingPhotos(false)
    }
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
  const assignFee = Math.max(0, (Number(deal.buyer_price) || 0) - (Number(deal.seller_agreed_price) || Number(deal.offer_price) || 0))

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
                        <FileText size={11} /> Preview
                      </Button>
                      <Button variant="secondary" size="sm" loading={downloadingPdf === contract.key} onClick={() => downloadContractPdf(contract.key)}>
                        <Download size={11} /> PDF
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

              {/* Contract preview modal */}
              {previewContract && (
                <div
                  onClick={() => setPreviewContract(null)}
                  style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 24,
                  }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: 'min(760px, 96vw)', maxHeight: '90vh',
                      display: 'flex', flexDirection: 'column',
                      background: 'var(--s1)', border: '1px solid var(--border-rest)',
                      borderRadius: 8, overflow: 'hidden',
                    }}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderBottom: '1px solid var(--border-rest)',
                    }}>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>
                          {previewContract.doc_title || 'Contract'}
                        </p>
                        {previewContract.strategy && (
                          <p style={{ fontSize: 11, color: 'var(--t4)', marginTop: 2 }}>
                            Strategy: {previewContract.strategy}
                            {previewContract.ready === false ? ' · DRAFT (missing fields)' : ''}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setPreviewContract(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {Array.isArray(previewContract.missing) && previewContract.missing.length > 0 && (
                      <div style={{
                        padding: '8px 16px',
                        background: 'rgba(245,158,11,0.08)',
                        borderBottom: '1px solid rgba(245,158,11,0.2)',
                        fontSize: 12, color: 'var(--amber)',
                      }}>
                        Fill in before signing: {previewContract.missing.join(', ')}
                      </div>
                    )}

                    <pre style={{
                      flex: 1, overflow: 'auto', margin: 0,
                      padding: 16, fontSize: 11.5, lineHeight: 1.55,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: 'var(--t2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {previewContract.content}
                    </pre>

                    <div style={{
                      display: 'flex', justifyContent: 'flex-end', gap: 8,
                      padding: '12px 16px', borderTop: '1px solid var(--border-rest)',
                    }}>
                      <Button
                        variant="secondary" size="sm"
                        loading={downloadingPdf === previewContract.type}
                        onClick={() => downloadContractPdf(previewContract.type)}
                      >
                        <Download size={11} /> Download PDF
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => { sendContract(previewContract.type); setPreviewContract(null) }}>
                        <Send size={11} /> Send
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Section>

            {/* EMD + Assignment Fee (post-contract lifecycle) */}
            <Section title="EMD & Assignment Fee" icon={Shield}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                {/* EMD card */}
                <div style={{ background: 'var(--s2)', border: '1px solid var(--border-rest)', borderRadius: 6, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)' }}>
                      Earnest Money
                    </span>
                    <Badge variant={
                      deal.emd_status === 'received' ? 'green' :
                      deal.emd_status === 'requested' ? 'gold' :
                      deal.emd_status === 'forfeited' ? 'red' : 'gray'
                    }>
                      {deal.emd_status || 'none'}
                    </Badge>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-rest)' }}>
                    <span style={{ fontSize: 11, color: 'var(--t4)' }}>Amount</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>{fmt$(deal.emd_amount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-rest)' }}>
                    <span style={{ fontSize: 11, color: 'var(--t4)' }}>Refundable</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: deal.emd_refundable ? 'var(--amber)' : 'var(--t2)' }}>
                      {deal.emd_refundable ? 'Yes' : 'No'}
                    </span>
                  </div>
                  {deal.emd_requested_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-rest)' }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>Requested</span>
                      <span style={{ fontSize: 11, color: 'var(--t2)' }}>{formatTimestamp(deal.emd_requested_at)}</span>
                    </div>
                  )}
                  {deal.emd_received_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-rest)' }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>Received</span>
                      <span style={{ fontSize: 11, color: 'var(--green)' }}>{formatTimestamp(deal.emd_received_at)}</span>
                    </div>
                  )}

                  {deal.emd_status !== 'received' && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        type="number"
                        value={emdAmountDraft}
                        onChange={e => setEmdAmountDraft(e.target.value)}
                        placeholder={deal.emd_amount ? `Amount (${fmt$(deal.emd_amount)})` : 'EMD amount'}
                        style={{ height: 32, background: 'var(--s1)', border: '1px solid var(--border-rest)', borderRadius: 5, padding: '0 10px', fontSize: 12, color: 'var(--t1)', outline: 'none', fontFamily: 'inherit' }}
                      />
                      <select
                        value={emdHeldByDraft}
                        onChange={e => setEmdHeldByDraft(e.target.value)}
                        style={{ height: 32, background: 'var(--s1)', border: '1px solid var(--border-rest)', borderRadius: 5, padding: '0 10px', fontSize: 12, color: 'var(--t2)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
                      >
                        <option value="title">Held by Title</option>
                        <option value="operator">Held by Operator</option>
                      </select>
                      <Button variant="primary" size="sm" loading={confirmingEMD} onClick={confirmEMD}>
                        <Check size={11} /> Confirm EMD Received
                      </Button>
                    </div>
                  )}
                </div>

                {/* Assignment fee suggester card */}
                <div style={{ background: 'var(--s2)', border: '1px solid var(--border-rest)', borderRadius: 6, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)' }}>
                      Assignment Fee
                    </span>
                    {deal.assignment_fee != null && deal.assignment_fee !== 0 && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>{fmt$(deal.assignment_fee)}</span>
                    )}
                  </div>

                  {!feeSuggestion ? (
                    <Button variant="secondary" size="sm" style={{ width: '100%' }} loading={loadingFee} onClick={loadFeeSuggestion}>
                      <Zap size={11} /> Suggest Fee
                    </Button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {feeSuggestion.suggested != null ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 11, color: 'var(--t4)' }}>Suggested</span>
                            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold)' }}>{fmt$(feeSuggestion.suggested)}</span>
                          </div>
                          {(feeSuggestion.floor != null && feeSuggestion.ceiling != null) && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 11, color: 'var(--t4)' }}>Range</span>
                              <span style={{ fontSize: 11, color: 'var(--t2)' }}>{fmt$(feeSuggestion.floor)} – {fmt$(feeSuggestion.ceiling)}</span>
                            </div>
                          )}
                          {feeSuggestion.basis?.reason && (
                            <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5, margin: '4px 0 0' }}>
                              {feeSuggestion.basis.reason}
                            </p>
                          )}
                          <Button variant="primary" size="sm" style={{ width: '100%' }} loading={applyingFee} onClick={applyFee}>
                            <Check size={11} /> Apply {fmt$(feeSuggestion.suggested)}
                          </Button>
                        </>
                      ) : (
                        <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
                          {feeSuggestion.basis?.reason || 'Set buyer + seller pricing to derive a fee.'}
                        </p>
                      )}
                      <button
                        onClick={loadFeeSuggestion}
                        style={{ background: 'none', border: 'none', color: 'var(--t4)', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}
                      >
                        Re-calculate
                      </button>
                    </div>
                  )}
                </div>
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

            <Section title="Execution Timeline" icon={FileText}>
              {activity.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--t3)' }}>No activity logged yet for this deal</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activity.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '12px 14px',
                        background: 'var(--s2)',
                        border: '1px solid var(--border-rest)',
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <p style={{ fontSize: 13, color: 'var(--t1)', marginBottom: 3 }}>{item.message}</p>
                        <p style={{ fontSize: 10, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {String(item.activity_type || '').replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--t4)', whiteSpace: 'nowrap' }}>
                        {formatTimestamp(item.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Follow-Up Queue" icon={Send}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 120px', gap: 10, marginBottom: 14 }}>
                <input
                  value={followUpReason}
                  onChange={e => setFollowUpReason(e.target.value)}
                  placeholder="Reason for the next touchpoint"
                  style={{
                    height: 36, background: 'var(--s2)', border: '1px solid var(--border-rest)',
                    borderRadius: 6, padding: '0 10px', color: 'var(--t1)', fontSize: 12, outline: 'none',
                  }}
                />
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={e => setFollowUpAt(e.target.value)}
                  style={{
                    height: 36, background: 'var(--s2)', border: '1px solid var(--border-rest)',
                    borderRadius: 6, padding: '0 10px', color: 'var(--t1)', fontSize: 12, outline: 'none',
                  }}
                />
                <select
                  value={followUpType}
                  onChange={e => setFollowUpType(e.target.value)}
                  style={{
                    height: 36, background: 'var(--s2)', border: '1px solid var(--border-rest)',
                    borderRadius: 6, padding: '0 10px', color: 'var(--t1)', fontSize: 12, outline: 'none',
                  }}
                >
                  <option value="text">Text</option>
                  <option value="voice_call">Voice Call</option>
                  <option value="alert">Alert</option>
                </select>
              </div>
              <Button variant="primary" size="sm" loading={schedulingFollowUp} onClick={scheduleFollowUp}>
                <Send size={11} /> Schedule Follow-Up
              </Button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {followUps.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--t3)' }}>No follow-ups scheduled for this deal yet.</p>
                ) : followUps.map(item => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 12px',
                      background: 'var(--s2)',
                      border: '1px solid var(--border-rest)',
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 3 }}>{item.reason}</p>
                      <p style={{ fontSize: 10, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {String(item.follow_up_type || '').replace(/_/g, ' ')} · {item.status}
                      </p>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                      {formatTimestamp(item.next_follow_up_at)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Property Photos" icon={ImageIcon}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>
                    {photos.length} seller photo{photos.length === 1 ? '' : 's'} attached to this deal
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--t4)', margin: '4px 0 0' }}>
                    Upload property-condition photos and share them with buyers from the gallery.
                  </p>
                </div>
                <Link
                  to={`/deals/${id}/photos`}
                  style={{ fontSize: 12, color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  Open gallery
                </Link>
              </div>

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 34,
                  padding: '0 12px',
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--t2)',
                  fontSize: 12,
                  cursor: uploadingPhotos ? 'not-allowed' : 'pointer',
                  opacity: uploadingPhotos ? 0.6 : 1,
                }}
              >
                <Upload size={12} />
                {uploadingPhotos ? 'Uploading…' : 'Upload photos'}
                <input type="file" accept="image/*" multiple onChange={uploadPhotos} style={{ display: 'none' }} disabled={uploadingPhotos} />
              </label>

              {photos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
                  {photos.slice(0, 6).map((photo) => (
                    <div
                      key={photo.id}
                      style={{
                        background: 'var(--s2)',
                        border: '1px solid var(--border-rest)',
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      {photo.signed_url ? (
                        <img src={photo.signed_url} alt={photo.caption || 'Property'} style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ height: 96, background: 'var(--surface-bg)' }} />
                      )}
                      <div style={{ padding: 8 }}>
                        <p style={{ fontSize: 10, color: 'var(--t4)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {photo.caption || 'Seller photo'}
                        </p>
                      </div>
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

            {/* Velocity Score + Smart Deal Brief */}
            <div style={{ background: 'var(--s1)', border: '1px solid var(--border-rest)', borderRadius: 8, padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 10 }}>
                Deal Intelligence
              </p>

              {/* Velocity Score */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={13} style={{ color: velocityScore >= 70 ? '#00C37A' : velocityScore >= 40 ? '#B8922A' : 'var(--t4)' }} />
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>Velocity Score</span>
                </div>
                <span style={{
                  fontSize: 18, fontWeight: 800,
                  color: velocityScore == null ? 'var(--t4)' : velocityScore >= 70 ? '#00C37A' : velocityScore >= 40 ? '#B8922A' : '#D93030'
                }}>
                  {velocityScore != null ? velocityScore : '-'}
                </span>
              </div>
              {velocityScore != null && (
                <div style={{ height: 4, background: 'var(--surface-bg)', borderRadius: 4, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${velocityScore}%`, borderRadius: 4, transition: 'width 0.5s ease', background: velocityScore >= 70 ? '#00C37A' : velocityScore >= 40 ? '#B8922A' : '#D93030' }} />
                </div>
              )}

              {/* Smart Deal Brief */}
              <button
                onClick={async () => {
                  setLoadingBrief(true)
                  try {
                    const r = await api.get(`/api/deals/${id}/brief`)
                    setDealBrief(r.data?.brief || r.data?.data || null)
                  } catch { toast.error('Brief generation failed') }
                  finally { setLoadingBrief(false) }
                }}
                disabled={loadingBrief}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 0', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--surface-bg)', color: 'var(--t2)', fontSize: 12, fontWeight: 600,
                  cursor: loadingBrief ? 'not-allowed' : 'pointer', opacity: loadingBrief ? 0.6 : 1,
                  fontFamily: 'inherit', transition: 'all 0.15s ease',
                }}
              >
                <BookOpen size={12} />
                {loadingBrief ? 'Generating…' : 'Generate Deal Brief'}
              </button>

              {dealBrief && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(0,195,122,0.04)', border: '1px solid rgba(0,195,122,0.15)',
                  borderRadius: 7, fontSize: 12, color: 'var(--t2)', lineHeight: 1.6,
                  maxHeight: 200, overflowY: 'auto',
                }}>
                  {typeof dealBrief === 'string' ? dealBrief : JSON.stringify(dealBrief, null, 2)}
                </div>
              )}
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
                    {t.email && <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{t.email}</p>}
                    <div style={{ marginTop: 10 }}>
                      <Button variant="primary" size="sm" style={{ width: '100%' }} loading={sendingToTitle} onClick={sendToTitle}>
                        <Send size={11} /> Send to Title
                      </Button>
                    </div>
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

            <div style={{
              background: 'var(--s1)',
              border: '1px solid var(--border-rest)',
              borderRadius: 8,
              padding: '14px 16px',
            }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 10 }}>
                Title Status
              </p>
              {titleLog ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--t3)' }}>Status</span>
                    <Badge variant={titleLog.status === 'closed' ? 'green' : titleLog.status === 'funding_pending' ? 'gold' : 'amber'}>
                      {titleLog.status || 'documents_sent'}
                    </Badge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--t3)' }}>Sent to title</span>
                    <span style={{ fontSize: 12, color: 'var(--t2)' }}>{formatTimestamp(titleLog.sent_to_title_at)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--t3)' }}>Closing date</span>
                    <span style={{ fontSize: 12, color: 'var(--t2)' }}>{titleLog.closing_date || deal.closing_date || '-'}</span>
                  </div>
                  {titleLog.title_contact_name && (
                    <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-rest)' }}>
                      <p style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 2 }}>{titleLog.title_contact_name}</p>
                      {titleLog.title_contact_phone && <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>{titleLog.title_contact_phone}</p>}
                      {titleLog.title_contact_email && <p style={{ fontSize: 11, color: 'var(--t3)' }}>{titleLog.title_contact_email}</p>}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6 }}>
                  This deal has not been sent to title yet.
                </p>
              )}
            </div>

            {/* Wire / escrow instructions (default + per-deal override) */}
            <div style={{
              background: 'var(--s1)',
              border: '1px solid var(--border-rest)',
              borderRadius: 8,
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)' }}>
                  Wire Instructions
                </p>
                {wireSource && (
                  <Badge variant={wireSource === 'deal_override' ? 'gold' : 'gray'}>
                    {wireSource === 'deal_override' ? 'deal override' : 'title default'}
                  </Badge>
                )}
              </div>

              {wireDraft ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['wire_bank_name', 'Bank name'],
                    ['wire_account_name', 'Account name'],
                    ['wire_routing_last4', 'Routing last-4'],
                    ['wire_account_last4', 'Account last-4'],
                  ].map(([k, ph]) => (
                    <input
                      key={k}
                      value={wireDraft[k]}
                      onChange={e => setWireDraft(w => ({ ...w, [k]: e.target.value }))}
                      placeholder={ph}
                      style={{ height: 32, background: 'var(--s2)', border: '1px solid var(--border-rest)', borderRadius: 5, padding: '0 10px', fontSize: 12, color: 'var(--t1)', outline: 'none', fontFamily: 'inherit' }}
                    />
                  ))}
                  <textarea
                    value={wireDraft.wire_instructions}
                    onChange={e => setWireDraft(w => ({ ...w, wire_instructions: e.target.value }))}
                    placeholder="Free-text wire / escrow instructions"
                    rows={3}
                    style={{ background: 'var(--s2)', border: '1px solid var(--border-rest)', borderRadius: 5, padding: '8px 10px', fontSize: 12, color: 'var(--t1)', outline: 'none', fontFamily: 'inherit', resize: 'vertical' }}
                  />
                  <p style={{ fontSize: 10, color: 'var(--t4)', lineHeight: 1.5, margin: 0 }}>
                    Store only last-4 references — never full account or routing numbers.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="primary" size="sm" loading={savingWire} onClick={saveWire}>Save for this deal</Button>
                    <Button variant="secondary" size="sm" onClick={() => setWireDraft(null)}>Cancel</Button>
                  </div>
                </div>
              ) : wire && (wire.wire_bank_name || wire.wire_instructions || wire.wire_account_last4) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wire.wire_bank_name && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>Bank</span>
                      <span style={{ fontSize: 12, color: 'var(--t1)' }}>{wire.wire_bank_name}</span>
                    </div>
                  )}
                  {wire.wire_account_name && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>Account</span>
                      <span style={{ fontSize: 12, color: 'var(--t1)' }}>{wire.wire_account_name}</span>
                    </div>
                  )}
                  {wire.wire_routing_last4 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>Routing</span>
                      <span style={{ fontSize: 12, color: 'var(--t2)' }}>•••• {wire.wire_routing_last4}</span>
                    </div>
                  )}
                  {wire.wire_account_last4 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>Acct #</span>
                      <span style={{ fontSize: 12, color: 'var(--t2)' }}>•••• {wire.wire_account_last4}</span>
                    </div>
                  )}
                  {wire.wire_instructions && (
                    <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.6, margin: '4px 0 0', paddingTop: 6, borderTop: '1px solid var(--border-rest)' }}>
                      {wire.wire_instructions}
                    </p>
                  )}
                  <button
                    onClick={startWireEdit}
                    style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--green)', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}
                  >
                    {wireSource === 'deal_override' ? 'Edit deal override' : 'Override for this deal'}
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6, marginBottom: 8 }}>
                    No wire instructions on file. Set a default on the title company, or add a per-deal override.
                  </p>
                  <Button variant="secondary" size="sm" onClick={startWireEdit}>Add wire override</Button>
                </div>
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
