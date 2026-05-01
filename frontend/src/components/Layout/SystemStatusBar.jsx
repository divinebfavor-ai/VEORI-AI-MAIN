import React, { useState, useEffect } from 'react'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import { analytics } from '../../services/api'

export default function SystemStatusBar() {
  const { calls: liveCalls } = useLiveCalls()
  const liveCount = liveCalls.length
  const [stats, setStats] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [, tick] = useState(0)

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

  // Tick every 5s to update relative time
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const callsToday = stats?.calls_today ?? '—'
  const hotLeads   = stats?.hot_leads   ?? '—'
  const deals      = stats?.deals_under_contract ?? '—'
  const pendingSigs = stats?.pending_signatures ?? '—'
  const dueFollowUps = stats?.due_follow_ups ?? '—'

  const since = lastUpdate
    ? (() => {
        const s = Math.floor((Date.now() - lastUpdate) / 1000)
        if (s < 60)   return `${s}s ago`
        if (s < 3600) return `${Math.floor(s / 60)}m ago`
        return `${Math.floor(s / 3600)}h ago`
      })()
    : null

  const isActive = liveCount > 0

  const sep = (
    <span style={{ color: 'var(--t4)', fontSize: 11, userSelect: 'none', opacity: 0.5 }}>·</span>
  )

  return (
    <div style={{
      height: 34,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 16,
      paddingRight: 16,
      background: 'var(--surface-bg)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      fontSize: 11,
      fontWeight: 500,
      color: 'var(--t4)',
      letterSpacing: '0.04em',
      userSelect: 'none',
      transition: 'background 0.3s ease, color 0.3s ease, border-color 0.3s ease',
    }}>

      {/* System state */}
      {isActive ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#00C37A' }}>
          <span className="live-dot" style={{ width: 5, height: 5 }} />
          CALLING ACTIVE
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--t4)' }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--t4)', flexShrink: 0,
            display: 'inline-block', opacity: 0.4,
          }} />
          IDLE — READY
        </span>
      )}

      {sep}

      {isActive && (
        <>
          <span>
            <span style={{ color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>{liveCount}</span>
            {' '}live {liveCount === 1 ? 'line' : 'lines'}
          </span>
          {sep}
        </>
      )}

      <span>
        <span style={{ color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>{callsToday}</span> calls today
      </span>

      {sep}

      <span style={{ color: hotLeads > 0 ? '#C9A84C' : 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>
        {hotLeads} hot leads
      </span>

      {sep}

      <span>
        <span style={{ color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>{deals}</span> under contract
      </span>

      {sep}

      <span>
        <span style={{ color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>{pendingSigs}</span> pending signatures
      </span>

      {sep}

      <span style={{ color: Number(dueFollowUps) > 0 ? '#FF9500' : 'var(--t4)' }}>
        {dueFollowUps} due follow-ups
      </span>

      {since && (
        <>
          {sep}
          <span style={{ color: 'var(--t4)', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
            updated {since}
          </span>
        </>
      )}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* System health — right */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--t4)' }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#00C37A', flexShrink: 0,
          display: 'inline-block',
          boxShadow: '0 0 6px rgba(0,195,122,0.60)',
        }} />
        All systems online
      </span>
    </div>
  )
}
