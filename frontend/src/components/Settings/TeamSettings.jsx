import React, { useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { team as teamApi } from '../../services/api'

const ROLE_HELP = {
  admin: 'Everything except billing',
  member: 'Leads, calls, deals, buyers and campaigns. No billing, API keys, team or number purchases',
  viewer: 'Can see everything, change nothing',
}
const errText = (err, fallback) => err?.response?.data?.error || fallback

export default function TeamSettings() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ email: '', role: 'member' })
  const [inviting, setInviting] = useState(false)
  const [lastLink, setLastLink] = useState(null)

  const load = () => teamApi.get()
    .then(r => setData(r.data.data))
    .catch(err => toast.error(errText(err, 'Could not load your team')))
  useEffect(() => { load() }, [])

  if (!data) return <p className="text-[13px] text-text-muted">Loading...</p>

  const canManage = data.my_role === 'owner' || data.my_role === 'admin'
  const isMember = data.my_role !== 'owner'

  const invite = async () => {
    setInviting(true)
    try {
      const r = await teamApi.invite(form.email.trim(), form.role)
      const d = r.data.data
      toast.success(d.emailed ? `Invite emailed to ${form.email.trim()}` : 'Invite created - the email could not be sent, share the link below')
      setLastLink(d.invite_link)
      setForm({ email: '', role: 'member' })
      load()
    } catch (err) { toast.error(errText(err, 'Could not send the invite')) }
    finally { setInviting(false) }
  }

  const changeRole = async (m, role) => {
    try { await teamApi.changeRole(m.id, role); toast.success('Role updated'); load() }
    catch (err) { toast.error(errText(err, 'Could not change the role')) }
  }

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.full_name || m.email} from the team? They lose access immediately.`)) return
    try { await teamApi.remove(m.id); toast.success('Removed'); load() }
    catch (err) { toast.error(errText(err, 'Could not remove them')) }
  }

  const leave = async () => {
    if (!window.confirm('Leave this team? You will go back to your own workspace.')) return
    try {
      await teamApi.leave()
      toast.success('You left the team')
      window.location.assign('/dashboard')
    } catch (err) { toast.error(errText(err, 'Could not leave the team')) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
        <div className="px-4 md:px-6 py-5 border-b border-border-subtle">
          <h3 className="text-[15px] font-medium text-text-primary">Team</h3>
          <p className="text-[12px] text-text-muted mt-0.5">
            {isMember
              ? `You work in ${data.owner?.company_name || data.owner?.full_name || 'this'} workspace as ${data.my_role === 'admin' ? 'an admin' : `a ${data.my_role}`}.`
              : 'People you invite sign in with their own account and work in your workspace.'}
          </p>
        </div>
        <div className="p-4 md:p-6 space-y-5">
          {canManage && (
            <div className="space-y-3">
              <Input label="Invite by email" type="email" placeholder="teammate@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <div>
                <p className="label-caps mb-2">Role</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ROLE_HELP).filter(([r]) => r !== 'admin' || data.my_role === 'owner').map(([r, help]) => (
                    <label key={r} className="flex items-start gap-2 text-[12px] px-3 py-2 rounded-[6px] border border-border-subtle cursor-pointer" style={{ borderColor: form.role === r ? '#00C37A' : undefined }}>
                      <input type="radio" name="role" checked={form.role === r} onChange={() => setForm(f => ({ ...f, role: r }))} style={{ accentColor: '#00C37A', marginTop: 2 }} />
                      <span><span className="text-text-primary capitalize">{r}</span><br /><span className="text-text-muted">{help}</span></span>
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={invite} loading={inviting} disabled={!form.email.trim()}>Send invite</Button>
              {lastLink && (
                <div className="flex items-center gap-2 text-[12px]">
                  <code className="flex-1 min-w-0 break-all text-text-secondary">{lastLink}</code>
                  <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(lastLink).then(() => toast.success('Link copied'))}><Copy size={12} /> Copy</Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {data.owner && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-[6px] border border-border-subtle">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-primary">{data.owner.full_name || data.owner.email}</p>
                  <p className="text-[11px] text-text-muted">{data.owner.email} · Owner</p>
                </div>
              </div>
            )}
            {data.members.map(m => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-[6px] border border-border-subtle">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-primary">{m.full_name || m.email}{m.is_you ? ' (you)' : ''}</p>
                  <p className="text-[11px] text-text-muted">
                    {m.email} · {m.status === 'invited' ? (m.invite_expired ? 'Invite expired' : 'Invited') : 'Active'}
                  </p>
                </div>
                {canManage && !m.is_you && (m.role !== 'admin' || data.my_role === 'owner') ? (
                  <select value={m.role} onChange={e => changeRole(m, e.target.value)}
                    className="bg-surface border border-border-subtle rounded-[6px] text-[12px] text-text-primary px-2 py-1.5">
                    {Object.keys(ROLE_HELP).filter(r => r !== 'admin' || data.my_role === 'owner').map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <span className="text-[12px] text-text-muted capitalize">{m.role}</span>
                )}
                {canManage && !m.is_you && (m.role !== 'admin' || data.my_role === 'owner') && (
                  <Button size="sm" variant="secondary" onClick={() => remove(m)}><Trash2 size={12} /></Button>
                )}
              </div>
            ))}
            {data.members.length === 0 && <p className="text-[13px] text-text-muted">No team members yet.</p>}
          </div>

          {isMember && <Button variant="secondary" onClick={leave}>Leave team</Button>}
        </div>
      </div>
    </div>
  )
}
