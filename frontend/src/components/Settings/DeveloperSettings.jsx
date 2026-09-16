import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Trash2, Send, Power } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { developer } from '../../services/api'

const errText = (err, fallback) => err?.response?.data?.error || fallback
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : 'Never')

function copy(text) {
  navigator.clipboard?.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.error('Copy failed - select the text and copy it manually'))
}

function Card({ title, description, children }) {
  return (
    <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 md:px-6 py-5 border-b border-border-subtle">
        <h3 className="text-[15px] font-medium text-text-primary">{title}</h3>
        {description && <p className="text-[12px] text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="p-4 md:p-6">{children}</div>
    </div>
  )
}

// Shown exactly once, right after a key or signing secret is created.
function RevealOnce({ label, value, onDone }) {
  return (
    <div className="rounded-[8px] px-4 py-3 mb-4" style={{ background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.35)' }}>
      <p className="text-[12px] text-text-secondary mb-2">{label} - copy it now. It will not be shown again.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 text-[12px] break-all text-text-primary">{value}</code>
        <Button size="sm" variant="secondary" onClick={() => copy(value)}><Copy size={12} /> Copy</Button>
      </div>
      <button onClick={onDone} className="text-[12px] text-text-muted mt-2 underline">I've saved it</button>
    </div>
  )
}

export default function DeveloperSettings() {
  const [meta, setMeta] = useState({ scopes: [], events: {} })
  const [keys, setKeys] = useState([])
  const [hooks, setHooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newKey, setNewKey] = useState(null)
  const [newSecret, setNewSecret] = useState(null)
  const [keyForm, setKeyForm] = useState({ name: '', scopes: [] })
  const [hookForm, setHookForm] = useState({ url: '', events: [], description: '' })
  const [busy, setBusy] = useState(null)
  const [openDeliveries, setOpenDeliveries] = useState(null)
  const [deliveries, setDeliveries] = useState([])

  const load = async () => {
    try {
      const [m, k, h] = await Promise.all([developer.meta(), developer.listKeys(), developer.listWebhooks()])
      setMeta({ scopes: m.data.scopes || [], events: m.data.events || {} })
      setKeys(k.data.data || [])
      setHooks(h.data.data || [])
    } catch (err) {
      toast.error(errText(err, 'Could not load developer settings'))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const toggle = (list, value) => (list.includes(value) ? list.filter(v => v !== value) : [...list, value])

  const createKey = async () => {
    if (!keyForm.name.trim()) { toast.error('Name the key so you know where it is used'); return }
    if (!keyForm.scopes.length) { toast.error('Choose at least one permission'); return }
    setBusy('key')
    try {
      const r = await developer.createKey({ name: keyForm.name.trim(), scopes: keyForm.scopes })
      setNewKey(r.data.key)
      setKeyForm({ name: '', scopes: [] })
      load()
    } catch (err) { toast.error(errText(err, 'Could not create the key')) }
    finally { setBusy(null) }
  }

  const revokeKey = async (k) => {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`)) return
    try { await developer.revokeKey(k.id); toast.success('Key revoked'); load() }
    catch (err) { toast.error(errText(err, 'Could not revoke the key')) }
  }

  const createHook = async () => {
    if (!hookForm.url.trim()) { toast.error('Enter the https URL that should receive events'); return }
    if (!hookForm.events.length) { toast.error('Choose at least one event'); return }
    setBusy('hook')
    try {
      const r = await developer.createWebhook({ url: hookForm.url.trim(), events: hookForm.events, description: hookForm.description.trim() || undefined })
      setNewSecret(r.data.secret)
      setHookForm({ url: '', events: [], description: '' })
      load()
    } catch (err) { toast.error(errText(err, 'Could not add the endpoint')) }
    finally { setBusy(null) }
  }

  const testHook = async (h) => {
    setBusy(`test-${h.id}`)
    try {
      const r = await developer.testWebhook(h.id)
      const d = r.data.data || {}
      if (d.status === 'delivered') toast.success(`Delivered (HTTP ${d.response_status})`)
      else toast.error(`Not delivered: ${d.response_status ? `HTTP ${d.response_status}` : (d.error || 'no response')}. It will be retried.`)
      if (openDeliveries === h.id) showDeliveries(h.id)
      load()
    } catch (err) { toast.error(errText(err, 'Test failed')) }
    finally { setBusy(null) }
  }

  const toggleHook = async (h) => {
    try { await developer.updateWebhook(h.id, { is_active: !h.is_active }); load() }
    catch (err) { toast.error(errText(err, 'Could not update the endpoint')) }
  }

  const deleteHook = async (h) => {
    if (!window.confirm(`Delete the endpoint ${h.url}? Pending deliveries to it are dropped.`)) return
    try { await developer.deleteWebhook(h.id); toast.success('Endpoint deleted'); load() }
    catch (err) { toast.error(errText(err, 'Could not delete the endpoint')) }
  }

  const showDeliveries = async (id) => {
    if (openDeliveries === id) { setOpenDeliveries(null); return }
    try {
      const r = await developer.deliveries(id)
      setDeliveries(r.data.data || [])
      setOpenDeliveries(id)
    } catch (err) { toast.error(errText(err, 'Could not load deliveries')) }
  }

  if (loading) return <p className="text-[13px] text-text-muted">Loading...</p>

  const activeKeys = keys.filter(k => !k.revoked_at)

  return (
    <div className="space-y-4">
      <Card title="API Keys" description="Let your own software or another CRM read and write your leads, deals, buyers and calls.">
        <p className="text-[12px] text-text-muted mb-4">
          Send the key as <code>Authorization: Bearer vk_live_...</code>. Full reference: <Link to="/developers" className="underline text-text-secondary">API documentation</Link>.
        </p>
        {newKey && <RevealOnce label="Your new API key" value={newKey} onDone={() => setNewKey(null)} />}

        <div className="space-y-3 mb-6">
          <Input label="Key name" placeholder="e.g. Zapier, my website" value={keyForm.name} onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))} />
          <div>
            <p className="label-caps mb-2">Permissions</p>
            <div className="flex flex-wrap gap-2">
              {meta.scopes.map(s => (
                <label key={s} className="flex items-center gap-1.5 text-[12px] text-text-secondary px-2 py-1 rounded-[6px] border border-border-subtle cursor-pointer">
                  <input type="checkbox" checked={keyForm.scopes.includes(s)} onChange={() => setKeyForm(f => ({ ...f, scopes: toggle(f.scopes, s) }))} style={{ accentColor: '#00C37A' }} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <Button onClick={createKey} loading={busy === 'key'}>Create key</Button>
        </div>

        {activeKeys.length === 0 ? (
          <p className="text-[13px] text-text-muted">No active keys.</p>
        ) : (
          <div className="space-y-2">
            {activeKeys.map(k => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-[6px] border border-border-subtle">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-primary">{k.name} <code className="text-[11px] text-text-muted">{k.prefix}...</code></p>
                  <p className="text-[11px] text-text-muted">{k.scopes.join(', ')} · last used {fmtDate(k.last_used_at)}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => revokeKey(k)}><Trash2 size={12} /> Revoke</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Webhooks" description="Veori sends a signed POST to your URL when these events happen. Failed deliveries are retried for up to 2 days.">
        {newSecret && <RevealOnce label="Signing secret for this endpoint" value={newSecret} onDone={() => setNewSecret(null)} />}

        <div className="space-y-3 mb-6">
          <Input label="Endpoint URL (https)" placeholder="https://your-app.com/veori-webhook" value={hookForm.url} onChange={e => setHookForm(f => ({ ...f, url: e.target.value }))} />
          <Input label="Description (optional)" value={hookForm.description} onChange={e => setHookForm(f => ({ ...f, description: e.target.value }))} />
          <div>
            <p className="label-caps mb-2">Events</p>
            <div className="space-y-1.5">
              {Object.entries(meta.events).map(([name, desc]) => (
                <label key={name} className="flex items-start gap-2 text-[12px] cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={hookForm.events.includes(name)} onChange={() => setHookForm(f => ({ ...f, events: toggle(f.events, name) }))} style={{ accentColor: '#00C37A' }} />
                  <span><code className="text-text-primary">{name}</code> <span className="text-text-muted">- {desc}</span></span>
                </label>
              ))}
            </div>
          </div>
          <Button onClick={createHook} loading={busy === 'hook'}>Add endpoint</Button>
        </div>

        {hooks.length === 0 ? (
          <p className="text-[13px] text-text-muted">No endpoints.</p>
        ) : (
          <div className="space-y-2">
            {hooks.map(h => (
              <div key={h.id} className="px-3 py-2.5 rounded-[6px] border border-border-subtle">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-text-primary break-all">{h.url}</p>
                    <p className="text-[11px] text-text-muted">
                      {h.is_active ? 'Active' : `Paused${h.disabled_reason ? ` - ${h.disabled_reason}` : ''}`} · {h.events.join(', ')} · last success {fmtDate(h.last_success_at)}
                      {h.consecutive_failures > 0 ? ` · ${h.consecutive_failures} failures in a row` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" loading={busy === `test-${h.id}`} onClick={() => testHook(h)}><Send size={12} /> Test</Button>
                  <Button size="sm" variant="secondary" onClick={() => toggleHook(h)}><Power size={12} /> {h.is_active ? 'Pause' : 'Resume'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => showDeliveries(h.id)}>Deliveries</Button>
                  <Button size="sm" variant="secondary" onClick={() => deleteHook(h)}><Trash2 size={12} /></Button>
                </div>
                {openDeliveries === h.id && (
                  <div className="mt-3 space-y-1">
                    {deliveries.length === 0 ? <p className="text-[12px] text-text-muted">No deliveries yet.</p> : deliveries.map(d => (
                      <p key={d.id} className="text-[11px] text-text-muted">
                        {new Date(d.created_at).toLocaleString()} · <code>{d.event}</code> · {d.status}
                        {d.response_status ? ` · HTTP ${d.response_status}` : ''}{d.error ? ` · ${d.error}` : ''} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
