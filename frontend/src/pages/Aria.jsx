import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Send, Plus, Sparkles, ArrowRight, MessageSquare, Trash2, Clock, TrendingUp, Users, BookOpen } from 'lucide-react'
import { formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import toast from 'react-hot-toast'
import { ai } from '../services/api'
import MarkdownRenderer from '../components/ui/MarkdownRenderer'

// ─── Constants ────────────────────────────────────────────────────────────────
const DAILY_LIMIT = 20
const STORAGE_KEY = 'aria_daily'
const HISTORY_KEY = 'aria_history'

const STARTER_PROMPTS = [
  { icon: TrendingUp, label: 'How do I calculate MAO on a deal?',               q: 'How do I calculate MAO (Maximum Allowable Offer) on a wholesale real estate deal?' },
  { icon: Users,      label: 'What makes a seller motivated to sell?',           q: 'What are the signs that indicate a seller is highly motivated to sell their property?' },
  { icon: Sparkles,   label: 'How do I find cash buyers fast?',                  q: 'What are the fastest ways to build a cash buyers list for wholesaling deals?' },
  { icon: BookOpen,   label: 'Walk me through a wholesale deal start to finish', q: 'Can you walk me through a complete wholesale real estate deal from finding a property to closing?' },
]

// ─── Storage helpers ──────────────────────────────────────────────────────────
function getDailyData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}
function getRemaining() {
  const today = new Date().toDateString()
  const d = getDailyData()
  if (!d || d.date !== today) return DAILY_LIMIT
  return Math.max(0, DAILY_LIMIT - (d.count || 0))
}
function incrementUsage() {
  const today = new Date().toDateString()
  const d = getDailyData()
  if (!d || d.date !== today) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: 1 }))
    return DAILY_LIMIT - 1
  }
  const next = (d.count || 0) + 1
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: next }))
  return DAILY_LIMIT - next
}
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
      ref.current = setTimeout(step, 12)
    }
    ref.current = setTimeout(step, 12)
    return () => clearTimeout(ref.current)
  }, [targetText, isStreaming])
  return displayed
}

// ─── User message ─────────────────────────────────────────────────────────────
function UserMessage({ content, timestamp }) {
  return (
    <div className="flex justify-end gap-3 group">
      <div className="flex flex-col items-end gap-1">
        <div className="px-4 py-3 text-[14px] text-white leading-[1.7] max-w-[75%]"
          style={{ background: '#1A3A2A', border: '1px solid #00C37A33', borderRadius: '12px 12px 3px 12px' }}>
          {content}
        </div>
        {timestamp && (
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity mr-1">
            {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
          </span>
        )}
      </div>
      <div className="w-7 h-7 rounded-full bg-elevated border border-border-default flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold text-text-secondary">
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
    <div className="flex gap-3 group">
      <div className="flex-shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <span className="text-[12px] font-bold text-primary">A</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {isError
          ? <p className="text-danger text-[14px] leading-[1.7]">{text}</p>
          : <MarkdownRenderer content={text} />
        }
      </div>
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-[12px] font-bold text-primary">A</span>
      </div>
      <div className="flex items-center gap-1.5 py-2">
        {[0, 150, 300].map(delay => (
          <div key={delay} className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
    </div>
  )
}

// ─── Chat input ───────────────────────────────────────────────────────────────
function ChatInput({ value, onChange, onSend, disabled, placeholder }) {
  const ref = useRef(null)

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(120, el.scrollHeight) + 'px'
  }

  useEffect(() => { resize() }, [value])

  return (
    <div className="flex items-end gap-3 bg-surface border border-border-subtle rounded-[10px] px-4 py-3 focus-within:border-border-default transition-colors">
      <textarea ref={ref} value={value} onChange={e => { onChange(e.target.value); resize() }}
        onKeyDown={handleKeyDown} placeholder={placeholder} rows={1} disabled={disabled}
        className="flex-1 bg-transparent text-[14px] text-text-primary placeholder-text-muted focus:outline-none resize-none disabled:opacity-40"
        style={{ maxHeight: '120px', lineHeight: '1.6' }}
      />
      {value.trim() && (
        <button onClick={onSend} disabled={disabled}
          className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-primary hover:bg-primary-hover text-black transition-colors disabled:opacity-40 flex-shrink-0">
          <Send size={13} />
        </button>
      )}
    </div>
  )
}

// ─── Group history by date ────────────────────────────────────────────────────
function groupByDate(conversations) {
  const groups = { Today: [], Yesterday: [], 'Last 7 days': [], Older: [] }
  conversations.forEach(c => {
    const d = new Date(c.updatedAt || c.createdAt)
    if (isToday(d))           groups.Today.push(c)
    else if (isYesterday(d))  groups.Yesterday.push(c)
    else if (Date.now() - d.getTime() < 7 * 86400000) groups['Last 7 days'].push(c)
    else                      groups.Older.push(c)
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
  const [remaining, setRemaining]         = useState(getRemaining)
  const [streamingId, setStreamingId]     = useState(null)
  const [hoveredId, setHoveredId]         = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { saveHistory(conversations) }, [conversations])

  const startNewChat = useCallback(() => {
    setActiveId(null); setMessages([]); setInput('')
  }, [])

  const loadConversation = useCallback(convo => {
    setActiveId(convo.id); setMessages(convo.messages || []); setInput('')
  }, [])

  const deleteConversation = useCallback((id, e) => {
    e.stopPropagation()
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) startNewChat()
  }, [activeId, startNewChat])

  const send = useCallback(async text => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    if (remaining <= 0) { toast.error('Daily limit reached.'); return }

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
      setTimeout(() => setStreamingId(null), Math.min(reply.length * 12, 4000))

      const left = incrementUsage()
      setRemaining(left)

      const title = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '')
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
  }, [input, loading, remaining, messages, activeId])

  const isEmpty = messages.length === 0
  const groups  = groupByDate(conversations)
  const isLow   = remaining <= 5 && remaining > 0

  return (
    <div className="flex h-full bg-bg overflow-hidden">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-[240px] flex-shrink-0 bg-surface border-r border-border-subtle flex flex-col">
        {/* New chat */}
        <div className="p-3 border-b border-border-subtle">
          <button onClick={startNewChat}
            className="w-full flex items-center gap-2 bg-primary hover:bg-primary-hover text-black text-[13px] font-semibold px-3 py-2.5 rounded-[6px] transition-colors">
            <Plus size={14} />
            New Chat
          </button>
        </div>

        {/* History */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4 scrollbar-hide">
          {Object.entries(groups).map(([label, convos]) =>
            convos.length === 0 ? null : (
              <div key={label}>
                <p className="label-caps px-2 mb-1.5">{label}</p>
                {convos.map(c => (
                  <button key={c.id} onClick={() => loadConversation(c)}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[6px] text-left transition-colors text-[13px] ${
                      activeId === c.id
                        ? 'bg-elevated text-text-primary'
                        : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
                    }`}>
                    <span className="truncate flex-1">{c.title}</span>
                    {hoveredId === c.id && (
                      <span onClick={e => deleteConversation(c.id, e)}
                        className="flex-shrink-0 p-0.5 rounded hover:text-danger transition-colors">
                        <Trash2 size={12} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          )}
          {conversations.length === 0 && (
            <div className="px-3 py-8 text-center">
              <MessageSquare size={20} className="text-text-muted mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[12px] text-text-muted">No conversations yet</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[4px] bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="text-[11px] font-bold text-primary">A</span>
            </div>
            <div>
              <p className="text-[12px] font-medium text-text-primary">Aria</p>
              <p className="text-[10px] text-text-muted">Real Estate Intelligence</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[4px] bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="text-[11px] font-bold text-primary">A</span>
            </div>
            <span className="text-[14px] font-medium text-text-primary">Aria</span>
            <span className="text-[12px] text-text-muted">— Real Estate Intelligence</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Limit pill */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border ${
              isLow
                ? 'bg-warning/10 border-warning/30 text-warning'
                : 'bg-elevated border-border-subtle text-text-muted'
            }`}>
              <Clock size={10} />
              {remaining} / {DAILY_LIMIT} left
            </div>
            <Link to="/login" className="text-[12px] font-medium text-primary hover:text-primary-hover transition-colors">
              Sign in →
            </Link>
          </div>
        </header>

        {/* Chat thread */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="max-w-[720px] mx-auto px-6 py-6 space-y-6">

            {isEmpty ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
                <div className="w-14 h-14 rounded-[12px] bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                  <span className="text-[28px] font-bold text-primary">A</span>
                </div>
                <h1 className="text-[28px] font-medium text-white mb-2">Hi, I'm Aria.</h1>
                <p className="text-[14px] text-text-secondary mb-1">Your free AI advisor for real estate investing.</p>
                <p className="text-[13px] text-text-muted mb-10">Ask me anything about wholesaling, ARV, MAO, or finding deals.</p>

                <div className="grid grid-cols-2 gap-3 w-full max-w-[560px]">
                  {STARTER_PROMPTS.map(p => (
                    <button key={p.label} onClick={() => send(p.q)}
                      className="flex items-start gap-3 bg-card hover:bg-elevated border border-border-subtle hover:border-primary/30 rounded-lg p-4 text-left transition-all group">
                      <p.icon size={14} className="text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-[13px] text-text-muted group-hover:text-text-secondary transition-colors leading-snug">
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
                      <AIMessage key={msg.id || idx}
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

            {/* Limit exhausted */}
            {remaining === 0 && !isEmpty && (
              <div className="flex justify-center">
                <div className="bg-card border border-border-subtle rounded-lg p-6 text-center max-w-sm w-full">
                  <p className="text-[14px] font-medium text-text-primary mb-1">You've used all your free messages today.</p>
                  <p className="text-[13px] text-text-muted mb-4">Sign up free to get 50 messages per day.</p>
                  <Link to="/register"
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-black font-semibold px-5 py-2.5 rounded-[6px] text-[13px] transition-colors">
                    Create Free Account <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Low limit banner */}
        {isLow && (
          <div className="flex-shrink-0 mx-auto w-full max-w-[720px] px-6 pb-1">
            <div className="flex items-center justify-between px-4 py-2.5 bg-warning/5 border border-warning/20 rounded-[6px]">
              <p className="text-[12px] text-warning">{remaining} free messages remaining today</p>
              <Link to="/register" className="text-[12px] text-primary hover:underline font-medium">
                Sign up for unlimited →
              </Link>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex-shrink-0 px-6 pb-6 pt-2">
          <div className="max-w-[720px] mx-auto">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => send()}
              disabled={loading || remaining === 0}
              placeholder={remaining > 0 ? 'Ask Aria anything about real estate…' : 'Daily limit reached — sign up for unlimited access'}
            />
            <p className="text-center text-[11px] text-text-muted mt-2">
              Educational information only — not legal or financial advice.{' '}
              <Link to="/login" className="text-primary hover:underline">Already have an account?</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
