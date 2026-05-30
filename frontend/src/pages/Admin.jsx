/**
 * Admin Dashboard - /admin
 * Only accessible to admin emails
 */
import React, { useState, useEffect } from 'react'
import { Users, DollarSign, Phone, TrendingUp, Globe, RefreshCw } from 'lucide-react'

const API = 'https://veori-ai-main-production.up.railway.app/api/admin'

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
  founding_member: '#C9A84C', starter: '#00C37A', growth: '#00C37A',
  pro: '#60A5FA', scale: '#A78BFA', enterprise: '#F87171',
}

export default function Admin() {
  const [stats, setStats]       = useState(null)
  const [users, setUsers]       = useState([])
  const [countries, setCountries] = useState([])
  const [revenue, setRevenue]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState('overview')

  const load = async () => {
    setLoading(true)
    try {
      const [s, u, c, r] = await Promise.all([
        fetch(`${API}/stats`,     { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/users`,     { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/countries`, { headers: authHeaders() }).then(x => x.json()),
        fetch(`${API}/revenue`,   { headers: authHeaders() }).then(x => x.json()),
      ])
      if (!s.success) { setError('Admin access only'); return }
      setStats(s.stats)
      setUsers(u.users || [])
      setCountries(c.countries || [])
      setRevenue(r)
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

  const TABS = ['overview', 'users', 'countries', 'revenue']

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
