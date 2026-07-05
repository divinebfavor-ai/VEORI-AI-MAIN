const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');

/**
 * Sanitise REDIS_URL. Some hosting dashboards paste the redis-cli invocation
 * (e.g. ` -u redis://…`) into the value instead of the bare URL. ioredis then
 * treats the whole string as a hostname → `connect ENOENT %20-u%20redis://…`
 * crash-loop. Strip any leading redis-cli flag / whitespace so we're left with
 * a clean `redis://` (or `rediss://`) URL. Returns null if nothing usable.
 */
function sanitizeRedisUrl(raw) {
  if (!raw) return null;
  let v = String(raw).trim();
  // Drop a leading `-u`/`--uri` flag and its surrounding spaces if present.
  v = v.replace(/^-{1,2}u(?:ri)?\s+/i, '').trim();
  // If the URL is embedded after other tokens, grab from the scheme onward.
  const m = v.match(/rediss?:\/\/\S+/i);
  if (m) v = m[0];
  return /^rediss?:\/\//i.test(v) ? v : null;
}

const REDIS_URL = sanitizeRedisUrl(process.env.REDIS_URL);
const REDIS_AVAILABLE = !!REDIS_URL;
let connection = null;

function getRedisConnection() {
  if (!REDIS_AVAILABLE) return null;
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on('error', (err) => {
      console.warn('[Queue] Redis error:', err.message);
    });
  }
  return connection;
}

// ─── Queue definitions ────────────────────────────────────────────────────────
const QUEUE_NAMES = {
  FOLLOW_UPS:         'follow-ups',
  SCHEDULED_CALLS:    'scheduled-calls',
  SEQUENCE_STEPS:     'sequence-steps',
  MARKET_INTELLIGENCE:'market-intelligence',
  CONVERSATION_INTEL: 'conversation-intelligence',
  TITLE_WARNINGS:     'title-warnings',
  SMS_BLAST:          'sms-blast',     // outbound high-volume outreach SMS
  SMS_INBOUND:        'sms-inbound',   // inbound reply scoring/escalation (off the webhook)
  SMS_DAILY_RESET:    'sms-daily-reset', // nightly zero of per-number SMS counters
  ANALYTICS_ROLLUP:   'analytics-rollup', // nightly per-operator daily stats rollup
  SEQUENCE_SCAN:      'sequence-scan',   // periodic nurture scan (processReadySequences)
  TOLLFREE_VERIFY_POLL: 'tollfree-verify-poll', // refresh pending toll-free SMS verifications from Twilio
};

// Single-instance cron gate: only ONE box should register repeatable jobs (so we
// don't run the nightly scans N times on N instances). Workers run everywhere.
// Default-on; set RUN_CRON=false on extra instances if you ever scale horizontally.
const RUN_CRON = process.env.RUN_CRON !== 'false';

// SMS blast tuning. Per-number carrier safety is enforced INSIDE the processor
// (smsRotation daily caps + LRU). This limiter is a global throughput ceiling for
// the whole worker - keep it conservative on unregistered long-codes; raise
// SMS_GLOBAL_RATE_MAX as you register A2P numbers and rotation grows the pool.
const SMS_WORKER_CONCURRENCY = Number(process.env.SMS_WORKER_CONCURRENCY) || 50;
const SMS_GLOBAL_RATE_MAX    = Number(process.env.SMS_GLOBAL_RATE_MAX)    || 10; // sends/sec
const SMS_INBOUND_CONCURRENCY = Number(process.env.SMS_INBOUND_CONCURRENCY) || 20;

const queues = {};

function getQueue(name) {
  if (!REDIS_AVAILABLE) return null;
  if (!queues[name]) {
    queues[name] = new Queue(name, { connection: getRedisConnection() });
  }
  return queues[name];
}

// ─── Schedule a follow-up ────────────────────────────────────────────────────
async function scheduleFollowUp({ followUpId, dealId, contactId, contactType, runAt, type, template }) {
  const queue = getQueue(QUEUE_NAMES.FOLLOW_UPS);
  const delay = new Date(runAt).getTime() - Date.now();
  if (delay < 0) return null;

  const job = await queue.add('run-follow-up', {
    followUpId, dealId, contactId, contactType, type, template,
  }, {
    delay,
    jobId: `followup-${followUpId}`,
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  return job.id;
}

// ─── Schedule a Vapi voice call ───────────────────────────────────────────────
async function scheduleVapiCall({ followUpId, dealId, leadId, runAt, script }) {
  const queue = getQueue(QUEUE_NAMES.SCHEDULED_CALLS);
  const delay = new Date(runAt).getTime() - Date.now();
  if (delay < 0) return null;

  const job = await queue.add('run-vapi-call', {
    followUpId, dealId, leadId, script,
  }, {
    delay,
    jobId: `call-${followUpId}`,
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 2,
    backoff: { type: 'fixed', delay: 30000 },
  });

  return job.id;
}

// ─── Schedule a sequence step ─────────────────────────────────────────────────
async function scheduleSequenceStep({ sequenceId, stepIndex, runAt }) {
  const queue = getQueue(QUEUE_NAMES.SEQUENCE_STEPS);
  const delay = new Date(runAt).getTime() - Date.now();
  if (delay < 0) return null;

  const job = await queue.add('run-sequence-step', {
    sequenceId, stepIndex,
  }, {
    delay,
    jobId: `seq-${sequenceId}-step-${stepIndex}`,
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  });

  return job.id;
}

// ─── Enqueue an outbound blast SMS ────────────────────────────────────────────
// Producer mirrors scheduleFollowUp: one job per lead (idempotent jobId), retries
// with exponential backoff, dead-letter retained on final failure. The processor
// (smsBlastProcessor) owns DNC + credit reservation + rotation + the actual send.
// Returns the BullMQ job id (for sms_first_leads.enqueue_job_id) or null if Redis
// is unavailable (caller falls back to an inline send loop).
async function enqueueSMS({ leadId, campaignId, userId, to, body, smsFirstLeadId = null, delay = 0, jobIdSuffix = '' }) {
  const queue = getQueue(QUEUE_NAMES.SMS_BLAST);
  if (!queue) return null;

  // jobIdSuffix lets a worker RE-enqueue the same lead with a distinct id (used by
  // the TCPA quiet-hours deferral: the original job is still 'active' when it
  // re-queues, so a bare reuse of the base id would be a BullMQ no-op and silently
  // drop the deferred message). Empty suffix === original behavior, unchanged.
  const job = await queue.add('send-blast-sms', {
    leadId, campaignId, userId, to, body, smsFirstLeadId,
  }, {
    delay: delay > 0 ? delay : undefined,
    jobId: `sms-${campaignId || 'adhoc'}-${leadId}${jobIdSuffix}`,
    removeOnComplete: true,
    removeOnFail: 1000,           // retain failed jobs for forensics before dead-letter
    attempts: 3,
    backoff: { type: 'exponential', delay: 15000 },
  });

  return job.id;
}

// ─── Enqueue inbound-reply scoring (off the Twilio webhook) ───────────────────
// The webhook keeps STOP/START + inbound logging inline; the slow GPT scoreReply +
// escalation is handed here so a reply flood can't block the request path. Returns
// the job id, or null if Redis is unavailable (caller scores inline as before).
async function enqueueInboundSMS({ leadId, userId, from, body, inboundMsgId }) {
  const queue = getQueue(QUEUE_NAMES.SMS_INBOUND);
  if (!queue) return null;

  // jobId = the provider MessageSid → if Twilio re-delivers the same inbound webhook
  // (its standard retry behavior), BullMQ dedups and we DON'T score/act on it twice.
  // Falls back to a per-lead-timestamp key when no SID is present.
  const jobId = inboundMsgId
    ? `inbound-${inboundMsgId}`
    : `inbound-${leadId}-${Date.now()}`;

  const job = await queue.add('score-inbound-sms', {
    leadId, userId, from, body, inboundMsgId,
  }, {
    jobId,
    removeOnComplete: true,
    removeOnFail: 500,
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  });

  return job.id;
}

// ─── Cancel a job by ID ───────────────────────────────────────────────────────
async function cancelJob(queueName, jobId) {
  try {
    const queue = getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (job) await job.remove();
  } catch (err) {
    console.error('[Queue] Cancel job error:', err.message);
  }
}

// ─── Initialize workers ───────────────────────────────────────────────────────
// Returns true when BullMQ workers are actually running (Redis available),
// false when disabled - so the caller can arm interval fallbacks ONLY when
// the queue-driven crons are genuinely absent (no double-fire).
function initWorkers() {
  if (!REDIS_AVAILABLE) {
    console.warn('[Queue] REDIS_URL not set - BullMQ disabled. Add Redis on Railway to enable job queues.');
    return false;
  }
  const conn = getRedisConnection();

  // Follow-up worker
  new Worker(QUEUE_NAMES.FOLLOW_UPS, async (job) => {
    const { processFollowUp } = require('./followUpProcessor');
    await processFollowUp(job.data);
  }, { connection: conn, concurrency: 5 });

  // Scheduled call worker
  new Worker(QUEUE_NAMES.SCHEDULED_CALLS, async (job) => {
    const { processScheduledCall } = require('./followUpProcessor');
    await processScheduledCall(job.data);
  }, { connection: conn, concurrency: 3 });

  // Sequence step worker
  new Worker(QUEUE_NAMES.SEQUENCE_STEPS, async (job) => {
    const { processSequenceStep } = require('./followUpProcessor');
    await processSequenceStep(job.data);
  }, { connection: conn, concurrency: 5 });

  // ── SMS blast worker (outbound high-volume outreach) ──────────────────────
  // concurrency drains the queue fast; the limiter is a SAFE global send ceiling.
  // Per-number carrier caps live in the processor (smsRotation). A hard send
  // failure throws → BullMQ retries (3×, exp backoff) → final failure → dead-letter.
  const smsBlastWorker = new Worker(QUEUE_NAMES.SMS_BLAST, async (job) => {
    const { processBlastSMS } = require('./smsBlastProcessor');
    await processBlastSMS(job.data);
  }, {
    connection: conn,
    concurrency: SMS_WORKER_CONCURRENCY,
    limiter: { max: SMS_GLOBAL_RATE_MAX, duration: 1000 },
  });

  // After retries are exhausted, persist to sms_dead_letter for manual replay.
  smsBlastWorker.on('failed', async (job, err) => {
    if (!job || (job.attemptsMade || 0) < (job.opts?.attempts || 1)) return; // not final yet
    try {
      const supabase = require('../config/supabase');
      if (!supabase) return;
      const d = job.data || {};
      await supabase.from('sms_dead_letter').insert({
        operator_id: d.userId || null,
        lead_id:     d.leadId || null,
        campaign_id: d.campaignId || null,
        to_phone:    d.to || null,
        body:        d.body || null,
        error:       (err && err.message) ? err.message.slice(0, 1000) : 'unknown',
        attempts:    job.attemptsMade || 0,
        job_id:      String(job.id),
      });
    } catch (e) {
      console.warn('[Queue] dead-letter insert failed:', e.message);
    }
  });

  // ── SMS inbound worker (reply scoring + escalation, off the webhook) ───────
  new Worker(QUEUE_NAMES.SMS_INBOUND, async (job) => {
    const { processInboundSMS } = require('./smsInboundProcessor');
    await processInboundSMS(job.data);
  }, { connection: conn, concurrency: SMS_INBOUND_CONCURRENCY });

  // ── SMS daily-reset worker (zero per-number counters) ─────────────────────
  new Worker(QUEUE_NAMES.SMS_DAILY_RESET, async (job) => {
    const { resetDailyCounters } = require('./smsRotation');
    const n = await resetDailyCounters();
    console.log(`[Queue] sms-daily-reset zeroed ${n} number(s)`);
  }, { connection: conn, concurrency: 1 });

  // ── Analytics rollup worker (per-operator daily stats) ────────────────────
  new Worker(QUEUE_NAMES.ANALYTICS_ROLLUP, async (job) => {
    const { rollupYesterday } = require('./analyticsRollup');
    const n = await rollupYesterday();
    console.log(`[Queue] analytics-rollup wrote ${n} operator row(s)`);
  }, { connection: conn, concurrency: 1 });

  // ── Sequence-scan worker (drives the multi-touch nurture engine) ──────────
  // Scans `sequences` for steps whose next_action_at is due and executes them
  // (email/SMS/call). Previously this only ran in index.js's Redis-FAILURE
  // fallback, so in normal production (Redis up) the nurture engine never fired.
  // Now it runs as a real repeatable job, gated by RUN_CRON like the others.
  new Worker(QUEUE_NAMES.SEQUENCE_SCAN, async (job) => {
    const { processReadySequences } = require('./sequenceEngine');
    await processReadySequences();
  }, { connection: conn, concurrency: 1 });

  // Market intelligence worker (runs everywhere; repeat registered only on cron box)
  new Worker(QUEUE_NAMES.MARKET_INTELLIGENCE, async (job) => {
    const { runMarketIntelligenceScan } = require('./marketIntelligenceService');
    await runMarketIntelligenceScan();
  }, { connection: conn, concurrency: 1 });

  // Title warnings worker
  new Worker(QUEUE_NAMES.TITLE_WARNINGS, async (job) => {
    const { runTitleWarningsScan } = require('./titleWarningsService');
    await runTitleWarningsScan();
  }, { connection: conn, concurrency: 1 });

  // ── Toll-free SMS verification poller ─────────────────────────────────────
  // Refreshes every toll-free number stuck in 'pending' against Twilio, flipping
  // it to 'verified' once carrier review approves - so Veori-bought numbers become
  // SMS-deliverable with zero operator action.
  new Worker(QUEUE_NAMES.TOLLFREE_VERIFY_POLL, async (job) => {
    const { pollPendingVerifications } = require('./numberProvisioning');
    const r = await pollPendingVerifications();
    if (r.changed) console.log(`[Queue] tollfree-verify-poll: ${r.changed}/${r.checked} number(s) advanced`);
  }, { connection: conn, concurrency: 1 });

  // ── Repeatable (cron) jobs - register on the cron instance only ───────────
  if (RUN_CRON) {
    const marketQueue = getQueue(QUEUE_NAMES.MARKET_INTELLIGENCE);
    marketQueue.add('nightly-market-scan', {}, {
      jobId: 'market-intelligence-nightly',
      repeat: { pattern: '0 2 * * *' }, // 2am every night
      removeOnComplete: 5,
    }).catch(() => {});

    const titleQueue = getQueue(QUEUE_NAMES.TITLE_WARNINGS);
    titleQueue.add('daily-title-check', {}, {
      jobId: 'title-warnings-daily',
      repeat: { pattern: '0 8 * * *' }, // 8am every day
      removeOnComplete: 5,
    }).catch(() => {});

    const smsResetQueue = getQueue(QUEUE_NAMES.SMS_DAILY_RESET);
    smsResetQueue.add('sms-daily-reset', {}, {
      jobId: 'sms-daily-reset',
      repeat: { pattern: '5 0 * * *' }, // 00:05 every day
      removeOnComplete: 5,
    }).catch(() => {});

    const rollupQueue = getQueue(QUEUE_NAMES.ANALYTICS_ROLLUP);
    rollupQueue.add('analytics-rollup', {}, {
      jobId: 'analytics-rollup',
      repeat: { pattern: '15 0 * * *' }, // 00:15 every day (after sms-daily-reset)
      removeOnComplete: 5,
    }).catch(() => {});

    const seqScanQueue = getQueue(QUEUE_NAMES.SEQUENCE_SCAN);
    seqScanQueue.add('sequence-scan', {}, {
      jobId: 'sequence-scan',
      repeat: { pattern: '*/15 * * * *' }, // every 15 min - nurture due-step scan
      removeOnComplete: 5,
    }).catch(() => {});

    const tfVerifyQueue = getQueue(QUEUE_NAMES.TOLLFREE_VERIFY_POLL);
    tfVerifyQueue.add('tollfree-verify-poll', {}, {
      jobId: 'tollfree-verify-poll',
      repeat: { pattern: '*/30 * * * *' }, // every 30 min - carrier approval takes days
      removeOnComplete: 5,
    }).catch(() => {});
  } else {
    console.log('[Queue] RUN_CRON=false - skipping repeatable job registration on this instance');
  }

  console.log('[Queue] BullMQ workers initialized');
  return true;
}

module.exports = {
  getQueue,
  getRedisConnection,
  scheduleFollowUp,
  scheduleVapiCall,
  scheduleSequenceStep,
  enqueueSMS,
  enqueueInboundSMS,
  cancelJob,
  initWorkers,
  QUEUE_NAMES,
  REDIS_AVAILABLE,
};
