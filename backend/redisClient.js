const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

let isConnected = false;

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('connect', () => {
  isConnected = true;
  console.log(`[Redis] Connected successfully to ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('ready', () => {
  isConnected = true;
  console.log('[Redis] Client is ready to accept commands');
});

redis.on('error', (err) => {
  isConnected = false;
  console.error('[Redis Error]', err.message);
});

redis.on('close', () => {
  isConnected = false;
  console.warn('[Redis] Connection closed');
});

async function checkRedisHealth() {
  try {
    const ping = await redis.ping();
    const info = await redis.info('server');
    return {
      status: ping === 'PONG' ? 'healthy' : 'degraded',
      connected: isConnected,
      host: REDIS_HOST,
      port: REDIS_PORT,
      uptime_seconds: info.match(/uptime_in_seconds:(\d+)/)?.[1] || null,
      redis_version: info.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown',
    };
  } catch (error) {
    return {
      status: 'unreachable',
      connected: false,
      host: REDIS_HOST,
      port: REDIS_PORT,
      error: error.message,
    };
  }
}

module.exports = {
  redis,
  checkRedisHealth,
};
