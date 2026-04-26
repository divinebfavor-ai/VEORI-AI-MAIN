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
};

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

  // Market intelligence nightly job (repeat)
  const marketQueue = getQueue(QUEUE_NAMES.MARKET_INTELLIGENCE);
  marketQueue.add('nightly-market-scan', {}, {
    jobId: 'market-intelligence-nightly',
    repeat: { pattern: '0 2 * * *' }, // 2am every night
    removeOnComplete: 5,
  }).catch(() => {});

  new Worker(QUEUE_NAMES.MARKET_INTELLIGENCE, async (job) => {
    const { runMarketIntelligenceScan } = require('./marketIntelligenceService');
    await runMarketIntelligenceScan();
  }, { connection: conn, concurrency: 1 });

  // Title warnings daily check (8am every day)
  const titleQueue = getQueue(QUEUE_NAMES.TITLE_WARNINGS);
  titleQueue.add('daily-title-check', {}, {
    jobId: 'title-warnings-daily',
    repeat: { pattern: '0 8 * * *' },
    removeOnComplete: 5,
  }).catch(() => {});

  new Worker(QUEUE_NAMES.TITLE_WARNINGS, async (job) => {
    const { runTitleWarningsScan } = require('./titleWarningsService');
    await runTitleWarningsScan();
  }, { connection: conn, concurrency: 1 });

  console.log('[Queue] BullMQ workers initialized');
}

module.exports = {
  getQueue,
  getRedisConnection,
  scheduleFollowUp,
  scheduleVapiCall,
  scheduleSequenceStep,
  cancelJob,
  initWorkers,
  QUEUE_NAMES,
};
