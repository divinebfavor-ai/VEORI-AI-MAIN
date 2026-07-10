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
    <div style={{ overflow: 'hidden', padding: '16px 0', background: '#F5F5F7', borderTop: '1px solid rgba(0,0,0,0.06)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="ticker-track" style={{ display: 'flex', width: 'max-content', gap: 0 }}>
        {doubled.map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 32px', fontSize: 13, color: '#6E6E73', whiteSpace: 'nowrap' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C47B', flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{e.label}</span>
            <span style={{ color: '#1D1D1F', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{e.value}</span>
            <span style={{ color: '#86868B' }}>{e.city}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
