import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'

// Public API reference, rendered from the live OpenAPI document so it can't drift
// from what the server actually accepts.

const METHOD_COLOR = { get: '#00C37A', post: '#C9A84C', patch: '#FF9500', delete: '#FF4444' }

const VERIFY_SNIPPET = `// Node.js / Express - verify a Veori webhook
const crypto = require('crypto')

app.post('/veori-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('Veori-Signature') || ''            // t=1700000000,v1=abc...
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')))
  const expected = crypto.createHmac('sha256', process.env.VEORI_WEBHOOK_SECRET)
    .update(\`\${parts.t}.\${req.body}\`).digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300
  const valid = parts.v1 && expected.length === parts.v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
  if (!valid || !fresh) return res.status(400).end()

  const event = JSON.parse(req.body)                          // { id, type, created_at, data }
  // ...handle event.type...
  res.status(200).end()                                       // any 2xx = delivered
})`

function Schema({ schema, spec, depth = 0 }) {
  if (!schema) return null
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()
    const target = spec.components.schemas[name]
    return target ? <Schema schema={target} spec={spec} depth={depth} /> : <code>{name}</code>
  }
  if (schema.type === 'object' && schema.properties && depth < 2) {
    return (
      <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
        {Object.entries(schema.properties).map(([k, v]) => (
          <li key={k} style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.7 }}>
            <code style={{ color: 'var(--t1)' }}>{k}</code>
            {schema.required?.includes(k) && <span style={{ color: '#FF9500' }}> required</span>}
            {' '}<span>{Array.isArray(v.type) ? v.type.join(' | ') : (v.type || (v.$ref ? 'object' : ''))}</span>
            {v.enum && <span> - one of {v.enum.join(', ')}</span>}
            {v.description && <span> - {v.description}</span>}
          </li>
        ))}
      </ul>
    )
  }
  return null
}

export default function ApiDocs() {
  const [spec, setSpec] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/v1/openapi.json')
      .then(r => setSpec(r.data))
      .catch(() => setError('The API reference could not be loaded. Refresh to try again.'))
  }, [])

  const wrap = { minHeight: '100vh', background: 'var(--app-bg)', color: 'var(--t1)', padding: '32px 16px' }
  const inner = { maxWidth: 880, margin: '0 auto' }
  const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 12 }

  if (error) return <div style={wrap}><div style={inner}><p>{error}</p></div></div>
  if (!spec) return <div style={wrap}><div style={inner}><p style={{ color: 'var(--t3)' }}>Loading API reference...</p></div></div>

  const server = spec.servers?.[0]?.url

  return (
    <div style={wrap}>
      <div style={inner}>
        <Link to="/settings" style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none' }}>← Back to Veori</Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '12px 0 4px' }}>{spec.info.title}</h1>
        <p style={{ fontSize: 12, color: 'var(--t4)', margin: '0 0 16px' }}>Version {spec.info.version} · Base URL <code>{server}</code></p>
        <div style={card}>
          {spec.info.description.split('\n').map((line, i) => (
            <p key={i} style={{ fontSize: 13, color: 'var(--t2)', margin: line ? '0 0 6px' : '0 0 10px', lineHeight: 1.6 }}>{line}</p>
          ))}
          <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>
            Create keys and webhook endpoints in <Link to="/settings" style={{ color: '#00C37A' }}>Settings → Developers</Link>.
            Machine-readable spec: <a href={`${server}/openapi.json`} style={{ color: '#00C37A' }}>openapi.json</a>.
          </p>
        </div>

        <h2 style={{ fontSize: 18, margin: '24px 0 10px' }}>Endpoints</h2>
        {Object.entries(spec.paths).map(([path, ops]) => Object.entries(ops).map(([method, op]) => (
          <div key={`${method}-${path}`} style={card}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: METHOD_COLOR[method] || 'var(--t2)', textTransform: 'uppercase', minWidth: 52 }}>{method}</span>
              <code style={{ fontSize: 13, color: 'var(--t1)', wordBreak: 'break-all' }}>{path}</code>
              {op['x-required-scope'] && <span style={{ fontSize: 11, color: 'var(--t4)' }}>scope: {op['x-required-scope']}</span>}
            </div>
            <p style={{ fontSize: 13, color: 'var(--t2)', margin: '6px 0 0' }}>{op.summary}</p>
            {op.parameters?.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--t3)', margin: '6px 0 0' }}>
                Parameters: {op.parameters.map(p => `${p.name} (${p.in})`).join(', ')}
              </p>
            )}
            {op.requestBody && (
              <div style={{ marginTop: 6 }}>
                <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>Body:</p>
                <Schema schema={op.requestBody.content['application/json'].schema} spec={spec} />
              </div>
            )}
          </div>
        )))}

        <h2 style={{ fontSize: 18, margin: '24px 0 10px' }}>Webhook events</h2>
        <div style={card}>
          {Object.entries(spec['x-webhook-events'] || {}).map(([name, desc]) => (
            <p key={name} style={{ fontSize: 13, color: 'var(--t2)', margin: '0 0 6px' }}><code style={{ color: 'var(--t1)' }}>{name}</code> - {desc}</p>
          ))}
        </div>

        <h2 style={{ fontSize: 18, margin: '24px 0 10px' }}>Verifying webhook signatures</h2>
        <pre style={{ ...card, overflowX: 'auto', fontSize: 12, lineHeight: 1.6, color: 'var(--t2)' }}>{VERIFY_SNIPPET}</pre>
      </div>
    </div>
  )
}
