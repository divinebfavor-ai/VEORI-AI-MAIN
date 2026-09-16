// ─── Outbound webhooks ───────────────────────────────────────────────────────
// Operators subscribe HTTPS endpoints to events. Each event becomes one delivery
// row per subscribed endpoint (the row is the durable queue: nothing is lost on a
// restart), POSTed with an HMAC signature and retried with backoff.
//
// Signature:  Veori-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
// Receivers should recompute v1 over the raw body and reject stale timestamps.
//
// SSRF: an endpoint URL must be https and must not resolve to a private,
// loopback, link-local or otherwise internal address. The check runs inside the
// socket's DNS lookup, so a hostname can't pass validation and then re-resolve to
// an internal IP at delivery time. Redirects are not followed.

const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');
const axios = require('axios');
const supabase = require('../config/supabase');

const EVENTS = {
  'lead.created':         'A lead was added (manually, by import, by the API or by the Lead Engine).',
  'lead.opted_out':       'A lead asked not to be contacted (STOP text, spoken request, or marked manually).',
  'sms.received':         'A lead replied by text.',
  'call.completed':       'A call ended and its outcome was recorded.',
  'deal.created':         'A deal was created.',
  'deal.stage_changed':   'A deal moved to a new stage.',
  'contract.sent':        'A contract was sent for signature.',
  'contract.fully_signed':'Every party signed a contract.',
  'buyer.interested':     'A buyer replied YES and was assigned to a deal.',
};
const EVENT_NAMES = Object.keys(EVENTS);

const MAX_ENDPOINTS_PER_USER = 20;
const RETRY_DELAYS_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const DISABLE_AFTER_CONSECUTIVE_FAILURES = 50;
const TIMEOUT_MS = 10000;

class WebhookError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Address safety ────────────────────────────────────────────────────────────
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224;                                // multicast / reserved
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) {
      const rest = v.slice(7);
      if (net.isIPv4(rest)) return isPrivateAddress(rest);
      // hex form, e.g. ::ffff:a00:1 -> 10.0.0.1
      const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (m) {
        const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
        return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') ||
      v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    const bad = list.find(a => isPrivateAddress(a.address));
    if (bad) return callback(new Error(`blocked internal address for ${hostname}`));
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const safeAgent = new https.Agent({ lookup: safeLookup, keepAlive: false });

function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new WebhookError(400, 'url must be a valid https URL'); }
  if (u.protocol !== 'https:') throw new WebhookError(400, 'url must use https');
  if (u.username || u.password) throw new WebhookError(400, 'url must not contain credentials');
  if (net.isIP(u.hostname) && isPrivateAddress(u.hostname)) throw new WebhookError(400, 'url must not point to an internal address');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new WebhookError(400, 'url must not point to an internal host');
  if (u.toString().length > 2000) throw new WebhookError(400, 'url is too long');
  return u.toString();
}

async function assertPublicHost(url) {
  const { hostname } = new URL(url);
  if (net.isIP(hostname)) return;
  const addresses = await dns.promises.lookup(hostname, { all: true }).catch(() => {
    throw new WebhookError(400, `could not resolve ${hostname}`);
  });
  if (addresses.some(a => isPrivateAddress(a.address))) throw new WebhookError(400, 'url resolves to an internal address');
}

function validateEvents(events) {
  const list = Array.isArray(events) ? [...new Set(events.map(String))] : [];
  if (!list.length) throw new WebhookError(400, `choose at least one event: ${EVENT_NAMES.join(', ')}, or "*"`);
  const unknown = list.filter(e => e !== '*' && !EVENT_NAMES.includes(e));
  if (unknown.length) throw new WebhookError(400, `unknown event(s): ${unknown.join(', ')}`);
  return list.includes('*') ? ['*'] : list;
}

function endpointShape(row) {
  return {
    id: row.id, url: row.url, description: row.description, events: row.events,
    is_active: row.is_active, consecutive_failures: row.consecutive_failures,
    disabled_reason: row.disabled_reason, last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at, created_at: row.created_at,
  };
}

// ── Endpoint management ──────────────────────────────────────────────────────
async function createEndpoint(userId, { url, events, description }) {
  const cleanUrl = validateUrl(url);
  await assertPublicHost(cleanUrl);
  const cleanEvents = validateEvents(events);
  const { count, error: cErr } = await supabase.from('webhook_endpoints')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (cErr) throw new Error(cErr.message);
  if ((count || 0) >= MAX_ENDPOINTS_PER_USER) throw new WebhookError(400, `limit of ${MAX_ENDPOINTS_PER_USER} endpoints reached`);
  const secret = 'whsec_' + crypto.randomBytes(32).toString('base64url');
  const { data, error } = await supabase.from('webhook_endpoints').insert({
    user_id: userId, url: cleanUrl, events: cleanEvents,
    description: description ? String(description).slice(0, 200) : null, secret,
  }).select().single();
  if (error) throw new Error(error.message);
  return { endpoint: endpointShape(data), secret };
}

async function listEndpoints(userId) {
  const { data, error } = await supabase.from('webhook_endpoints').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(endpointShape);
}

async function updateEndpoint(userId, id, { url, events, description, is_active: isActive }) {
  const patch = { updated_at: new Date().toISOString() };
  if (url !== undefined) { patch.url = validateUrl(url); await assertPublicHost(patch.url); }
  if (events !== undefined) patch.events = validateEvents(events);
  if (description !== undefined) patch.description = description ? String(description).slice(0, 200) : null;
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw new WebhookError(400, 'is_active must be true or false');
    patch.is_active = isActive;
    if (isActive) { patch.consecutive_failures = 0; patch.disabled_reason = null; }
  }
  const { data, error } = await supabase.from('webhook_endpoints').update(patch)
    .eq('id', id).eq('user_id', userId).select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new WebhookError(404, 'Webhook endpoint not found');
  return endpointShape(data);
}

async function deleteEndpoint(userId, id) {
  const { data, error } = await supabase.from('webhook_endpoints').delete()
    .eq('id', id).eq('user_id', userId).select('id');
  if (error) throw new Error(error.message);
  if (!(data || []).length) throw new WebhookError(404, 'Webhook endpoint not found');
}

async function listDeliveries(userId, endpointId, limit = 50) {
  const { data: ep } = await supabase.from('webhook_endpoints').select('id').eq('id', endpointId).eq('user_id', userId).maybeSingle();
  if (!ep) throw new WebhookError(404, 'Webhook endpoint not found');
  const { data, error } = await supabase.from('webhook_deliveries')
    .select('id, event, event_id, status, attempts, response_status, error, next_attempt_at, delivered_at, created_at')
    .eq('endpoint_id', endpointId).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(error.message);
  return data || [];
}

// ── Emitting + delivering ────────────────────────────────────────────────────
/**
 * Record an event for every subscribed, active endpoint of this operator and
 * attempt delivery right away. Never throws: a webhook problem must not break
 * the action that produced the event.
 */
async function emitEvent(userId, event, data) {
  try {
    if (!supabase || !userId || !EVENTS[event]) return 0;
    const { data: endpoints, error } = await supabase.from('webhook_endpoints')
      .select('id, events').eq('user_id', userId).eq('is_active', true);
    if (error) { console.error('[Webhooks] endpoint lookup failed:', error.message); return 0; }
    const targets = (endpoints || []).filter(e => (e.events || []).includes('*') || (e.events || []).includes(event));
    if (!targets.length) return 0;

    const eventId = crypto.randomUUID();
    const payload = { id: eventId, type: event, created_at: new Date().toISOString(), data };
    const rows = targets.map(t => ({ endpoint_id: t.id, user_id: userId, event, event_id: eventId, payload }));
    const { data: inserted, error: insErr } = await supabase.from('webhook_deliveries').insert(rows).select('id');
    if (insErr) { console.error('[Webhooks] delivery insert failed:', insErr.message); return 0; }
    setImmediate(() => { (inserted || []).forEach(r => deliver(r.id, { immediate: true }).catch(() => {})); });
    return (inserted || []).length;
  } catch (e) {
    console.error('[Webhooks] emitEvent failed:', e.message);
    return 0;
  }
}

/** One event per item, one endpoint lookup total (used by bulk imports). Never throws. */
async function emitEvents(userId, event, items) {
  try {
    if (!supabase || !userId || !EVENTS[event] || !Array.isArray(items) || !items.length) return 0;
    const { data: endpoints, error } = await supabase.from('webhook_endpoints')
      .select('id, events').eq('user_id', userId).eq('is_active', true);
    if (error) { console.error('[Webhooks] endpoint lookup failed:', error.message); return 0; }
    const targets = (endpoints || []).filter(e => (e.events || []).includes('*') || (e.events || []).includes(event));
    if (!targets.length) return 0;
    const now = new Date().toISOString();
    const rows = [];
    for (const data of items) {
      const eventId = crypto.randomUUID();
      const payload = { id: eventId, type: event, created_at: now, data };
      for (const t of targets) rows.push({ endpoint_id: t.id, user_id: userId, event, event_id: eventId, payload });
    }
    let total = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { data: inserted, error: insErr } = await supabase.from('webhook_deliveries').insert(rows.slice(i, i + 500)).select('id');
      if (insErr) { console.error('[Webhooks] batch insert failed:', insErr.message); continue; }
      total += (inserted || []).length;
    }
    // Delivered by the retry sweep (next_attempt_at = now), so a large import
    // doesn't open thousands of connections at once.
    return total;
  } catch (e) {
    console.error('[Webhooks] emitEvents failed:', e.message);
    return 0;
  }
}

function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Deliver one row. Claims it first so two workers can't send it twice.
 * immediate=true is for a row inserted a moment ago: its next_attempt_at comes
 * from the database clock, which can be a few ms ahead of this server's clock, so
 * a time filter would skip it. Retries (the sweep) keep the schedule check.
 */
async function deliver(deliveryId, { immediate = false } = {}) {
  let claim = supabase.from('webhook_deliveries')
    .update({ status: 'delivering' })
    .eq('id', deliveryId).eq('status', 'pending');
  if (!immediate) claim = claim.lte('next_attempt_at', new Date().toISOString());
  const { data: claimed, error: claimErr } = await claim
    .select('id, endpoint_id, event, event_id, payload, attempts').maybeSingle();
  if (claimErr || !claimed) return null;

  const { data: ep } = await supabase.from('webhook_endpoints')
    .select('id, url, secret, is_active, consecutive_failures').eq('id', claimed.endpoint_id).maybeSingle();
  const attempts = claimed.attempts + 1;
  if (!ep || !ep.is_active) {
    await supabase.from('webhook_deliveries').update({ status: 'failed', attempts, error: 'endpoint disabled or deleted' }).eq('id', deliveryId);
    return 'failed';
  }

  const body = JSON.stringify(claimed.payload);
  const t = Math.floor(Date.now() / 1000);
  let status = null, responseText = null, errMsg = null;
  try {
    validateUrl(ep.url);
    const res = await axios.post(ep.url, body, {
      httpsAgent: safeAgent,
      timeout: TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: 64 * 1024,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Veori-Webhooks/1.0',
        'Veori-Event': claimed.event,
        'Veori-Delivery': deliveryId,
        'Veori-Signature': `t=${t},v1=${sign(ep.secret, t, body)}`,
      },
      transformRequest: [(d) => d],
    });
    status = res.status;
    responseText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
  } catch (e) {
    errMsg = e.message;
  }

  const now = new Date().toISOString();
  if (status && status >= 200 && status < 300) {
    await supabase.from('webhook_deliveries').update({
      status: 'delivered', attempts, response_status: status,
      response_body: (responseText || '').slice(0, 1000), error: null, delivered_at: now,
    }).eq('id', deliveryId);
    await supabase.from('webhook_endpoints').update({ consecutive_failures: 0, last_success_at: now }).eq('id', ep.id);
    return 'delivered';
  }

  const final = attempts >= MAX_ATTEMPTS;
  await supabase.from('webhook_deliveries').update({
    status: final ? 'failed' : 'pending', attempts, response_status: status,
    response_body: (responseText || '').slice(0, 1000),
    error: errMsg || `HTTP ${status}`,
    next_attempt_at: final ? now : new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString(),
  }).eq('id', deliveryId);
  const failures = (ep.consecutive_failures || 0) + 1;
  const disable = failures >= DISABLE_AFTER_CONSECUTIVE_FAILURES;
  await supabase.from('webhook_endpoints').update({
    consecutive_failures: failures, last_failure_at: now,
    ...(disable ? { is_active: false, disabled_reason: `Disabled after ${failures} consecutive failed deliveries` } : {}),
  }).eq('id', ep.id);
  return final ? 'failed' : 'retrying';
}

/** Retry sweep: deliveries due now, plus rows stuck in 'delivering' (a crash mid-send). */
async function processDueDeliveries(limit = 100) {
  if (!supabase) return 0;
  const stuckBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabase.from('webhook_deliveries').update({ status: 'pending' })
    .eq('status', 'delivering').lt('next_attempt_at', stuckBefore);
  const { data, error } = await supabase.from('webhook_deliveries').select('id')
    .eq('status', 'pending').lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true }).limit(limit);
  if (error) { console.error('[Webhooks] sweep query failed:', error.message); return 0; }
  for (const row of data || []) await deliver(row.id).catch(e => console.error('[Webhooks] deliver failed:', e.message));
  return (data || []).length;
}

async function sendTestEvent(userId, endpointId) {
  const { data: ep } = await supabase.from('webhook_endpoints').select('id').eq('id', endpointId).eq('user_id', userId).maybeSingle();
  if (!ep) throw new WebhookError(404, 'Webhook endpoint not found');
  const eventId = crypto.randomUUID();
  const payload = { id: eventId, type: 'webhook.test', created_at: new Date().toISOString(), data: { message: 'Test event from Veori' } };
  const { data, error } = await supabase.from('webhook_deliveries')
    .insert({ endpoint_id: endpointId, user_id: userId, event: 'webhook.test', event_id: eventId, payload })
    .select('id').single();
  if (error) throw new Error(error.message);
  const result = await deliver(data.id, { immediate: true });
  const { data: row } = await supabase.from('webhook_deliveries')
    .select('status, response_status, error, attempts').eq('id', data.id).maybeSingle();
  return { result, ...row };
}

module.exports = {
  EVENTS, EVENT_NAMES, WebhookError, isPrivateAddress, validateUrl, sign,
  createEndpoint, listEndpoints, updateEndpoint, deleteEndpoint, listDeliveries,
  emitEvent, emitEvents, deliver, processDueDeliveries, sendTestEvent,
};
