// ─── White label ─────────────────────────────────────────────────────────────
// Each workspace owner can brand what their team, sellers and buyers see: name,
// logo, color, support contact, and a custom app domain.
//
// Custom domain flow:
//   1. Owner sets app.theircompany.com -> we issue a TXT token.
//   2. They add TXT _veori-verify.app.theircompany.com = <token>, and point the
//      domain at the frontend (CNAME cname.vercel-dns.com).
//   3. Verify: we read the TXT record. Only then is the domain trusted (CORS,
//      login-page branding). If VERCEL_API_TOKEN + VERCEL_PROJECT_ID are set the
//      domain is also added to the Vercel project automatically.

const crypto = require('crypto');
const dns = require('dns');
const axios = require('axios');
const supabase = require('../config/supabase');

const BUCKET = 'brand-assets';
const MAX_LOGO_BYTES = 1024 * 1024;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const RESERVED_DOMAINS = ['veori.net', 'www.veori.net', 'localhost'];

class BrandError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function logoUrl(path) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null;
}

function shape(row, { includePrivate }) {
  const base = {
    brand_name: row?.brand_name || null,
    logo_url: logoUrl(row?.logo_path),
    primary_color: row?.primary_color || null,
    support_email: row?.support_email || null,
    support_phone: row?.support_phone || null,
    hide_powered_by: !!row?.hide_powered_by,
  };
  if (!includePrivate) return base;
  return {
    ...base,
    custom_domain: row?.custom_domain || null,
    domain_verified: !!row?.domain_verified_at,
    domain_verify_record: row?.custom_domain && !row?.domain_verified_at
      ? { type: 'TXT', name: `_veori-verify.${row.custom_domain}`, value: row.domain_verify_token }
      : null,
    domain_cname_record: row?.custom_domain ? { type: 'CNAME', name: row.custom_domain, value: 'cname.vercel-dns.com' } : null,
    vercel_auto_attach: !!(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID),
  };
}

async function readRow(ownerId) {
  const { data, error } = await supabase.from('brand_settings').select('*').eq('user_id', ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getBrand(ownerId) {
  return shape(await readRow(ownerId), { includePrivate: true });
}

async function getPublicBrand(ownerId) {
  if (!ownerId) return shape(null, { includePrivate: false });
  return shape(await readRow(ownerId), { includePrivate: false });
}

async function upsert(ownerId, patch) {
  const { data, error } = await supabase.from('brand_settings')
    .upsert({ user_id: ownerId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*').single();
  if (error) {
    if (error.code === '23505') throw new BrandError(409, 'That domain is already used by another workspace');
    throw new Error(error.message);
  }
  return data;
}

async function updateBrand(ownerId, body = {}) {
  const patch = {};
  if (body.brand_name !== undefined) {
    const v = String(body.brand_name || '').trim();
    if (v.length > 80) throw new BrandError(400, 'Brand name must be 80 characters or fewer');
    patch.brand_name = v || null;
  }
  if (body.primary_color !== undefined) {
    const v = String(body.primary_color || '').trim();
    if (v && !HEX_RE.test(v)) throw new BrandError(400, 'Color must be a hex value like #00C37A');
    patch.primary_color = v || null;
  }
  if (body.support_email !== undefined) {
    const v = String(body.support_email || '').trim().toLowerCase();
    if (v && !EMAIL_RE.test(v)) throw new BrandError(400, 'Support email is not valid');
    patch.support_email = v || null;
  }
  if (body.support_phone !== undefined) {
    const v = String(body.support_phone || '').trim();
    if (v && v.replace(/\D/g, '').length < 10) throw new BrandError(400, 'Support phone is not valid');
    patch.support_phone = v.slice(0, 30) || null;
  }
  if (body.hide_powered_by !== undefined) {
    if (typeof body.hide_powered_by !== 'boolean') throw new BrandError(400, 'hide_powered_by must be true or false');
    patch.hide_powered_by = body.hide_powered_by;
  }
  if (!Object.keys(patch).length) throw new BrandError(400, 'Nothing to update');
  return shape(await upsert(ownerId, patch), { includePrivate: true });
}

// PNG, JPEG and WebP only, checked by content (not the file name): SVG can carry script.
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return { ext: 'png', type: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

async function uploadLogo(ownerId, buffer) {
  if (!buffer || !buffer.length) throw new BrandError(400, 'Choose an image file');
  if (buffer.length > MAX_LOGO_BYTES) throw new BrandError(400, 'Logo must be 1 MB or smaller');
  const kind = sniffImage(buffer);
  if (!kind) throw new BrandError(400, 'Logo must be a PNG, JPEG or WebP image');
  const previous = await readRow(ownerId);
  const path = `${ownerId}/logo-${Date.now()}.${kind.ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: kind.type, upsert: false, cacheControl: '31536000' });
  if (error) throw new Error(`logo upload failed: ${error.message}`);
  const row = await upsert(ownerId, { logo_path: path });
  if (previous?.logo_path && previous.logo_path !== path) {
    supabase.storage.from(BUCKET).remove([previous.logo_path]).then(({ error: e }) => { if (e) console.warn('[Brand] old logo cleanup failed:', e.message); });
  }
  return shape(row, { includePrivate: true });
}

async function removeLogo(ownerId) {
  const previous = await readRow(ownerId);
  const row = await upsert(ownerId, { logo_path: null });
  if (previous?.logo_path) await supabase.storage.from(BUCKET).remove([previous.logo_path]);
  return shape(row, { includePrivate: true });
}

// ── Custom domain ─────────────────────────────────────────────────────────────
let verifiedCache = { at: 0, domains: new Map() };
function invalidateDomains() { verifiedCache = { at: 0, domains: new Map() }; }

async function verifiedDomains() {
  if (Date.now() - verifiedCache.at < 60 * 1000) return verifiedCache.domains;
  const { data, error } = await supabase.from('brand_settings')
    .select('user_id, custom_domain').not('custom_domain', 'is', null).not('domain_verified_at', 'is', null);
  if (error) { console.error('[Brand] verified domain load failed:', error.message); return verifiedCache.domains; }
  verifiedCache = { at: Date.now(), domains: new Map((data || []).map(r => [r.custom_domain, r.user_id])) };
  return verifiedCache.domains;
}

/** CORS: true when origin is https://<a verified custom domain>. */
async function isVerifiedOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    return (await verifiedDomains()).has(u.hostname.toLowerCase());
  } catch { return false; }
}

async function ownerForDomain(host) {
  const h = String(host || '').toLowerCase().trim();
  if (!h) return null;
  return (await verifiedDomains()).get(h) || null;
}

async function setDomain(ownerId, rawDomain) {
  const domain = String(rawDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) {
    const row = await upsert(ownerId, { custom_domain: null, domain_verify_token: null, domain_verified_at: null });
    invalidateDomains();
    return shape(row, { includePrivate: true });
  }
  if (!DOMAIN_RE.test(domain) || domain.length > 253) throw new BrandError(400, 'Enter a domain like app.yourcompany.com');
  if (RESERVED_DOMAINS.includes(domain) || domain.endsWith('.veori.net') || domain.endsWith('.vercel.app')) {
    throw new BrandError(400, 'Use a domain you own');
  }
  const token = `veori-${crypto.randomBytes(16).toString('hex')}`;
  const row = await upsert(ownerId, { custom_domain: domain, domain_verify_token: token, domain_verified_at: null });
  invalidateDomains();
  return shape(row, { includePrivate: true });
}

async function attachToVercel(domain) {
  const token = process.env.VERCEL_API_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return { attempted: false };
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '';
  try {
    const { data } = await axios.post(`https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/domains${team}`,
      { name: domain }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    return { attempted: true, added: true, verified: !!data?.verified, verification: data?.verification || [] };
  } catch (e) {
    const status = e.response?.status;
    const message = e.response?.data?.error?.message || e.message;
    // 400 includes "already exists on the project" - treat that as attached.
    if (status === 400 && /already/i.test(message)) return { attempted: true, added: true, verified: null };
    return { attempted: true, added: false, error: message };
  }
}

async function verifyDomain(ownerId) {
  const row = await readRow(ownerId);
  if (!row?.custom_domain || !row.domain_verify_token) throw new BrandError(400, 'Set a custom domain first');
  let records = [];
  try {
    records = (await dns.promises.resolveTxt(`_veori-verify.${row.custom_domain}`)).map(parts => parts.join(''));
  } catch (e) {
    throw new BrandError(400, `No TXT record found at _veori-verify.${row.custom_domain} yet. DNS changes can take a few minutes.`);
  }
  if (!records.includes(row.domain_verify_token)) {
    throw new BrandError(400, `The TXT record at _veori-verify.${row.custom_domain} doesn't match. Expected ${row.domain_verify_token}`);
  }
  const updated = await upsert(ownerId, { domain_verified_at: new Date().toISOString() });
  invalidateDomains();
  const vercel = await attachToVercel(row.custom_domain);
  return { brand: shape(updated, { includePrivate: true }), vercel };
}

module.exports = {
  BrandError, sniffImage, getBrand, getPublicBrand, updateBrand, uploadLogo, removeLogo,
  setDomain, verifyDomain, isVerifiedOrigin, ownerForDomain, invalidateDomains,
};
