// ─── Teams ───────────────────────────────────────────────────────────────────
// A member signs in with their own account and works on the owner's workspace.
// middleware/auth.js calls resolveContext() on every request, so every existing
// route keeps using req.user.id (now the workspace owner) unchanged, while
// req.user.actorId is the person actually signed in.

const crypto = require('crypto');
const supabase = require('../config/supabase');

const ROLES = ['admin', 'member', 'viewer'];
const INVITE_TTL_DAYS = 7;
const MAX_MEMBERS = parseInt(process.env.TEAM_MAX_MEMBERS, 10) || 50;
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // actorId -> { at, membership | null }

class TeamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function invalidate(actorId) {
  if (actorId) cache.delete(actorId); else cache.clear();
}

async function activeMembership(actorId) {
  const hit = cache.get(actorId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.membership;
  const { data, error } = await supabase.from('team_members')
    .select('id, owner_id, role').eq('member_user_id', actorId).eq('status', 'active').maybeSingle();
  if (error) throw new Error(`team lookup failed: ${error.message}`);
  cache.set(actorId, { at: Date.now(), membership: data || null });
  return data || null;
}

/** Build req.user from a verified token payload. */
async function resolveContext(decoded) {
  const actorId = decoded.id;
  const m = supabase ? await activeMembership(actorId) : null;
  if (!m) return { ...decoded, actorId, actorEmail: decoded.email, teamRole: 'owner', teamOwnerId: actorId };
  return { ...decoded, id: m.owner_id, actorId, actorEmail: decoded.email, teamRole: m.role, teamOwnerId: m.owner_id, teamMembershipId: m.id };
}

// ── Access rules ──────────────────────────────────────────────────────────────
// Paths are matched on req.originalUrl. Identity routes (sign-in, password, 2FA,
// team invites) always act on the signed-in person, so they are open to every role.
const OPEN_TO_ALL = ['/api/auth', '/api/team', '/api/feedback', '/api/notifications'];
const OWNER_ONLY = ['/api/billing', '/api/fw-billing', '/api/stripe', '/api/referrals', '/api/privacy'];
const OWNER_OR_ADMIN = ['/api/developer'];
const OWNER_OR_ADMIN_WRITES = ['/api/phones', '/api/operator'];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const starts = (url, list) => list.some(p => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));

/** @returns {null | string} null when allowed, otherwise the reason */
function accessDenied({ role, method, url }) {
  if (!role || role === 'owner') return null;
  const path = String(url || '').split('#')[0];
  if (starts(path, OPEN_TO_ALL)) return null;
  if (starts(path, OWNER_ONLY)) return 'Only the account owner can do this';
  if (starts(path, OWNER_OR_ADMIN) && role !== 'admin') return 'Only the owner or a team admin can do this';
  if (!READ_METHODS.has(method)) {
    if (role === 'viewer') return 'Your team role is view-only';
    if (starts(path, OWNER_OR_ADMIN_WRITES) && role !== 'admin') return 'Only the owner or a team admin can change this';
  }
  return null;
}

// ── Management ────────────────────────────────────────────────────────────────
function canManage(user) {
  return user.teamRole === 'owner' || user.teamRole === 'admin';
}

async function listTeam(user) {
  const { data, error } = await supabase.from('team_members')
    .select('id, email, role, status, member_user_id, created_at, accepted_at, invite_expires_at, member:users!team_members_member_user_id_fkey(full_name)')
    .eq('owner_id', user.teamOwnerId).neq('status', 'removed').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const { data: owner } = await supabase.from('users').select('id, email, full_name, company_name').eq('id', user.teamOwnerId).maybeSingle();
  return {
    owner: owner ? { id: owner.id, email: owner.email, full_name: owner.full_name, company_name: owner.company_name } : null,
    my_role: user.teamRole,
    members: (data || []).map(r => ({
      id: r.id, email: r.email, role: r.role, status: r.status, full_name: r.member?.full_name || null,
      invited_at: r.created_at, accepted_at: r.accepted_at,
      invite_expired: r.status === 'invited' && r.invite_expires_at && new Date(r.invite_expires_at) < new Date(),
      is_you: r.member_user_id === user.actorId,
    })),
  };
}

async function invite(user, { email, role }) {
  if (!canManage(user)) throw new TeamError(403, 'Only the owner or a team admin can invite people');
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) throw new TeamError(400, 'Enter a valid email address');
  if (!ROLES.includes(role)) throw new TeamError(400, `role must be one of ${ROLES.join(', ')}`);
  if (role === 'admin' && user.teamRole !== 'owner') throw new TeamError(403, 'Only the owner can invite admins');

  const { data: owner } = await supabase.from('users').select('email, full_name, company_name').eq('id', user.teamOwnerId).maybeSingle();
  if (owner?.email?.toLowerCase() === cleanEmail) throw new TeamError(400, 'That is the account owner');

  const { count } = await supabase.from('team_members').select('id', { count: 'exact', head: true })
    .eq('owner_id', user.teamOwnerId).neq('status', 'removed');
  if ((count || 0) >= MAX_MEMBERS) throw new TeamError(400, `Teams are limited to ${MAX_MEMBERS} people`);

  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();
  const { data: existing } = await supabase.from('team_members').select('id, status')
    .eq('owner_id', user.teamOwnerId).ilike('email', cleanEmail).neq('status', 'removed').maybeSingle();
  if (existing?.status === 'active') throw new TeamError(409, 'That person is already on your team');

  let row;
  if (existing) {
    const { data, error } = await supabase.from('team_members')
      .update({ role, invite_token_hash: hashToken(token), invite_expires_at: expires, invited_by: user.actorId })
      .eq('id', existing.id).select('id, email, role, status').single();
    if (error) throw new Error(error.message);
    row = data;
  } else {
    const { data, error } = await supabase.from('team_members').insert({
      owner_id: user.teamOwnerId, email: cleanEmail, role, status: 'invited',
      invite_token_hash: hashToken(token), invite_expires_at: expires, invited_by: user.actorId,
    }).select('id, email, role, status').single();
    if (error) throw new Error(error.message);
    row = data;
  }

  const base = process.env.FRONTEND_URL || process.env.APP_URL;
  if (!base) throw new TeamError(500, 'FRONTEND_URL is not set, so an invite link cannot be built');
  const link = `${base}/team/accept?token=${encodeURIComponent(token)}`;
  const teamName = owner?.company_name || owner?.full_name || 'a Veori team';
  let emailed = false;
  try {
    const r = await require('./emailService').sendEmail({
      userId: user.teamOwnerId, to: cleanEmail,
      subject: `You're invited to join ${teamName} on Veori`,
      body: `You've been invited to join ${teamName} on Veori as ${role === 'admin' ? 'an admin' : `a ${role}`}.\n\nAccept the invite (sign in or create an account with this email first):\n${link}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
      emailType: 'team_invite',
    });
    emailed = !!(r?.success && !r.simulated);
  } catch (e) {
    console.error('[Team] invite email failed:', e.message);
  }
  // The link is returned so the inviter can share it if the email doesn't arrive.
  return { member: row, emailed, invite_link: link };
}

async function accept(user, token) {
  if (!token || typeof token !== 'string') throw new TeamError(400, 'Invite link is missing its token');
  const { data: inv } = await supabase.from('team_members')
    .select('id, owner_id, email, role, status, invite_expires_at').eq('invite_token_hash', hashToken(token)).maybeSingle();
  if (!inv || inv.status !== 'invited') throw new TeamError(404, 'This invite is not valid or was already used');
  if (inv.invite_expires_at && new Date(inv.invite_expires_at) < new Date()) throw new TeamError(410, 'This invite has expired - ask for a new one');
  const actorEmail = String(user.actorEmail || '').toLowerCase();
  if (actorEmail !== inv.email.toLowerCase()) {
    throw new TeamError(403, `This invite is for ${inv.email}. Sign in with that email to accept it.`);
  }
  if (inv.owner_id === user.actorId) throw new TeamError(400, 'You own this team');
  const { count: ownMembers } = await supabase.from('team_members').select('id', { count: 'exact', head: true })
    .eq('owner_id', user.actorId).eq('status', 'active');
  if ((ownMembers || 0) > 0) throw new TeamError(409, 'You have your own team members. Remove them before joining another team.');

  const { data, error } = await supabase.from('team_members')
    .update({ status: 'active', member_user_id: user.actorId, accepted_at: new Date().toISOString(), invite_token_hash: null })
    .eq('id', inv.id).eq('status', 'invited').select('id, owner_id, role').maybeSingle();
  if (error) {
    if (error.code === '23505') throw new TeamError(409, 'You are already on another team. Leave it first.');
    throw new Error(error.message);
  }
  if (!data) throw new TeamError(409, 'This invite was just used');
  invalidate(user.actorId);
  return data;
}

async function changeRole(user, memberId, role) {
  if (!canManage(user)) throw new TeamError(403, 'Only the owner or a team admin can change roles');
  if (!ROLES.includes(role)) throw new TeamError(400, `role must be one of ${ROLES.join(', ')}`);
  const { data: target } = await supabase.from('team_members').select('id, role, member_user_id')
    .eq('id', memberId).eq('owner_id', user.teamOwnerId).neq('status', 'removed').maybeSingle();
  if (!target) throw new TeamError(404, 'Team member not found');
  if (user.teamRole !== 'owner' && (target.role === 'admin' || role === 'admin')) throw new TeamError(403, 'Only the owner can grant or change admin');
  if (target.member_user_id === user.actorId) throw new TeamError(400, 'You cannot change your own role');
  const { error } = await supabase.from('team_members').update({ role }).eq('id', memberId);
  if (error) throw new Error(error.message);
  invalidate(target.member_user_id);
}

async function remove(user, memberId) {
  const { data: target } = await supabase.from('team_members').select('id, role, member_user_id, status')
    .eq('id', memberId).eq('owner_id', user.teamOwnerId).neq('status', 'removed').maybeSingle();
  if (!target) throw new TeamError(404, 'Team member not found');
  const self = target.member_user_id === user.actorId;
  if (!self) {
    if (!canManage(user)) throw new TeamError(403, 'Only the owner or a team admin can remove people');
    if (target.role === 'admin' && user.teamRole !== 'owner') throw new TeamError(403, 'Only the owner can remove an admin');
  }
  const { error } = await supabase.from('team_members')
    .update({ status: 'removed', removed_at: new Date().toISOString(), invite_token_hash: null }).eq('id', memberId);
  if (error) throw new Error(error.message);
  invalidate(target.member_user_id);
}

/** Team info for the signed-in person (used by /api/auth/me). */
async function contextForActor(actorId) {
  const m = await activeMembership(actorId);
  if (!m) return { role: 'owner', owner_id: actorId, owner_name: null };
  const { data: owner } = await supabase.from('users').select('full_name, company_name').eq('id', m.owner_id).maybeSingle();
  return { role: m.role, owner_id: m.owner_id, owner_name: owner?.company_name || owner?.full_name || null };
}

module.exports = { contextForActor, ROLES, TeamError, resolveContext, accessDenied, invalidate, listTeam, invite, accept, changeRole, remove, hashToken };
