import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { intelligence, deals } from '../services/api'
import useIsMobile from '../hooks/useIsMobile'

const SIGNAL_LABEL = { high_equity: 'High equity', probate: 'Probate', pre_foreclosure: 'Pre-foreclosure', tax_delinquent: 'Tax delinquent', vacant_absentee: 'Vacant + absentee', long_ownership: 'Long ownership' }
const errText = (err, fallback) => err?.response?.data?.error || err?.message || fallback

export default function Opportunities() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(null)

  const load = async () => {
    setLoading(true)
    try { setResult((await intelligence.opportunities()).data.data) }
    catch (err) { toast.error(errText(err, 'Could not scan for opportunities')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const openDeal = async (op) => {
    setCreating(op.lead_id)
    try {
      const r = await deals.createDeal({ lead_id: op.lead_id, property_address: op.address.split(',')[0] || null, status: 'lead' })
      navigate(`/deals/${r.data.data.id}/room`)
    } catch (err) { toast.error(errText(err, 'Could not open a deal')) }
    finally { setCreating(null) }
  }

  const opps = result?.data?.opportunities || []
  return (
    <div style={{ padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>Opportunities</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--t3)' }}>Leads without a deal that show two or more independent signals. Each signal comes from your lead records and is not independently verified.</p>
        </div>
        <Button size="sm" variant="secondary" loading={loading} onClick={load}><RefreshCw size={12} /> Rescan</Button>
      </div>

      {result && <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>{result.summary} <span style={{ color: 'var(--t4)' }}>Scanned {result.data?.scanned ?? 0} leads.</span></p>}

      {!loading && !opps.length && <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, fontSize: 13, color: 'var(--t4)' }}>No lead currently shows two or more signals.</div>}

      {opps.map(op => (
        <div key={op.lead_id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{op.address || 'Address not on file'} {op.owner && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--t3)' }}>· {op.owner}</span>}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {op.evidence.map(e => <Badge key={e.signal} variant={op.signal_count >= 3 ? 'green' : 'gold'}>{SIGNAL_LABEL[e.signal] || e.signal}</Badge>)}
              <Badge variant="amber">Unverified</Badge>
            </div>
            {op.evidence.map(e => <p key={e.signal} style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--t3)' }}>{SIGNAL_LABEL[e.signal] || e.signal}: {e.detail}</p>)}
          </div>
          <Button size="sm" variant="primary" loading={creating === op.lead_id} onClick={() => openDeal(op)}>Open deal</Button>
        </div>
      ))}

      {(result?.missing || []).map((m, i) => <p key={i} style={{ margin: 0, fontSize: 12, color: 'var(--t4)' }}>Not covered yet: {m.item} — {m.why_it_matters} {m.how_to_get}</p>)}
    </div>
  )
}
