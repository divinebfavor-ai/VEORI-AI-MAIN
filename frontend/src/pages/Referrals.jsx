/**
 * Referrals Page - /referrals
 * Users get their referral link, see stats, and track earnings
 */
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Users, DollarSign, TrendingUp, Share2, Check } from 'lucide-react'
import toast from 'react-hot-toast'

const API = 'https://veori-ai-main-production.up.railway.app/api'

function authHeaders() {
  const token = localStorage.getItem('veori_token')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function StatCard({ icon: Icon, label, value, color = '#00C37A' }) {
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{ background: `${color}18`, borderRadius: 10, padding: 12 }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}

export default function Referrals() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    fetch(`${API}/referrals/me`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const copyLink = () => {
    if (!data?.referral_link) return
    navigator.clipboard.writeText(data.referral_link)
    setCopied(true)
    toast.success('Referral link copied!')
    setTimeout(() => setCopied(false), 2500)
  }

  const share = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Join Veori AI',
        text:  'I use Veori to close real estate deals with AI. Get 10% off your first month:',
        url:   data?.referral_link,
      })
    } else {
      copyLink()
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--t2)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--t1)', margin: 0 }}>Referrals</h1>
        <p style={{ color: 'var(--t2)', marginTop: 8, fontSize: 15 }}>
          Refer investors to Veori and earn commissions every month they stay subscribed.
        </p>
      </div>

      {/* Commission structure banner */}
      <div style={{
        background:   'linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.04))',
        border:       '1px solid rgba(201,168,76,0.3)',
        borderRadius: 12, padding: '16px 24px', marginBottom: 28,
        display: 'flex', gap: 32, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#C9A84C', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Month 1</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)' }}>10%</div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>of first payment</div>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div>
          <div style={{ fontSize: 11, color: '#00C37A', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Month 2+</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)' }}>3%</div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>every month they stay</div>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div>
          <div style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Max per customer</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)' }}>$500</div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>commission cap/month</div>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div>
          <div style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>New user gets</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)' }}>10%</div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>off first month</div>
        </div>
      </div>

      {/* Referral link */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, marginBottom: 28,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)', marginBottom: 12 }}>Your referral link</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{
            flex: 1, background: 'var(--app-bg)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 16px', fontSize: 14, color: 'var(--t1)',
            fontFamily: 'monospace', minWidth: 200,
          }}>
            {data?.referral_link || 'Loading...'}
          </div>
          <button onClick={copyLink} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: copied ? 'rgba(0,195,122,0.15)' : '#00C37A',
            color: copied ? '#00C37A' : '#060E1A',
            border: copied ? '1px solid #00C37A' : 'none',
            borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={share} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--t1)', borderRadius: 8, padding: '10px 20px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            <Share2 size={15} />
            Share
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--t2)' }}>
          Your code: <span style={{ color: '#00C37A', fontWeight: 700, fontFamily: 'monospace' }}>{data?.referral_code}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard icon={Users} label="Total Referrals" value={data?.stats?.total_referrals || 0} />
        <StatCard icon={TrendingUp} label="Active Subscribers" value={data?.stats?.active_referrals || 0} color="#C9A84C" />
        <StatCard icon={DollarSign} label="Total Earned" value={`$${(data?.stats?.total_earned || 0).toFixed(2)}`} color="#00C37A" />
        <StatCard icon={DollarSign} label="Pending Payout" value={`$${(data?.stats?.pending_payout || 0).toFixed(2)}`} color="#FF9500" />
      </div>

      {/* Referrals table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>People You Referred</h3>
        </div>

        {(!data?.referrals || data.referrals.length === 0) ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--t2)' }}>
            <Users size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p style={{ margin: 0 }}>No referrals yet. Share your link to start earning.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Plan', 'Status', 'Month 1', 'Total Earned'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.referrals.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 20px', fontSize: 14, color: 'var(--t1)', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--t2)', textTransform: 'capitalize' }}>{r.plan?.replace('_', ' ') || 'Free'}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                      background: r.status === 'active' ? 'rgba(0,195,122,0.15)' : 'rgba(255,68,68,0.1)',
                      color: r.status === 'active' ? '#00C37A' : '#FF4444',
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: r.month1_paid ? '#00C37A' : 'var(--t2)' }}>
                    {r.month1_paid ? 'Paid' : 'Pending'}
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 14, fontWeight: 700, color: '#00C37A' }}>
                    ${parseFloat(r.total_earned || 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payout note */}
      <div style={{ marginTop: 20, padding: '14px 20px', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)', borderRadius: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
          <span style={{ color: '#FF9500', fontWeight: 700 }}>Payouts:</span> Commissions are paid monthly. Contact <strong>divineqflash@gmail.com</strong> to request your payout once your balance exceeds $50.
        </p>
      </div>

    </div>
  )
}
