import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { intelligence } from '../../services/api'

const RED = '#FF4444'
const AMBER = '#FF9500'
const GOLD = '#C9A84C'
const GREEN = '#00C37A'
const SEVERITY = { critical: { color: RED, variant: 'red' }, high: { color: AMBER, variant: 'amber' }, medium: { color: GOLD, variant: 'gold' }, low: { color: 'var(--t3)', variant: 'gray' } }
const STEP_VARIANT = { done: 'green', drafted: 'gold', skipped: 'gray', blocked: 'red', failed: 'red', pending_approval: 'gold' }
const errText = (err, fallback) => err?.response?.data?.error || err?.message || fallback
const POST_CONTRACT = ['under_contract', 'sent_to_title', 'closing_prep']

const box = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
const heading = { margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }

// Deal Death Prevention alerts - shown above the Deal Room sections.
export function AlertsBanner({ dealId, stage, style }) {
  const [alerts, setAlerts] = useState([])
  const [checking, setChecking] = useState(false)
  const load = useCallback(() => intelligence.dealAlerts(dealId).then(r => setAlerts(r.data.data || [])).catch(() => {}), [dealId])
  useEffect(() => { load() }, [load])

  const recheck = async () => {
    setChecking(true)
    try { const r = await intelligence.recheck(dealId); setAlerts(r.data.data.alerts || []); toast.success(r.data.data.applicable ? 'Contract re-checked' : 'Monitoring starts once the deal is under contract') }
    catch (err) { toast.error(errText(err, 'Re-check failed')) }
    finally { setChecking(false) }
  }
  const close = async (alertId, action) => {
    try { await intelligence.closeAlert(alertId, action); setAlerts(a => a.filter(x => x.id !== alertId)) }
    catch (err) { toast.error(errText(err, 'Could not update the alert')) }
  }

  if (!alerts.length && !POST_CONTRACT.includes(stage)) return null
  const worst = alerts[0]?.severity
  return (
    <div style={{ ...box, borderColor: worst ? SEVERITY[worst].color : 'var(--border)', padding: '12px 14px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ ...heading, color: worst ? SEVERITY[worst].color : GREEN, display: 'flex', alignItems: 'center', gap: 6 }}>
          {worst && <AlertTriangle size={12} />} Deal Death Prevention · {alerts.length ? `${alerts.length} open warning${alerts.length === 1 ? '' : 's'}` : 'no warning signs'}
        </p>
        <Button size="sm" variant="secondary" loading={checking} onClick={recheck}><RefreshCw size={12} /> Re-check</Button>
      </div>
      {alerts.map(a => (
        <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)' }}><Badge variant={SEVERITY[a.severity].variant}>{a.severity}</Badge> {a.message}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t3)' }}>{a.recommended_action} · first seen {new Date(a.created_at).toLocaleString()}</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="primary" onClick={() => close(a.id, 'resolve')}>Resolved</Button>
            <Button size="sm" variant="secondary" onClick={() => close(a.id, 'dismiss')}>Dismiss</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Copilot/Autopilot settings, Autopilot runs with every recorded step.
export function AutopilotPanel({ dealId, settings, onChanged }) {
  const [runs, setRuns] = useState([])
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = useCallback(() => intelligence.autopilotRuns(dealId).then(r => setRuns(r.data.data || [])).catch(() => {}), [dealId])
  useEffect(() => { load() }, [load])

  const s = settings || { mode: 'copilot', auto_send_sms: false, auto_place_calls: false, auto_draft: true }
  const save = async (patch) => {
    setSaving(true)
    try { await intelligence.updateSettings(patch); toast.success('Autonomy settings saved'); onChanged?.() }
    catch (err) { toast.error(errText(err, 'Could not save settings')) }
    finally { setSaving(false) }
  }
  const run = async () => {
    setRunning(true)
    try { const r = await intelligence.runAutopilot(dealId); toast[r.data.data.status === 'completed' ? 'success' : 'error'](r.data.data.status === 'completed' ? 'Autopilot run complete' : 'Autopilot run stopped'); await load(); onChanged?.() }
    catch (err) { toast.error(errText(err, 'Autopilot could not run')) }
    finally { setRunning(false) }
  }

  const Toggle = ({ k, label, hint }) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!s[k]} disabled={saving} onChange={e => save({ [k]: e.target.checked })} style={{ accentColor: GREEN, marginTop: 3 }} />
      <span><span style={{ fontSize: 13, color: 'var(--t1)' }}>{label}</span><br /><span style={{ fontSize: 11, color: 'var(--t4)' }}>{hint}</span></span>
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={box}>
        <p style={{ ...heading, marginBottom: 10 }}>Autonomy</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {['copilot', 'autopilot'].map(m => (
            <Button key={m} size="sm" variant={s.mode === m ? 'primary' : 'secondary'} disabled={saving} onClick={() => s.mode !== m && save({ mode: m })}>{m === 'copilot' ? 'Copilot' : 'Autopilot'}</Button>
          ))}
        </div>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--t3)' }}>
          {s.mode === 'autopilot' ? 'Autopilot analyzes, monitors and follows up within the switches below.' : 'Copilot recommends; nothing goes out without you.'} Offers, contracts, money and legal filings always wait for your approval.
        </p>
        <Toggle k="auto_send_sms" label="Send seller follow-up texts automatically" hint="Only to leads with recorded consent, inside legal hours, not on any DNC list, and at most one exchange every 72 hours." />
        <Toggle k="auto_draft" label="Draft messages automatically" hint="Drafts are saved for you to review." />
      </div>

      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <p style={heading}>Autopilot runs</p>
          <Button size="sm" variant="primary" loading={running} disabled={s.mode !== 'autopilot'} onClick={run}><Play size={12} /> Run Autopilot now</Button>
        </div>
        {s.mode !== 'autopilot' && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--t4)' }}>Switch to Autopilot to run it on this deal.</p>}
        {runs.length ? runs.map(r => (
          <details key={r.id} open={r === runs[0]} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--t1)' }}>
              {new Date(r.started_at).toLocaleString()} · <Badge variant={r.status === 'completed' ? 'green' : r.status === 'failed' ? 'red' : 'gold'}>{r.status}</Badge> <span style={{ fontSize: 11, color: 'var(--t4)' }}>{r.triggered_by}</span>
            </summary>
            {(r.steps || []).map((st, i) => (
              <div key={i} style={{ padding: '6px 0 6px 10px', borderLeft: '2px solid var(--border)', marginTop: 6 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}><Badge variant={STEP_VARIANT[st.status] || 'gray'}>{st.status}</Badge> {st.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t3)', overflowWrap: 'anywhere' }}>{st.detail}</p>
                {st.draft && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--t4)', overflowWrap: 'anywhere' }}>Draft to {st.draft.to}: “{st.draft.body}”</p>}
                {(st.disclosures || []).map((d, j) => <p key={j} style={{ margin: '2px 0 0', fontSize: 11, color: GOLD }}>Required disclosure: {d}</p>)}
              </div>
            ))}
          </details>
        )) : <p style={{ margin: 0, fontSize: 13, color: 'var(--t4)' }}>No runs on this deal yet.</p>}
      </div>
    </div>
  )
}
