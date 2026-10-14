const scheduler = require('./scheduler');

const sampleTasks = [
  {
    name: 'Production API Health Check',
    description: 'Pings the main microservice health endpoint to check latency and status code.',
    type: 'http_ping',
    schedule_type: 'interval',
    interval_seconds: 25,
    payload: {
      url: 'https://httpbin.org/status/200',
      timeout: 4000,
      notify_on_failure: true,
    },
  },
  {
    name: 'Automated Database Snapshot',
    description: 'Creates a gzip compressed snapshot of primary cluster data and ships to object storage.',
    type: 'db_backup',
    schedule_type: 'interval',
    interval_seconds: 60,
    payload: {
      database: 'redis_cluster_primary',
      destination: 's3://cloud-backups/daily/db-snapshot.rdb.gz',
    },
  },
  {
    name: 'Security & Auth Digest Dispatch',
    description: 'Summarizes login anomalies, blocked IP addresses, and alerts DevOps engineers.',
    type: 'email_alert',
    schedule_type: 'interval',
    interval_seconds: 45,
    payload: {
      to: 'security-team@internal.corp',
      subject: 'Security & Anomaly Detection Digest',
    },
  },
  {
    name: 'Session & CDN Cache Invalidation',
    description: 'Evicts expired cache keys and purges CDN edge nodes for stale static assets.',
    type: 'cache_purge',
    schedule_type: 'interval',
    interval_seconds: 90,
    payload: {
      pattern: 'session:auth:*',
      zone: 'global-cdn-us-east',
    },
  },
  {
    name: 'Business KPI Executive Summary',
    description: 'Aggregates transaction throughput, latency p99, and sends tabular breakdown.',
    type: 'report_generator',
    schedule_type: 'interval',
    interval_seconds: 120,
    payload: {
      report_type: 'Executive Latency & SLA Audit',
    },
  },
];

async function seedInitialData() {
  const existing = await scheduler.getAllTasks();
  if (existing.length === 0) {
    console.log('[Seed] No existing tasks found. Seeding initial scheduled jobs...');
    for (const item of sampleTasks) {
      await scheduler.createTask(item);
    }
    console.log(`[Seed] Seeded ${sampleTasks.length} demonstration tasks successfully!`);
  }
}

module.exports = {
  sampleTasks,
  seedInitialData,
};
