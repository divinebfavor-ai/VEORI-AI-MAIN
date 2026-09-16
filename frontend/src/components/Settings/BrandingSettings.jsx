import React, { useEffect, useRef, useState } from 'react'
import { Upload, Trash2, Copy, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { branding } from '../../services/api'
import useBrandStore from '../../store/brandStore'

const errText = (err, fallback) => err?.response?.data?.error || fallback
const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'))

function DnsRow({ record }) {
  if (!record) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-[70px_1fr_1fr_auto] gap-2 items-center text-[12px] px-3 py-2 rounded-[6px] border border-border-subtle">
      <span className="text-text-muted">{record.type}</span>
      <code className="break-all text-text-primary">{record.name}</code>
      <code className="break-all text-text-primary">{record.value}</code>
      <Button size="sm" variant="secondary" onClick={() => copy(record.value)}><Copy size={12} /></Button>
    </div>
  )
}

export default function BrandingSettings() {
  const setBrand = useBrandStore(s => s.setBrand)
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ brand_name: '', primary_color: '', support_email: '', support_phone: '', hide_powered_by: false })
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(null)
  const fileRef = useRef(null)

  const apply = (d) => {
    setData(d)
    setBrand(d)
    setForm({
      brand_name: d.brand_name || '', primary_color: d.primary_color || '',
      support_email: d.support_email || '', support_phone: d.support_phone || '',
      hide_powered_by: !!d.hide_powered_by,
    })
    setDomain(d.custom_domain || '')
  }

  useEffect(() => {
    branding.get().then(r => apply(r.data.data)).catch(err => toast.error(errText(err, 'Could not load branding')))
  }, [])

  if (!data) return <p className="text-[13px] text-text-muted">Loading...</p>

  const save = async () => {
    setBusy('save')
    try { const r = await branding.update(form); apply(r.data.data); toast.success('Branding saved') }
    catch (err) { toast.error(errText(err, 'Could not save branding')) }
    finally { setBusy(null) }
  }

  const onLogo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('logo')
    try { const r = await branding.uploadLogo(file); apply(r.data.data); toast.success('Logo uploaded') }
    catch (err) { toast.error(errText(err, 'Logo upload failed')) }
    finally { setBusy(null) }
  }

  const removeLogo = async () => {
    try { const r = await branding.removeLogo(); apply(r.data.data); toast.success('Logo removed') }
    catch (err) { toast.error(errText(err, 'Could not remove the logo')) }
  }

  const saveDomain = async () => {
    setBusy('domain')
    try { const r = await branding.setDomain(domain.trim()); apply(r.data.data); toast.success(domain.trim() ? 'Domain saved - add the DNS records below' : 'Custom domain removed') }
    catch (err) { toast.error(errText(err, 'Could not save the domain')) }
    finally { setBusy(null) }
  }

  const verify = async () => {
    setBusy('verify')
    try {
      const r = await branding.verifyDomain()
      apply(r.data.data)
      const v = r.data.vercel || {}
      if (v.attempted && !v.added) toast.error(`Domain verified, but adding it to the web host failed: ${v.error}`, { duration: 8000 })
      else toast.success(v.attempted ? 'Domain verified and added to the web host' : 'Domain verified')
    } catch (err) { toast.error(errText(err, 'Verification failed'), { duration: 8000 }) }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
        <div className="px-4 md:px-6 py-5 border-b border-border-subtle">
          <h3 className="text-[15px] font-medium text-text-primary">Branding</h3>
          <p className="text-[12px] text-text-muted mt-0.5">Your name and logo on the app, the login page, contract signing, photo upload and tour pages, and emails you send.</p>
        </div>
        <div className="p-4 md:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {data.logo_url
              ? <img src={data.logo_url} alt="Logo" style={{ height: 48, maxWidth: 200, objectFit: 'contain' }} />
              : <span className="text-[12px] text-text-muted">No logo</span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
            <Button size="sm" variant="secondary" loading={busy === 'logo'} onClick={() => fileRef.current?.click()}><Upload size={12} /> Upload logo</Button>
            {data.logo_url && <Button size="sm" variant="secondary" onClick={removeLogo}><Trash2 size={12} /> Remove</Button>}
            <span className="text-[11px] text-text-muted">PNG, JPEG or WebP, up to 1 MB</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Brand name" value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))} placeholder="Smith Home Buyers" />
            <div>
              <Input label="Brand color (hex)" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} placeholder="#00C37A" />
            </div>
            <Input label="Support email" type="email" value={form.support_email} onChange={e => setForm(f => ({ ...f, support_email: e.target.value }))} placeholder="help@yourcompany.com" />
            <Input label="Support phone" type="tel" value={form.support_phone} onChange={e => setForm(f => ({ ...f, support_phone: e.target.value }))} placeholder="(555) 000-0000" />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
            <input type="checkbox" checked={form.hide_powered_by} onChange={e => setForm(f => ({ ...f, hide_powered_by: e.target.checked }))} style={{ accentColor: '#00C37A' }} />
            Hide "Powered by Veori"
          </label>
          <Button onClick={save} loading={busy === 'save'}>Save branding</Button>
        </div>
      </div>

      <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
        <div className="px-4 md:px-6 py-5 border-b border-border-subtle">
          <h3 className="text-[15px] font-medium text-text-primary">Custom domain</h3>
          <p className="text-[12px] text-text-muted mt-0.5">Run the app on your own address, like app.yourcompany.com.</p>
        </div>
        <div className="p-4 md:p-6 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]"><Input label="Domain" value={domain} onChange={e => setDomain(e.target.value)} placeholder="app.yourcompany.com" /></div>
            <Button variant="secondary" loading={busy === 'domain'} onClick={saveDomain}>Save domain</Button>
          </div>
          {data.custom_domain && (
            data.domain_verified ? (
              <p className="flex items-center gap-2 text-[13px] text-text-secondary"><CheckCircle size={14} style={{ color: '#00C37A' }} /> {data.custom_domain} is verified.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] text-text-muted">Add these records at your domain provider, then verify:</p>
                <DnsRow record={data.domain_verify_record} />
                <DnsRow record={data.domain_cname_record} />
                {!data.vercel_auto_attach && (
                  <p className="text-[12px] text-text-muted">After verifying, the domain also has to be added to the web host (Vercel) by the platform administrator, unless automatic setup is configured.</p>
                )}
                <Button loading={busy === 'verify'} onClick={verify}>Verify domain</Button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
