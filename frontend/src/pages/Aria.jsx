import React, { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Send, Sparkles, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { ai } from '../services/api'

const EXAMPLE_PROMPTS = [
  'How does wholesale real estate work?',
  'How do I calculate MAO (Maximum Allowable Offer)?',
  'What makes a motivated seller?',
  'How do I find cash buyers fast?',
]

const DAILY_LIMIT = 20
const STORAGE_KEY = 'aria_daily'

function getDailyData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function getRemaining() {
  const today = new Date().toDateString()
  const data = getDailyData()
  if (!data || data.date !== today) return DAILY_LIMIT
  return Math.max(0, DAILY_LIMIT - (data.count || 0))
}

function incrementUsage() {
  const today = new Date().toDateString()
  const data = getDailyData()
  if (!data || data.date !== today) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: 1 }))
    return DAILY_LIMIT - 1
  }
  const next = (data.count || 0) + 1
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: next }))
  return DAILY_LIMIT - next
}

export default function Aria() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState(getRemaining)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const send = async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return
    if (remaining <= 0) {
      toast.error('Daily limit reached. Sign up for unlimited access.')
      return
    }

    setInput('')
    const userMsg = { role: 'user', content: trimmed }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await ai.sendAriaMessage(trimmed, history)
      const reply = res.data?.message || res.data?.reply || res.data?.content || 'I received your question!'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      const left = incrementUsage()
      setRemaining(left)
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <header className="border-b border-border-subtle px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-purple-500 rounded-lg flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <span className="font-black text-text-primary text-lg">Aria</span>
              <span className="text-text-muted text-xs ml-2">by Veori AI</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-text-muted">
              {remaining}/{DAILY_LIMIT} free messages today
            </span>
            <Link
              to="/register"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
            >
              Sign up free <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Chat area */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-6 py-6">
        {isEmpty ? (
          /* Welcome screen */
          <div className="flex-1 flex flex-col items-center justify-center text-center pb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-purple-500 rounded-2xl flex items-center justify-center mb-5">
              <Sparkles size={28} className="text-white" />
            </div>
            <h1 className="text-3xl font-black text-text-primary mb-2">Meet Aria</h1>
            <p className="text-text-secondary mb-1">Free AI Real Estate Advisor</p>
            <p className="text-text-muted text-sm mb-10">
              Ask me anything about wholesaling, deal analysis, or finding motivated sellers.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="bg-card border border-border-subtle hover:border-primary/40 hover:bg-elevated rounded-xl p-4 text-left text-sm text-text-secondary hover:text-text-primary transition-all"
                >
                  <span className="text-primary mr-2">"</span>
                  {prompt}
                  <span className="text-primary ml-2">"</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="flex-1 overflow-y-auto space-y-5 pb-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 bg-gradient-to-br from-primary to-purple-500 rounded-lg flex items-center justify-center flex-shrink-0 mr-3 mt-0.5">
                    <Sparkles size={14} className="text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-tr-sm'
                      : msg.error
                      ? 'bg-danger/10 text-danger border border-danger/20'
                      : 'bg-card border border-border-subtle text-text-secondary rounded-tl-sm'
                  }`}
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 bg-gradient-to-br from-primary to-purple-500 rounded-lg flex items-center justify-center flex-shrink-0 mr-3 mt-0.5">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div className="bg-card border border-border-subtle rounded-2xl rounded-tl-sm px-5 py-4">
                  <div className="flex gap-1.5 items-center">
                    <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Limit warning */}
        {remaining <= 5 && remaining > 0 && (
          <div className="mb-3 px-4 py-3 bg-warning/10 border border-warning/20 rounded-xl flex items-center justify-between">
            <p className="text-sm text-warning">{remaining} free messages left today</p>
            <Link to="/register" className="text-sm font-medium text-primary hover:underline">
              Sign up for unlimited →
            </Link>
          </div>
        )}

        {remaining === 0 && (
          <div className="mb-3 px-4 py-4 bg-card border border-border-subtle rounded-xl text-center">
            <p className="text-text-secondary font-medium mb-1">Daily limit reached</p>
            <p className="text-text-muted text-sm mb-3">
              Create a free account for unlimited Aria conversations and access to the full platform.
            </p>
            <Link
              to="/register"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              Create Free Account <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Input */}
        <div className="bg-card border border-border-subtle rounded-2xl p-3">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={remaining > 0 ? 'Ask Aria anything about real estate...' : 'Sign up for unlimited access'}
              rows={1}
              disabled={remaining === 0}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted focus:outline-none resize-none disabled:opacity-50 py-1"
              style={{ maxHeight: '120px' }}
              onInput={e => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading || remaining === 0}
              className="w-9 h-9 flex items-center justify-center bg-primary hover:bg-primary-hover rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-text-muted mt-3">
          Aria provides educational information only, not legal or financial advice.
          <Link to="/login" className="text-primary ml-2 hover:underline">Already have an account? Sign in</Link>
        </p>
      </div>
    </div>
  )
}
