import React, { useState, useEffect } from 'react'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import { analytics } from '../../services/api'

export default function SystemStatusBar() {
  const { calls: liveCalls } = useLiveCalls()
  const liveCount = liveCalls.length
  const [stats, setStats] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    const load = () => {
      analytics.getDashboard().then(r => {
        const d = r.data?.data || r.data || {}
        setStats(d.stats || {})
        setLastUpdate(new Date())
      }).catch(() => {})
    }
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  const callsToday = stats?.calls_today ?? '—'
  const hotLeads   = stats?.hot_leads   ?? '—'
  const deals      = stats?.deals_under_contract ?? '—'

  // Relative time since last update
  const since = lastUpdate
    ? (() => {
        const s = Math.floor((Date.now() - lastUpdate) / 1000)
        if (s < 60)   return `${s}s ago`
        if (s < 3600) return `${Math.floor(s/60)}m ago`
        return `${Math.floor(s/3600)}h ago`
      })()
    : null

  // Determine system state
  const isActive = liveCount > 0

  return (
    <div className="status-bar" style={{ paddingLeft: 'calc(var(--rail-width) + 16px)' }}>
      {/* System state */}
      {isActive ? (
        <span className="flex items-center gap-1.5" style={{ color: 'var(--green)' }}>
          <span className="dot-live" style={{ width: 5, height: 5 }} />
          CALLING ACTIVE
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={{ width: 5, height: 5, background: 'var(--t4)', flexShrink: 0 }}
          />
          IDLE — READY
        </span>
      )}

      <span className="status-sep">·</span>

      {isActive && (
        <>
          <span>
            <span style={{ color: 'var(--t1)' }}>{liveCount}</span>
            {' '}live {liveCount === 1 ? 'line' : 'lines'}
          </span>
          <span className="status-sep">·</span>
        </>
      )}

      <span>
        <span style={{ color: 'var(--t2)' }}>{callsToday}</span> calls today
      </span>

      <span className="status-sep">·</span>

      <span style={{ color: hotLeads > 0 ? 'var(--gold)' : 'var(--t3)' }}>
        {hotLeads} hot leads
      </span>

      <span className="status-sep">·</span>

      <span>
        <span style={{ color: 'var(--t2)' }}>{deals}</span> under contract
      </span>

      {since && (
        <>
          <span className="status-sep">·</span>
          <span>updated {since}</span>
        </>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* System health — right side */}
      <span className="flex items-center gap-1.5" style={{ color: 'var(--t3)', paddingRight: 16 }}>
        <span
          className="inline-block rounded-full"
          style={{ width: 5, height: 5, background: 'var(--green)', flexShrink: 0 }}
        />
        All systems online
      </span>
    </div>
  )
}
