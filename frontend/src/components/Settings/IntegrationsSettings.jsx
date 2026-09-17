import React, { useEffect, useState } from 'react'
import { Link2, RefreshCw, Unplug } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { crm } from '../../services/api'

const errText = (err, fallback) => err?.response?.data?.error || fallback
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : 'Not yet')

const HELP = {
  hubspot: 'In HubSpot: Settings → Integrations → Private Apps → Create a private app with the crm.objects.contacts.read and crm.objects.contacts.write scopes, then copy its access token.',
  followupboss: 'In Follow Up Boss: Admin → API → copy your API key.',
}

function ProviderCard({ item, onChanged }) {
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(null)
  const [stats, setStats] = useState(null)
  const conn = item.connection

  const loadStats = async () => {
    if (!conn) return
    try { const r = await crm.status(item.provider); setStats(r.data.data) } catch { setStats(null) }
  }
  useEffect(() => { loadStats() }, [conn?.last_synced_at, conn?.status])

  const run = async (name, fn, success) => {
    setBusy(name)
    try { const r = await fn(); if (success) toast.success(typeof success === 'function' ? success(r) : success); await onChanged(); await loadStats(); return true }
    catch (err) { toast.error(errText(err, 'Something went wrong')); return false }
    finally { setBusy(null) }
  }

  const statusColor = !conn ? 'var(--t4)' : conn.status === 'active' ? '#00C37A' : '#FF9500'
  const statusText = !conn ? 'Not connected' : conn.status === 'active' ? 'Connected' : 'Needs attention'

  return (
    <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 md:px-6 py-5 border-b border-border-subtle flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium text-text-primary">{item.label}</h3>
          <p className="text-[12px] text-text-muted mt-0.5">New leads are added to {item.label} automatically.</p>
        </div>
        <span className="text-[12px] font-semibold shrink-0" style={{ color: statusColor }}>{statusText}</span>
      </div>
      <div className="p-4 md:p-6 flex flex-col gap-4">
        {!item.available && (
          <p className="text-[13px] text-text-secondary">{item.unavailable_reason}</p>
        )}

        {item.available && !conn && (
          <>
            <p className="text-[12px] text-text-muted leading-relaxed">{HELP[item.provider]}</p>
            <Input
              label={item.credential_label}
              type="password"
              autoComplete="off"
              value={credential}
              onChange={e => setCredential(e.target.value)}
              placeholder={`Paste your ${item.credential_label.toLowerCase()}`}
            />
            <div>
              <Button variant="primary" size="sm" loading={busy === 'connect'} disabled={!credential.trim()}
                onClick={() => run('connect', () => crm.connect(item.provider, credential.trim()), `${item.label} connected`).then(ok => { if (ok) setCredential('') })}>
                <Link2 size={13} /> Connect
              </Button>
            </div>
          </>
        )}

        {conn && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
              <div><span className="text-text-muted">Key</span><div className="text-text-primary">{conn.credential_hint}</div></div>
              <div><span className="text-text-muted">Last sync</span><div className="text-text-primary">{fmtDate(conn.last_synced_at)}</div></div>
              {stats && (
                <div className="sm:col-span-2 text-text-secondary">
                  {stats.done} synced · {stats.pending + stats.processing} waiting · {stats.failed} failed
                </div>
              )}
            </div>
            {conn.last_error && (
              <p className="text-[12px] rounded-[8px] px-3 py-2" style={{ color: '#FF9500', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)' }}>{conn.last_error}</p>
            )}
            <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
              <input type="checkbox" checked={conn.sync_new_leads} disabled={busy === 'toggle'} style={{ accentColor: '#00C37A' }}
                onChange={e => run('toggle', () => crm.update(item.provider, { sync_new_leads: e.target.checked }))} />
              Send new leads to {item.label}
            </label>
            {conn.status !== 'active' && (
              <div className="flex flex-col gap-2">
                <Input label={`New ${item.credential_label.toLowerCase()}`} type="password" autoComplete="off" value={credential} onChange={e => setCredential(e.target.value)} />
                <div>
                  <Button variant="primary" size="sm" loading={busy === 'connect'} disabled={!credential.trim()}
                    onClick={() => run('connect', () => crm.connect(item.provider, credential.trim()), 'Reconnected').then(ok => { if (ok) setCredential('') })}>
                    <Link2 size={13} /> Reconnect
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" loading={busy === 'backfill'} disabled={conn.status !== 'active'}
                onClick={() => run('backfill', () => crm.backfill(item.provider), (r) => `${r.data.queued} existing leads queued for ${item.label}`)}>
                <RefreshCw size={13} /> Sync existing leads
              </Button>
              <Button variant="secondary" size="sm" loading={busy === 'disconnect'}
                onClick={() => { if (window.confirm(`Disconnect ${item.label}? Leads already in ${item.label} stay there.`)) run('disconnect', () => crm.disconnect(item.provider), 'Disconnected') }}>
                <Unplug size={13} /> Disconnect
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function IntegrationsSettings() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try { const r = await crm.list(); setItems(r.data.data || []) }
    catch (err) { toast.error(errText(err, 'Could not load integrations')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (loading) return <p className="text-[13px] text-text-muted">Loading integrations…</p>
  return (
    <div className="flex flex-col gap-4">
      {items.map(item => <ProviderCard key={item.provider} item={item} onChanged={load} />)}
      <p className="text-[12px] text-text-muted">
        Using a different CRM? Connect it with webhooks or the REST API under Developers.
      </p>
    </div>
  )
}
