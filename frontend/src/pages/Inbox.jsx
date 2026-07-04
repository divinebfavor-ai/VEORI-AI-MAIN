/**
 * Two-Way SMS Inbox
 * Real-time conversation threads with leads.
 * Left panel: conversation list. Right panel: thread + reply.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Search, MessageSquare, Phone, RefreshCw, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

const POLL_INTERVAL = 5000 // 5-second polling

const QUICK_REPLIES = [
  'Interested in making a cash offer on your property.',
  'When is a good time to talk?',
  'What is your asking price?',
  'Are you open to a quick close?',
]

function scoreColor(score) {
  if (!score) return 'var(--t4)'
  if (score >= 70) return '#00C37A'
  if (score >= 40) return '#FF9500'
  return '#FF4444'
}

function fmtTime(str) {
  if (!str) return ''
  const d = new Date(str)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function LeadInitials({ name }) {
  const initials = (name || 'U')
    .split(' ')
    .map(n => n[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <div style={{
      width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
      background: 'var(--surface-bg-3)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, color: 'var(--t2)', letterSpacing: '0.02em',
    }}>
      {initials}
    </div>
  )
}

export default function Inbox() {
  const [conversations, setConversations] = useState([])
  const [messages, setMessages]           = useState([])
  const [selected, setSelected]           = useState(null)
  const [reply, setReply]                 = useState('')
  const [sending, setSending]             = useState(false)
  const [loading, setLoading]             = useState(true)
  const [filter, setFilter]               = useState('All')
  const [search, setSearch]               = useState('')
  const threadRef = useRef(null)
  const pollRef   = useRef(null)

  // ── Load conversation list ──────────────────────────────────────────────────
  const loadInbox = useCallback(async () => {
    try {
      const res = await api.get('/api/sms/inbox')
      setConversations(res.data?.data || [])
    } catch {
      // silent - don't spam toasts on background poll
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Load thread for selected lead ───────────────────────────────────────────
  const loadThread = useCallback(async (leadId) => {
    if (!leadId) return
    try {
      const res = await api.get(`/api/sms/conversation/${leadId}`)
      setMessages(res.data?.data || [])
      // Mark as read
      await api.post(`/api/sms/read/${leadId}`).catch(() => {})
      // Update unread count in conversation list
      setConversations(prev =>
        prev.map(c => c.lead_id === leadId ? { ...c, unread_count: 0 } : c)
      )
    } catch {
      setMessages([])
    }
  }, [])

  // ── Select conversation ─────────────────────────────────────────────────────
  const selectConversation = useCallback(async (conv) => {
    setSelected(conv)
    await loadThread(conv.lead_id)
  }, [loadThread])

  // ── Send reply ──────────────────────────────────────────────────────────────
  const sendReply = async () => {
    if (!reply.trim() || !selected?.lead_id || sending) return
    setSending(true)
    const body = reply.trim()
    setReply('')
    try {
      await api.post('/api/sms/send', { lead_id: selected.lead_id, message: body })
      await loadThread(selected.lead_id)
      await loadInbox()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send message')
      setReply(body) // restore on failure
    } finally {
      setSending(false)
    }
  }

  // ── Scroll thread to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  // ── Initial load + polling ──────────────────────────────────────────────────
  useEffect(() => {
    loadInbox()
    pollRef.current = setInterval(() => {
      loadInbox()
      if (selected?.lead_id) loadThread(selected.lead_id)
    }, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [loadInbox, loadThread, selected?.lead_id])

  // ── Filtered + searched conversations ──────────────────────────────────────
  const filtered = conversations.filter(c => {
    const name = `${c.lead?.first_name || ''} ${c.lead?.last_name || ''}`.toLowerCase()
    const phone = c.lead?.phone || ''
    const matchSearch = !search || name.includes(search.toLowerCase()) || phone.includes(search)

    const score = c.lead?.motivation_score || 0
    const matchFilter =
      filter === 'All'         ? true :
      filter === 'Unread'      ? c.unread_count > 0 :
      filter === 'Hot Leads'   ? score >= 70 :
      filter === 'Needs Reply' ? c.last_direction === 'inbound' :
      true

    return matchSearch && matchFilter
  })

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── Left panel: conversation list ──────────────────────────────────── */}
      <div style={{
        width: 320, flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 16px 12px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em' }}>
                Inbox
              </h1>
              {totalUnread > 0 && (
                <span style={{
                  background: '#00C37A', color: '#060E1A',
                  fontSize: 10, fontWeight: 800,
                  padding: '1px 6px', borderRadius: 8,
                }}>
                  {totalUnread}
                </span>
              )}
            </div>
            <button
              onClick={loadInbox}
              style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 4 }}
              title="Refresh"
            >
              <RefreshCw size={13} strokeWidth={1.8} />
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={12} strokeWidth={1.8} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t4)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or phone..."
              style={{
                width: '100%', height: 32, background: 'var(--surface-bg-2)',
                border: '1px solid var(--border)', borderRadius: 8,
                paddingLeft: 30, paddingRight: 12,
                fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto' }}>
            {['All', 'Unread', 'Hot Leads', 'Needs Reply'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  height: 24, padding: '0 8px', borderRadius: 12, flexShrink: 0,
                  border: `1px solid ${filter === f ? 'rgba(0,195,122,0.4)' : 'var(--border)'}`,
                  background: filter === f ? 'rgba(0,195,122,0.08)' : 'var(--border)',
                  fontSize: 10, fontWeight: filter === f ? 600 : 400,
                  color: filter === f ? '#00C37A' : 'var(--t3)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-bg-2)', flexShrink: 0, animation: 'skeleton-pulse 1.4s ease infinite' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ width: 100, height: 11, borderRadius: 4, background: 'var(--surface-bg-2)', marginBottom: 6, animation: 'skeleton-pulse 1.4s ease infinite' }} />
                  <div style={{ width: '80%', height: 9, borderRadius: 4, background: 'var(--border)', animation: 'skeleton-pulse 1.4s ease infinite 0.1s' }} />
                </div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px 20px' }}>
              <MessageSquare size={28} strokeWidth={1.2} color="var(--t4)" style={{ marginBottom: 10 }} />
              <p style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 500 }}>No conversations</p>
              <p style={{ fontSize: 11, color: 'var(--t4)' }}>Messages appear here when leads reply</p>
            </div>
          ) : (
            filtered.map(conv => {
              const name = [conv.lead?.first_name, conv.lead?.last_name].filter(Boolean).join(' ') || conv.lead?.phone || 'Unknown'
              const isActive = selected?.lead_id === conv.lead_id
              return (
                <div
                  key={conv.lead_id}
                  onClick={() => selectConversation(conv)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: isActive ? 'rgba(0,195,122,0.05)' : 'transparent',
                    borderLeft: `2px solid ${isActive ? '#00C37A' : 'transparent'}`,
                    cursor: 'pointer',
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    transition: 'background 0.12s',
                  }}
                >
                  <LeadInitials name={name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: conv.unread_count > 0 ? 700 : 500, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--t4)', flexShrink: 0, marginLeft: 6 }}>
                        {fmtTime(conv.last_message_at)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontSize: 11, color: conv.unread_count > 0 ? 'var(--t2)' : 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {conv.last_direction === 'outbound' ? '↗ ' : ''}{conv.last_message || ''}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}>
                        {conv.lead?.motivation_score > 0 && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: scoreColor(conv.lead.motivation_score) }}>
                            {conv.lead.motivation_score}
                          </span>
                        )}
                        {conv.unread_count > 0 && (
                          <span style={{ background: '#00C37A', color: '#060E1A', fontSize: 9, fontWeight: 800, width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                    {conv.lead?.property_address && (
                      <p style={{ fontSize: 10, color: 'var(--t4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {conv.lead.property_address}
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel: thread ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <MessageSquare size={24} strokeWidth={1.3} color="#00C37A" />
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>Select a conversation</p>
            <p style={{ fontSize: 12, color: 'var(--t4)' }}>Choose a conversation on the left to view the thread</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <LeadInitials name={[selected.lead?.first_name, selected.lead?.last_name].filter(Boolean).join(' ') || 'Unknown'} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 1 }}>
                    {[selected.lead?.first_name, selected.lead?.last_name].filter(Boolean).join(' ') || 'Unknown Caller'}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--t4)' }}>
                    {selected.lead?.phone || ''}{selected.lead?.property_address ? ` · ${selected.lead.property_address}` : ''}
                  </p>
                </div>
              </div>
              {selected.lead?.motivation_score > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 10, color: 'var(--t4)', display: 'block', marginBottom: 2 }}>MOTIVATION</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: scoreColor(selected.lead.motivation_score) }}>
                    {selected.lead.motivation_score}
                  </span>
                </div>
              )}
            </div>

            {/* Messages */}
            <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--t4)', fontSize: 12 }}>
                  No messages yet. Send the first message below.
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isOutbound = msg.direction === 'outbound'
                  return (
                    <div key={msg.id || i} style={{ display: 'flex', justifyContent: isOutbound ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '72%',
                        background: isOutbound ? 'rgba(0,195,122,0.12)' : 'var(--surface-bg-2)',
                        border: `1px solid ${isOutbound ? 'rgba(0,195,122,0.25)' : 'var(--border)'}`,
                        borderRadius: isOutbound ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        padding: '9px 13px',
                      }}>
                        <p style={{ fontSize: 13, color: isOutbound ? '#00C37A' : 'var(--t1)', lineHeight: 1.45, margin: 0, wordBreak: 'break-word' }}>
                          {msg.body}
                        </p>
                        <p style={{ fontSize: 10, color: 'var(--t4)', marginTop: 4, textAlign: isOutbound ? 'right' : 'left', margin: '4px 0 0' }}>
                          {fmtTime(msg.sent_at)}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Quick replies */}
            <div style={{ padding: '8px 20px 0', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
              {QUICK_REPLIES.map((qr, i) => (
                <button
                  key={i}
                  onClick={() => setReply(qr)}
                  style={{
                    height: 26, padding: '0 10px', borderRadius: 13, flexShrink: 0,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-bg-2)',
                    fontSize: 10, color: 'var(--t3)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.12s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {qr}
                </button>
              ))}
            </div>

            {/* Reply input */}
            <div style={{ padding: '10px 20px 16px', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                placeholder="Type a message… (Enter to send)"
                rows={2}
                style={{
                  flex: 1, background: 'var(--surface-bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 10, padding: '10px 12px',
                  fontSize: 13, color: 'var(--t1)',
                  fontFamily: 'inherit', outline: 'none', resize: 'none',
                  lineHeight: 1.45,
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(0,195,122,0.4)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
              />
              <button
                onClick={sendReply}
                disabled={sending || !reply.trim()}
                style={{
                  width: 40, height: 40,
                  background: reply.trim() ? '#00C37A' : 'var(--surface-bg-3)',
                  border: 'none', borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: reply.trim() ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s', flexShrink: 0,
                }}
              >
                <Send size={15} strokeWidth={2} color={reply.trim() ? '#060E1A' : 'var(--t4)'} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
