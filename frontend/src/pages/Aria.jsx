import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Send, Plus, Sparkles, ArrowRight, MessageSquare, Trash2,
  ChevronRight, Menu, X, Clock, TrendingUp, Users, BookOpen,
} from 'lucide-react'
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns'
import toast from 'react-hot-toast'
import { ai } from '../services/api'
import MarkdownRenderer from '../components/ui/MarkdownRenderer'

// ─── Constants ────────────────────────────────────────────────────────────────
const DAILY_LIMIT   = 20
const STORAGE_KEY   = 'aria_daily'
const HISTORY_KEY   = 'aria_history'

const STARTER_PROMPTS = [
  { icon: TrendingUp, label: 'How do I calculate MAO on a deal?',              q: 'How do I calculate MAO (Maximum Allowable Offer) on a wholesale real estate deal?' },
  { icon: Users,      label: 'What makes a seller motivated to sell?',          q: 'What are the signs that indicate a seller is highly motivated to sell their property?' },
  { icon: Sparkles,   label: 'How do I find cash buyers fast?',                  q: 'What are the fastest ways to build a cash buyers list for wholesaling deals?' },
  { icon: BookOpen,   label: 'Walk me through a wholesale deal start to finish', q: 'Can you walk me through a complete wholesale real estate deal from finding a property to closing?' },
]

// ─── Local storage helpers ────────────────────────────────────────────────────
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

// ─── Streaming simulation hook ────────────────────────────────────────────────
function useStreamText(targetText, isStreaming) {
  const [displayed, setDisplayed] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!isStreaming || !targetText) { setDisplayed(targetText || ''); return }
    setDisplayed('')
    let idx = 0
    const step = () => {
      idx += Math.floor(Math.random() * 3) + 2 // 2-4 chars per tick
      if (idx >= targetText.length) { setDisplayed(targetText); return }
      setDisplayed(targetText.slice(0, idx))
      ref.current = setTimeout(step, 12)
    }
    ref.current = setTimeout(step, 12)
    return () => clearTimeout(ref.current)
  }, [targetText, isStreaming])

  return displayed
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function UserMessage({ content, timestamp }) {
  return (
    <div className="flex justify-end gap-3 group">
      <div className="flex flex-col items-end gap-1">
        <div
          className="px-4 py-3 text-sm text-white leading-[1.7]"
          style={{
            background: '#1E3A5F',
            borderRadius: '18px 18px 4px 18px',
            maxWidth: '75%',
            minWidth: '60px',
          }}
        >
          {content}
        </div>
        {timestamp && (
          <span className="text-[11px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity mr-1">
            {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
          </span>
        )}
      </div>
      <div className="w-7 h-7 rounded-full bg-border-default flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold text-text-primary">
        U
      </div>
    </div>
  )
}

// ─── AI message ────────────────────────────────────────────────────────────────
function AIMessage({ content, isFirst, isStreaming, isError }) {
  const displayed = useStreamText(content, isStreaming)
  const text = isStreaming ? displayed : content

  return (
    <div
      className="flex gap-3 group animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ animationFillMode: 'both' }}
    >
      <div className="flex-shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
          <Sparkles size={13} className="text-white" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {isFirst && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-xs font-medium text-text-muted">Aria</span>
          </div>
        )}
        {isError ? (
          <p className="text-danger text-sm leading-[1.7]">{text}</p>
        ) : (
          <MarkdownRenderer content={text} />
        )}
      </div>
    </div>
  )
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles size={13} className="text-white" />
      </div>
      <div className="flex items-center gap-1.5 py-2">
        {[0, 150, 300].map((delay) => (
          <div
            key={delay}
            className="w-2 h-2 bg-text-muted rounded-full animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Input area ────────────────────────────────────────────────────────────────
function ChatInput({ value, onChange, onSend, disabled, placeholder }) {
  const textareaRef = useRef(null)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(120, el.scrollHeight) + 'px'
  }

  useEffect(() => { autoResize() }, [value])

  return (
    <div
      className="flex items-end gap-0 rounded-xl border"
      style={{
        background: '#0D1421',
        borderColor: '#243550',
        padding: '14px 14px 14px 16px',
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); autoResize() }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="flex-1 bg-transparent text-[15px] text-text-primary placeholder-text-muted focus:outline-none resize-none disabled:opacity-40"
        style={{ maxHeight: '120px', lineHeight: '1.5' }}
      />
      {value.trim() && (
        <button
          onClick={onSend}
          disabled={disabled}
          className="ml-3 w-8 h-8 flex items-center justify-center rounded-lg bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-40 flex-shrink-0"
        >
          <Send size={14} />
        </button>
      )}
    </div>
  )
}

// ─── Group history by date ─────────────────────────────────────────────────────
function groupByDate(conversations) {
  const groups = { Today: [], Yesterday: [], 'Last 7 days': [], Older: [] }
  conversations.forEach((c) => {
    const d = new Date(c.updatedAt || c.createdAt)
    if (isToday(d)) groups.Today.push(c)
    else if (isYesterday(d)) groups.Yesterday.push(c)
    else if (Date.now() - d.getTime() < 7 * 24 * 3600 * 1000) groups['Last 7 days'].push(c)
    else groups.Older.push(c)
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
  const [sidebarOpen, setSidebarOpen]     = useState(false)
  const [hoveredId, setHoveredId]         = useState(null)
  const bottomRef = useRef(null)

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Persist conversations
  useEffect(() => { saveHistory(conversations) }, [conversations])

  const startNewChat = useCallback(() => {
    setActiveId(null)
    setMessages([])
    setInput('')
    setSidebarOpen(false)
  }, [])

  const loadConversation = useCallback((convo) => {
    setActiveId(convo.id)
    setMessages(convo.messages || [])
    setInput('')
    setSidebarOpen(false)
  }, [])

  const deleteConversation = useCallback((id, e) => {
    e.stopPropagation()
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) startNewChat()
  }, [activeId, startNewChat])

  const send = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return

    if (remaining <= 0) {
      toast.error('Daily limit reached.')
      return
    }

    setInput('')
    const msgId     = Date.now().toString()
    const userMsg   = { id: `u-${msgId}`, role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const newMsgs   = [...messages, userMsg]
    setMessages(newMsgs)
    setLoading(true)

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const res     = await ai.sendAriaMessage(trimmed, history)
      const reply   = res.data?.reply || res.data?.message || res.data?.content || "I'm having trouble connecting right now."

      const aiMsgId = `a-${msgId}`
      const aiMsg   = { id: aiMsgId, role: 'assistant', content: reply, timestamp: new Date().toISOString() }
      const finalMsgs = [...newMsgs, aiMsg]

      setMessages(finalMsgs)
      setStreamingId(aiMsgId)
      setTimeout(() => setStreamingId(null), Math.min(reply.length * 12, 4000))

      const left = incrementUsage()
      setRemaining(left)

      // Save conversation
      const title   = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '')
      const now     = new Date().toISOString()

      if (activeId) {
        setConversations((prev) =>
          prev.map((c) => c.id === activeId ? { ...c, messages: finalMsgs, updatedAt: now } : c)
        )
      } else {
        const newConvo = { id: msgId, title, messages: finalMsgs, createdAt: now, updatedAt: now }
        setConversations((prev) => [newConvo, ...prev])
        setActiveId(msgId)
      }
    } catch {
      const errMsg = { id: `e-${msgId}`, role: 'assistant', content: "I'm having trouble connecting right now. Please try again in a moment.", isError: true, timestamp: new Date().toISOString() }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, remaining, messages, activeId])

  const isEmpty  = messages.length === 0
  const groups   = groupByDate(conversations)
  const isLow    = remaining <= 5 && remaining > 0

  // ─── Sidebar ────────────────────────────────────────────────────────────────
  const Sidebar = (
    <aside className={`
      flex flex-col w-[260px] flex-shrink-0 bg-card border-r border-border-subtle
      md:flex
      ${sidebarOpen ? 'flex fixed inset-y-0 left-0 z-50' : 'hidden'}
    `}>
      {/* New chat */}
      <div className="p-3 border-b border-border-subtle">
        <button
          onClick={startNewChat}
          className="w-full flex items-center gap-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium px-3 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New chat
        </button>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4 scrollbar-hide">
        {Object.entries(groups).map(([label, convos]) =>
          convos.length === 0 ? null : (
            <div key={label}>
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest px-2 mb-1">{label}</p>
              {convos.map((c) => (
                <button
                  key={c.id}
                  onClick={() => loadConversation(c)}
                  onMouseEnter={() => setHoveredId(c.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors text-sm group ${
                    activeId === c.id
                      ? 'bg-elevated text-text-primary'
                      : 'text-text-secondary hover:bg-elevated/60 hover:text-text-primary'
                  }`}
                >
                  <span className="truncate flex-1">{c.title}</span>
                  {hoveredId === c.id && (
                    <span
                      onClick={(e) => deleteConversation(c.id, e)}
                      className="flex-shrink-0 p-0.5 rounded hover:text-danger transition-colors"
                    >
                      <Trash2 size={13} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        )}

        {conversations.length === 0 && (
          <div className="px-3 py-6 text-center">
            <MessageSquare size={24} className="text-text-muted mx-auto mb-2" />
            <p className="text-xs text-text-muted">No conversations yet</p>
          </div>
        )}
      </div>

      {/* Branding footer */}
      <div className="p-4 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
            <Sparkles size={11} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-text-primary">Veori AI</p>
            <p className="text-[10px] text-text-muted">Aria v1.0</p>
          </div>
        </div>
      </div>
    </aside>
  )

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      {Sidebar}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Top bar */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border-subtle flex-shrink-0">
          {/* Mobile hamburger */}
          <button
            className="md:hidden text-text-muted hover:text-text-primary transition-colors"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu size={20} />
          </button>

          {/* Center branding */}
          <div className="flex-1 flex justify-center">
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                  <span className="text-white text-xs font-black">A</span>
                </div>
                <span className="font-black text-text-primary">Aria</span>
                <span className="text-text-muted text-xs hidden sm:block">— Real Estate Intelligence</span>
              </div>
              <p className="text-[10px] text-text-muted hidden sm:block">Free AI advisor for real estate investors</p>
            </div>
          </div>

          {/* Right: limit pill + sign in */}
          <div className="flex items-center gap-3">
            {/* Limit indicator */}
            <div className={`
              hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border
              ${remaining <= 5
                ? 'bg-warning/10 border-warning/30 text-warning'
                : 'bg-elevated border-border-subtle text-text-muted'}
            `}>
              <Clock size={10} />
              {remaining} / {DAILY_LIMIT} left
            </div>

            <Link
              to="/login"
              className="hidden sm:flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover transition-colors"
            >
              Sign in <ChevronRight size={12} />
            </Link>
          </div>
        </header>

        {/* Chat thread */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-4 md:px-6 py-6 space-y-6">

            {isEmpty ? (
              /* ── Empty state ─────────────────────────────────────── */
              <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center mb-5 shadow-lg shadow-primary/20">
                  <Sparkles size={28} className="text-white" />
                </div>
                <h1 className="text-2xl md:text-3xl font-black text-text-primary mb-2">
                  Hi, I&apos;m Aria.
                </h1>
                <p className="text-text-secondary mb-1">
                  Your free AI advisor for real estate investing.
                </p>
                <p className="text-text-muted text-sm mb-10">Ask me anything.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[600px]">
                  {STARTER_PROMPTS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => send(p.q)}
                      className="flex items-start gap-3 bg-card hover:bg-elevated border border-border-subtle hover:border-primary/30 rounded-xl p-4 text-left transition-all group"
                    >
                      <p.icon size={16} className="text-primary flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors leading-snug">
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* ── Messages ──────────────────────────────────────────── */
              <>
                {messages.map((msg, idx) => {
                  const isAI       = msg.role === 'assistant'
                  const prevIsAI   = idx > 0 && messages[idx - 1].role === 'assistant'
                  const isFirstAI  = isAI && !prevIsAI

                  if (isAI) {
                    return (
                      <AIMessage
                        key={msg.id || idx}
                        content={msg.content}
                        isFirst={isFirstAI}
                        isStreaming={streamingId === msg.id}
                        isError={msg.isError}
                      />
                    )
                  }
                  return (
                    <UserMessage
                      key={msg.id || idx}
                      content={msg.content}
                      timestamp={msg.timestamp}
                    />
                  )
                })}

                {loading && <TypingIndicator />}
              </>
            )}

            {/* Limit exhausted inline card */}
            {remaining === 0 && !isEmpty && (
              <div className="flex justify-center">
                <div className="bg-card border border-border-subtle rounded-2xl p-6 text-center max-w-sm w-full">
                  <p className="text-text-primary font-semibold mb-1">
                    You&apos;ve used all your free messages today.
                  </p>
                  <p className="text-text-muted text-sm mb-4">
                    Sign up free to get 50 messages per day and full property analysis.
                  </p>
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
                  >
                    Create Free Account <ArrowRight size={14} />
                  </Link>
                  <p className="mt-3">
                    <button
                      className="text-xs text-text-muted hover:text-text-secondary transition-colors"
                      onClick={() => {}}
                    >
                      Maybe later
                    </button>
                  </p>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Low limit warning */}
        {isLow && (
          <div className="flex-shrink-0 mx-auto w-full max-w-[760px] px-4 md:px-6 pb-1">
            <div className="flex items-center justify-between px-4 py-2.5 bg-warning/10 border border-warning/20 rounded-xl">
              <p className="text-xs text-warning">{remaining} free messages left today</p>
              <Link to="/register" className="text-xs text-primary hover:underline font-medium">
                Sign up for unlimited →
              </Link>
            </div>
          </div>
        )}

        {/* Mobile limit pill */}
        <div className="flex-shrink-0 mx-auto w-full max-w-[760px] px-4 md:px-6 pb-1 sm:hidden">
          <div className={`
            flex justify-center
            ${remaining <= 5 ? 'text-warning' : 'text-text-muted'}
          `}>
            <span className="text-[10px]">{remaining} / {DAILY_LIMIT} free messages today</span>
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 pb-4 md:pb-6 px-4 md:px-6">
          <div className="max-w-[760px] mx-auto">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => send()}
              disabled={loading || remaining === 0}
              placeholder={remaining > 0 ? 'Ask Aria anything about real estate…' : 'Sign up for unlimited access'}
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
