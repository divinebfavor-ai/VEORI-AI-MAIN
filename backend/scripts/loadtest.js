#!/usr/bin/env node
// Simple HTTP load test with no dependencies (Node 18+ fetch).
//
//   node scripts/loadtest.js --url https://staging.example.com/health --concurrency 200 --duration 60
//   node scripts/loadtest.js --url https://.../api/leads?limit=25 --token <JWT> --concurrency 50 --duration 30
//
// Runs `concurrency` workers that each send requests back-to-back for `duration`
// seconds, then prints throughput, status codes and latency percentiles.
// Do not point large runs at production: per-user and per-IP rate limits will
// (correctly) answer 429, and real users share the same database.

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const url = args.url;
const concurrency = Math.max(1, parseInt(args.concurrency || '10', 10));
const duration = Math.max(1, parseInt(args.duration || '10', 10)) * 1000;
const token = args.token || process.env.LOADTEST_TOKEN || null;
if (!url) { console.error('Usage: --url <url> [--concurrency 10] [--duration 10] [--token JWT]'); process.exit(1); }

const latencies = [];
const statuses = {};
let errors = 0;
const headers = token ? { Authorization: `Bearer ${token}` } : {};

async function worker(deadline) {
  while (Date.now() < deadline) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers });
      await res.arrayBuffer();
      statuses[res.status] = (statuses[res.status] || 0) + 1;
    } catch {
      errors += 1;
    }
    latencies.push(performance.now() - t0);
  }
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

(async () => {
  const started = Date.now();
  const deadline = started + duration;
  await Promise.all(Array.from({ length: concurrency }, () => worker(deadline)));
  const secs = (Date.now() - started) / 1000;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const ms = (v) => `${v.toFixed(0)}ms`;
  console.log(JSON.stringify({
    url: url.replace(/\?.*$/, ''),
    concurrency,
    seconds: Number(secs.toFixed(1)),
    requests: latencies.length,
    rps: Number((latencies.length / secs).toFixed(1)),
    statuses,
    network_errors: errors,
    latency: { p50: ms(pct(sorted, 50)), p90: ms(pct(sorted, 90)), p95: ms(pct(sorted, 95)), p99: ms(pct(sorted, 99)), max: ms(sorted[sorted.length - 1] || 0) },
  }, null, 2));
})();
