/**
 * Admin Dashboard - /admin
 * Only accessible to admin emails
 */
import React, { useState, useEffect } from 'react'
import { Users, DollarSign, Phone, TrendingUp, Globe, RefreshCw, Eye, MapPin, Share2 } from 'lucide-react'

const API      = `${import.meta.env.VITE_API_URL || 'https://veori.net'}/api/admin`
const API_BASE = import.meta.env.VITE_API_URL || 'https://veori.net'

function authHeaders() {
  const token = localStorage.getItem('veori_token')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function StatCard({ icon: Icon, label, value, sub, color = '#00C37A' }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ background: `${color}18`, borderRadius: 10, padding: 12, flexShrink: 0 }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--t1)', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginTop: 6 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

const COUNTRY_NAMES = {
  US: 'United States', GB: 'United Kingdom', NG: 'Nigeria', CA: 'Canada',
  AU: 'Australia', GH: 'Ghana', ZA: 'South Africa', KE: 'Kenya',
  IN: 'India', DE: 'Germany', FR: 'France', BR: 'Brazil',
}

const PLAN_COLORS = {
  starter: '#00C37A', solo: '#34D399', operator: '#60A5FA',
  scale: '#A78BFA', enterprise: '#F87171',
  founding_member: '#C9A84C', growth: '#00C37A', pro: '#93C5FD', // retired tiers - legacy rows
}

export default function Admin() {
  const [stats, setStats]         = useState(null)
  const [users, setUsers]         = useState([])
  const [countries, setCountries] = useState([])
  const [revenue, setRevenue]     = useState(null)
  const [visitors, setVisitors]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [tab, setTab]             = useState('overview')

  const load = async () => {
    setLoading(true)
    try {
      const [s, u, c, r, v] = await Promise.all([
        fetch(`${API}/stats`,     { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/users`,     { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/countries`, { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/revenue`,   { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API_BASE}/api/analytics/landing-stats`, { headers: authHeaders() }).then(x => x.json()).catch(() => null),
      ])
      if (!s.success) { setError('Admin access only'); return }
      setStats(s.stats)
      setUsers(u.users || [])
      setCountries(c.countries || [])
      setRevenue(r)
      if (v?.success) setVisitors(v)
    } catch {
      setError('Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ color: 'var(--t1)', fontSize: 18, fontWeight: 700 }}>Admin Access Only</div>
      <div style={{ color: 'var(--t2)', fontSize: 14 }}>{error}</div>
    </div>
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--t2)' }}>
      Loading admin data...
    </div>
  )

  const TABS = ['overview', 'visitors', 'users', 'countries', 'revenue']

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--t1)', margin: 0 }}>Admin Dashboard</h1>
          <p style={{ color: 'var(--t2)', margin: '4px 0 0', fontSize: 13 }}>Real-time overview of Veori</p>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--t1)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 600,
            background: tab === t ? '#00C37A' : 'transparent',
            color: tab === t ? '#060E1A' : 'var(--t2)',
            cursor: 'pointer', textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
            <StatCard icon={Users}      label="Total Users"       value={stats.total_users}      sub={`+${stats.new_today} today`} />
            <StatCard icon={TrendingUp} label="Active This Week"  value={stats.active_this_week} color="#C9A84C" />
            <StatCard icon={DollarSign} label="Paying Customers"  value={stats.paying_customers} sub={`$${stats.mrr?.toLocaleString()}/mo MRR`} color="#C9A84C" />
            <StatCard icon={Phone}      label="Total AI Calls"    value={stats.total_calls?.toLocaleString()} color="#60A5FA" />
          </div>

          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 16 }}>Monthly Recurring Revenue</div>
            <div style={{ fontSize: 44, fontWeight: 900, color: '#00C37A' }}>${stats.mrr?.toLocaleString()}</div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>ARR: ${(stats.mrr * 12)?.toLocaleString()}</div>
          </div>
        </>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>
            {users.length} Users
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Email', 'Location', 'Plan', 'Joined', 'Last Seen'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap' }}>{u.full_name || 'Unknown'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)' }}>{u.email}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                      {[u.city, u.region, u.country_code].filter(Boolean).join(', ') || 'Unknown'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {u.subscription_plan ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${PLAN_COLORS[u.subscription_plan] || '#00C37A'}18`, color: PLAN_COLORS[u.subscription_plan] || '#00C37A' }}>
                          {u.subscription_plan.replace('_', ' ')}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--t2)' }}>Free</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                      {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Visitors - Landing Page Analytics */}
      {tab === 'visitors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              { label: 'Today',      value: visitors?.stats?.today      ?? '-', icon: Eye,    color: '#00C37A' },
              { label: 'This Week',  value: visitors?.stats?.this_week  ?? '-', icon: Eye,    color: '#4D9EFF' },
              { label: 'This Month', value: visitors?.stats?.this_month ?? '-', icon: Eye,    color: '#C9A84C' },
              { label: 'All Time',   value: visitors?.stats?.all_time   ?? '-', icon: Globe,  color: '#FF9500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ background: `${color}18`, borderRadius: 10, padding: 10 }}>
                  <Icon size={18} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--t1)', lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>{label}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Top countries */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={14} /> Top Countries (30 days)
              </div>
              {!visitors?.top_countries?.length ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>No visits yet</div>
              ) : (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visitors.top_countries.map((c, i) => {
                    const max = visitors.top_countries[0]?.count || 1
                    return (
                      <div key={c.country}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                          <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{c.country || 'Unknown'}</span>
                          <span style={{ fontSize: 12, color: 'var(--t2)' }}>{c.count}</span>
                        </div>
                        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.round((c.count/max)*100)}%`, background: i === 0 ? '#00C37A' : 'rgba(0,195,122,0.5)', borderRadius: 3 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Traffic sources */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Share2 size={14} /> Traffic Sources (30 days)
              </div>
              {!visitors?.top_sources?.length ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>No visits yet</div>
              ) : (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {visitors.top_sources.map((s, i) => {
                    const icons = { facebook:'📘', instagram:'📸', twitter:'𝕏', tiktok:'♪', youtube:'▶', google:'🔍', linkedin:'💼', direct:'🔗', other:'🌐', reddit:'🤖', bing:'🔎' }
                    const colors = { facebook:'#1877F2', instagram:'#E1306C', twitter:'#1DA1F2', tiktok:'#69C9D0', google:'#4285F4', direct:'#00C37A', other:'#FF9500' }
                    const total = visitors.top_sources.reduce((a,x) => a + x.count, 0)
                    const pct   = Math.round((s.count / total) * 100)
                    const color = colors[s.source] || '#00C37A'
                    return (
                      <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{icons[s.source] || '🌐'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600, textTransform: 'capitalize' }}>{s.source}</span>
                            <span style={{ fontSize: 12, color: 'var(--t2)' }}>{s.count} ({pct}%)</span>
                          </div>
                          <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent visitors */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>
              Recent Visitors
            </div>
            {!visitors?.recent?.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>No visits recorded yet</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-bg)' }}>
                    {['Location', 'Source', 'Device', 'Time'].map(h => (
                      <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visitors.recent.map((v, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--t1)' }}>
                        {[v.city, v.region, v.country_name].filter(Boolean).join(', ') || 'Unknown'}
                      </td>
                      <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--t2)', textTransform: 'capitalize' }}>{v.referrer_source || 'direct'}</td>
                      <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--t2)', textTransform: 'capitalize' }}>{v.device_type || '-'}</td>
                      <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--t3)' }}>
                        {new Date(v.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Countries */}
      {tab === 'countries' && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={16} /> Users by Country
          </div>
          {countries.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--t2)', fontSize: 14 }}>No location data yet. Will populate as users sign up.</div>
          ) : (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {countries.map(c => {
                const pct = Math.round((c.count / users.length) * 100)
                return (
                  <div key={c.country_code}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, color: 'var(--t1)', fontWeight: 600 }}>
                        {COUNTRY_NAMES[c.country_code] || c.country_code}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--t2)' }}>{c.count} users ({pct}%)</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#00C37A', borderRadius: 3, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Revenue */}
      {tab === 'revenue' && revenue && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
              <div style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>MRR</div>
              <div style={{ fontSize: 40, fontWeight: 900, color: '#00C37A' }}>${(revenue.mrr || 0).toLocaleString()}</div>
            </div>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
              <div style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>ARR</div>
              <div style={{ fontSize: 40, fontWeight: 900, color: '#C9A84C' }}>${(revenue.arr || 0).toLocaleString()}</div>
            </div>
          </div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>Revenue by Plan</div>
            {(revenue.breakdown || []).length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--t2)' }}>No paying customers yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Plan', 'Customers', 'MRR'].map(h => (
                      <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(revenue.breakdown || []).map(b => (
                    <tr key={b.plan} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, padding: '3px 12px', borderRadius: 20, background: `${PLAN_COLORS[b.plan] || '#00C37A'}18`, color: PLAN_COLORS[b.plan] || '#00C37A' }}>
                          {b.plan?.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 14, color: 'var(--t1)', fontWeight: 600 }}>{b.count}</td>
                      <td style={{ padding: '14px 20px', fontSize: 14, fontWeight: 700, color: '#00C37A' }}>${b.revenue?.toLocaleString()}/mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
