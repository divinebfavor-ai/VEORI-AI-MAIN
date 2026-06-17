const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_AVAILABLE = !!process.env.REDIS_URL;
let connection = null;

function getRedisConnection() {
  if (!REDIS_AVAILABLE) return null;
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL, {
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
};

// Single-instance cron gate: only ONE box should register repeatable jobs (so we
// don't run the nightly scans N times on N instances). Workers run everywhere.
// Default-on; set RUN_CRON=false on extra instances if you ever scale horizontally.
const RUN_CRON = process.env.RUN_CRON !== 'false';

// SMS blast tuning. Per-number carrier safety is enforced INSIDE the processor
// (smsRotation daily caps + LRU). This limiter is a global throughput ceiling for
// the whole worker — keep it conservative on unregistered long-codes; raise
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
async function enqueueSMS({ leadId, campaignId, userId, to, body, smsFirstLeadId = null, delay = 0 }) {
  const queue = getQueue(QUEUE_NAMES.SMS_BLAST);
  if (!queue) return null;

  const job = await queue.add('send-blast-sms', {
    leadId, campaignId, userId, to, body, smsFirstLeadId,
  }, {
    delay: delay > 0 ? delay : undefined,
    jobId: `sms-${campaignId || 'adhoc'}-${leadId}`,
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
async function enqueueInboundSMS({ leadId, userId, from, body }) {
  const queue = getQueue(QUEUE_NAMES.SMS_INBOUND);
  if (!queue) return null;

  const job = await queue.add('score-inbound-sms', {
    leadId, userId, from, body,
  }, {
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
function initWorkers() {
  if (!REDIS_AVAILABLE) {
    console.warn('[Queue] REDIS_URL not set — BullMQ disabled. Add Redis on Railway to enable job queues.');
    return;
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

  // ── Repeatable (cron) jobs — register on the cron instance only ───────────
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
  } else {
    console.log('[Queue] RUN_CRON=false — skipping repeatable job registration on this instance');
  }

  console.log('[Queue] BullMQ workers initialized');
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
