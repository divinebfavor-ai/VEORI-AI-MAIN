import React, { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, X, Send, Minus, TrendingUp, Phone, BarChart2, Mail } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { ai } from '../../services/api'
import MarkdownRenderer from '../ui/MarkdownRenderer'

const PROMPTS = [
  { icon: TrendingUp, label: 'Show my hottest leads',       q: 'Which of my leads have the highest motivation scores right now? Show me the top ones to prioritize.' },
  { icon: Phone,      label: 'What to follow up on today?', q: 'What should I prioritize following up on today based on my recent calls and leads?' },
  { icon: BarChart2,  label: 'How did calls perform?',      q: 'Give me a summary of how my calls performed this week — connect rate, motivation scores, deals close to converting.' },
  { icon: Mail,       label: 'Write a follow up SMS',       q: 'Help me write a compelling follow-up SMS to a motivated seller who said they need to think about it.' },
]

function useStream(target, active) {
  const [shown, setShown] = useState('')
  const t = useRef(null)
  useEffect(() => {
    if (!active || !target) { setShown(target || ''); return }
    setShown(''); let i = 0
    const step = () => { i += Math.floor(Math.random()*3)+2; if (i>=target.length){setShown(target);return}; setShown(target.slice(0,i)); t.current=setTimeout(step,12) }
    t.current = setTimeout(step, 12)
    return () => clearTimeout(t.current)
  }, [target, active])
  return shown
}

function UserMsg({ content }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] text-[13px] text-white leading-[1.7] px-3.5 py-2.5"
        style={{ background:'#1A3A2A', border:'1px solid rgba(0,195,122,0.25)', borderRadius:'14px 14px 3px 14px' }}>
        {content}
      </div>
    </div>
  )
}

function AIMsg({ content, isFirst, streaming, isError }) {
  const shown = useStream(content, streaming)
  return (
    <div className="flex gap-2.5">
      <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-primary text-[9px] font-bold">V</span>
      </div>
      <div className="flex-1 min-w-0">
        {isFirst && <p className="label-caps mb-1">Veori Assistant</p>}
        {isError
          ? <p className="text-danger text-[13px] leading-[1.7]">{shown || content}</p>
          : <MarkdownRenderer content={streaming ? shown : content} />
        }
      </div>
    </div>
  )
}

function Typing() {
  return (
    <div className="flex gap-2.5">
      <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
        <span className="text-primary text-[9px] font-bold">V</span>
      </div>
      <div className="flex items-center gap-1 py-1.5">
        {[0,150,300].map(d => <div key={d} className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{animationDelay:`${d}ms`}} />)}
      </div>
    </div>
  )
}

export default function AssistantChat() {
  const [open, setOpen]       = useState(false)
  const [min, setMin]         = useState(false)
  const [msgs, setMsgs]       = useState([])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [streamId, setStreamId] = useState(null)
  const [limit, setLimit]     = useState(200)
  const bottomRef = useRef(null)
  const taRef     = useRef(null)

  useEffect(() => { if (open && !min) bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [msgs, loading, open, min])

  const send = useCallback(async (text) => {
    const t = (text || input).trim()
    if (!t || loading) return
    if (limit <= 0) { toast.error('Message limit reached'); return }
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'

    const id  = Date.now().toString()
    const um  = { id:`u-${id}`, role:'user', content:t, ts: new Date().toISOString() }
    const nxt = [...msgs, um]
    setMsgs(nxt); setLoading(true)

    try {
      const res   = await ai.sendAssistantMessage(t, msgs.map(m=>({role:m.role,content:m.content})))
      const reply = res.data?.reply || res.data?.message || res.data?.content || "I'm having trouble connecting."
      const aid   = `a-${id}`
      const am    = { id:aid, role:'assistant', content:reply, ts: new Date().toISOString() }
      setMsgs([...nxt, am])
      setStreamId(aid)
      setTimeout(() => setStreamId(null), Math.min(reply.length*12, 4000))
      setLimit(l => Math.max(0, l-1))
    } catch {
      setMsgs(p => [...p, { id:`e-${id}`, role:'assistant', content:"Sorry, I'm having trouble connecting right now.", isError:true }])
    } finally { setLoading(false) }
  }, [input, loading, limit, msgs])

  const resize = () => { const el=taRef.current; if(!el)return; el.style.height='auto'; el.style.height=Math.min(100,el.scrollHeight)+'px' }
  const empty  = msgs.length === 0

  return (
    <>
      {/* Toggle button */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setMin(false) }}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-primary hover:bg-primary-hover rounded-[10px] shadow-lg flex items-center justify-center text-black transition-colors"
          title="Veori Assistant"
        >
          <MessageSquare size={20} strokeWidth={2} />
        </button>
      )}

      {/* Panel */}
      <div
        className={`fixed bottom-0 right-0 z-50 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width:400, height: min ? 'auto' : 'min(660px, 90vh)' }}
      >
        <div className="flex flex-col flex-1 overflow-hidden"
          style={{ background:'#141414', border:'1px solid #242424', borderRadius: min ? '10px' : '10px 10px 0 0', boxShadow:'0 -8px 40px rgba(0,0,0,0.6)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="text-primary text-[11px] font-bold">V</span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-white leading-none">Veori Assistant</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="dot-live" style={{width:5,height:5}} />
                  <p className="text-[10px] text-text-muted">Online · {limit} messages</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMin(!min)} className="w-7 h-7 flex items-center justify-center rounded-[5px] text-text-muted hover:text-text-primary hover:bg-elevated transition-colors">
                <Minus size={14} />
              </button>
              <button onClick={() => setOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-[5px] text-text-muted hover:text-text-primary hover:bg-elevated transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>

          {!min && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-hide">
                {empty && (
                  <div className="space-y-4">
                    <div className="text-center py-2">
                      <p className="text-[14px] font-medium text-text-primary mb-1">What can I help you with?</p>
                      <p className="text-[12px] text-text-muted">I have full context on your leads, calls and deals.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {PROMPTS.map(p => (
                        <button key={p.label} onClick={() => send(p.q)}
                          className="flex flex-col gap-1.5 bg-elevated hover:bg-elevated border border-border-subtle hover:border-primary/30 rounded-lg p-3 text-left transition-colors group">
                          <p.icon size={13} className="text-primary" />
                          <span className="text-[11px] text-text-muted group-hover:text-text-secondary leading-snug transition-colors">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msgs.map((m, i) => {
                  const isAI    = m.role === 'assistant'
                  const prevAI  = i > 0 && msgs[i-1].role === 'assistant'
                  if (isAI) return <AIMsg key={m.id} content={m.content} isFirst={!prevAI} streaming={streamId===m.id} isError={m.isError} />
                  return <UserMsg key={m.id} content={m.content} />
                })}
                {loading && <Typing />}
                <div ref={bottomRef} />
              </div>

              {/* Limit warn */}
              {limit <= 5 && limit > 0 && (
                <div className="flex-shrink-0 px-4 py-2 border-t border-border-subtle bg-warning/5">
                  <p className="text-[11px] text-warning">{limit} messages remaining</p>
                </div>
              )}

              {/* Input */}
              <div className="flex-shrink-0 p-3 border-t border-border-subtle">
                <div className="flex items-end gap-0 rounded-lg border border-border-subtle" style={{background:'#0C0C0C',padding:'10px 10px 10px 14px'}}>
                  <textarea ref={taRef} value={input}
                    onChange={e => { setInput(e.target.value); resize() }}
                    onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()} }}
                    placeholder="Message Veori Assistant…" rows={1} disabled={loading||limit===0}
                    className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted focus:outline-none resize-none disabled:opacity-40"
                    style={{maxHeight:100,lineHeight:1.5}}
                  />
                  {input.trim() && (
                    <button onClick={() => send()} disabled={loading||limit===0}
                      className="ml-2 w-7 h-7 flex items-center justify-center rounded-[5px] bg-primary hover:bg-primary-hover text-black transition-colors disabled:opacity-40 flex-shrink-0">
                      <Send size={12} strokeWidth={2.5} />
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
