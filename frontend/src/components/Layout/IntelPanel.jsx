import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Phone, Zap, Mail, Mic, FileText } from 'lucide-react'
import useIntelStore from '../../store/intelStore'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import { calls as callsApi } from '../../services/api'
import toast from 'react-hot-toast'

// ─── Shared components ────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div>
      <p style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)',
        marginBottom: 10,
      }}>
        {title}
      </p>
      {children}
    </div>
  )
}

function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.80)', fontVariantNumeric: 'tabular-nums', ...(valueStyle || {}) }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function ActionBtn({ icon: Icon, label, onClick, variant = 'default' }) {
  const styles = {
    default: { bg: 'rgba(255,255,255,0.04)', text: 'rgba(255,255,255,0.55)', border: 'rgba(255,255,255,0.08)' },
    green:   { bg: '#00C37A', text: '#000',   border: 'transparent' },
    amber:   { bg: 'rgba(255,149,0,0.10)', text: '#FF9500', border: 'rgba(255,149,0,0.22)' },
  }
  const s = styles[variant] || styles.default
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        fontSize: 11, fontWeight: 500,
        background: s.bg, color: s.text,
        border: `1px solid ${s.border}`,
        borderRadius: 7, cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {Icon && <Icon size={11} strokeWidth={2} />}
      {label}
    </button>
  )
}

function scoreColor(s) {
  if (s == null) return 'rgba(255,255,255,0.40)'
  if (s >= 70) return '#00C37A'
  if (s >= 40) return '#FF9500'
  return '#FF4444'
}
function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : '—' }
function fmtDate(d) { return d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : 'Never' }

// ─── System Mode ──────────────────────────────────────────────────────────────
function SystemPanel() {
  const { calls: liveCalls } = useLiveCalls()

  const AI_LOG = [
    { time: '4m',  text: 'Marcus Johnson scored 78', tag: 'motivation spike' },
    { time: '7m',  text: '3 leads enrolled in sequence', tag: 'no answer' },
    { time: '12m', text: 'Postcard triggered → 1204 Pine', tag: '3rd no-answer' },
    { time: '18m', text: 'Inbound call matched to DB', tag: 'same lead' },
    { time: '1h',  text: 'Campaign paused', tag: 'daily limit' },
  ]

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Section title="Live Activity">
        {liveCalls.length === 0 ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>No active calls</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {liveCalls.slice(0, 3).map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                background: 'rgba(0,195,122,0.04)',
                border: '1px solid rgba(0,195,122,0.12)',
                borderRadius: 8,
              }}>
                <span className="live-dot" style={{ width: 5, height: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.leads?.first_name} {c.leads?.last_name}
                  </p>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.leads?.property_address || '—'}
                  </p>
                </div>
                {c.motivation_score != null && (
                  <span style={{
                    fontSize: 14, fontWeight: 700,
                    color: scoreColor(c.motivation_score),
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  }}>
                    {c.motivation_score}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

      <Section title="AI Activity">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {AI_LOG.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              <span style={{
                fontSize: 10, color: 'rgba(255,255,255,0.22)',
                flexShrink: 0, paddingTop: 1,
                fontVariantNumeric: 'tabular-nums', minWidth: 22,
              }}>
                {item.time}
              </span>
              <div>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{item.text}</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)', marginLeft: 5 }}>[{item.tag}]</span>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ─── Lead Mode ────────────────────────────────────────────────────────────────
function LeadPanel({ data: lead }) {
  const [dialing, setDialing] = React.useState(false)
  if (!lead) return <SystemPanel />

  const score = lead.motivation_score
  const color = scoreColor(score)

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
          {lead.first_name} {lead.last_name}
        </p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
          {[lead.property_city, lead.property_state].filter(Boolean).join(', ') || '—'}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Score */}
        {score != null && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 48, fontWeight: 700, color, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                {score}
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>motivation</span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(100, score)}%`,
                background: color, borderRadius: 2,
                boxShadow: `0 0 8px ${color}70`,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        )}

        {/* Personality badge */}
        {lead.seller_personality && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(255,149,0,0.06)',
            border: '1px solid rgba(255,149,0,0.15)',
          }}>
            <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF9500', marginBottom: 5 }}>
              {lead.seller_personality} Seller
            </p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
              {lead.seller_personality === 'Emotional'  && 'Lead with empathy before numbers.'}
              {lead.seller_personality === 'Analytical' && 'Provide data and comparables first.'}
              {lead.seller_personality === 'Skeptical'  && 'Build credibility before the offer.'}
              {lead.seller_personality === 'Motivated'  && 'Move fast — confirm urgency and close.'}
              {lead.seller_personality === 'Resistant'  && 'Plant seeds of value. Low pressure.'}
            </p>
          </div>
        )}

        {/* Property facts */}
        <Section title="Property">
          <div>
            <StatRow label="Address" value={lead.property_address ? lead.property_address.split(',')[0] : '—'} />
            <StatRow label="ARV"     value={fmt$(lead.estimated_arv || lead.estimated_value)} valueStyle={{ color: '#C9A84C' }} />
            <StatRow label="Equity"  value={fmt$(lead.estimated_equity)} />
            <StatRow label="Source"  value={lead.source} />
            <StatRow label="Last Call" value={fmtDate(lead.last_call_date)} />
          </div>
        </Section>

        {/* AI Summary */}
        {lead.ai_summary && (
          <Section title="AI Analysis">
            <div style={{
              fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7,
              background: 'rgba(0,195,122,0.04)',
              border: '1px solid rgba(0,195,122,0.10)',
              borderLeft: '2px solid rgba(0,195,122,0.35)',
              padding: '10px 12px', borderRadius: '0 7px 7px 0',
            }}>
              {lead.ai_summary}
            </div>
          </Section>
        )}
      </div>

      {/* Action strip */}
      <div style={{ padding: '10px 12px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <ActionBtn icon={Phone} label={dialing ? 'Dialing…' : lead.is_on_dnc ? 'DNC' : 'Dial Now'} onClick={dialNow} variant="green" />
          <ActionBtn icon={FileText} label="Create Deal" onClick={() => {}} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
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
  const color = scoreColor(score)
  const signals = call.key_signals || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', letterSpacing: '-0.01em' }}>
          {call.lead_name || 'Live Call'}
        </p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
          {call.property_address || 'Address unknown'}
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {score != null && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 48, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>
                {score}
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>↑ rising</span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 2 }} />
            </div>
          </div>
        )}

        {signals.length > 0 && (
          <Section title="Signals Detected">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {signals.map((s, i) => (
                <span key={i} style={{
                  padding: '3px 8px', borderRadius: 4,
                  fontSize: 10, fontWeight: 600,
                  background: 'rgba(0,195,122,0.08)',
                  color: '#00C37A',
                  border: '1px solid rgba(0,195,122,0.18)',
                }}>
                  {s}
                </span>
              ))}
            </div>
          </Section>
        )}

        {call.coaching && (
          <Section title="Coaching">
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(0,195,122,0.04)',
              border: '1px solid rgba(0,195,122,0.12)',
              fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7,
            }}>
              {call.coaching}
            </div>
          </Section>
        )}

        {call.offer_made && (
          <Section title="Offer Made">
            <p style={{ fontSize: 28, fontWeight: 700, color: '#C9A84C', fontVariantNumeric: 'tabular-nums' }}>
              {fmt$(call.offer_made)}
            </p>
          </Section>
        )}
      </div>
    </div>
  )
}

// ─── Deal Mode ────────────────────────────────────────────────────────────────
function DealPanel({ data: deal }) {
  if (!deal) return <SystemPanel />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
          {deal.property_address || 'Deal'}
        </p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
          {[deal.property_city, deal.property_state].filter(Boolean).join(', ')}
        </p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <Section title="Deal Numbers">
          <div>
            <StatRow label="ARV"          value={fmt$(deal.arv)} />
            <StatRow label="Repairs est." value={fmt$(deal.repair_estimate)} />
            <StatRow label="MAO"          value={fmt$(deal.mao)} />
            <StatRow label="Agreed price" value={fmt$(deal.seller_agreed_price)} />
            <StatRow label="Buyer price"  value={fmt$(deal.buyer_price)} />
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>Assignment fee</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#C9A84C', fontVariantNumeric: 'tabular-nums' }}>
                {fmt$(deal.assignment_fee)}
              </span>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ─── Root Intel Panel ─────────────────────────────────────────────────────────
export default function IntelPanel() {
  const { mode, data } = useIntelStore()

  const modeLabels = {
    system: 'System',
    lead:   'Lead Context',
    call:   'Call Intelligence',
    deal:   'Deal Context',
  }

  return (
    <div style={{
      width: 280,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.015)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Panel header */}
      <div style={{
        height: 36,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)',
        }}>
          {modeLabels[mode] || 'System'}
        </span>
      </div>

      {/* Panel content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {mode === 'system' && <SystemPanel />}
        {mode === 'lead'   && <LeadPanel data={data} />}
        {mode === 'call'   && <CallPanel data={data} />}
        {mode === 'deal'   && <DealPanel data={data} />}
      </div>
    </div>
  )
}
