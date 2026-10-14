# 🕒 Chronos — Three-Tier Application
### MongoDB (Primary Database) + Redis (In-Memory Cache & Drafts) + Node.js API + Web UI

A full-stack, containerized three-tier application featuring a **Distributed Task Scheduler** and a **Smart Multi-Step User Registration** system using **MongoDB** for persistent storage and **Redis** for in-memory caching (specifically preserving registration forms left mid-way, query caching, and delayed task queues).

---

## 🏗️ Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│               Tier 1: Frontend (Client UI)             │
│        • Modern Dark Glassmorphic Dashboard (HTML5/CSS3)│
│        • Task Scheduler Engine with Live Countdowns    │
│        • In-Progress Registration Auto-Save to Redis   │
│        • Live SSE Telemetry & Health Badges            │
│        • Port 3000 (Served via Nginx Reverse Proxy)    │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / SSE (/api/*)
┌───────────────────────────▼────────────────────────────┐
│               Tier 2: Backend & Worker Engine          │
│        • Node.js Express REST API                      │
│        • Mongoose ORM for MongoDB Persistent Entities   │
│        • ioredis Client for Caching & Task Scheduling  │
│        • 1-second Tick Loop for Delayed Task Queue     │
│        • Port 5000 (task_scheduler_backend)            │
└─────────────┬────────────────────────────┬─────────────┘
              │ Persistent Data            │ In-Memory Cache & Drafts
┌─────────────▼──────────────┐ ┌───────────▼─────────────┐
│  Tier 3: Database (MongoDB) │ │ Tier 3: Cache (Redis 7) │
│  • localhost:27017          │ │ • Port 6379             │
│  • DB: 'task_scheduler'     │ │ • Registration Drafts   │
│  • Users Collection         │ │ • Task Query Cache      │
│  • Tasks Collection         │ │ • Delayed Queue (ZSET)  │
│  • Execution Logs History   │ │ • 30m Auto-Expiry (TTL) │
└────────────────────────────┘ └─────────────────────────┘
```

---

## ⚡ How Redis & MongoDB Work Together

### 1. In-Progress User Registration Drafts (Left in the Middle)
- As a user types into the registration form, partial inputs (`name`, `email`, `role`, `department`, `phone`, `bio`) are debounced (350ms) and cached in **Redis** via `POST /api/register/draft`.
- The Redis key `draft:user:<sessionId>` is stored using `SETEX` with a 30-minute Time-To-Live (TTL).
- If the user accidentally refreshes, leaves the tab, or comes back later, the frontend checks Redis (`GET /api/register/draft/:sessionId`) and automatically **restores their progress**!
- Once the user clicks "Save to MongoDB", the record is permanently committed to **MongoDB** (`User.create()`), and the draft is atomically evicted from **Redis** (`DEL draft:user:<sessionId>`).

### 2. Task Scheduling & Execution
- Tasks and historical execution logs are permanently stored in **MongoDB** (`tasks` and `executionlogs` collections).
- Scheduled upcoming runs are indexed in **Redis Sorted Sets (ZSET)** (`tasks:scheduled`) with millisecond timestamps as scores for high-speed atomic claiming (`ZRANGEBYSCORE` + `ZREM`).
- Task list queries are cached in Redis (`cache:tasks:all`) with a 60s TTL and invalidated immediately upon task creation/updates.

---

## 🚀 Quick Start (Docker)

Make sure Docker Desktop and MongoDB are running, then run:

### Option 1: Double-click `start.bat`
Double-click `start.bat` in the root folder. It will build and run all 3 tiers and open your browser automatically.

### Option 2: Command Line
```powershell
docker compose up --build -d
```

Once running:
- **Frontend Dashboard (Tier 1)**: [http://localhost:3000](http://localhost:3000)
- **Backend API & Health (Tier 2)**: [http://localhost:5000/api/health](http://localhost:5000/api/health)
- **MongoDB Database**: Connected to `localhost:27017/task_scheduler` (visible in MongoDB Compass!)
- **Redis Cache Database**: `localhost:6379`

To view logs:
```powershell
docker compose logs -f
```

To stop containers:
```powershell
docker compose down
```

---

## 📡 REST API Reference

### User Registration & Redis Cache Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/register/draft` | Auto-save in-progress registration draft to Redis cache (`SETEX` 1800s TTL) |
| `GET` | `/api/register/draft/:sessionId` | Retrieve cached registration draft left in the middle from Redis |
| `DELETE` | `/api/register/draft/:sessionId` | Evict draft from Redis cache |
| `GET` | `/api/register/drafts` | Inspect all active cached drafts in Redis |
| `POST` | `/api/register/complete` | Commit user to **MongoDB database** and evict draft from **Redis** |
| `GET` | `/api/users` | List registered users from **MongoDB** |
| `DELETE` | `/api/users/:id` | Delete user from **MongoDB** |

### Task Scheduler Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Multi-tier health check (Frontend, Node.js API, MongoDB, Redis) |
| `GET` | `/api/stats` | Telemetry counters (Tasks, Active, Running, MongoDB Users, Redis Drafts) |
| `GET` | `/api/tasks` | List all tasks (cached in Redis, persisted in MongoDB) |
| `POST` | `/api/tasks` | Create and schedule a task (saves to MongoDB & Redis) |
| `GET` | `/api/tasks/:id` | Task details and historical execution logs |
| `POST` | `/api/tasks/:id/run` | Force immediate run |
| `POST` | `/api/tasks/:id/toggle` | Pause or resume task |
| `DELETE` | `/api/tasks/:id` | Remove task and logs from MongoDB and Redis |
| `POST` | `/api/seed` | Seed realistic demo jobs |
| `GET` | `/api/events` | Server-Sent Events (SSE) live execution telemetry stream |
