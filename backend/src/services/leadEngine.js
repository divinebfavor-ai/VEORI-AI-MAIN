/**
 * VEORI Lead Engine — Autonomous Public Records Sourcing
 *
 * Runs every 24 hours. Pulls from all sources simultaneously,
 * scores every record, skip traces, deduplicates, and pushes
 * directly into the Veori pipeline with AI calling triggered.
 *
 * Sources:
 *   tax_delinquent  — county tax assessor databases (2+ years unpaid)
 *   probate         — county courthouse estate filings
 *   lis_pendens     — pre-foreclosure notices
 *   divorce         — divorce filings with real property
 *   code_violation  — code enforcement violations
 *   usda_land       — USDA vacant/rural absentee parcels
 *   blm_land        — BLM adjacent private absentee land
 *   bankruptcy      — PACER federal bankruptcy with property assets
 */

const { v4: uuidv4 }            = require('uuid');
const supabase                   = require('../config/supabase');

// Supabase's query builder is a *thenable*, not a real Promise — it has no
// .catch() method. Calling .catch() on it throws a TypeError, which aborted
// every engine run at its FIRST job insert (the engine never pulled a record).
// Promise.resolve() assimilates the thenable into a real Promise so best-effort
// awaits are actually best-effort.
const bestEffort = (builder) => Promise.resolve(builder).catch(() => {});
const { calculateSourcingScore } = require('./leadEngineScorer');
const { skipTraceLead }          = require('./skipTraceService');
const {
  pullAllFreeRecords,
  pullPhillyLisPendens,
  pullPhillyViolations,
  pullPhillyAbsentee,
  pullPhillySheriffSales,
  pullCookCountyTaxDelinquent,
  pullDetroitTaxDelinquent,
} = require('./sources/freePublicRecords');


// ─── Deduplication ────────────────────────────────────────────────────────────

async function isExistingLead(userId, address, phone) {
  if (!address && !phone) return false;

  const queries = [];
  if (address) {
    queries.push(
      supabase.from('leads').select('id').eq('user_id', userId)
        .ilike('property_address', `%${address.split(' ').slice(0, 3).join(' ')}%`)
        .limit(1)
    );
  }
  if (phone) {
    queries.push(
      supabase.from('leads').select('id').eq('user_id', userId).eq('phone', phone).limit(1)
    );
  }

  const results = await Promise.all(queries);
  return results.some(r => (r.data || []).length > 0);
}

// ─── Insert with retry ───────────────────────────────────────────────────────
// A sourced lead is expensive to find (skip-trace + scraping). A momentary Supabase
// blip must NOT lose it. Retry the insert a few times with backoff before giving up.
// A genuine duplicate-key error (23505 — the new unique index) is NOT retried: it is
// the dedup working, so we return that row's existing-ness, not an error.
async function insertLeadWithRetry(payload, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase.from('leads').insert(payload).select().single();
    if (!error) return { lead: data, error: null, duplicate: false };
    // Unique-violation = the dedup index caught a duplicate. Not a transient failure;
    // stop and report it as a duplicate rather than retrying or losing the record.
    if (error.code === '23505') return { lead: null, error: null, duplicate: true };
    lastError = error;
    console.warn(`[LeadEngine] Insert attempt ${i + 1}/${attempts} failed: ${error.message}`);
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  return { lead: null, error: lastError, duplicate: false };
}

// ─── Process a single raw record ─────────────────────────────────────────────

async function processRecord(record, userId) {
  try {
    const { score, signals, lead_type } = calculateSourcingScore(record);

    // Only import leads scoring 25+ (filters garbage records)
    if (score < 25) return { status: 'skipped', reason: 'low_score' };

    // Auto skip trace if no phone/email
    let phone = record.phone || '';
    let email = record.email || '';

    if (!phone || !email) {
      try {
        const traced = await skipTraceLead({
          first_name:       record.first_name,
          last_name:        record.last_name,
          property_address: record.property_address,
          property_city:    record.property_city,
          property_state:   record.property_state,
          property_zip:     record.property_zip,
        });
        if (traced?.phones?.[0]?.number) phone = traced.phones[0].number;
        if (traced?.emails?.[0]?.address) email = traced.emails[0].address;
      } catch (_) {}
    }

    // Dedup check
    const exists = await isExistingLead(userId, record.property_address, phone);
    if (exists) return { status: 'skipped', reason: 'duplicate' };

    // Build tags
    const tags = [
      `auto-sourced`,
      `source:${record.source_key}`,
      ...signals.map(s => `signal:${s}`),
      ...(record.county ? [`county:${record.county.toLowerCase()}`] : []),
    ];

    // Insert into leads — retried, so a momentary DB blip doesn't lose the lead.
    const { lead, error, duplicate } = await insertLeadWithRetry({
      id:               uuidv4(),
      user_id:          userId,
      first_name:       record.first_name || 'Property',
      last_name:        record.last_name  || 'Owner',
      phone:            phone || null,
      email:            email || null,
      property_address: record.property_address || '',
      property_city:    record.property_city    || '',
      property_state:   record.property_state   || '',
      property_zip:     record.property_zip     || '',
      property_type:    record.property_type    || 'Single Family',
      estimated_value:  record.estimated_value  || null,
      county:           record.county           || null,
      parcel_id:        record.parcel_id        || null,
      years_delinquent: record.years_delinquent || null,
      tax_owed:         record.tax_owed         || null,
      case_number:      record.case_number      || null,
      filing_date:      record.filing_date      || null,
      source:           'lead_engine',
      sourcing_source:  record.source_key,
      sourcing_score:   score,
      distress_signals: signals,
      lead_type,
      auto_sourced:     true,
      sourced_at:       new Date().toISOString(),
      status:           'new',
      motivation_score: score, // sourcing score as initial motivation estimate
      tags,
      notes:            record.notes || `Auto-sourced via Lead Engine — ${signals.join(', ')}`,
    });

    // Unique index caught a race the pre-check missed — that's the dedup working.
    if (duplicate) return { status: 'skipped', reason: 'duplicate' };
    if (error) {
      console.error('[LeadEngine] Insert error after retries:', error.message);
      return { status: 'error', reason: error.message };
    }

    // Trigger motivation scoring + AI calling for high-score leads
    if (score >= 60 && phone) {
      try {
        const { enrollLeadInSequence } = require('./sequenceEngine');
        // Signature is (userId, leadId, sequenceType) — args were previously swapped.
        await enrollLeadInSequence(userId, lead.id, 'auto_sourced').catch(() => {});
      } catch (_) {}
    }

    return { status: 'imported', lead_id: lead.id, score };
  } catch (err) {
    console.error('[LeadEngine] processRecord error:', err.message);
    return { status: 'error', reason: err.message };
  }
}

// ─── Run one specific source (used by targeted pull) ─────────────────────────
async function runSource(sourceKey, state, userId) {
  const jobId = uuidv4();
  await bestEffort(supabase.from('lead_engine_jobs').insert({
    id: jobId, source_key: sourceKey, state, started_at: new Date().toISOString(), status: 'running',
  }));

  // For targeted pulls, always run all free sources (state filter applied in processRecord)
  let rawRecords = [];
  try {
    rawRecords = await pullAllFreeRecords();
    // If a specific state was requested, filter to that state
    if (state) rawRecords = rawRecords.filter(r => !r.property_state || r.property_state === state);
  } catch (err) {
    await bestEffort(supabase.from('lead_engine_jobs').update({
      status: 'error', completed_at: new Date().toISOString(), error_message: err.message,
    }).eq('id', jobId));
    return { imported: 0, skipped: 0, errors: 0 };
  }

  let imported = 0, skipped = 0, errors = 0;

  // Process records concurrently (batches of 5 to avoid rate limits)
  const BATCH = 5;
  for (let i = 0; i < rawRecords.length; i += BATCH) {
    const batch = rawRecords.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(r => processRecord(r, userId)));
    for (const r of results) {
      if (r.status === 'imported') imported++;
      else if (r.status === 'skipped') skipped++;
      else errors++;
    }
  }

  // Update coverage map
  await bestEffort(supabase.from('lead_engine_coverage').upsert({
    state,
    source_key:  sourceKey,
    is_covered:  rawRecords.length > 0,
    last_updated: new Date().toISOString(),
    total_leads:  imported,
  }, { onConflict: 'state,county,source_key' }));

  // Mark job complete
  await bestEffort(supabase.from('lead_engine_jobs').update({
    status:         errors > 0 && imported === 0 ? 'error' : 'success',
    completed_at:   new Date().toISOString(),
    records_found:  rawRecords.length,
    records_new:    imported,
    records_skipped: skipped,
  }).eq('id', jobId));

  // Update source stats
  await bestEffort(supabase.from('lead_engine_sources').upsert({
    user_id:         userId,
    source_key:      sourceKey,
    source_label:    SOURCE_LABELS[sourceKey] || sourceKey,
    state,
    last_run_at:     new Date().toISOString(),
    last_run_status: imported > 0 ? 'success' : 'partial',
    last_run_count:  imported,
  }, { onConflict: 'user_id,source_key,state' }));

  console.log(`[LeadEngine] ${sourceKey}/${state} → ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return { imported, skipped, errors };
}

const SOURCE_LABELS = {
  tax_delinquent: 'Tax Delinquent',
  lis_pendens:    'Lis Pendens / Pre-Foreclosure',
  code_violation: 'Code Violations',
};

// ─── Full engine run — pulls all verified free sources ────────────────────────
async function runLeadEngine(userId) {
  console.log(`[LeadEngine] Starting run for user ${userId}`);

  const jobId = uuidv4();
  await bestEffort(supabase.from('lead_engine_jobs').insert({
    id: jobId, source_key: 'all', started_at: new Date().toISOString(), status: 'running',
  }));

  let imported = 0, skipped = 0, errors = 0;

  try {
    const rawRecords = await pullAllFreeRecords();
    console.log(`[LeadEngine] ${rawRecords.length} raw records — processing...`);

    const BATCH = 5;
    for (let i = 0; i < rawRecords.length; i += BATCH) {
      const batch = rawRecords.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(r => processRecord(r, userId)));
      for (const r of results) {
        if (r.status === 'imported') imported++;
        else if (r.status === 'skipped') skipped++;
        else errors++;
      }
    }
  } catch (err) {
    console.error('[LeadEngine] Run error:', err.message);
    errors++;
  }

  await bestEffort(supabase.from('lead_engine_jobs').update({
    status: imported > 0 ? 'success' : 'partial',
    completed_at: new Date().toISOString(),
    records_new: imported,
    records_skipped: skipped,
  }).eq('id', jobId));

  console.log(`[LeadEngine] Done — ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return { total_imported: imported, total_skipped: skipped };
}

// ─── Scheduler: runs automatically every 24 hours ───────────────────────────

let engineTimer = null;

function startLeadEngineScheduler() {
  if (engineTimer) return; // already running

  console.log('[LeadEngine] Scheduler started — runs every 24h');

  const runForAllUsers = async () => {
    try {
      // Get all users with active subscriptions (they get the engine)
      const { data: users } = await supabase
        .from('users')
        .select('id, subscription_status')
        .in('subscription_status', ['active', 'trialing'])
        .limit(100);

      for (const user of users || []) {
        await runLeadEngine(user.id).catch(err =>
          console.error(`[LeadEngine] Error for user ${user.id}:`, err.message)
        );
        // Stagger user runs by 30 seconds each
        await new Promise(r => setTimeout(r, 30000));
      }
    } catch (err) {
      console.error('[LeadEngine] Scheduler error:', err.message);
    }
  };

  // Run immediately on start, then every 24 hours
  runForAllUsers();
  engineTimer = setInterval(runForAllUsers, 24 * 60 * 60 * 1000);
}

function stopLeadEngineScheduler() {
  if (engineTimer) { clearInterval(engineTimer); engineTimer = null; }
}

module.exports = {
  runLeadEngine,
  runSource,
  startLeadEngineScheduler,
  stopLeadEngineScheduler,
  SOURCE_LABELS,
};
