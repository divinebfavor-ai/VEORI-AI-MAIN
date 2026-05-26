/**
 * Features 28-33 Content + Social Media Engine
 * Social connections, caption generator, video generator, email blast, content calendar
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const PLATFORMS = [
  { id: 'facebook',  label: 'Facebook',  icon: 'f', color: '#1877F2' },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#E1306C' },
  { id: 'twitter',   label: 'Twitter/X', icon: '𝕏', color: '#1DA1F2' },
  { id: 'youtube',   label: 'YouTube',   icon: '▶', color: '#FF0000' },
  { id: 'tiktok',    label: 'TikTok',    icon: '♪', color: '#69C9D0' },
]

const TONES = ['professional','casual','excited','urgent']

export default function ContentStudio() {
  const [tab, setTab]                   = useState('connections')
  const [connections, setConnections]   = useState([])
  const [content, setContent]           = useState([])
  const [listings, setListings]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [captionForm, setCaptionForm]   = useState({ listing_id: '', platform: 'instagram', tone: 'professional' })
  const [caption, setCaption]           = useState(null)
  const [generating, setGenerating]     = useState(false)
  const [blastForm, setBlastForm]       = useState({ listing_id: '', subject: '', body_html: '', recipient_type: 'all_buyers' })
  const [sending, setSending]           = useState(false)
  const [blastResult, setBlastResult]   = useState(null)
  const [calendar, setCalendar]         = useState([])

  function load() {
    setLoading(true)
    Promise.all([
      fetch(`${API}/social-connections`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/content`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/listings`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/content/calendar`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([conn, cont, list, cal]) => {
      setConnections(conn.connections || [])
      setContent(cont.content || [])
      setListings(list.listings || [])
      setCalendar(cal.calendar || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function connectPlatform(platform) {
    try {
      const r = await fetch(`${API}/social-connections/auth-url/${platform}`, { headers: authHeader() })
      const d = await r.json()
      if (d.success) window.open(d.url, '_blank')
      else alert(`OAuth for ${platform} not yet configured. Add API keys in Railway env vars.`)
    } catch { alert('Connection failed') }
  }

  async function disconnectPlatform(platform) {
    if (!confirm(`Disconnect ${platform}?`)) return
    await fetch(`${API}/social-connections/${platform}`, { method: 'DELETE', headers: authHeader() })
    load()
  }

  async function generateCaption() {
    setGenerating(true)
    try {
      const r = await fetch(`${API}/content/generate-caption`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(captionForm),
      })
      const d = await r.json()
      if (d.success) setCaption(d.caption)
      else alert(d.error)
    } catch { alert('Failed to generate caption') }
    setGenerating(false)
  }

  async function sendBlast() {
    if (!blastForm.subject || !blastForm.body_html) return alert('Subject and body required')
    setSending(true)
    try {
      const r = await fetch(`${API}/content/email-blast`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(blastForm),
      })
      const d = await r.json()
      if (d.success) { setBlastResult(d); setBlastForm({ listing_id: '', subject: '', body_html: '', recipient_type: 'all_buyers' }) }
      else alert(d.error)
    } catch { alert('Network error') }
    setSending(false)
  }

  const s = {
    page:  { padding: '32px', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif' },
    card:  { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
    tab:   (a) => ({ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
    sel:   { background: 'var(--card-bg, #0A1526)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%' },
  }

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🎬 Content Studio</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>AI captions, email blasts, social publishing, content calendar all in one place</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['connections','captions','email-blast','calendar','library'].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'connections' ? '🔗 Connections' : t === 'captions' ? '✍️ AI Captions' : t === 'email-blast' ? '📧 Email Blast' : t === 'calendar' ? '📅 Calendar' : '📁 Library'}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading…</div>}

      {/* Connections */}
      {!loading && tab === 'connections' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12 }}>
          {PLATFORMS.map(p => {
            const conn = connections.find(c => c.platform === p.id)
            const isConnected = conn?.connected
            return (
              <div key={p.id} style={{ ...s.card, border: isConnected ? `1px solid ${p.color}40` : '1px solid var(--border, rgba(255,255,255,0.07))' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${p.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{p.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.label}</div>
                    {isConnected && conn.account_name && <div style={{ fontSize: 11, color: p.color }}>@{conn.account_name}</div>}
                  </div>
                </div>
                {isConnected ? (
                  <button onClick={() => disconnectPlatform(p.id)}
                    style={{ width: '100%', padding: '8px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>
                    Disconnect
                  </button>
                ) : (
                  <button onClick={() => connectPlatform(p.id)}
                    style={{ width: '100%', padding: '8px', background: `${p.color}20`, border: `1px solid ${p.color}40`, color: p.color, borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>
                    Connect {p.label}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* AI Captions */}
      {!loading && tab === 'captions' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#00C37A' }}>GENERATE AI CAPTION</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Property Listing (optional)</label>
                <select style={s.sel} value={captionForm.listing_id} onChange={e => setCaptionForm(p => ({ ...p, listing_id: e.target.value }))}>
                  <option value="">No listing selected</option>
                  {listings.map(l => <option key={l.id} value={l.id}>{l.title} {l.address}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Platform</label>
                <select style={s.sel} value={captionForm.platform} onChange={e => setCaptionForm(p => ({ ...p, platform: e.target.value }))}>
                  {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Tone</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {TONES.map(tone => (
                    <button key={tone} onClick={() => setCaptionForm(p => ({ ...p, tone }))}
                      style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${captionForm.tone === tone ? '#00C37A' : 'rgba(255,255,255,0.10)'}`, background: captionForm.tone === tone ? 'rgba(0,195,122,0.15)' : 'transparent', color: captionForm.tone === tone ? '#00C37A' : 'rgba(255,255,255,0.55)', fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600, textTransform: 'capitalize' }}>
                      {tone}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={generateCaption} disabled={generating}
                style={{ padding: '12px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                {generating ? 'Generating…' : '✨ Generate Caption'}
              </button>
            </div>
          </div>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'rgba(255,255,255,0.45)' }}>GENERATED CAPTION</div>
            {caption ? (
              <>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  style={{ ...s.input, height: 200, resize: 'vertical', marginBottom: 12 }}
                />
                <button onClick={() => navigator.clipboard.writeText(caption)}
                  style={{ padding: '8px 20px', background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                  📋 Copy to Clipboard
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
                <div>Generated caption will appear here</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Blast */}
      {!loading && tab === 'email-blast' && (
        <div style={{ maxWidth: 640 }}>
          {blastResult && (
            <div style={{ ...s.card, background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.25)', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00C37A', marginBottom: 4 }}>✅ Blast Sent!</div>
              <div style={{ fontSize: 13 }}>Sent to {blastResult.blast.sent_count} buyers out of {blastResult.recipients_found} found</div>
              <button onClick={() => setBlastResult(null)} style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Dismiss</button>
            </div>
          )}
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#C9A84C' }}>📧 EMAIL BLAST TO BUYERS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Listing (optional)</label>
                <select style={s.sel} value={blastForm.listing_id} onChange={e => setBlastForm(p => ({ ...p, listing_id: e.target.value }))}>
                  <option value="">No specific listing</option>
                  {listings.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Recipients</label>
                <select style={s.sel} value={blastForm.recipient_type} onChange={e => setBlastForm(p => ({ ...p, recipient_type: e.target.value }))}>
                  <option value="all_buyers">All Buyers in CRM</option>
                  <option value="specific">Specific Buyers</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Subject Line *</label>
                <input style={s.input} placeholder="🏠 NEW DEAL Off-Market Property Available Now" value={blastForm.subject} onChange={e => setBlastForm(p => ({ ...p, subject: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Email Body (HTML or plain text) *</label>
                <textarea style={{ ...s.input, height: 160, resize: 'vertical' }} placeholder="Hey {{name}},\n\nI just locked up a great deal and you're first to know..." value={blastForm.body_html} onChange={e => setBlastForm(p => ({ ...p, body_html: e.target.value }))} />
              </div>
              <button onClick={sendBlast} disabled={sending}
                style={{ padding: '12px', background: '#C9A84C', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                {sending ? 'Sending…' : 'Send Blast 📧'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content Calendar */}
      {!loading && tab === 'calendar' && (
        <div style={s.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: 'rgba(255,255,255,0.45)' }}>CONTENT CALENDAR This Month</div>
          {calendar.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
              <div>No scheduled content. Create captions and schedule them from the Library.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {calendar.map(entry => (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                  <div style={{ width: 50, textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C' }}>{new Date(entry.scheduled_date).getDate()}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{new Date(entry.scheduled_date).toLocaleString('default', { month: 'short' })}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{entry.platform || 'All Platforms'}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{entry.generated_content?.content_type} · {entry.status}</div>
                    {entry.notes && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{entry.notes}</div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: entry.status === 'published' ? '#00C37A' : '#C9A84C', textTransform: 'capitalize' }}>{entry.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Library */}
      {!loading && tab === 'library' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {content.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
              <div>No content yet. Generate your first caption!</div>
            </div>
          ) : content.map(c => (
            <div key={c.id} style={{ ...s.card, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', background: 'rgba(201,168,76,0.15)', padding: '2px 8px', borderRadius: 4, textTransform: 'capitalize' }}>{c.content_type}</span>
                  {c.platform && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>{c.platform}</span>}
                  <span style={{ fontSize: 11, color: c.status === 'published' ? '#00C37A' : 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>{c.status}</span>
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, maxHeight: 60, overflow: 'hidden' }}>{c.caption || c.content}</div>
                {c.listings && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{c.listings.title}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
