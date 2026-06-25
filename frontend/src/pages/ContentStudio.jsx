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
  const [tab, setTab]                   = useState('captions')
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
  // Tier 4 — cold-email analytics (opens/clicks/replies + winning subject variant)
  const [emailStats, setEmailStats]     = useState(null)
  const [statsDays, setStatsDays]       = useState(30)
  const [statsLoading, setStatsLoading] = useState(false)

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

  // Tier 4 — fetch email analytics. Lazy: only loads when the Email Stats tab is
  // opened (or its range changes), so the page's initial load stays untouched.
  function loadEmailStats(days) {
    setStatsLoading(true)
    fetch(`${API}/email/analytics?days=${days}`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setEmailStats(d || null))
      .catch(() => setEmailStats(null))
      .finally(() => setStatsLoading(false))
  }
  useEffect(() => {
    if (tab === 'email-stats') loadEmailStats(statsDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statsDays])

  async function connectPlatform(platform) {
    try {
      const r = await fetch(`${API}/social-connections/auth-url/${platform}`, { headers: authHeader() })
      const d = await r.json()
      if (d.success) window.open(d.url, '_blank')
      else alert(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connection coming soon. Contact support to enable.`)
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

      {/* Social connection banner */}
      {connections.length === 0 && !loading && (
        <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🔗</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#C9A84C' }}>Connect your social accounts first</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginLeft: 8 }}>Go to Settings → Social Media to connect Facebook, Instagram, Twitter, and more.</span>
          </div>
          <a href="/settings" style={{ padding: '7px 14px', background: '#C9A84C', color: '#000', borderRadius: 8, fontSize: 12, fontWeight: 800, textDecoration: 'none', fontFamily: 'Inter,sans-serif', whiteSpace: 'nowrap' }}>Open Settings</a>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['captions','email-blast','email-stats','calendar','library'].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'captions' ? '✍️ AI Captions' : t === 'email-blast' ? '📧 Email Blast' : t === 'email-stats' ? '📊 Email Stats' : t === 'calendar' ? '📅 Calendar' : '📁 Library'}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading…</div>}

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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => navigator.clipboard.writeText(caption)}
                    style={{ padding: '8px 20px', background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                    📋 Copy
                  </button>
                  {connections.filter(c => c.connected).map(conn => {
                    const pl = PLATFORMS.find(p => p.id === conn.platform)
                    if (!pl) return null
                    return (
                      <button key={conn.platform}
                        onClick={async () => {
                          try {
                            const r = await fetch(`${API}/social-connections/publish`, {
                              method: 'POST', headers: authHeader(),
                              body: JSON.stringify({ platform: conn.platform, content: caption, listing_id: captionForm.listing_id || null }),
                            })
                            const d = await r.json()
                            alert(d.success ? `Posted to ${pl.label}!` : (d.error || 'Post failed'))
                          } catch { alert('Failed to post') }
                        }}
                        style={{ padding: '8px 16px', background: `${pl.color}20`, border: `1px solid ${pl.color}40`, color: pl.color, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                        {pl.icon} Post to {pl.label}
                      </button>
                    )
                  })}
                </div>
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

      {/* Email Stats (Tier 4) */}
      {!loading && tab === 'email-stats' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>COLD-EMAIL PERFORMANCE</div>
            <div style={{ flex: 1 }} />
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setStatsDays(d)}
                style={{ ...s.tab(statsDays === d), padding: '6px 12px' }}>
                {d}d
              </button>
            ))}
          </div>

          {statsLoading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading…</div>}

          {!statsLoading && emailStats && (emailStats.totals?.sent || 0) === 0 && (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div>No cold emails sent in this window yet. Once your drips send, opens, clicks and the winning subject line show up here.</div>
            </div>
          )}

          {!statsLoading && emailStats && (emailStats.totals?.sent || 0) > 0 && (
            <>
              {/* Funnel KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                {[
                  { label: 'Sent',       value: emailStats.totals.sent,        sub: null,                         color: '#FFFFFF' },
                  { label: 'Delivered',  value: `${emailStats.rates.delivered}%`, sub: `${emailStats.totals.delivered}`, color: '#00C37A' },
                  { label: 'Open rate',  value: `${emailStats.rates.open}%`,    sub: `${emailStats.totals.opened} opens`,  color: '#00C37A' },
                  { label: 'Click rate', value: `${emailStats.rates.click}%`,   sub: `${emailStats.totals.clicked} clicks`, color: '#C9A84C' },
                  { label: 'Bounce',     value: `${emailStats.rates.bounce}%`,  sub: `${emailStats.totals.bounced}`,   color: emailStats.rates.bounce > 2 ? '#FF5C5C' : 'rgba(255,255,255,0.75)' },
                  { label: 'Complaints', value: `${emailStats.rates.complaint}%`, sub: `${emailStats.totals.complained}`, color: emailStats.rates.complaint > 0.3 ? '#FF5C5C' : 'rgba(255,255,255,0.75)' },
                  { label: 'Unsubscribed', value: emailStats.totals.suppressed, sub: 'opted out',                   color: 'rgba(255,255,255,0.55)' },
                ].map(k => (
                  <div key={k.label} style={s.card}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, color: k.color, marginTop: 6 }}>{k.value}</div>
                    {k.sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{k.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Deliverability guard note */}
              {(emailStats.rates.bounce > 2 || emailStats.rates.complaint > 0.3) && (
                <div style={{ background: 'rgba(255,92,92,0.08)', border: '1px solid rgba(255,92,92,0.25)', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#FF9C9C' }}>
                  ⚠️ {emailStats.rates.complaint > 0.3 ? `Spam-complaint rate (${emailStats.rates.complaint}%) is above the 0.3% Gmail/Yahoo ceiling. ` : ''}
                  {emailStats.rates.bounce > 2 ? `Bounce rate (${emailStats.rates.bounce}%) is above the 2% safe threshold. ` : ''}
                  Slow your send volume and verify list quality to protect domain reputation.
                </div>
              )}

              {/* Winning subject variants */}
              <div style={s.card}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: '#00C37A' }}>WINNING SUBJECT LINES (A/B)</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 14 }}>Open rate per subject variant. Winner needs ≥5 sends to qualify.</div>
                {(!emailStats.variants || emailStats.variants.length === 0) ? (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>No A/B drip data yet in this window.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {emailStats.variants.map(v => (
                      <div key={`${v.template}-${v.variant}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: v.winner ? 'rgba(0,195,122,0.08)' : 'rgba(255,255,255,0.03)', border: v.winner ? '1px solid rgba(0,195,122,0.3)' : '1px solid transparent', borderRadius: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#C9A84C', minWidth: 90 }}>{v.template}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.8)', minWidth: 24 }}>{v.variant}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{v.open_rate}% open · {v.click_rate}% click</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{v.sent} sent · {v.opened} opened</div>
                        </div>
                        {v.winner && <span style={{ fontSize: 11, fontWeight: 800, color: '#00C37A', background: 'rgba(0,195,122,0.15)', padding: '3px 10px', borderRadius: 6 }}>🏆 WINNER</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
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
