const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const { redis } = require('./redisClient');
const cacheService = require('./cacheService');
const { executeTask } = require('./executor');
const Task = require('./models/Task');
const ExecutionLog = require('./models/ExecutionLog');

class TaskScheduler extends EventEmitter {
  constructor() {
    super();
    this.intervalHandle = null;
    this.isTicking = false;
  }

  start() {
    if (this.intervalHandle) return;
    console.log('[Scheduler] Background worker engine initialized. Checking queue every 1000ms...');
    this.intervalHandle = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const now = Date.now();
      // Fetch up to 10 tasks that are due (score <= now)
      const dueTaskIds = await redis.zrangebyscore('tasks:scheduled', '-inf', now, 'LIMIT', 0, 10);

      if (dueTaskIds && dueTaskIds.length > 0) {
        for (const taskId of dueTaskIds) {
          // Atomically remove from scheduled ZSET to claim task
          const removed = await redis.zrem('tasks:scheduled', taskId);
          if (removed > 0) {
            this.processTask(taskId);
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler Error in Tick]', err.message);
    } finally {
      this.isTicking = false;
    }
  }

  async processTask(taskId) {
    try {
      const task = await this.getTaskById(taskId);
      if (!task) return;

      if (task.status === 'paused') {
        console.log(`[Scheduler] Task ${taskId} (${task.name}) is paused. Skipping.`);
        return;
      }

      // Mark status as running
      const lastRunAt = new Date();
      await redis.hset(`task:${taskId}`, {
        status: 'running',
        last_run_at: lastRunAt.toISOString(),
      });

      // Update in MongoDB
      Task.findOneAndUpdate({ taskId }, { status: 'running', last_run_at: lastRunAt }).catch(() => {});

      await cacheService.invalidateTaskCache();
      this.emit('event', { type: 'task_started', taskId, taskName: task.name, timestamp: lastRunAt.toISOString() });

      // Execute task
      const result = await executeTask(task);

      // Save log to MongoDB ExecutionLog collection
      try {
        await ExecutionLog.create({
          run_id: result.run_id,
          taskId,
          taskName: task.name,
          type: task.type,
          status: result.status,
          duration_ms: result.duration_ms,
          message: result.message,
          details: result.details,
          timestamp: new Date(result.timestamp),
        });
      } catch (logErr) {
        console.warn('[MongoDB] Log save warning:', logErr.message);
      }

      // Append log entry to Redis cache (keep last 50 runs)
      await redis.lpush(`task:${taskId}:logs`, JSON.stringify(result));
      await redis.ltrim(`task:${taskId}:logs`, 0, 49);

      // Increment run count
      const newRunCount = await redis.hincrby(`task:${taskId}`, 'run_count', 1);

      // Determine next state
      if (task.schedule_type === 'interval' && task.interval_seconds > 0) {
        // Reschedule for next interval
        const nextRunAt = Date.now() + parseInt(task.interval_seconds, 10) * 1000;
        await redis.hset(`task:${taskId}`, {
          status: 'scheduled',
          run_at: nextRunAt,
        });
        await redis.zadd('tasks:scheduled', nextRunAt, taskId);

        // Update in MongoDB
        await Task.findOneAndUpdate(
          { taskId },
          { status: 'scheduled', run_at: nextRunAt, run_count: newRunCount, last_run_at: lastRunAt }
        ).catch(() => {});

        await cacheService.invalidateTaskCache();
        this.emit('event', {
          type: result.status === 'success' ? 'task_completed' : 'task_failed',
          taskId,
          taskName: task.name,
          result,
          nextRunAt,
          runCount: newRunCount,
        });
      } else {
        // One-time task completed
        const finalStatus = result.status === 'success' ? 'completed' : 'failed';
        await redis.hset(`task:${taskId}`, {
          status: finalStatus,
        });

        // Update in MongoDB
        await Task.findOneAndUpdate(
          { taskId },
          { status: finalStatus, run_count: newRunCount, last_run_at: lastRunAt }
        ).catch(() => {});

        await cacheService.invalidateTaskCache();
        this.emit('event', {
          type: result.status === 'success' ? 'task_completed' : 'task_failed',
          taskId,
          taskName: task.name,
          result,
          runCount: newRunCount,
        });
      }
    } catch (err) {
      console.error(`[Scheduler] Error processing task ${taskId}:`, err.message);
      await redis.hset(`task:${taskId}`, { status: 'failed' }).catch(() => {});
      Task.findOneAndUpdate({ taskId }, { status: 'failed' }).catch(() => {});
    }
  }

  async createTask(data) {
    const taskId = data.taskId || uuidv4();
    const now = Date.now();
    const createdAt = new Date().toISOString();

    const scheduleType = data.schedule_type || 'interval';
    let runAt = now;

    if (data.delay_seconds) {
      runAt = now + parseInt(data.delay_seconds, 10) * 1000;
    } else if (data.run_at) {
      runAt = new Date(data.run_at).getTime();
      if (isNaN(runAt) || runAt < now) {
        runAt = now + 5000;
      }
    } else if (scheduleType === 'interval' && data.interval_seconds) {
      runAt = now + parseInt(data.interval_seconds, 10) * 1000;
    }

    const taskObj = {
      taskId,
      name: data.name || 'Untitled Task',
      description: data.description || '',
      type: data.type || 'http_ping',
      schedule_type: scheduleType,
      interval_seconds: data.interval_seconds ? parseInt(data.interval_seconds, 10) : 60,
      run_at: runAt,
      status: 'scheduled',
      payload: JSON.stringify(data.payload || {}),
      created_at: createdAt,
      last_run_at: '',
      run_count: 0,
    };

    // Save in Redis Hash & ZSET
    await redis.hset(`task:${taskId}`, taskObj);
    await redis.sadd('tasks:all', taskId);
    await redis.zadd('tasks:scheduled', runAt, taskId);

    // Save persistently in MongoDB
    try {
      await Task.findOneAndUpdate(
        { taskId },
        {
          taskId,
          name: taskObj.name,
          description: taskObj.description,
          type: taskObj.type,
          schedule_type: taskObj.schedule_type,
          interval_seconds: taskObj.interval_seconds,
          run_at: taskObj.run_at,
          status: taskObj.status,
          payload: data.payload || {},
          run_count: 0,
        },
        { upsert: true, new: true }
      );
    } catch (mongoErr) {
      console.warn('[MongoDB] Task persist warning:', mongoErr.message);
    }

    await cacheService.invalidateTaskCache();
    this.emit('event', { type: 'task_created', taskId, task: taskObj });

    return this.getTaskById(taskId);
  }

  async getAllTasks() {
    // 1. Try Redis cache first
    const cached = await cacheService.getCachedTasks();
    if (cached) {
      return cached;
    }

    // 2. Fetch from Redis keys
    const ids = await redis.smembers('tasks:all');
    let tasks = [];

    if (ids && ids.length > 0) {
      for (const id of ids) {
        const task = await this.getTaskById(id);
        if (task) {
          tasks.push(task);
        }
      }
    } else {
      // 3. Fallback: if Redis empty, hydrate from MongoDB
      try {
        const mongoTasks = await Task.find({}).sort({ run_at: 1 }).lean();
        if (mongoTasks.length > 0) {
          tasks = mongoTasks.map((t) => ({
            ...t,
            id: t.taskId,
          }));
          // Re-populate Redis
          for (const t of mongoTasks) {
            await redis.sadd('tasks:all', t.taskId);
            await redis.hset(`task:${t.taskId}`, {
              taskId: t.taskId,
              name: t.name,
              description: t.description || '',
              type: t.type,
              schedule_type: t.schedule_type,
              interval_seconds: t.interval_seconds,
              run_at: t.run_at,
              status: t.status,
              payload: JSON.stringify(t.payload || {}),
              run_count: t.run_count || 0,
              last_run_at: t.last_run_at ? new Date(t.last_run_at).toISOString() : '',
            });
            if (t.status === 'scheduled') {
              await redis.zadd('tasks:scheduled', t.run_at, t.taskId);
            }
          }
        }
      } catch (err) {
        console.warn('[MongoDB] Query fallback error:', err.message);
      }
    }

    // Sort by run_at ascending
    tasks.sort((a, b) => (parseInt(a.run_at, 10) || 0) - (parseInt(b.run_at, 10) || 0));

    // Cache in Redis for 30s
    await cacheService.setCachedTasks(tasks, 30);

    return tasks;
  }

  async getTaskById(id) {
    const data = await redis.hgetall(`task:${id}`);
    if (data && Object.keys(data).length > 0) {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(data.payload || '{}');
      } catch {
        parsedPayload = {};
      }

      return {
        ...data,
        id: data.taskId || id,
        run_at: parseInt(data.run_at, 10) || null,
        interval_seconds: parseInt(data.interval_seconds, 10) || 0,
        run_count: parseInt(data.run_count, 10) || 0,
        payload: parsedPayload,
      };
    }

    // Try MongoDB
    try {
      const doc = await Task.findOne({ taskId: id }).lean();
      if (doc) {
        return {
          ...doc,
          id: doc.taskId,
        };
      }
    } catch {}

    return null;
  }

  async getTaskLogs(id, limit = 20) {
    // Try Redis list first
    const rawLogs = await redis.lrange(`task:${id}:logs`, 0, limit - 1);
    if (rawLogs && rawLogs.length > 0) {
      return rawLogs.map((log) => {
        try {
          return JSON.parse(log);
        } catch {
          return { message: log };
        }
      });
    }

    // Fallback to MongoDB
    try {
      const logs = await ExecutionLog.find({ taskId: id }).sort({ timestamp: -1 }).limit(limit).lean();
      return logs;
    } catch {
      return [];
    }
  }

  async triggerTaskNow(id) {
    const task = await this.getTaskById(id);
    if (!task) throw new Error('Task not found');

    await redis.zrem('tasks:scheduled', id);
    this.processTask(id);
    return { success: true, message: `Task '${task.name}' triggered immediately` };
  }

  async togglePause(id) {
    const task = await this.getTaskById(id);
    if (!task) throw new Error('Task not found');

    if (task.status === 'paused') {
      const nextRunAt = Date.now() + (task.interval_seconds ? task.interval_seconds * 1000 : 5000);
      await redis.hset(`task:${id}`, { status: 'scheduled', run_at: nextRunAt });
      await redis.zadd('tasks:scheduled', nextRunAt, id);
      await Task.findOneAndUpdate({ taskId: id }, { status: 'scheduled', run_at: nextRunAt }).catch(() => {});
      await cacheService.invalidateTaskCache();
      this.emit('event', { type: 'task_updated', taskId: id, status: 'scheduled', nextRunAt });
      return { status: 'scheduled', nextRunAt };
    } else {
      await redis.zrem('tasks:scheduled', id);
      await redis.hset(`task:${id}`, { status: 'paused' });
      await Task.findOneAndUpdate({ taskId: id }, { status: 'paused' }).catch(() => {});
      await cacheService.invalidateTaskCache();
      this.emit('event', { type: 'task_updated', taskId: id, status: 'paused' });
      return { status: 'paused' };
    }
  }

  async deleteTask(id) {
    await redis.zrem('tasks:scheduled', id);
    await redis.srem('tasks:all', id);
    await redis.del(`task:${id}`);
    await redis.del(`task:${id}:logs`);
    await Task.findOneAndDelete({ taskId: id }).catch(() => {});
    await ExecutionLog.deleteMany({ taskId: id }).catch(() => {});
    await cacheService.invalidateTaskCache();
    this.emit('event', { type: 'task_deleted', taskId: id });
    return { success: true, id };
  }

  async getStats() {
    const tasks = await this.getAllTasks();
    const stats = {
      total: tasks.length,
      scheduled: 0,
      running: 0,
      completed: 0,
      failed: 0,
      paused: 0,
      total_runs: 0,
    };

    tasks.forEach((t) => {
      if (stats[t.status] !== undefined) {
        stats[t.status]++;
      }
      stats.total_runs += parseInt(t.run_count, 10) || 0;
    });

    return stats;
  }
}

const scheduler = new TaskScheduler();

module.exports = scheduler;
