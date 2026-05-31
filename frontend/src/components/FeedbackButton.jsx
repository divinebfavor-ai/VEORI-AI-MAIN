import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'

const API = `${import.meta.env.VITE_API_URL || 'https://veori.net'}/api/feedback`

const TYPES = [
  { value: 'bug',       label: '🐛 Bug',             desc: 'Something is broken or not working' },
  { value: 'feature',   label: '✨ Feature Request',  desc: 'Something you want added' },
  { value: 'complaint', label: '😤 Complaint',        desc: 'Something that frustrated you' },
  { value: 'other',     label: '💬 Other',            desc: 'Anything else on your mind' },
]

export default function FeedbackButton() {
  const location = useLocation()
  const [open, setOpen]         = useState(false)
  const [type, setType]         = useState('bug')
  const [subject, setSubject]   = useState('')
  const [desc, setDesc]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [err, setErr]           = useState('')

  function reset() {
    setType('bug'); setSubject(''); setDesc(''); setSent(false); setErr('')
  }

  async function submit(e) {
    e.preventDefault()
    if (!subject.trim() || !desc.trim()) {
      setErr('Please fill in both fields.'); return
    }
    setLoading(true); setErr('')
    try {
      const token = localStorage.getItem('veori_token') || localStorage.getItem('token') || localStorage.getItem('authToken')
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, subject: subject.trim(), description: desc.trim(), page: location.pathname }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSent(true)
    } catch (e) {
      setErr(e.message || 'Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const trigger = {
    position: 'fixed', bottom: 24, right: 24, zIndex: 900,
    background: 'rgba(10,18,32,0.92)', border: '1px solid rgba(0,195,122,0.30)',
    borderRadius: 40, padding: '9px 18px', color: 'rgba(255,255,255,0.75)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex',
    alignItems: 'center', gap: 7, backdropFilter: 'blur(12px)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    transition: 'border-color .2s, color .2s',
    fontFamily: 'Inter, sans-serif',
  }
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 950,
    background: 'rgba(4,10,20,0.75)', backdropFilter: 'blur(10px)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    padding: 24,
  }
  const modal = {
    width: 420, background: '#0A1220',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 28, fontFamily: 'Inter, sans-serif',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  }
  const label  = { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const input  = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }
  const btn    = { width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: '#00C37A', color: '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 4 }
  const btnDis = { ...btn, opacity: 0.5, cursor: 'not-allowed' }

  return (
    <>
      {/* Floating trigger */}
      <button
        style={trigger}
        onClick={() => { reset(); setOpen(true) }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,195,122,0.7)'; e.currentTarget.style.color = '#00C37A' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,195,122,0.30)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Feedback
      </button>

      {/* Modal */}
      {open && (
        <div style={overlay} onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div style={modal}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff' }}>Report / Feedback</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>We read every submission and fix things fast.</p>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>

            {sent ? (
              /* ── Success state ── */
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <p style={{ color: '#00C37A', fontWeight: 700, fontSize: 16, margin: '0 0 6px' }}>Got it - thank you!</p>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>We'll review this and fix it ASAP.</p>
                <button
                  style={{ ...btn, marginTop: 20, width: 'auto', padding: '10px 28px' }}
                  onClick={() => { reset(); setOpen(false) }}
                >Close</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                {/* Type selector */}
                <div style={{ marginBottom: 16 }}>
                  <span style={label}>Type</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {TYPES.map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setType(t.value)}
                        style={{
                          background: type === t.value ? 'rgba(0,195,122,0.12)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${type === t.value ? 'rgba(0,195,122,0.5)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                          color: type === t.value ? '#00C37A' : 'rgba(255,255,255,0.55)',
                          fontSize: 12, fontWeight: 600, textAlign: 'left',
                          fontFamily: 'Inter, sans-serif',
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject */}
                <div style={{ marginBottom: 14 }}>
                  <label style={label}>Subject</label>
                  <input
                    style={input}
                    placeholder="Short summary of the issue..."
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    maxLength={120}
                  />
                </div>

                {/* Description */}
                <div style={{ marginBottom: 18 }}>
                  <label style={label}>What happened?</label>
                  <textarea
                    style={{ ...input, minHeight: 90, resize: 'vertical' }}
                    placeholder="Describe what went wrong or what you'd like improved. Be as specific as possible..."
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    maxLength={2000}
                  />
                </div>

                {err && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '-8px 0 12px' }}>{err}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  style={loading ? btnDis : btn}
                >
                  {loading ? 'Sending…' : 'Submit Report'}
                </button>

                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', margin: '10px 0 0' }}>
                  Page: {location.pathname}
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
