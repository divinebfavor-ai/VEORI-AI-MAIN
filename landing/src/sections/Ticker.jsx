const events = [
  { label: 'Lead qualified', value: 'Score 91', city: 'Dallas TX' },
  { label: 'AI call completed', value: '2m 14s', city: 'Atlanta GA' },
  { label: 'Offer sent', value: '$142,000', city: 'Houston TX' },
  { label: 'Seller motivated', value: 'Score 96', city: 'Phoenix AZ' },
  { label: 'Contract generated', value: '3m 48s', city: 'Miami FL' },
  { label: 'Follow-up scheduled', value: '30 days', city: 'Charlotte NC' },
  { label: 'Lead qualified', value: 'Score 84', city: 'Memphis TN' },
  { label: 'Offer accepted', value: '+$21,400', city: 'Tampa FL' },
]
const doubled = [...events, ...events]

export default function Ticker() {
  return (
    <div style={{ overflow: 'hidden', padding: '14px 0', background: 'rgba(0,196,123,0.04)', borderTop: '1px solid rgba(0,196,123,0.08)', borderBottom: '1px solid rgba(0,196,123,0.08)' }}>
      <div className="ticker-track" style={{ display: 'flex', width: 'max-content', gap: 0 }}>
        {doubled.map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 36px', fontSize: 12.5, color: 'rgba(255,255,255,0.40)', whiteSpace: 'nowrap' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00C47B', flexShrink: 0 }} />
            <span>{e.label}</span>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{e.value}</span>
            <span style={{ color: 'rgba(255,255,255,0.28)' }}>{e.city}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
