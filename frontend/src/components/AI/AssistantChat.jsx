import React, { useState, useRef, useEffect } from 'react'
import { MessageSquare, X, Send, Bot, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { ai } from '../../services/api'

export default function AssistantChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your AI advisor. Ask me anything about your leads, campaigns, or deal analysis.",
      timestamp: new Date(),
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState(50)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return
    if (remaining <= 0) {
      toast.error('Message limit reached. Upgrade for unlimited messages.')
      return
    }

    const userMsg = { role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await ai.sendAssistantMessage(text, history)
      const reply = res.data?.message || res.data?.reply || res.data?.content || 'I received your message.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date() }])
      setRemaining(prev => Math.max(0, prev - 1))
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting right now. Please try again.",
        timestamp: new Date(),
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      {/* Floating Button */}
      <div className="fixed bottom-6 right-6 z-40">
        {open ? (
          /* Chat Panel */
          <div className="flex flex-col w-96 h-[560px] bg-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden mb-0">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-elevated">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Bot size={16} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-text-primary">AI Advisor</div>
                  <div className="text-xs text-text-muted">{remaining} messages remaining</div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-white'
                        : msg.error
                        ? 'bg-danger/10 text-danger border border-danger/20'
                        : 'bg-elevated text-text-secondary border border-border-subtle'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-elevated border border-border-subtle rounded-xl px-4 py-3">
                    <div className="flex gap-1 items-center">
                      <div className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Limit warning */}
            {remaining <= 5 && remaining > 0 && (
              <div className="px-4 py-2 bg-warning/10 border-t border-warning/20">
                <p className="text-xs text-warning flex items-center gap-1.5">
                  <Zap size={12} />
                  {remaining} messages left. Upgrade for unlimited.
                </p>
              </div>
            )}
            {remaining === 0 && (
              <div className="px-4 py-3 bg-danger/10 border-t border-danger/20">
                <p className="text-xs text-danger font-medium">Message limit reached.</p>
                <button className="text-xs text-primary mt-1 underline">Upgrade plan</button>
              </div>
            )}

            {/* Input */}
            <div className="px-4 py-3 border-t border-border-subtle">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about deals, leads, or strategies..."
                  rows={1}
                  disabled={remaining === 0}
                  className="flex-1 bg-surface border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary resize-none disabled:opacity-50"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading || remaining === 0}
                  className="w-9 h-9 flex items-center justify-center bg-primary hover:bg-primary-hover rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Toggle button */
          <button
            onClick={() => setOpen(true)}
            className="w-14 h-14 bg-primary hover:bg-primary-hover rounded-2xl shadow-xl flex items-center justify-center text-white transition-all hover:scale-105 animate-glow"
          >
            <MessageSquare size={22} />
          </button>
        )}
      </div>
    </>
  )
}
