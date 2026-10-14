const { redis } = require('./redisClient');

const DRAFT_PREFIX = 'draft:user:';
const TASK_CACHE_KEY = 'cache:tasks:all';
const STATS_CACHE_KEY = 'cache:stats';

class CacheService {
  /**
   * Stores in-progress / incomplete user registration form in Redis
   * @param {string} sessionId Unique session or client identifier
   * @param {object} draftData Form values entered so far
   * @param {number} ttlSeconds Expiration time (default: 30 minutes / 1800s)
   */
  async saveRegistrationDraft(sessionId, draftData, ttlSeconds = 1800) {
    if (!sessionId) throw new Error('Session ID is required to cache registration draft');
    const key = `${DRAFT_PREFIX}${sessionId}`;
    const payload = JSON.stringify({
      ...draftData,
      cachedAt: new Date().toISOString(),
      updatedAt: Date.now(),
    });

    await redis.setex(key, ttlSeconds, payload);
    const ttl = await redis.ttl(key);

    return {
      success: true,
      key,
      sessionId,
      ttl_remaining_seconds: ttl,
      cachedAt: new Date().toISOString(),
    };
  }

  /**
   * Retrieves an in-progress user registration draft from Redis cache
   * @param {string} sessionId
   */
  async getRegistrationDraft(sessionId) {
    if (!sessionId) return null;
    const key = `${DRAFT_PREFIX}${sessionId}`;
    const raw = await redis.get(key);
    if (!raw) return null;

    const ttl = await redis.ttl(key);
    try {
      const data = JSON.parse(raw);
      return {
        ...data,
        ttl_remaining_seconds: ttl,
      };
    } catch {
      return null;
    }
  }

  /**
   * Clears the registration draft from Redis (e.g. after successful submit or discard)
   * @param {string} sessionId
   */
  async deleteRegistrationDraft(sessionId) {
    if (!sessionId) return false;
    const key = `${DRAFT_PREFIX}${sessionId}`;
    const deleted = await redis.del(key);
    return deleted > 0;
  }

  /**
   * Lists all active in-progress registration drafts currently cached in Redis
   */
  async listActiveDrafts() {
    const keys = await redis.keys(`${DRAFT_PREFIX}*`);
    const drafts = [];

    for (const key of keys) {
      const raw = await redis.get(key);
      const ttl = await redis.ttl(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const sessionId = key.replace(DRAFT_PREFIX, '');
          drafts.push({
            sessionId,
            ttl_remaining_seconds: ttl,
            draft: parsed,
          });
        } catch {}
      }
    }

    return drafts;
  }

  /**
   * Tasks query cache
   */
  async getCachedTasks() {
    try {
      const cached = await redis.get(TASK_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  async setCachedTasks(tasks, ttlSeconds = 60) {
    try {
      await redis.setex(TASK_CACHE_KEY, ttlSeconds, JSON.stringify(tasks));
    } catch (err) {
      console.warn('[Cache] Could not set task cache:', err.message);
    }
  }

  async invalidateTaskCache() {
    try {
      await redis.del(TASK_CACHE_KEY);
      await redis.del(STATS_CACHE_KEY);
    } catch (err) {
      console.warn('[Cache] Could not invalidate cache:', err.message);
    }
  }
}

const cacheService = new CacheService();

module.exports = cacheService;
