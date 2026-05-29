/**
 * BillingVerify - handles Flutterwave redirect after payment
 * Route: /billing/verify
 */
import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const API = 'https://veori-ai-main-production.up.railway.app/api/fw-billing'

function authHeaders() {
  const token = localStorage.getItem('veori_token')
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function BillingVerify() {
  const navigate       = useNavigate()
  const [params]       = useSearchParams()
  const [status, setStatus] = useState('verifying') // verifying | success | failed
  const [message, setMessage] = useState('')
  const [planName, setPlanName] = useState('')

  useEffect(() => {
    const txRef        = params.get('tx_ref')
    const transactionId = params.get('transaction_id')
    const flwStatus    = params.get('status')

    if (flwStatus === 'cancelled') {
      setStatus('failed')
      setMessage('Payment was cancelled. No charge was made.')
      return
    }

    if (!txRef && !transactionId) {
      setStatus('failed')
      setMessage('Missing payment reference. Please contact support.')
      return
    }

    // Build verify URL
    const ref = txRef || transactionId
    const url = transactionId
      ? `${API}/verify/${txRef || 'unknown'}?transaction_id=${transactionId}`
      : `${API}/verify/${txRef}`

    fetch(url, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setStatus('success')
          setPlanName(data.plan_name || 'your plan')
          setMessage(data.message || 'Payment successful!')
          // Redirect to dashboard after 3 seconds
          setTimeout(() => navigate('/dashboard'), 3000)
        } else {
          setStatus('failed')
          setMessage(data.error || 'Payment verification failed.')
        }
      })
      .catch(() => {
        setStatus('failed')
        setMessage('Network error during verification. Please contact support.')
      })
  }, [])

  return (
    <div style={{
      minHeight:      '100vh',
      background:     '#060E1A',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        24,
    }}>
      <div style={{
        background:   'rgba(255,255,255,0.04)',
        border:       '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding:      48,
        maxWidth:     480,
        width:        '100%',
        textAlign:    'center',
      }}>

        {status === 'verifying' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⏳</div>
            <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
              Verifying Payment…
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>
              Please wait while we confirm your payment.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 64, marginBottom: 20 }}>🎉</div>
            <h2 style={{ color: '#00C37A', fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
              Welcome to Veori!
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, marginBottom: 8 }}>
              {message}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              Redirecting to your dashboard…
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                marginTop:    24,
                background:   '#00C37A',
                color:        '#060E1A',
                border:       'none',
                borderRadius: 10,
                padding:      '14px 32px',
                fontSize:     15,
                fontWeight:   700,
                cursor:       'pointer',
              }}
            >
              Go to Dashboard →
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 20 }}>❌</div>
            <h2 style={{ color: '#FF4444', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
              Payment Failed
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, marginBottom: 24 }}>
              {message}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => navigate('/billing')}
                style={{
                  background:   '#00C37A',
                  color:        '#060E1A',
                  border:       'none',
                  borderRadius: 10,
                  padding:      '12px 24px',
                  fontSize:     14,
                  fontWeight:   700,
                  cursor:       'pointer',
                }}
              >
                Try Again
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                style={{
                  background:   'transparent',
                  color:        'rgba(255,255,255,0.5)',
                  border:       '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  padding:      '12px 24px',
                  fontSize:     14,
                  cursor:       'pointer',
                }}
              >
                Go to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
