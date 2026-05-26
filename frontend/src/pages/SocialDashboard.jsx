import React, { useState, useEffect, useCallback } from 'react'
import {
  Share2, Plus, Calendar, Clock, CheckCircle, XCircle,
  RefreshCw, TrendingUp, Users, Heart, MessageCircle,
  Eye, Zap, AlertTriangle, ChevronDown, ChevronUp,
  Facebook, Youtube, Instagram, Twitter,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'

function authHeaders() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

const PLATFORMS = [
  { id: 'facebook',  label: 'Facebook',   icon: '📘', color: '#1877F2' },
  { id: 'instagram', label: 'Instagram',  icon: '📸', color: '#E1306C' },
  { id: 'twitter',   label: 'Twitter/X',  icon: '𝕏',  color: '#1DA1F2' },
  { id: 'youtube',   label: 'YouTube',    icon: '▶',  color: '#FF0000' },
  { id: 'tiktok',    label: 'TikTok',     icon: '♪',  color: '#69C9D0' },
]

const STATUS_COLORS = {
  pending:   '#C9A84C',
  scheduled: '#00C37A',
  published: '#6BCB77',
  failed:    '#FF4444',
  cancelled: 'var(--t4)',
}

function StatusBadge({ status }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
      textTransform: 'uppercase', padding: '2px 8px',
      borderRadius: 20, border: `1px solid ${STATUS_COLORS[status] || 'var(--border)'}`,
      color: STATUS_COLORS[status] || 'var(--t4)',
      background: `${STATUS_COLORS[status] || 'transparent'}18`,
    }}>
      {status}
    </span>
  )
}

function PlatformIcon({ platform }) {
  const p = PLATFORMS.find(x => x.id === platform)
  if (!p) return <span style={{ fontSize: 14 }}>🌐</span>
  return <span style={{ fontSize: 16 }}>{p.icon}</span>
}

function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>{label}</p>
        {Icon && <Icon size={16} style={{ color: color || 'var(--t4)' }} strokeWidth={1.6} />}
      </div>
      <p style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--t1)', margin: 0, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--t4)', marginTop: 6, margin: '6px 0 0' }}>{sub}</p>}
    </div>
  )
}

function ComposeModal({ onClose, onScheduled }) {
  const [caption, setCaption] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [scheduleType, setScheduleType] = useState('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const togglePlatform = (id) =>
    setPlatforms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const handleSubmit = async () => {
    if (!caption.trim()) { setError('Caption is required'); return }
    if (platforms.length === 0) { setError('Select at least one platform'); return }
    if (scheduleType === 'later' && !scheduledAt) { setError('Pick a scheduled date/time'); return }
    setSubmitting(true)
    setError('')
    try {
      const body = {
        caption,
        platforms,
        scheduled_at: scheduleType === 'now' ? null : scheduledAt,
        post_type: 'manual',
      }
      const res = await fetch(`${API}/post-queue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to schedule post')
      }
      onScheduled()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }}>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 28, width: '100%', maxWidth: 540,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>New Post</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', fontSize: 20 }}>x</button>
        </div>

        {/* Caption */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Caption</label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Write your post caption..."
            rows={4}
            style={{
              width: '100%', background: 'var(--surface-bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', color: 'var(--t1)', fontSize: 13,
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: 11, color: 'var(--t4)', marginTop: 4 }}>{caption.length} characters</p>
        </div>

        {/* Platforms */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Platforms</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 20,
                  border: `1px solid ${platforms.includes(p.id) ? p.color : 'var(--border)'}`,
                  background: platforms.includes(p.id) ? `${p.color}18` : 'transparent',
                  color: platforms.includes(p.id) ? p.color : 'var(--t3)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  transition: 'all 0.15s',
                }}
              >
                <span>{p.icon}</span> {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>When to Post</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[['now', 'Post Now'], ['later', 'Schedule']].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setScheduleType(v)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8,
                  border: `1px solid ${scheduleType === v ? '#00C37A' : 'var(--border)'}`,
                  background: scheduleType === v ? 'rgba(0,195,122,0.1)' : 'transparent',
                  color: scheduleType === v ? '#00C37A' : 'var(--t3)',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500,
                }}
              >
                {l}
              </button>
            ))}
          </div>
          {scheduleType === 'later' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              style={{
                width: '100%', background: 'var(--surface-bg)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px', color: 'var(--t1)', fontSize: 13,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          )}
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(255,68,68,0.08)', borderRadius: 8, marginBottom: 16 }}>
            <AlertTriangle size={14} style={{ color: '#FF4444' }} />
            <span style={{ fontSize: 12, color: '#FF4444' }}>{error}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '10px 0', borderRadius: 8,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--t3)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{
            flex: 2, padding: '10px 0', borderRadius: 8,
            border: 'none', background: '#00C37A',
            color: '#000', cursor: submitting ? 'default' : 'pointer',
            fontSize: 13, fontWeight: 600, opacity: submitting ? 0.7 : 1,
          }}>
            {submitting ? 'Scheduling...' : scheduleType === 'now' ? 'Post Now' : 'Schedule Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PostRow({ post, onCancel }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 20px', borderBottom: '1px solid var(--border)',
    }}>
      {/* Platform icons */}
      <div style={{ display: 'flex', gap: 4, width: 80, flexShrink: 0 }}>
        {(post.platforms || [post.platform]).filter(Boolean).map(p => (
          <PlatformIcon key={p} platform={p} />
        ))}
      </div>

      {/* Caption preview */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, color: 'var(--t1)', margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {post.caption || post.content || 'No caption'}
        </p>
        <p style={{ fontSize: 11, color: 'var(--t4)', margin: '2px 0 0' }}>
          {post.post_type ? `${post.post_type} post` : 'Manual'} &middot; {post.created_at ? new Date(post.created_at).toLocaleDateString() : ''}
        </p>
      </div>

      {/* Scheduled time */}
      <div style={{ width: 140, flexShrink: 0, textAlign: 'right' }}>
        {post.scheduled_at ? (
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>
            {new Date(post.scheduled_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        ) : (
          <p style={{ fontSize: 12, color: '#00C37A', margin: 0 }}>Immediate</p>
        )}
      </div>

      {/* Status */}
      <div style={{ width: 90, flexShrink: 0, textAlign: 'center' }}>
        <StatusBadge status={post.status || 'pending'} />
      </div>

      {/* Actions */}
      {(post.status === 'pending' || post.status === 'scheduled') && (
        <button onClick={() => onCancel(post.id || post.queue_id)} style={{
          background: 'none', border: '1px solid var(--border)',
          borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
          color: 'var(--t4)', fontSize: 11,
        }}>
          Cancel
        </button>
      )}
    </div>
  )
}

export default function SocialDashboard() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCompose, setShowCompose] = useState(false)
  const [tab, setTab] = useState('queue')
  const [stats, setStats] = useState({ total: 0, published: 0, scheduled: 0, failed: 0 })
  const [connections, setConnections] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [queueRes, connRes] = await Promise.all([
        fetch(`${API}/post-queue?tab=${tab}`, { headers: authHeaders() }),
        fetch(`${API}/social-connections`, { headers: authHeaders() }),
      ])
      if (queueRes.ok) {
        const data = await queueRes.json()
        const items = data.posts || data.queue || []
        setPosts(items)
        setStats({
          total: data.total || items.length,
          published: items.filter(p => p.status === 'published').length,
          scheduled: items.filter(p => p.status === 'scheduled').length,
          failed: items.filter(p => p.status === 'failed').length,
        })
      }
      if (connRes.ok) {
        const cd = await connRes.json()
        setConnections(cd.connections || [])
      }
    } catch {
      setError('Could not load posts. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const cancelPost = async (id) => {
    try {
      await fetch(`${API}/post-queue/${id}/cancel`, { method: 'PATCH', headers: authHeaders() })
      load()
    } catch {
      // silent
    }
  }

  const connectedPlatforms = connections.filter(c => c.connected)

  return (
    <div style={{ padding: '32px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--t1)', margin: 0, letterSpacing: '-0.02em' }}>Social Dashboard</h1>
          <p style={{ fontSize: 13, color: 'var(--t4)', marginTop: 4 }}>Schedule, track, and auto-post to your connected social platforms</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={load} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--t3)', cursor: 'pointer', fontSize: 13,
          }}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button onClick={() => setShowCompose(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: '#00C37A', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            <Plus size={14} /> New Post
          </button>
        </div>
      </div>

      {/* Connected platforms banner */}
      {connectedPlatforms.length === 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px', borderRadius: 10, marginBottom: 20,
          background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)',
        }}>
          <AlertTriangle size={16} style={{ color: '#C9A84C', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, color: '#C9A84C', fontWeight: 500, margin: 0 }}>No social accounts connected</p>
            <p style={{ fontSize: 12, color: 'var(--t4)', margin: '2px 0 0' }}>
              Go to <a href="/settings" style={{ color: '#00C37A' }}>Settings &rarr; Social Media</a> to connect Facebook, Instagram, and more.
            </p>
          </div>
        </div>
      )}

      {connectedPlatforms.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 10, marginBottom: 20,
          background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.15)',
        }}>
          <CheckCircle size={14} style={{ color: '#00C37A' }} />
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>
            Connected: {connectedPlatforms.map(c => c.platform).join(', ')}
          </p>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard label="Total Posts" value={stats.total} icon={Share2} color="var(--t1)" />
        <StatCard label="Published" value={stats.published} icon={CheckCircle} color="#6BCB77" />
        <StatCard label="Scheduled" value={stats.scheduled} icon={Clock} color="#00C37A" />
        <StatCard label="Failed" value={stats.failed} icon={XCircle} color="#FF4444" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[
          { id: 'queue', label: 'Queue' },
          { id: 'published', label: 'Published' },
          { id: 'failed', label: 'Failed' },
          { id: 'all', label: 'All' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', borderRadius: '8px 8px 0 0',
            border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? '#00C37A' : 'var(--t4)',
            borderBottom: tab === t.id ? '2px solid #00C37A' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Post list */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{
          display: 'flex', gap: 12, padding: '10px 20px',
          background: 'var(--surface-bg)', borderBottom: '1px solid var(--border)',
        }}>
          {[['Platform', 80], ['Caption', null], ['Scheduled', 140], ['Status', 90], ['', 70]].map(([h, w]) => (
            <div key={h} style={{ width: w || undefined, flex: w ? undefined : 1 }}>
              <span style={{ fontSize: 10, color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>{h}</span>
            </div>
          ))}
        </div>

        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--t4)', fontSize: 13 }}>Loading posts...</div>
        )}

        {!loading && error && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <AlertTriangle size={28} style={{ color: '#FF4444', margin: '0 auto 10px', display: 'block' }} />
            <p style={{ fontSize: 13, color: '#FF4444' }}>{error}</p>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Share2 size={36} style={{ color: 'var(--t4)', margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
            <p style={{ fontSize: 15, color: 'var(--t2)', margin: '0 0 6px' }}>No posts yet</p>
            <p style={{ fontSize: 13, color: 'var(--t4)' }}>Create your first post with the "New Post" button above</p>
          </div>
        )}

        {!loading && !error && posts.map(post => (
          <PostRow key={post.id || post.queue_id} post={post} onCancel={cancelPost} />
        ))}
      </div>

      {showCompose && (
        <ComposeModal onClose={() => setShowCompose(false)} onScheduled={load} />
      )}
    </div>
  )
}
