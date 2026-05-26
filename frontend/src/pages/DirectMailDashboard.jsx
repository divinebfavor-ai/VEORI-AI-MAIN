/**
 * Feature 20 Direct Mail Auto-Trigger
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const STATUS_COLORS = { sent: '#00C37A', queued: '#C9A84C', failed: '#EF4444' }

export default function DirectMailDashboard() {
  const [mail, setMail]         = useState([])
  const [stats, setStats]       = useState(null)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('history')
  const [sending, setSending]   = useState(false)
  const [sendForm, setSendForm] = useState({ lead_id: '', template: 'motivated' })
  const [leads, setLeads]       = useState([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/direct-mail`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/direct-mail/stats`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/direct-mail/templates`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/leads?limit=50`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([m, s, t, l]) => {
      setMail(m.mail || [])
      setStats(s.stats || null)
      setTemplates(t.templates || [])
      setLeads(l.leads || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function sendMail() {
    if (!sendForm.lead_id) return alert('Select a lead')
    setSending(true)
    try {
      const r = await fetch(`${API}/direct-mail/send`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(sendForm),
      })
      const d = await r.json()
      if (d.success) {
        setMail(prev => [d.mail, ...prev])
        setSendForm({ lead_id: '', template: 'motivated' })
      } else {
        alert(d.error || 'Failed to send')
      }
    } catch { alert('Network error') }
    setSending(false)
  }

  const s = {
    page: { padding: '32px', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif' },
    card: { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '20px' },
    sel:  { background: 'var(--card-bg, #0A1526)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%' },
    tab:  (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#C9A84C' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
  }

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>✉️ Direct Mail</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Automated postcard campaigns via Lob.com triggers fire automatically on key events</p>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Sent', value: stats.total, color: '#fff' },
            { label: '✅ Delivered', value: stats.sent, color: '#00C37A' },
            { label: '⏳ Queued', value: stats.queued, color: '#C9A84C' },
          ].map(item => (
            <div key={item.label} style={s.card}>
              <div style={{ fontSize: 26, fontWeight: 900, color: item.color, marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'history')}  onClick={() => setTab('history')}>📋 History</button>
        <button style={s.tab(tab === 'send')}     onClick={() => setTab('send')}>📬 Send Manual</button>
        <button style={s.tab(tab === 'templates')} onClick={() => setTab('templates')}>📄 Templates</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading mail data…</div>}

      {!loading && tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mail.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No mail sent yet. Triggers fire automatically or send manually.</div>
          ) : mail.map(m => (
            <div key={m.id} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{m.leads?.first_name} {m.leads?.last_name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{m.leads?.property_address} · Template: {m.template}</div>
                {m.trigger_reason && <div style={{ fontSize: 11, color: '#C9A84C', marginTop: 2 }}>Trigger: {m.trigger_reason}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[m.status] || '#fff', background: `${STATUS_COLORS[m.status]}20`, padding: '3px 10px', borderRadius: 6 }}>{m.status}</span>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{new Date(m.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'send' && (
        <div style={{ maxWidth: 480 }}>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#C9A84C' }}>SEND A POSTCARD</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Select Lead</label>
                <select style={s.sel} value={sendForm.lead_id} onChange={e => setSendForm(p => ({ ...p, lead_id: e.target.value }))}>
                  <option value="">Choose a lead</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.first_name} {l.last_name} {l.property_address}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Template</label>
                <select style={s.sel} value={sendForm.template} onChange={e => setSendForm(p => ({ ...p, template: e.target.value }))}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button onClick={sendMail} disabled={sending}
                style={{ padding: '12px', background: '#C9A84C', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: sending ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
                {sending ? 'Sending…' : 'Send Postcard ✉️'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {templates.map(t => (
            <div key={t.id} style={s.card}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{t.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>{t.description}</div>
              <div style={{ fontSize: 11, color: '#C9A84C', fontWeight: 700 }}>Auto-trigger: {t.trigger.replace(/_/g, ' ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
