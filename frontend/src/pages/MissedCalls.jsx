/**
 * Missed Call Text-Back Page
 * Shows missed call log + settings for the auto-SMS feature.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { PhoneMissed, MessageSquare, RefreshCw, CheckCircle2, Clock, Settings2, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  const diff = Math.floor((Date.now() - d) / 60000) // minutes ago
  if (diff < 2)  return 'Just now'
  if (diff < 60) return `${diff}m ago`
  const hrs = Math.floor(diff / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function statusDot(sent) {
  if (sent) return { color: '#00C37A', label: 'SMS sent', icon: CheckCircle2 }
  return { color: '#FF9500', label: 'SMS pending', icon: Clock }
}

export default function MissedCalls() {
  const [missedCalls, setMissedCalls] = useState([])
  const [settings, setSettings]       = useState({ enabled: true, message: '', delay_seconds: 60 })
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState('log')   // 'log' | 'settings'
  const [savingSettings, setSavingSettings] = useState(false)
  const [localMsg, setLocalMsg]       = useState('')
  const [localDelay, setLocalDelay]   = useState(60)

  const load = useCallback(async () => {
    try {
      const [logRes, settingsRes] = await Promise.all([
        api.get('/api/missed-calls'),
        api.get('/api/missed-calls/settings'),
      ])
      setMissedCalls(logRes.data?.data || [])
      const s = settingsRes.data?.settings || {}
      setSettings(s)
      setLocalMsg(s.message || '')
      setLocalDelay(s.delay_seconds ?? 60)
    } catch {
      toast.error('Failed to load missed calls')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveSettings = async () => {
    if (localMsg.trim().length === 0) {
      toast.error('Message cannot be empty')
      return
    }
    if (localDelay < 0 || localDelay > 300) {
      toast.error('Delay must be 0–300 seconds')
      return
    }
    setSavingSettings(true)
    try {
      await api.put('/api/missed-calls/settings', {
        enabled:        settings.enabled,
        message:        localMsg.trim(),
        delay_seconds:  localDelay,
      })
      setSettings(prev => ({ ...prev, message: localMsg.trim(), delay_seconds: localDelay }))
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save')
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleEnabled = async () => {
    const newVal = !settings.enabled
    setSettings(prev => ({ ...prev, enabled: newVal }))
    try {
      await api.put('/api/missed-calls/settings', { enabled: newVal })
      toast.success(newVal ? 'Missed call text-back ON' : 'Missed call text-back OFF')
    } catch {
      setSettings(prev => ({ ...prev, enabled: !newVal })) // revert
      toast.error('Failed to update')
    }
  }

  const smsCount    = missedCalls.filter(c => c.sms_sent).length
  const repliedCount = missedCalls.filter(c => c.replied).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 20px 14px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Missed Call Text-Back
            </h1>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>{missedCalls.length} missed calls</span>
              <span style={{ fontSize: 12, color: '#00C37A', fontWeight: 600 }}>{smsCount} SMS sent</span>
              <span style={{ fontSize: 12, color: '#4C9EFF', fontWeight: 600 }}>{repliedCount} replied</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 6 }}>
              <RefreshCw size={14} strokeWidth={1.8} />
            </button>
            {/* Master toggle */}
            <button
              onClick={toggleEnabled}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: settings.enabled ? 'rgba(0,195,122,0.1)' : 'var(--surface-bg-2)',
                border: `1px solid ${settings.enabled ? 'rgba(0,195,122,0.35)' : 'var(--border)'}`,
                borderRadius: 8, padding: '7px 12px',
                fontSize: 12, fontWeight: 600,
                color: settings.enabled ? '#00C37A' : 'var(--t3)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {settings.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {settings.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[['log', 'Missed Call Log'], ['settings', 'Text-Back Settings']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                height: 28, padding: '0 12px', borderRadius: 6,
                border: `1px solid ${tab === k ? 'rgba(0,195,122,0.4)' : 'var(--border)'}`,
                background: tab === k ? 'rgba(0,195,122,0.08)' : 'var(--border)',
                fontSize: 11, fontWeight: tab === k ? 600 : 400,
                color: tab === k ? '#00C37A' : 'var(--t3)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Missed Call Log ──────────────────────────────────────────────────── */}
      {tab === 'log' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px' }}>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 68, borderRadius: 10, background: 'var(--surface-bg-2)', marginBottom: 8, animation: `skeleton-pulse 1.4s ease infinite ${i * 0.07}s` }} />
            ))
          ) : missedCalls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,68,68,0.06)', border: '1px solid rgba(255,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <PhoneMissed size={22} strokeWidth={1.3} color="#FF4444" />
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>No missed calls yet</p>
              <p style={{ fontSize: 12, color: 'var(--t4)' }}>
                When a call results in no-answer or voicemail, it appears here and an auto-SMS is sent.
              </p>
            </div>
          ) : (
            missedCalls.map(mc => {
              const { color, label, icon: StatusIcon } = statusDot(mc.sms_sent)
              const leadName = mc.leads
                ? `${mc.leads.first_name || ''} ${mc.leads.last_name || ''}`.trim() || mc.caller_phone
                : mc.caller_phone
              return (
                <div
                  key={mc.id}
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 10, marginBottom: 8,
                    padding: '12px 16px',
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(255,68,68,0.08)',
                    border: '1px solid rgba(255,68,68,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <PhoneMissed size={14} strokeWidth={1.8} color="#FF4444" />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{leadName}</span>
                      <span style={{ fontSize: 10, color: 'var(--t4)' }}>{fmtDate(mc.called_at)}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: mc.sms_sent ? 5 : 0 }}>
                      <span style={{ fontSize: 10, color: 'var(--t3)' }}>
                        {mc.direction === 'inbound' ? 'Inbound' : 'Outbound'} · {mc.outcome?.replace(/_/g, ' ') || 'no answer'}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <StatusIcon size={9} />
                        {label}
                      </span>
                      {mc.replied && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#4C9EFF', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <MessageSquare size={9} /> Replied
                        </span>
                      )}
                    </div>

                    {mc.sms_sent && mc.sms_message && (
                      <p style={{ fontSize: 10, color: 'var(--t4)', fontStyle: 'italic', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{mc.sms_message}"
                      </p>
                    )}
                    {mc.leads?.property_address && (
                      <p style={{ fontSize: 10, color: 'var(--t4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {mc.leads.property_address}
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Settings tab ─────────────────────────────────────────────────────── */}
      {tab === 'settings' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          <div style={{ maxWidth: 560 }}>

            {/* Feature explanation */}
            <div style={{ background: 'rgba(0,195,122,0.05)', border: '1px solid rgba(0,195,122,0.15)', borderRadius: 10, padding: '14px 16px', marginBottom: 22 }}>
              <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: '#00C37A' }}>How it works:</strong> When a call ends with no-answer or voicemail, VEORI automatically sends an SMS to the seller within your set delay. The message opens a conversation in your inbox so you can continue qualifying the lead.
              </p>
            </div>

            {/* Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, padding: '12px 16px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 2 }}>Text-Back Enabled</p>
                <p style={{ fontSize: 11, color: 'var(--t4)' }}>Automatically SMS sellers who you miss</p>
              </div>
              <button
                onClick={toggleEnabled}
                style={{
                  background: settings.enabled ? 'rgba(0,195,122,0.12)' : 'var(--surface-bg-2)',
                  border: `1px solid ${settings.enabled ? 'rgba(0,195,122,0.35)' : 'var(--border)'}`,
                  borderRadius: 8, padding: '7px 14px',
                  fontSize: 12, fontWeight: 600,
                  color: settings.enabled ? '#00C37A' : 'var(--t3)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {settings.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                {settings.enabled ? 'On' : 'Off'}
              </button>
            </div>

            {/* Delay */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', display: 'block', marginBottom: 8 }}>
                Delay Before SMS (seconds)
              </label>
              <input
                type="number"
                value={localDelay}
                onChange={e => setLocalDelay(Math.max(0, Math.min(300, Number(e.target.value))))}
                min={0}
                max={300}
                style={{
                  width: 160, height: 40, background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '0 12px', fontSize: 13, color: 'var(--t1)',
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
              <p style={{ fontSize: 10, color: 'var(--t4)', marginTop: 5 }}>
                Default 60 seconds. Max 300 seconds (5 minutes).
              </p>
            </div>

            {/* Message */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', display: 'block', marginBottom: 8 }}>
                Auto-SMS Message
              </label>
              <textarea
                value={localMsg}
                onChange={e => setLocalMsg(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Hi, I just missed your call…"
                style={{
                  width: '100%', background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 12px', fontSize: 13, color: 'var(--t1)',
                  fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                  boxSizing: 'border-box', lineHeight: 1.5,
                }}
              />
              <p style={{ fontSize: 10, color: 'var(--t4)', marginTop: 4 }}>
                {localMsg.length}/500 characters · Use <code style={{ background: 'var(--surface-bg-3)', padding: '1px 4px', borderRadius: 3 }}>[Operator Name]</code> to insert your name
              </p>
            </div>

            <button
              onClick={saveSettings}
              disabled={savingSettings}
              style={{
                height: 40, padding: '0 24px',
                background: 'rgba(0,195,122,0.12)',
                border: '1px solid rgba(0,195,122,0.35)',
                borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#00C37A',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {savingSettings ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
