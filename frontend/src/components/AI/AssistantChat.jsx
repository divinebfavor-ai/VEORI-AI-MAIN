import React, { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, X, Send, Minus, TrendingUp, Phone, BarChart2, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { ai } from '../../services/api'
import MarkdownRenderer from '../ui/MarkdownRenderer'

const PROMPTS = [
  { icon: TrendingUp, label: 'Show my hottest leads',       q: 'Which of my leads have the highest motivation scores right now? Show me the top ones to prioritize.' },
  { icon: Phone,      label: 'What to follow up on today?', q: 'What should I prioritize following up on today based on my recent calls and leads?' },
  { icon: BarChart2,  label: 'How did calls perform?',      q: 'Give me a summary of how my calls performed this week — connect rate, motivation scores, deals close to converting.' },
  { icon: Mail,       label: 'Write a follow-up SMS',       q: 'Help me write a compelling follow-up SMS to a motivated seller who said they need to think about it.' },
]

function useStream(target, active) {
  const [shown, setShown] = useState('')
  const t = useRef(null)
  useEffect(() => {
    if (!active || !target) { setShown(target || ''); return }
    setShown(''); let i = 0
    const step = () => {
      i += Math.floor(Math.random() * 3) + 2
      if (i >= target.length) { setShown(target); return }
      setShown(target.slice(0, i))
      t.current = setTimeout(step, 10)
    }
    t.current = setTimeout(step, 10)
    return () => clearTimeout(t.current)
  }, [target, active])
  return shown
}

function UserMsg({ content }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        maxWidth: '82%', fontSize: 13, color: 'rgba(255,255,255,0.92)',
        lineHeight: 1.65, padding: '9px 14px',
        background: 'rgba(0,195,122,0.10)',
        border: '1px solid rgba(0,195,122,0.20)',
        borderRadius: '12px 12px 3px 12px',
      }}>
        {content}
      </div>
    </div>
  )
}

function AIMsg({ content, streaming, isError }) {
  const shown = useStream(content, streaming)
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 2,
        background: 'rgba(0,195,122,0.10)',
        border: '1px solid rgba(0,195,122,0.22)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: '#00C37A' }}>V</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isError
          ? <p style={{ fontSize: 13, color: '#FF4444', lineHeight: 1.65 }}>{shown || content}</p>
          : <MarkdownRenderer content={streaming ? shown : content} />
        }
        {streaming && (
          <span style={{
            display: 'inline-block', width: 5, height: 12,
            background: '#00C37A', borderRadius: 1, marginLeft: 2,
            verticalAlign: 'text-bottom',
            animation: 'breathe 0.6s ease infinite',
          }} />
        )}
      </div>
    </div>
  )
}

function Typing() {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(0,195,122,0.10)',
        border: '1px solid rgba(0,195,122,0.22)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: '#00C37A' }}>V</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4 }}>
        {[0, 150, 300].map(d => (
          <div key={d} style={{
            width: 5, height: 5,
            background: 'rgba(255,255,255,0.25)',
            borderRadius: '50%',
            animation: 'bounce 1s ease infinite',
            animationDelay: `${d}ms`,
          }} />
        ))}
      </div>
    </div>
  )
}

export default function AssistantChat() {
  const [open, setOpen]         = useState(false)
  const [min, setMin]           = useState(false)
  const [msgs, setMsgs]         = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [streamId, setStreamId] = useState(null)
  const bottomRef = useRef(null)
  const taRef     = useRef(null)

  useEffect(() => {
    if (open && !min) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading, open, min])

  const send = useCallback(async (text) => {
    const t = (text || input).trim()
    if (!t || loading) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'

    const id  = Date.now().toString()
    const um  = { id: `u-${id}`, role: 'user', content: t }
    const nxt = [...msgs, um]
    setMsgs(nxt)
    setLoading(true)

    try {
      const res   = await ai.sendAssistantMessage(t, msgs.map(m => ({ role: m.role, content: m.content })))
      const reply = res.data?.reply || res.data?.message || res.data?.content || "I'm having trouble connecting."
      const aid   = `a-${id}`
      setMsgs([...nxt, { id: aid, role: 'assistant', content: reply }])
      setStreamId(aid)
      setTimeout(() => setStreamId(null), Math.min(reply.length * 10, 4000))
    } catch {
      setMsgs(p => [...p, { id: `e-${id}`, role: 'assistant', content: "Sorry, I'm having trouble connecting right now.", isError: true }])
    } finally { setLoading(false) }
  }, [input, loading, msgs])

  const resize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(100, el.scrollHeight) + 'px'
  }

  const empty = msgs.length === 0

  return (
    <>
      {/* Toggle button */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setMin(false) }}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 40,
            width: 48, height: 48,
            background: '#00C37A',
            border: 'none', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#000',
            boxShadow: '0 0 20px rgba(0,195,122,0.40), 0 4px 16px rgba(0,0,0,0.40)',
            transition: 'all 0.18s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#00A868'; e.currentTarget.style.transform = 'scale(1.05)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#00C37A'; e.currentTarget.style.transform = 'scale(1)' }}
          title="Veori Assistant"
        >
          <MessageSquare size={20} strokeWidth={2} />
        </button>
      )}

      {/* Panel */}
      <div
        style={{
          position: 'fixed', bottom: 0, right: 0, zIndex: 50,
          width: 400,
          height: min ? 'auto' : 'min(660px, 90vh)',
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div style={{
          display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
          background: 'rgba(8,14,24,0.97)',
          backdropFilter: 'blur(32px) saturate(160%)',
          WebkitBackdropFilter: 'blur(32px) saturate(160%)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: min ? 12 : '12px 12px 0 0',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.50), 0 -4px 30px rgba(0,0,0,0.50)',
        }}>

          {/* Glass top edge */}
          <div style={{
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(0,195,122,0.50), transparent)',
            flexShrink: 0,
          }} />

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'rgba(0,195,122,0.10)',
                border: '1px solid rgba(0,195,122,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 10px rgba(0,195,122,0.15)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#00C37A' }}>V</span>
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', lineHeight: 1 }}>Veori Assistant</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  <span className="live-dot" style={{ width: 5, height: 5 }} />
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Online · Context-aware</p>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => setMin(!min)}
                style={{
                  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 6, background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'none' }}
              >
                <Minus size={13} />
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 6, background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'none' }}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {!min && (
            <>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {empty && (
                  <>
                    <div style={{ textAlign: 'center', paddingBottom: 6 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.80)', marginBottom: 4 }}>
                        What can I help you with?
                      </p>
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
                        I have full context on your leads, calls and deals.
                      </p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {PROMPTS.map(p => (
                        <button
                          key={p.label}
                          onClick={() => send(p.q)}
                          style={{
                            display: 'flex', flexDirection: 'column', gap: 6,
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.07)',
                            borderRadius: 10, padding: '12px 12px',
                            textAlign: 'left', cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(0,195,122,0.05)'
                            e.currentTarget.style.borderColor = 'rgba(0,195,122,0.20)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                          }}
                        >
                          <p.icon size={13} style={{ color: '#00C37A' }} />
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {msgs.map((m, i) => {
                  if (m.role === 'assistant') return <AIMsg key={m.id} content={m.content} streaming={streamId === m.id} isError={m.isError} />
                  return <UserMsg key={m.id} content={m.content} />
                })}
                {loading && <Typing />}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div style={{ flexShrink: 0, padding: '10px 12px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{
                  display: 'flex', alignItems: 'flex-end', gap: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 11, padding: '10px 12px',
                  transition: 'border-color 0.15s ease',
                }}
                  onFocusCapture={e => { e.currentTarget.style.borderColor = 'rgba(0,195,122,0.35)' }}
                  onBlurCapture={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                >
                  <textarea
                    ref={taRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); resize() }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder="Message Veori Assistant…"
                    rows={1}
                    disabled={loading}
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      resize: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)',
                      lineHeight: 1.55, maxHeight: 100,
                      fontFamily: 'inherit',
                      caretColor: '#00C37A',
                    }}
                  />
                  {input.trim() && (
                    <button
                      onClick={() => send()}
                      disabled={loading}
                      style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: '#00C37A', color: '#000',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#00A868'; e.currentTarget.style.transform = 'scale(1.05)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#00C37A'; e.currentTarget.style.transform = 'scale(1)' }}
                    >
                      <Send size={11} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
