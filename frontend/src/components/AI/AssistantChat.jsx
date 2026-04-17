import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  MessageSquare, X, Send, Sparkles, Minus,
  TrendingUp, Phone, BarChart2, Mail,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { ai } from '../../services/api'
import MarkdownRenderer from '../ui/MarkdownRenderer'

// ─── Starter prompts for operator context ─────────────────────────────────────
const OPERATOR_PROMPTS = [
  { icon: TrendingUp, label: 'Show me my hottest leads right now',           q: 'Which of my leads have the highest motivation scores right now? Show me the top ones to prioritize.' },
  { icon: Phone,      label: 'What should I follow up on today?',            q: "What should I prioritize following up on today? Look at my recent calls and leads that need attention." },
  { icon: BarChart2,  label: 'How did my calls perform this week?',          q: 'Give me a summary of how my calls performed this week — connect rate, motivation scores, and any deals close to converting.' },
  { icon: Mail,       label: 'Help me write a follow up message',            q: 'Help me write a compelling follow-up SMS to a motivated seller who expressed interest but said they need to think about it.' },
]

// ─── Streaming hook ────────────────────────────────────────────────────────────
function useStreamText(targetText, isStreaming) {
  const [displayed, setDisplayed] = useState('')
  const timerRef = useRef(null)

  useEffect(() => {
    if (!isStreaming || !targetText) { setDisplayed(targetText || ''); return }
    setDisplayed('')
    let idx = 0
    const step = () => {
      idx += Math.floor(Math.random() * 3) + 2
      if (idx >= targetText.length) { setDisplayed(targetText); return }
      setDisplayed(targetText.slice(0, idx))
      timerRef.current = setTimeout(step, 12)
    }
    timerRef.current = setTimeout(step, 12)
    return () => clearTimeout(timerRef.current)
  }, [targetText, isStreaming])

  return displayed
}

// ─── User message ──────────────────────────────────────────────────────────────
function UserMsg({ content, timestamp }) {
  return (
    <div className="flex justify-end gap-2 group">
      <div className="flex flex-col items-end gap-0.5">
        <div
          className="text-sm text-white leading-[1.7] px-3.5 py-2.5"
          style={{
            background: '#1E3A5F',
            borderRadius: '16px 16px 4px 16px',
            maxWidth: '78%',
          }}
        >
          {content}
        </div>
        {timestamp && (
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity mr-1">
            {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
          </span>
        )}
      </div>
      <div className="w-6 h-6 rounded-full bg-border-default flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-text-primary">
        U
      </div>
    </div>
  )
}

// ─── AI message ────────────────────────────────────────────────────────────────
function AIMsg({ content, isFirst, isStreaming, isError }) {
  const displayed = useStreamText(content, isStreaming)
  const text = isStreaming ? displayed : content

  return (
    <div className="flex gap-2.5 group animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles size={11} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        {isFirst && (
          <p className="text-[10px] font-medium text-text-muted mb-1">Veori Assistant</p>
        )}
        {isError ? (
          <p className="text-danger text-sm leading-[1.7]">{text}</p>
        ) : (
          <MarkdownRenderer content={text} className="text-sm" />
        )}
      </div>
    </div>
  )
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
function Typing() {
  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center flex-shrink-0">
        <Sparkles size={11} className="text-white" />
      </div>
      <div className="flex items-center gap-1 py-1.5">
        {[0, 150, 300].map((d) => (
          <div key={d} className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function AssistantChat() {
  const [open, setOpen]               = useState(false)
  const [minimized, setMinimized]     = useState(false)
  const [messages, setMessages]       = useState([])
  const [input, setInput]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [streamingId, setStreamingId] = useState(null)
  const [remaining, setRemaining]     = useState(200)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll
  useEffect(() => {
    if (open && !minimized) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading, open, minimized])

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    if (remaining <= 0) { toast.error('Message limit reached.'); return }

    setInput('')
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }

    const msgId   = Date.now().toString()
    const userMsg = { id: `u-${msgId}`, role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    setLoading(true)

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const res     = await ai.sendAssistantMessage(trimmed, history)
      const reply   = res.data?.reply || res.data?.message || res.data?.content || "I'm having trouble connecting right now."

      const aiMsgId = `a-${msgId}`
      const aiMsg   = { id: aiMsgId, role: 'assistant', content: reply, timestamp: new Date().toISOString() }
      setMessages([...newMsgs, aiMsg])
      setStreamingId(aiMsgId)
      setTimeout(() => setStreamingId(null), Math.min(reply.length * 12, 4000))
      setRemaining((r) => Math.max(0, r - 1))
    } catch {
      setMessages((prev) => [...prev, {
        id: `e-${msgId}`,
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting right now. Please try again.",
        isError: true,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, remaining, messages])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(100, el.scrollHeight) + 'px'
  }

  const isEmpty = messages.length === 0

  return (
    <>
      {/* Toggle button — only shown when panel is closed */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setMinimized(false) }}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-primary hover:bg-primary-hover rounded-2xl shadow-xl shadow-primary/30 flex items-center justify-center text-white transition-all hover:scale-105"
          title="Open Veori Assistant"
        >
          <MessageSquare size={22} />
        </button>
      )}

      {/* Sliding panel */}
      <div
        className={`
          fixed bottom-0 right-0 z-50 flex flex-col
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{
          width: '420px',
          height: minimized ? 'auto' : 'min(680px, 90vh)',
          maxHeight: minimized ? 'auto' : '90vh',
        }}
      >
        <div
          className="flex flex-col flex-1 overflow-hidden"
          style={{
            background: '#111B2E',
            border: '1px solid #1E2D45',
            borderRadius: minimized ? '16px' : '16px 16px 0 0',
            boxShadow: '0 -4px 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div
            className="flex items-center justify-between px-4 py-3.5 flex-shrink-0 border-b border-border-subtle"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                <Sparkles size={15} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary leading-none">Veori AI Assistant</p>
                <p className="text-[10px] text-text-muted mt-0.5">{remaining} messages remaining</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimized(!minimized)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
                title={minimized ? 'Expand' : 'Minimize'}
              >
                <Minus size={15} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* ── Messages ─────────────────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-hide">

                {/* Empty state with starter prompts */}
                {isEmpty && (
                  <div className="pt-2 space-y-4">
                    <div className="text-center pb-2">
                      <p className="text-sm text-text-secondary font-medium mb-0.5">
                        What can I help you with?
                      </p>
                      <p className="text-xs text-text-muted">
                        I know your leads, campaigns, and deals.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {OPERATOR_PROMPTS.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => sendMessage(p.q)}
                          className="flex flex-col gap-2 bg-elevated hover:bg-border-subtle border border-border-subtle hover:border-primary/30 rounded-xl p-3 text-left transition-all group"
                        >
                          <p.icon size={14} className="text-primary group-hover:scale-110 transition-transform" />
                          <span className="text-[11px] text-text-secondary group-hover:text-text-primary leading-snug transition-colors">
                            {p.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message thread */}
                {messages.map((msg, idx) => {
                  const isAI      = msg.role === 'assistant'
                  const prevIsAI  = idx > 0 && messages[idx - 1].role === 'assistant'
                  const isFirstAI = isAI && !prevIsAI

                  if (isAI) {
                    return (
                      <AIMsg
                        key={msg.id || idx}
                        content={msg.content}
                        isFirst={isFirstAI}
                        isStreaming={streamingId === msg.id}
                        isError={msg.isError}
                      />
                    )
                  }
                  return (
                    <UserMsg
                      key={msg.id || idx}
                      content={msg.content}
                      timestamp={msg.timestamp}
                    />
                  )
                })}

                {loading && <Typing />}
                <div ref={bottomRef} />
              </div>

              {/* ── Limit warning ─────────────────────────────────────────────── */}
              {remaining <= 5 && remaining > 0 && (
                <div className="flex-shrink-0 px-4 py-2 border-t border-warning/20 bg-warning/5">
                  <p className="text-xs text-warning">{remaining} messages remaining today</p>
                </div>
              )}
              {remaining === 0 && (
                <div className="flex-shrink-0 px-4 py-2 border-t border-danger/20 bg-danger/5">
                  <p className="text-xs text-danger font-medium">Message limit reached.</p>
                  <button className="text-xs text-primary hover:underline mt-0.5">Upgrade plan</button>
                </div>
              )}

              {/* ── Input ─────────────────────────────────────────────────────── */}
              <div className="flex-shrink-0 p-3 border-t border-border-subtle">
                <div
                  className="flex items-end gap-0 rounded-xl border"
                  style={{
                    background: '#0D1421',
                    borderColor: '#243550',
                    padding: '12px 12px 12px 14px',
                  }}
                >
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => { setInput(e.target.value); autoResize() }}
                    onKeyDown={handleKeyDown}
                    placeholder={remaining > 0 ? 'Message Veori Assistant…' : 'Message limit reached'}
                    rows={1}
                    disabled={loading || remaining === 0}
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted focus:outline-none resize-none disabled:opacity-40"
                    style={{ maxHeight: '100px', lineHeight: '1.5' }}
                  />
                  {input.trim() && (
                    <button
                      onClick={() => sendMessage()}
                      disabled={loading || remaining === 0}
                      className="ml-2.5 w-7 h-7 flex items-center justify-center rounded-lg bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      <Send size={13} />
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
