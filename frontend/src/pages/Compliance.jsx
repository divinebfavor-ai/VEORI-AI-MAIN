import React, { useState, useEffect } from 'react'
import { Shield, Download, AlertTriangle, CheckCircle } from 'lucide-react'
import { compliance } from '../services/api'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

const RISK_COLORS = { high: 'red', medium: 'amber', low: 'green' }

export default function Compliance() {
  const [tab, setTab]          = useState('tcpa')
  const [tcpaLogs, setLogs]    = useState([])
  const [stateData, setStates] = useState({})
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    if (tab === 'tcpa') {
      compliance.getTcpaLog({ limit: 200 })
        .then(r => {
          const raw = r.data?.logs ?? r.data?.data ?? r.data
          setLogs(Array.isArray(raw) ? raw : [])
          setLoading(false)
        })
        .catch(() => { setLogs([]); setLoading(false) })
    }
    if (tab === 'states') {
      compliance.getStates()
        .then(r => {
          setStates(r.data?.states || {})
          setLoading(false)
        })
        .catch(() => { setStates({}); setLoading(false) })
    }
  }, [tab])

  const downloadCsv = () => {
    const headers = ['Phone', 'Called At (UTC)', 'Local Time', 'Within Hours', 'DNC Result', 'Attempt #', 'Consent']
    const rows = tcpaLogs.map(l => [
      l.phone_number,
      l.called_at_utc,
      l.local_time,
      l.within_calling_hours ? 'Yes' : 'No',
      l.dnc_result || 'checked',
      l.attempt_number,
      l.consent_status,
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = 'tcpa-audit-log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-white">Compliance</h1>
          <p className="text-[13px] text-text-muted mt-1">TCPA audit log and state-by-state compliance rules</p>
        </div>
        {tab === 'tcpa' && (
          <Button variant="secondary" onClick={downloadCsv}>
            <Download size={14} /> Export CSV
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface border border-border-subtle rounded-[6px] p-1 w-fit mb-6">
        {[['tcpa', 'TCPA Audit Log'], ['states', 'State Compliance']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-[4px] text-[13px] font-medium transition-colors ${
              tab === id ? 'bg-card text-white' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tcpa' && (
        <>
          <div className="bg-primary/5 border border-primary/20 rounded-[6px] px-4 py-3 flex items-start gap-3 mb-6">
            <Shield size={14} className="text-primary flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-text-secondary">
              Every call attempt is logged automatically for TCPA legal protection. Export as CSV for your records.
              This log covers call time, local seller time, DNC status, and consent.
            </p>
          </div>

          {loading ? (
            <div className="text-center py-20 text-text-muted">Loading…</div>
          ) : tcpaLogs.length === 0 ? (
            <div className="bg-card border border-border-subtle rounded-lg py-20 text-center">
              <Shield size={32} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-[14px] text-text-primary">No call records yet</p>
              <p className="text-[12px] text-text-muted mt-1">Records appear here after calls are made</p>
            </div>
          ) : (
            <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border-subtle">
                    {['Phone', 'Called At', 'Local Time', 'Within Hours', 'DNC', 'Attempt', 'Consent'].map(h => (
                      <th key={h} className="text-left px-4 py-3 label-caps">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {tcpaLogs.map(log => (
                    <tr key={log.id} className="hover:bg-elevated transition-colors">
                      <td className="px-4 py-3 text-text-primary font-mono">{log.phone_number}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        {log.called_at_utc ? new Date(log.called_at_utc).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{log.local_time || '—'}</td>
                      <td className="px-4 py-3">
                        {log.within_calling_hours
                          ? <CheckCircle size={14} className="text-primary" />
                          : <AlertTriangle size={14} className="text-danger" />}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{log.dnc_result || '—'}</td>
                      <td className="px-4 py-3 text-text-secondary">{log.attempt_number || 1}</td>
                      <td className="px-4 py-3">
                        <Badge variant={log.consent_status === 'given' ? 'green' : 'gray'}>
                          {log.consent_status || 'unknown'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'states' && (
        <>
          <div className="bg-warning/5 border border-warning/20 rounded-[6px] px-4 py-3 flex items-start gap-3 mb-6">
            <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-text-secondary">
              Wholesaling laws vary by state. Always consult a real estate attorney in states with HIGH risk rating
              before proceeding. This information is current as of early 2025 and may change.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {Object.entries(stateData).map(([code, state]) => (
              <div
                key={code}
                className={`bg-card border rounded-lg p-5 ${
                  state.risk_level === 'high'
                    ? 'border-danger/30'
                    : state.risk_level === 'medium'
                    ? 'border-warning/30'
                    : 'border-border-subtle'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[18px] font-bold text-white w-8">{code}</span>
                    <div>
                      <p className="text-[14px] font-medium text-text-primary">{state.state_name}</p>
                      <p className="text-[12px] text-text-muted mt-0.5">{state.notes}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <Badge variant={RISK_COLORS[state.risk_level] || 'gray'}>{state.risk_level} risk</Badge>
                    {state.registration_required && <Badge variant="amber">registration req.</Badge>}
                    {state.cancellation_period_days > 0 && (
                      <Badge variant="amber">{state.cancellation_period_days}d cancel right</Badge>
                    )}
                  </div>
                </div>
                {state.disclosure_language && (
                  <div className="mt-3 px-3 py-2.5 bg-surface rounded-[4px] border border-border-subtle">
                    <p className="text-[11px] text-text-muted leading-relaxed">{state.disclosure_language}</p>
                  </div>
                )}
              </div>
            ))}
            {Object.keys(stateData).length === 0 && !loading && (
              <div className="text-center py-12 text-text-muted">Loading state compliance data…</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
