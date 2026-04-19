import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Phone, Zap, Mail, Mic, FileText } from 'lucide-react'
import useIntelStore from '../../store/intelStore'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import { calls as callsApi, leads as leadsApi } from '../../services/api'
import toast from 'react-hot-toast'

// ─── Shared small components ──────────────────────────────────────────────────
function PanelSection({ title, children }) {
  return (
    <div>
      <p className="label-caps mb-3" style={{ color: 'var(--t3)' }}>{title}</p>
      {children}
    </div>
  )
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-rest)' }}>
      <span style={{ fontSize: 12, color: 'var(--t2)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', ...(valueStyle || {}) }}>{value ?? '—'}</span>
    </div>
  )
}

function ActionBtn({ icon: Icon, label, onClick, variant = 'default' }) {
  const colors = {
    default: { bg: 'var(--s4)', text: 'var(--t2)', border: 'var(--border-rest)' },
    green:   { bg: 'var(--green)', text: '#000', border: 'transparent' },
    amber:   { bg: 'rgba(255,140,0,0.12)', text: 'var(--amber)', border: 'rgba(255,140,0,0.25)' },
  }
  const c = colors[variant] || colors.default
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 rounded transition-all duration-150"
      style={{
        height: 32,
        fontSize: 11,
        fontWeight: 500,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
      }}
    >
      {Icon && <Icon size={12} strokeWidth={1.8} />}
      {label}
    </button>
  )
}

// ─── System Mode (default) ────────────────────────────────────────────────────
function SystemPanel() {
  const { calls: liveCalls } = useLiveCalls()

  const AI_LOG = [
    { time: '4m ago',  text: 'Marcus Johnson scored 78', tag: 'motivation spike' },
    { time: '7m ago',  text: '3 leads enrolled in sequence', tag: 'not_interested' },
    { time: '12m ago', text: 'Postcard triggered → 1204 Pine', tag: '3rd no-answer' },
    { time: '18m ago', text: 'Inbound call matched to DB', tag: 'same lead' },
    { time: '1h ago',  text: 'Campaign paused', tag: 'daily limit' },
  ]

  return (
    <div className="p-4 space-y-5 animate-fade-in">
      <PanelSection title="Live Activity">
        {liveCalls.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' }}>No active calls</p>
        ) : (
          <div className="space-y-2">
            {liveCalls.slice(0, 3).map(c => (
              <div key={c.id}
                className="flex items-center gap-2 p-2 rounded-card"
                style={{ background: 'var(--s3)' }}
              >
                <span className="dot-live" style={{ width: 5, height: 5 }} />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t1)' }} className="truncate">
                    {c.leads?.first_name} {c.leads?.last_name}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--t3)' }} className="truncate">
                    {c.leads?.property_address || '—'}
                  </p>
                </div>
                {c.motivation_score != null && (
                  <span style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: c.motivation_score >= 70 ? 'var(--green)' : c.motivation_score >= 40 ? 'var(--amber)' : 'var(--red)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {c.motivation_score}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      <div style={{ height: 1, background: 'var(--border-rest)' }} />

      <PanelSection title="AI Activity">
        <div className="space-y-2.5">
          {AI_LOG.map((item, i) => (
            <div key={i} className="flex gap-2.5">
              <span style={{ fontSize: 10, color: 'var(--t4)', flexShrink: 0, paddingTop: 1, fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
                {item.time}
              </span>
              <div>
                <span style={{ fontSize: 12, color: 'var(--t2)' }}>{item.text}</span>
                <span style={{ fontSize: 10, color: 'var(--t4)', marginLeft: 6 }}>[{item.tag}]</span>
              </div>
            </div>
          ))}
        </div>
      </PanelSection>
    </div>
  )
}

// ─── Lead Mode ────────────────────────────────────────────────────────────────
function LeadPanel({ data: lead }) {
  const [dialing, setDialing] = React.useState(false)

  if (!lead) return <SystemPanel />

  const score = lead.motivation_score
  const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--amber)' : 'var(--red)'
  const scoreBar   = score != null ? `${Math.min(100, score)}%` : '0%'

  const fmt$ = (n) => n ? '$' + Number(n).toLocaleString() : '—'
  const fmtDate = (d) => d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : 'Never'

  const dialNow = async () => {
    if (lead.is_on_dnc) { toast.error('Lead is on DNC list'); return }
    setDialing(true)
    try {
      await callsApi.initiateCall({ lead_id: lead.id })
      toast.success('Call initiated')
    } catch (err) { toast.error(err.response?.data?.error || 'Call failed') }
    finally { setDialing(false) }
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Lead header */}
      <div className="p-4 pb-3" style={{ borderBottom: '1px solid var(--border-rest)' }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.3 }}>
          {lead.first_name} {lead.last_name}
        </p>
        <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
          {[lead.property_city, lead.property_state].filter(Boolean).join(', ') || '—'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Score */}
        {score != null && (
          <div>
            <div className="flex items-baseline gap-2 mb-2">
              <span style={{ fontSize: 48, fontWeight: 700, color: scoreColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {score}
              </span>
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>motivation</span>
            </div>
            <div style={{ height: 3, background: 'var(--s4)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: scoreBar, background: scoreColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        )}

        {/* Personality */}
        {lead.seller_personality && (
          <div className="p-3 rounded-card" style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.15)' }}>
            <p className="label-caps mb-1" style={{ color: 'var(--amber)' }}>{lead.seller_personality} Seller</p>
            <p style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.6 }}>
              {lead.seller_personality === 'Emotional'  && 'Lead with empathy before numbers.'}
              {lead.seller_personality === 'Analytical' && 'Provide data and comparables first.'}
              {lead.seller_personality === 'Skeptical'  && 'Build credibility before the offer.'}
              {lead.seller_personality === 'Motivated'  && 'Move fast — confirm urgency and close.'}
              {lead.seller_personality === 'Resistant'  && 'Plant seeds of value. Low pressure.'}
            </p>
          </div>
        )}

        {/* Key facts */}
        <PanelSection title="Property">
          <div>
            <StatRow label="Address" value={lead.property_address ? lead.property_address.split(',')[0] : '—'} />
            <StatRow label="ARV"     value={fmt$(lead.estimated_arv || lead.estimated_value)} valueStyle={{ color: 'var(--gold)' }} />
            <StatRow label="Equity"  value={fmt$(lead.estimated_equity)} />
            <StatRow label="Source"  value={lead.source} />
            <StatRow label="Last Call" value={fmtDate(lead.last_call_date)} />
          </div>
        </PanelSection>

        {/* AI Summary */}
        {lead.ai_summary && (
          <PanelSection title="AI Analysis">
            <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>{lead.ai_summary}</p>
          </PanelSection>
        )}
      </div>

      {/* Action strip */}
      <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--border-rest)', flexShrink: 0 }}>
        <div className="flex gap-2">
          <ActionBtn icon={Phone} label={dialing ? 'Dialing…' : lead.is_on_dnc ? 'DNC' : 'Dial Now'} onClick={dialNow} variant="green" />
          <ActionBtn icon={FileText} label="Create Deal" onClick={() => {}} />
        </div>
        <div className="flex gap-2">
          <ActionBtn icon={Mic} label="Drop VM" onClick={() => {}} />
          <ActionBtn icon={Zap} label="Skip Trace" onClick={() => {}} />
          <ActionBtn icon={Mail} label="Postcard" onClick={() => {}} />
        </div>
      </div>
    </div>
  )
}

// ─── Call Mode ────────────────────────────────────────────────────────────────
function CallPanel({ data: call }) {
  if (!call) return <SystemPanel />

  const score = call.motivation_score
  const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--amber)' : 'var(--red)'
  const fmt$ = (n) => n ? '$' + Number(n).toLocaleString() : '—'

  const signals = call.key_signals || []
  const objections = call.objections || []

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="p-4 pb-3" style={{ borderBottom: '1px solid var(--border-rest)' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>
          {call.lead_name || 'Live Call'}
        </p>
        <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
          {call.property_address || 'Address unknown'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Score */}
        {score != null && (
          <div className="flex items-baseline gap-2">
            <span style={{ fontSize: 48, fontWeight: 700, color: scoreColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {score}
            </span>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>↑ rising</span>
          </div>
        )}

        {/* Key signals */}
        {signals.length > 0 && (
          <PanelSection title="Signals Detected">
            <div className="flex flex-wrap gap-1.5">
              {signals.map((s, i) => (
                <span key={i} className="px-2 py-0.5 rounded-tight text-[10px] font-medium"
                  style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid rgba(0,229,122,0.2)' }}>
                  {s}
                </span>
              ))}
            </div>
          </PanelSection>
        )}

        {/* Coaching */}
        {call.coaching && (
          <PanelSection title="Coaching">
            <div className="p-3 rounded-card" style={{ background: 'rgba(0,229,122,0.05)', border: '1px solid rgba(0,229,122,0.15)' }}>
              <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>{call.coaching}</p>
            </div>
          </PanelSection>
        )}

        {/* Offer rec */}
        {call.offer_made && (
          <PanelSection title="Offer Made">
            <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>
              {fmt$(call.offer_made)}
            </p>
          </PanelSection>
        )}
      </div>
    </div>
  )
}

// ─── Deal Mode ────────────────────────────────────────────────────────────────
function DealPanel({ data: deal }) {
  if (!deal) return <SystemPanel />
  const fmt$ = (n) => n ? '$' + Number(n).toLocaleString() : '—'

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="p-4 pb-3" style={{ borderBottom: '1px solid var(--border-rest)' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.3 }}>
          {deal.property_address || 'Deal'}
        </p>
        <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
          {[deal.property_city, deal.property_state].filter(Boolean).join(', ')}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <PanelSection title="Deal Numbers">
          <div>
            <StatRow label="ARV"          value={fmt$(deal.arv)} />
            <StatRow label="Repairs est." value={fmt$(deal.repair_estimate)} />
            <StatRow label="MAO"          value={fmt$(deal.mao)} />
            <StatRow label="Agreed price" value={fmt$(deal.seller_agreed_price)} />
            <StatRow label="Buyer price"  value={fmt$(deal.buyer_price)} />
            <div className="flex items-center justify-between py-2">
              <span style={{ fontSize: 12, color: 'var(--t2)' }}>Assignment fee</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt$(deal.assignment_fee)}
              </span>
            </div>
          </div>
        </PanelSection>
      </div>
    </div>
  )
}

// ─── Root Intel Panel ─────────────────────────────────────────────────────────
export default function IntelPanel() {
  const { mode, data } = useIntelStore()

  return (
    <div
      className="layout-intel flex flex-col overflow-hidden"
      style={{
        background: 'var(--s1)',
        borderLeft: '1px solid var(--border-rest)',
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center px-4"
        style={{ height: 'var(--status-h)', borderBottom: '1px solid var(--border-rest)', flexShrink: 0 }}
      >
        <span className="label-caps" style={{ color: 'var(--t4)' }}>
          {mode === 'system' && 'System'}
          {mode === 'lead'   && 'Lead Context'}
          {mode === 'call'   && 'Call Intelligence'}
          {mode === 'deal'   && 'Deal Context'}
        </span>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {mode === 'system' && <SystemPanel />}
        {mode === 'lead'   && <LeadPanel data={data} />}
        {mode === 'call'   && <CallPanel data={data} />}
        {mode === 'deal'   && <DealPanel data={data} />}
      </div>
    </div>
  )
}
