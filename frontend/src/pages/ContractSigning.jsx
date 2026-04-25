import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function ContractSigning() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [printedName, setPrintedName] = useState('')
  const [signatureText, setSignatureText] = useState('')
  const [agree, setAgree] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`${API_BASE}/api/contracts/session/${token}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'Signing session not found')
        setSession(data.data)
        setPrintedName(data.data?.signer?.name || '')
      })
      .catch((err) => setError(err.message || 'Failed to load contract'))
      .finally(() => setLoading(false))
  }, [token])

  const submit = async () => {
    if (!printedName.trim() || !signatureText.trim() || !agree) {
      setError('Complete your printed name, signature, and agreement before submitting.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/contracts/handle_sign_submission/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printed_name: printedName.trim(),
          signature_text: signatureText.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to sign contract')
      setDone(true)
    } catch (err) {
      setError(err.message || 'Failed to sign contract')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div style={shell}><div style={card}><p style={muted}>Loading contract…</p></div></div>
  }

  if (error && !session) {
    return <div style={shell}><div style={card}><p style={danger}>{error}</p></div></div>
  }

  if (done) {
    return (
      <div style={shell}>
        <div style={card}>
          <h1 style={title}>Contract Signed</h1>
          <p style={muted}>Your signature was recorded successfully. You can close this page now.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={shell}>
      <div style={{ ...card, maxWidth: 960 }}>
        <div style={{ marginBottom: 20 }}>
          <p style={eyebrow}>{session?.contract?.contract_type?.toUpperCase() || 'CONTRACT'}</p>
          <h1 style={title}>Review and Sign</h1>
          <p style={muted}>
            Signing as {session?.signer?.name} ({String(session?.signer?.signer_role || '').replace(/_/g, ' ')})
          </p>
        </div>

        <div style={contractBox}>
          <pre style={contractText}>{session?.contract?.content}</pre>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
          <div>
            <label style={label}>Printed Name</label>
            <input value={printedName} onChange={(e) => setPrintedName(e.target.value)} style={input} placeholder="Your full legal name" />
          </div>
          <div>
            <label style={label}>Signature</label>
            <input value={signatureText} onChange={(e) => setSignatureText(e.target.value)} style={input} placeholder="Type your signature" />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, color: 'var(--t2)' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span style={{ fontSize: 13, lineHeight: 1.6 }}>
            I agree that this electronic signature is intended to sign this contract and may be stored with the agreement.
          </span>
        </label>

        {error && <p style={{ ...danger, marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={submit} disabled={submitting} style={submitButton}>
            {submitting ? 'Submitting…' : 'Sign Contract'}
          </button>
        </div>
      </div>
    </div>
  )
}

const shell = {
  minHeight: '100vh',
  background: 'var(--app-bg)',
  padding: '40px 20px',
  color: 'var(--t1)',
}

const card = {
  maxWidth: 720,
  margin: '0 auto',
  background: 'var(--card-bg)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
}

const eyebrow = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--t4)',
  marginBottom: 8,
}

const title = {
  fontSize: 28,
  fontWeight: 700,
  margin: 0,
  color: 'var(--t1)',
}

const muted = {
  color: 'var(--t3)',
  fontSize: 14,
}

const danger = {
  color: '#FF4444',
  fontSize: 13,
}

const contractBox = {
  background: 'var(--surface-bg)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 18,
  maxHeight: 420,
  overflowY: 'auto',
}

const contractText = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  fontFamily: 'Geist Mono, monospace',
  fontSize: 13,
  lineHeight: 1.7,
  color: 'var(--t2)',
}

const label = {
  display: 'block',
  marginBottom: 8,
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--t4)',
}

const input = {
  width: '100%',
  height: 44,
  background: 'var(--surface-bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '0 12px',
  color: 'var(--t1)',
  fontSize: 14,
  outline: 'none',
}

const submitButton = {
  height: 42,
  borderRadius: 8,
  border: 'none',
  padding: '0 18px',
  fontSize: 14,
  fontWeight: 600,
  background: '#00C37A',
  color: '#000',
  cursor: 'pointer',
}
