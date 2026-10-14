const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { connectMongo, checkMongoHealth } = require('./mongoClient');
const { checkRedisHealth } = require('./redisClient');
const cacheService = require('./cacheService');
const scheduler = require('./scheduler');
const { seedInitialData } = require('./seedData');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Server-Sent Events (SSE) subscribers
const sseClients = new Set();

scheduler.on('event', (data) => {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
});

// SSE Stream for live task execution telemetry
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Health check endpoint (MongoDB Database + Redis Cache + Node.js API)
app.get('/api/health', async (req, res) => {
  const mongoHealth = await checkMongoHealth();
  const redisHealth = await checkRedisHealth();

  const isHealthy = mongoHealth.connected && redisHealth.connected;
  res.status(isHealthy ? 200 : 200).json({
    service: 'task-scheduler-backend',
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    architecture: {
      database: 'MongoDB (Primary Persistent Document Store)',
      cache: 'Redis (In-Memory Cache, Delayed Task Queue, Draft Store)',
    },
    tiers: {
      frontend: { status: 'healthy' },
      backend: { status: 'healthy', port: PORT },
      database: mongoHealth,
      cache: redisHealth,
    },
  });
});

// Telemetry & stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await scheduler.getStats();
    const userCount = await User.countDocuments().catch(() => 0);
    const activeDrafts = await cacheService.listActiveDrafts();
    const redisHealth = await checkRedisHealth();
    const mongoHealth = await checkMongoHealth();

    res.json({
      success: true,
      stats: {
        ...stats,
        total_users_in_mongodb: userCount,
        cached_registration_drafts: activeDrafts.length,
      },
      tiers: {
        mongodb: mongoHealth,
        redis: redisHealth,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ==========================================================================
   Redis Cache for In-Progress Registration Details (Left in middle)
   ========================================================================== */

// 1. Auto-save in-progress registration draft to Redis cache
app.post('/api/register/draft', async (req, res) => {
  try {
    const { sessionId, draftData, ttlSeconds } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required to cache draft in Redis' });
    }

    const result = await cacheService.saveRegistrationDraft(sessionId, draftData || {}, ttlSeconds || 1800);
    res.json({
      success: true,
      message: 'Registration draft auto-saved to Redis cache',
      cache_key: result.key,
      ttl_remaining_seconds: result.ttl_remaining_seconds,
      cachedAt: result.cachedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Retrieve in-progress draft from Redis cache (e.g. on page refresh/return)
app.get('/api/register/draft/:sessionId', async (req, res) => {
  try {
    const draft = await cacheService.getRegistrationDraft(req.params.sessionId);
    if (!draft) {
      return res.json({ success: true, exists: false, message: 'No cached draft found in Redis' });
    }
    res.json({
      success: true,
      exists: true,
      source: 'Redis In-Memory Cache',
      ttl_remaining_seconds: draft.ttl_remaining_seconds,
      draft,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Discard draft from Redis cache
app.delete('/api/register/draft/:sessionId', async (req, res) => {
  try {
    const deleted = await cacheService.deleteRegistrationDraft(req.params.sessionId);
    res.json({ success: true, deleted, message: 'Draft cleared from Redis cache' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. List all active registration drafts currently in Redis cache
app.get('/api/register/drafts', async (req, res) => {
  try {
    const drafts = await cacheService.listActiveDrafts();
    res.json({
      success: true,
      count: drafts.length,
      storage: 'Redis In-Memory Cache (Temporary with TTL)',
      drafts,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Finalize registration: commit to MongoDB database & evict draft from Redis cache
app.post('/api/register/complete', async (req, res) => {
  try {
    const { sessionId, name, email, role, department, phone, bio, notificationsEnabled } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    // Check if user already exists in MongoDB
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, error: 'A user with this email is already registered in MongoDB' });
    }

    // Save permanently in MongoDB
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: role || 'Developer',
      department: department || 'Infrastructure & Engineering',
      phone: phone || '',
      bio: bio || '',
      notificationsEnabled: notificationsEnabled !== false,
      status: 'active',
    });

    // Clean up temporary draft in Redis cache
    if (sessionId) {
      await cacheService.deleteRegistrationDraft(sessionId);
    }

    res.status(201).json({
      success: true,
      message: 'User successfully saved to MongoDB database! Redis registration draft evicted.',
      persisted_in: 'MongoDB',
      cache_status: 'Evicted from Redis',
      user,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. List registered users from MongoDB
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      database: 'MongoDB',
      count: users.length,
      users,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Delete user from MongoDB
app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted from MongoDB' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ==========================================================================
   Tasks & Scheduler Endpoints (MongoDB Persisted + Redis Scheduled/Cached)
   ========================================================================== */

// List all tasks (Cached in Redis, persisted in MongoDB)
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await scheduler.getAllTasks();
    res.json({ success: true, count: tasks.length, tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create task
app.post('/api/tasks', async (req, res) => {
  try {
    const { name, description, type, schedule_type, interval_seconds, delay_seconds, run_at, payload } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Task name is required' });
    }

    const task = await scheduler.createTask({
      name: name.trim(),
      description: description || '',
      type: type || 'http_ping',
      schedule_type: schedule_type || 'interval',
      interval_seconds: interval_seconds ? parseInt(interval_seconds, 10) : 60,
      delay_seconds: delay_seconds ? parseInt(delay_seconds, 10) : undefined,
      run_at: run_at || undefined,
      payload: payload || {},
    });

    res.status(201).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single task + execution logs
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await scheduler.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const logs = await scheduler.getTaskLogs(req.params.id, 20);
    res.json({ success: true, task, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger task immediately
app.post('/api/tasks/:id/run', async (req, res) => {
  try {
    const result = await scheduler.triggerTaskNow(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// Toggle pause/resume
app.post('/api/tasks/:id/toggle', async (req, res) => {
  try {
    const result = await scheduler.togglePause(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const result = await scheduler.deleteTask(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// Get task logs
app.get('/api/tasks/:id/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const logs = await scheduler.getTaskLogs(req.params.id, limit);
    res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Seed sample tasks endpoint
app.post('/api/seed', async (req, res) => {
  try {
    const { sampleTasks } = require('./seedData');
    const created = [];
    for (const item of sampleTasks) {
      const task = await scheduler.createTask(item);
      created.push(task);
    }
    res.json({ success: true, message: `Seeded ${created.length} demo tasks in MongoDB & Redis`, tasks: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend static files
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
app.listen(PORT, async () => {
  console.log(`[Backend] API Server running on port ${PORT}`);

  // Connect to MongoDB
  await connectMongo();

  // Start Redis background scheduler loop
  scheduler.start();

  // Seed sample tasks if empty
  try {
    await seedInitialData();
  } catch (err) {
    console.warn('[Seed] Delayed seed notice:', err.message);
  }
});
