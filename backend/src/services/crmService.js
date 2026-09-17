// ─── CRM connectors ───────────────────────────────────────────────────────────
// Pushes this workspace's new leads into its own CRM. The operator pastes their CRM
// key in Settings → Integrations; from then on every new lead (manual, import, API,
// Lead Engine) is queued and synced, with retries, so a CRM outage loses nothing.
//
// Providers (request shapes checked against the vendors' docs, 2026-09-17):
//  - HubSpot: private app token, `Authorization: Bearer <token>`,
//    POST /crm/v3/objects/contacts, PATCH /crm/v3/objects/contacts/{id},
//    POST /crm/v3/objects/contacts/search. Scope: crm.objects.contacts.read + write.
//  - Follow Up Boss: API key as the HTTP Basic username (blank password),
//    POST /v1/events with type "Seller Inquiry"; FUB matches the person by email/phone.
//    FUB requires every request to carry the registered X-System / X-System-Key, so
//    this provider is available only once FUB_SYSTEM_NAME and FUB_SYSTEM_KEY are set.
//
// Credentials are encrypted with services/fieldCrypto (PII_ENCRYPTION_KEY) and never
// returned to the browser.

const axios = require('axios');
const supabase = require('../config/supabase');
const fieldCrypto = require('./fieldCrypto');

const HUBSPOT_BASE = 'https://api.hubapi.com';
const FUB_BASE = 'https://api.followupboss.com/v1';
const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const BATCH = 40;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

let http = axios; // swapped in tests

class CrmError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Providers ─────────────────────────────────────────────────────────────────
function splitName(lead) {
  return { first: (lead.first_name || '').trim(), last: (lead.last_name || '').trim() };
}

const PROVIDERS = {
  hubspot: {
    label: 'HubSpot',
    credentialLabel: 'Private app access token',
    available: () => true,
    unavailableReason: () => null,
    headers: (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),

    async test(token) {
      await http.get(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        headers: this.headers(token), params: { limit: 1 }, timeout: TIMEOUT_MS,
      });
    },

    properties(lead) {
      const { first, last } = splitName(lead);
      const p = {
        firstname: first || undefined,
        lastname: last || undefined,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        address: lead.property_address || undefined,
        city: lead.property_city || undefined,
        state: lead.property_state || undefined,
        zip: lead.property_zip || undefined,
      };
      return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));
    },

    async findByEmail(token, email) {
      const { data } = await http.post(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        limit: 1,
      }, { headers: this.headers(token), timeout: TIMEOUT_MS });
      return data?.results?.[0]?.id || null;
    },

    // Returns the HubSpot contact id.
    async pushLead(token, lead, existingId) {
      const properties = this.properties(lead);
      if (existingId) {
        try {
          await http.patch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(existingId)}`,
            { properties }, { headers: this.headers(token), timeout: TIMEOUT_MS });
          return existingId;
        } catch (err) {
          if (err.response?.status !== 404) throw err; // deleted in HubSpot: create again below
        }
      }
      try {
        const { data } = await http.post(`${HUBSPOT_BASE}/crm/v3/objects/contacts`,
          { properties }, { headers: this.headers(token), timeout: TIMEOUT_MS });
        return String(data.id);
      } catch (err) {
        // 409: a contact with this email already exists - update that one instead.
        if (err.response?.status === 409 && lead.email) {
          const id = await this.findByEmail(token, lead.email);
          if (id) {
            await http.patch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(id)}`,
              { properties }, { headers: this.headers(token), timeout: TIMEOUT_MS });
            return String(id);
          }
        }
        throw err;
      }
    },
  },

  followupboss: {
    label: 'Follow Up Boss',
    credentialLabel: 'API key',
    available: () => !!(process.env.FUB_SYSTEM_NAME && process.env.FUB_SYSTEM_KEY),
    unavailableReason: () => 'Follow Up Boss needs a registered system. Set FUB_SYSTEM_NAME and FUB_SYSTEM_KEY on the server.',
    config(apiKey) {
      return {
        auth: { username: apiKey, password: '' },
        headers: {
          'Content-Type': 'application/json',
          'X-System': process.env.FUB_SYSTEM_NAME,
          'X-System-Key': process.env.FUB_SYSTEM_KEY,
        },
        timeout: TIMEOUT_MS,
      };
    },

    async test(apiKey) {
      await http.get(`${FUB_BASE}/people`, { ...this.config(apiKey), params: { limit: 1 } });
    },

    async pushLead(apiKey, lead) {
      const { first, last } = splitName(lead);
      const address = [lead.property_address, lead.property_city, lead.property_state, lead.property_zip].filter(Boolean).join(', ');
      const person = {
        ...(first ? { firstName: first } : {}),
        ...(last ? { lastName: last } : {}),
        ...(lead.email ? { emails: [{ value: lead.email }] } : {}),
        ...(lead.phone ? { phones: [{ value: lead.phone }] } : {}),
        tags: ['Veori', ...(lead.primary_tag ? [lead.primary_tag.replace(/_/g, ' ')] : [])],
      };
      const body = {
        source: 'Veori',
        system: process.env.FUB_SYSTEM_NAME,
        type: 'Seller Inquiry',
        message: address ? `Seller lead for ${address}` : 'Seller lead from Veori',
        person,
      };
      const res = await http.post(`${FUB_BASE}/events`, body, this.config(apiKey));
      // 200 updated an existing person, 201 created one, 204 means FUB archived this lead source.
      if (res.status === 204) throw new CrmError(409, 'Follow Up Boss ignored the lead: the "Veori" lead source is archived in your account.');
      return null; // FUB matches the person itself by email/phone; no id to keep.
    },
  },
};

function providerOrThrow(name) {
  const p = PROVIDERS[name];
  if (!p) throw new CrmError(404, 'Unknown CRM');
  return p;
}

function describeError(err) {
  const status = err.response?.status;
  if (status === 401 || status === 403) return { status, message: 'The CRM rejected the key. Reconnect with a valid key.', auth: true };
  if (status === 429) return { status, message: 'The CRM is rate limiting requests. Will retry.', retry: true };
  if (status >= 500 || !status) return { status: status || 0, message: err.code === 'ECONNABORTED' ? 'The CRM did not respond in time.' : 'The CRM is unavailable.', retry: true };
  const detail = err.response?.data?.message || err.message;
  return { status, message: `The CRM refused the record (${status}): ${String(detail).slice(0, 300)}` };
}

// ── Connections ───────────────────────────────────────────────────────────────
function publicConnection(row) {
  return {
    provider: row.provider,
    label: PROVIDERS[row.provider]?.label || row.provider,
    credential_hint: row.credential_hint,
    sync_new_leads: row.sync_new_leads,
    status: row.status,
    last_error: row.last_error,
    last_synced_at: row.last_synced_at,
    connected_at: row.created_at,
  };
}

async function listConnections(userId) {
  const { data, error } = await supabase.from('crm_connections')
    .select('provider, credential_hint, sync_new_leads, status, last_error, last_synced_at, created_at')
    .eq('user_id', userId);
  if (error) throw error;
  const byProvider = Object.fromEntries((data || []).map(r => [r.provider, publicConnection(r)]));
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    provider: key,
    label: p.label,
    credential_label: p.credentialLabel,
    available: p.available(),
    unavailable_reason: p.available() ? null : p.unavailableReason(),
    connection: byProvider[key] || null,
  }));
}

async function connect(userId, provider, credential) {
  const p = providerOrThrow(provider);
  if (!p.available()) throw new CrmError(503, p.unavailableReason());
  if (!fieldCrypto.isEnabled()) {
    throw new CrmError(503, 'CRM connections need PII_ENCRYPTION_KEY set on the server so keys are stored encrypted.');
  }
  const key = typeof credential === 'string' ? credential.trim() : '';
  if (key.length < 8 || key.length > 512 || /\s/.test(key)) throw new CrmError(400, `Enter a valid ${p.credentialLabel.toLowerCase()}.`);

  try {
    await p.test(key);
  } catch (err) {
    const d = describeError(err);
    throw new CrmError(d.auth ? 400 : 502, d.auth ? `${p.label} rejected that ${p.credentialLabel.toLowerCase()}.` : `Could not reach ${p.label}: ${d.message}`);
  }

  const encrypted = fieldCrypto.encrypt(key);
  if (!encrypted) throw new CrmError(503, 'Could not encrypt the key.');
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('crm_connections').upsert({
    user_id: userId, provider,
    credential_encrypted: encrypted,
    credential_hint: `…${key.slice(-4)}`,
    status: 'active', last_error: null, updated_at: now,
  }, { onConflict: 'user_id,provider' }).select('*').single();
  if (error) throw error;
  return publicConnection(data);
}

async function updateSettings(userId, provider, { sync_new_leads } = {}) {
  providerOrThrow(provider);
  if (typeof sync_new_leads !== 'boolean') throw new CrmError(400, 'sync_new_leads must be true or false');
  const { data, error } = await supabase.from('crm_connections')
    .update({ sync_new_leads, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('provider', provider).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new CrmError(404, 'Not connected');
  return publicConnection(data);
}

async function disconnect(userId, provider) {
  providerOrThrow(provider);
  const { data, error } = await supabase.from('crm_connections')
    .delete().eq('user_id', userId).eq('provider', provider).select('id');
  if (error) throw error;
  if (!data?.length) throw new CrmError(404, 'Not connected');
  return true;
}

// ── Queue ─────────────────────────────────────────────────────────────────────
// Called for every lead.created event. Never throws: syncing must not break lead creation.
async function enqueueLeads(userId, leadIds, event = 'lead.created') {
  try {
    const ids = [...new Set((leadIds || []).filter(Boolean))];
    if (!userId || !ids.length) return 0;
    const { data: conns, error } = await supabase.from('crm_connections')
      .select('id').eq('user_id', userId).eq('status', 'active').eq('sync_new_leads', true);
    if (error || !conns?.length) return 0;
    const rows = [];
    for (const c of conns) for (const leadId of ids) rows.push({ user_id: userId, connection_id: c.id, lead_id: leadId, event });
    let queued = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error: insErr } = await supabase.from('crm_sync_jobs')
        .upsert(rows.slice(i, i + 500), { onConflict: 'connection_id,lead_id,event', ignoreDuplicates: true }).select('id');
      if (insErr) console.error('[CRM] enqueue failed:', insErr.message);
      else queued += data?.length || 0;
    }
    return queued;
  } catch (err) {
    console.error('[CRM] enqueue error:', err.message);
    return 0;
  }
}

// Queue every existing lead in the workspace (up to `limit`) for a first sync.
async function backfill(userId, provider, limit = 10000) {
  providerOrThrow(provider);
  const { data: conn, error } = await supabase.from('crm_connections')
    .select('id, status').eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (error) throw error;
  if (!conn) throw new CrmError(404, 'Not connected');
  if (conn.status !== 'active') throw new CrmError(409, 'Reconnect this CRM before syncing.');
  let queued = 0;
  const PAGE = 1000;
  for (let from = 0; from < limit; from += PAGE) {
    const { data: leads, error: lErr } = await supabase.from('leads').select('id')
      .eq('user_id', userId).order('created_at', { ascending: true }).range(from, Math.min(from + PAGE, limit) - 1);
    if (lErr) throw lErr;
    if (!leads?.length) break;
    const rows = leads.map(l => ({ user_id: userId, connection_id: conn.id, lead_id: l.id, event: 'lead.backfill' }));
    const { data, error: insErr } = await supabase.from('crm_sync_jobs')
      .upsert(rows, { onConflict: 'connection_id,lead_id,event', ignoreDuplicates: true }).select('id');
    if (insErr) throw insErr;
    queued += data?.length || 0;
    if (leads.length < PAGE) break;
  }
  return queued;
}

async function runJob(job) {
  const { data: conn } = await supabase.from('crm_connections')
    .select('id, user_id, provider, credential_encrypted, status').eq('id', job.connection_id).maybeSingle();
  if (!conn || conn.status !== 'active') return { done: false, final: true, error: 'CRM is disconnected or needs reconnecting' };
  const provider = PROVIDERS[conn.provider];
  if (!provider?.available()) return { done: false, final: false, error: provider?.unavailableReason() || 'Unknown CRM' };
  const credential = fieldCrypto.decrypt(conn.credential_encrypted);
  if (!credential) return { done: false, final: false, error: 'Stored key could not be decrypted (PII_ENCRYPTION_KEY missing or changed)' };

  // Read the lead fresh and only if it still belongs to the connection's workspace.
  const { data: lead } = await supabase.from('leads')
    .select('id, user_id, first_name, last_name, email, phone, property_address, property_city, property_state, property_zip, primary_tag')
    .eq('id', job.lead_id).eq('user_id', conn.user_id).maybeSingle();
  if (!lead) return { done: true, skipped: 'lead no longer exists' };

  const { data: link } = await supabase.from('crm_links').select('external_id')
    .eq('connection_id', conn.id).eq('lead_id', lead.id).maybeSingle();
  try {
    const externalId = await provider.pushLead(credential, lead, link?.external_id || null);
    const now = new Date().toISOString();
    if (externalId) {
      await supabase.from('crm_links').upsert({ connection_id: conn.id, lead_id: lead.id, external_id: externalId, synced_at: now }, { onConflict: 'connection_id,lead_id' });
    }
    await supabase.from('crm_connections').update({ last_synced_at: now, last_error: null }).eq('id', conn.id);
    return { done: true };
  } catch (err) {
    if (err instanceof CrmError) return { done: false, final: true, error: err.message };
    const d = describeError(err);
    if (d.auth) {
      await supabase.from('crm_connections').update({ status: 'error', last_error: d.message, updated_at: new Date().toISOString() }).eq('id', conn.id);
      return { done: false, final: true, error: d.message };
    }
    return { done: false, final: !d.retry, error: d.message };
  }
}

async function processDueJobs() {
  const now = Date.now();
  // Jobs left "processing" by a crashed instance go back to the queue.
  await supabase.from('crm_sync_jobs').update({ status: 'pending' })
    .eq('status', 'processing').lt('next_attempt_at', new Date(now - STALE_PROCESSING_MS).toISOString());

  const { data: due, error } = await supabase.from('crm_sync_jobs')
    .select('id, connection_id, lead_id, attempts')
    .eq('status', 'pending').lte('next_attempt_at', new Date(now).toISOString())
    .order('next_attempt_at', { ascending: true }).limit(BATCH);
  if (error) { console.error('[CRM] due query failed:', error.message); return 0; }

  let processed = 0;
  for (const job of due || []) {
    const { data: claimed } = await supabase.from('crm_sync_jobs')
      .update({ status: 'processing', next_attempt_at: new Date().toISOString() })
      .eq('id', job.id).eq('status', 'pending').select('id');
    if (!claimed?.length) continue;

    const result = await runJob(job);
    const attempts = job.attempts + 1;
    if (result.done) {
      await supabase.from('crm_sync_jobs').update({ status: 'done', attempts, completed_at: new Date().toISOString(), last_error: result.skipped || null }).eq('id', job.id);
    } else if (result.final || attempts >= MAX_ATTEMPTS) {
      await supabase.from('crm_sync_jobs').update({ status: 'failed', attempts, last_error: result.error, completed_at: new Date().toISOString() }).eq('id', job.id);
      await supabase.from('crm_connections').update({ last_error: result.error }).eq('id', job.connection_id);
    } else {
      const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60 * 1000;
      await supabase.from('crm_sync_jobs').update({ status: 'pending', attempts, last_error: result.error, next_attempt_at: new Date(Date.now() + wait).toISOString() }).eq('id', job.id);
    }
    processed += 1;
  }
  return processed;
}

async function syncStats(userId, provider) {
  providerOrThrow(provider);
  const { data: conn } = await supabase.from('crm_connections').select('id').eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (!conn) throw new CrmError(404, 'Not connected');
  const counts = {};
  for (const status of ['pending', 'processing', 'done', 'failed']) {
    const { count } = await supabase.from('crm_sync_jobs').select('id', { count: 'exact', head: true })
      .eq('connection_id', conn.id).eq('status', status);
    counts[status] = count || 0;
  }
  return counts;
}

module.exports = {
  PROVIDERS, CrmError, listConnections, connect, updateSettings, disconnect,
  enqueueLeads, backfill, processDueJobs, syncStats, runJob,
  _setHttp: (h) => { http = h; },
};
