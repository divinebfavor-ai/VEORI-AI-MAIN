import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Plus, Sparkles, MessageSquare, Trash2, TrendingUp, Users, BookOpen, Zap } from 'lucide-react'
import { formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import toast from 'react-hot-toast'
import { ai } from '../services/api'
import MarkdownRenderer from '../components/ui/MarkdownRenderer'

// ─── Constants ────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'aria_history'

const STARTER_PROMPTS = [
  { icon: TrendingUp, label: 'How do I calculate MAO on a deal?',                q: 'How do I calculate MAO (Maximum Allowable Offer) on a wholesale real estate deal?' },
  { icon: Users,      label: 'What makes a seller motivated to sell?',            q: 'What are the signs that indicate a seller is highly motivated to sell their property?' },
  { icon: Sparkles,   label: 'How do I find cash buyers fast?',                   q: 'What are the fastest ways to build a cash buyers list for wholesaling deals?' },
  { icon: BookOpen,   label: 'Walk me through a wholesale deal start to finish',  q: 'Can you walk me through a complete wholesale real estate deal from finding a property to closing?' },
]

// ─── Storage helpers ──────────────────────────────────────────────────────────
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistory(convos) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(convos)) } catch {}
}

// ─── Streaming simulation ─────────────────────────────────────────────────────
function useStreamText(targetText, isStreaming) {
  const [displayed, setDisplayed] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    if (!isStreaming || !targetText) { setDisplayed(targetText || ''); return }
    setDisplayed('')
    let idx = 0
    const step = () => {
      idx += Math.floor(Math.random() * 3) + 2
      if (idx >= targetText.length) { setDisplayed(targetText); return }
      setDisplayed(targetText.slice(0, idx))
      ref.current = setTimeout(step, 10)
    }
    ref.current = setTimeout(step, 10)
    return () => clearTimeout(ref.current)
  }, [targetText, isStreaming])
  return displayed
}

// ─── User message ─────────────────────────────────────────────────────────────
function UserMessage({ content, timestamp }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }} className="group">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, maxWidth: '75%' }}>
        <div style={{
          padding: '11px 16px',
          fontSize: 14, color: 'rgba(255,255,255,0.92)', lineHeight: 1.7,
          background: 'rgba(0,195,122,0.10)',
          border: '1px solid rgba(0,195,122,0.20)',
          borderRadius: '12px 12px 3px 12px',
        }}>
          {content}
        </div>
        {timestamp && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', opacity: 0, transition: 'opacity 0.2s' }} className="group-hover:opacity-100">
            {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
          </span>
        )}
      </div>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 2,
        fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.50)',
      }}>
        U
      </div>
    </div>
  )
}

// ─── AI message ───────────────────────────────────────────────────────────────
function AIMessage({ content, isStreaming, isError }) {
  const displayed = useStreamText(content, isStreaming)
  const text = isStreaming ? displayed : content

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'rgba(0,195,122,0.10)',
          border: '1px solid rgba(0,195,122,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 12px rgba(0,195,122,0.15)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#00C37A' }}>A</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        {isError ? (
          <p style={{ fontSize: 14, color: '#FF4444', lineHeight: 1.7 }}>{text}</p>
        ) : (
          <MarkdownRenderer content={text} />
        )}
        {isStreaming && (
          <span style={{
            display: 'inline-block', width: 6, height: 14,
            background: '#00C37A', borderRadius: 1,
            marginLeft: 2, verticalAlign: 'text-bottom',
            animation: 'breathe 0.6s ease infinite',
          }} />
        )}
      </div>
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'rgba(0,195,122,0.10)',
        border: '1px solid rgba(0,195,122,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#00C37A' }}>A</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 6 }}>
        {[0, 150, 300].map(delay => (
          <div key={delay} style={{
            width: 6, height: 6,
            background: 'rgba(255,255,255,0.25)',
            borderRadius: '50%',
            animation: 'bounce 1s ease infinite',
            animationDelay: `${delay}ms`,
          }} />
        ))}
      </div>
    </div>
  )
}

// ─── Group history by date ────────────────────────────────────────────────────
function groupByDate(conversations) {
  const groups = { Today: [], Yesterday: [], 'Last 7 days': [], Older: [] }
  conversations.forEach(c => {
    const d = new Date(c.updatedAt || c.createdAt)
    if (isToday(d))          groups.Today.push(c)
    else if (isYesterday(d)) groups.Yesterday.push(c)
    else if (Date.now() - d.getTime() < 7 * 86400000) groups['Last 7 days'].push(c)
    else                     groups.Older.push(c)
  })
  return groups
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function Aria() {
  const [conversations, setConversations] = useState(() => loadHistory())
  const [activeId, setActiveId]           = useState(null)
  const [messages, setMessages]           = useState([])
  const [input, setInput]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [streamingId, setStreamingId]     = useState(null)
  const [hoveredId, setHoveredId]         = useState(null)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { saveHistory(conversations) }, [conversations])

  const startNewChat = useCallback(() => {
    setActiveId(null); setMessages([]); setInput('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const loadConversation = useCallback(convo => {
    setActiveId(convo.id); setMessages(convo.messages || []); setInput('')
  }, [])

  const deleteConversation = useCallback((id, e) => {
    e.stopPropagation()
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) startNewChat()
  }, [activeId, startNewChat])

  const send = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return

    setInput('')
    const msgId   = Date.now().toString()
    const userMsg = { id: `u-${msgId}`, role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res     = await ai.sendAriaMessage(trimmed, history)
      const reply   = res.data?.reply || res.data?.message || res.data?.content || "I'm having trouble connecting right now."

      const aiMsgId = `a-${msgId}`
      const aiMsg   = { id: aiMsgId, role: 'assistant', content: reply, timestamp: new Date().toISOString() }
      const final   = [...newMsgs, aiMsg]

      setMessages(final)
      setStreamingId(aiMsgId)
      setTimeout(() => setStreamingId(null), Math.min(reply.length * 10, 5000))

      const title = trimmed.slice(0, 52) + (trimmed.length > 52 ? '…' : '')
      const now   = new Date().toISOString()

      if (activeId) {
        setConversations(prev => prev.map(c => c.id === activeId ? { ...c, messages: final, updatedAt: now } : c))
      } else {
        const newConvo = { id: msgId, title, messages: final, createdAt: now, updatedAt: now }
        setConversations(prev => [newConvo, ...prev])
        setActiveId(msgId)
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `e-${msgId}`, role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
        isError: true, timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, activeId])

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const resizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(130, el.scrollHeight) + 'px'
  }

  useEffect(() => { resizeInput() }, [input])

  const isEmpty = messages.length === 0
  const groups  = groupByDate(conversations)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Sidebar ───────────────────────────────────────────────────────────── */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: 'rgba(255,255,255,0.02)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* New chat */}
        <div style={{ padding: '14px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={startNewChat}
            style={{
              width: '100%', height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              background: '#00C37A', color: '#000',
              fontSize: 13, fontWeight: 700,
              border: 'none', borderRadius: 8, cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: '0 0 16px rgba(0,195,122,0.25)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00A868'; e.currentTarget.style.boxShadow = '0 0 24px rgba(0,195,122,0.40)' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#00C37A'; e.currentTarget.style.boxShadow = '0 0 16px rgba(0,195,122,0.25)' }}
          >
            <Plus size={14} />
            New Chat
          </button>
        </div>

        {/* History */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
          {Object.entries(groups).map(([label, convos]) =>
            convos.length === 0 ? null : (
              <div key={label} style={{ marginBottom: 16 }}>
                <p style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)',
                  padding: '0 8px', marginBottom: 4,
                }}>
                  {label}
                </p>
                {convos.map(c => (
                  <button
                    key={c.id}
                    onClick={() => loadConversation(c)}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', gap: 6,
                      padding: '7px 10px', borderRadius: 7,
                      background: activeId === c.id ? 'rgba(0,195,122,0.08)' : hoveredId === c.id ? 'rgba(255,255,255,0.04)' : 'transparent',
                      border: `1px solid ${activeId === c.id ? 'rgba(0,195,122,0.20)' : 'transparent'}`,
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <span style={{
                      fontSize: 12,
                      color: activeId === c.id ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.45)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      flex: 1,
                      transition: 'color 0.12s ease',
                    }}>
                      {c.title}
                    </span>
                    {hoveredId === c.id && (
                      <span
                        onClick={e => deleteConversation(c.id, e)}
                        style={{
                          flexShrink: 0, padding: 3, borderRadius: 4,
                          color: 'rgba(255,255,255,0.30)', cursor: 'pointer',
                          display: 'flex',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#FF4444' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.30)' }}
                      >
                        <Trash2 size={11} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          )}
          {conversations.length === 0 && (
            <div style={{ padding: '40px 12px', textAlign: 'center' }}>
              <MessageSquare size={20} style={{ color: 'rgba(255,255,255,0.20)', margin: '0 auto 8px', display: 'block' }} strokeWidth={1.5} />
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>No conversations yet</p>
            </div>
          )}
        </div>

        {/* Aria footer badge */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'rgba(0,195,122,0.10)',
              border: '1px solid rgba(0,195,122,0.20)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#00C37A' }}>A</span>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.80)' }}>Aria</p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)' }}>Real Estate Intelligence</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>

        {/* Top bar */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', height: 48,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'rgba(0,195,122,0.10)',
              border: '1px solid rgba(0,195,122,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 10px rgba(0,195,122,0.15)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#00C37A' }}>A</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.90)' }}>Aria</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>Real Estate Intelligence</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px',
              background: 'rgba(0,195,122,0.06)',
              border: '1px solid rgba(0,195,122,0.15)',
              borderRadius: 20,
              fontSize: 10, fontWeight: 600,
              color: '#00C37A', letterSpacing: '0.05em',
            }}>
              <Zap size={9} strokeWidth={2.5} />
              UNLIMITED
            </div>
          </div>
        </header>

        {/* Chat thread */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ maxWidth: 740, margin: '0 auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

            {isEmpty ? (
              /* Empty / welcome state */
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                minHeight: '50vh', textAlign: 'center',
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16,
                  background: 'rgba(0,195,122,0.08)',
                  border: '1px solid rgba(0,195,122,0.20)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 24,
                  boxShadow: '0 0 32px rgba(0,195,122,0.12)',
                }}>
                  <span style={{ fontSize: 30, fontWeight: 800, color: '#00C37A' }}>A</span>
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.03em', marginBottom: 8 }}>
                  Hi, I'm Aria.
                </h1>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>
                  Your AI advisor for real estate investing.
                </p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.28)', marginBottom: 40 }}>
                  Ask me anything about wholesaling, ARV, MAO, finding deals, or building your business.
                </p>

                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 10, width: '100%', maxWidth: 580,
                }}>
                  {STARTER_PROMPTS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => send(p.q)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 12, padding: '14px 16px',
                        textAlign: 'left', cursor: 'pointer',
                        transition: 'all 0.18s ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(0,195,122,0.05)'
                        e.currentTarget.style.borderColor = 'rgba(0,195,122,0.20)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                        e.currentTarget.style.transform = 'none'
                      }}
                    >
                      <p.icon size={14} style={{ color: '#00C37A', flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Messages */
              <>
                {messages.map((msg, idx) => {
                  if (msg.role === 'assistant') {
                    return (
                      <AIMessage
                        key={msg.id || idx}
                        content={msg.content}
                        isStreaming={streamingId === msg.id}
                        isError={msg.isError}
                      />
                    )
                  }
                  return <UserMessage key={msg.id || idx} content={msg.content} timestamp={msg.timestamp} />
                })}
                {loading && <TypingIndicator />}
              </>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input area */}
        <div style={{ flexShrink: 0, padding: '12px 24px 24px' }}>
          <div style={{ maxWidth: 740, margin: '0 auto' }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 10,
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14,
              padding: '12px 14px',
              transition: 'border-color 0.15s ease',
            }}
              onFocusCapture={e => { e.currentTarget.style.borderColor = 'rgba(0,195,122,0.35)' }}
              onBlurCapture={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => { setInput(e.target.value); resizeInput() }}
                onKeyDown={handleKeyDown}
                placeholder="Ask Aria anything about real estate…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, background: 'transparent',
                  border: 'none', outline: 'none', resize: 'none',
                  fontSize: 14, color: 'rgba(255,255,255,0.88)',
                  lineHeight: 1.65, maxHeight: 130,
                  fontFamily: 'inherit',
                  caretColor: '#00C37A',
                }}
              />
              {input.trim() && (
                <button
                  onClick={() => send()}
                  disabled={loading}
                  style={{
                    width: 34, height: 34, borderRadius: 9,
                    background: '#00C37A', color: '#000',
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                    boxShadow: '0 0 12px rgba(0,195,122,0.30)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#00A868'; e.currentTarget.style.transform = 'scale(1.05)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#00C37A'; e.currentTarget.style.transform = 'scale(1)' }}
                >
                  <Send size={13} />
                </button>
              )}
            </div>
            <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.20)', marginTop: 8 }}>
              Educational information only — not legal or financial advice.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
