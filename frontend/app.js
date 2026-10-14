/**
 * Chronos Three-Tier Application
 * MongoDB (Primary Persistent Database) + Redis (In-Memory Cache & Drafts) + Node.js API + UI
 */

const isDevPort = window.location.port === '5000' || window.location.port === '3000';
const API_BASE = isDevPort
  ? '/api'
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000/api'
    : '/api';

// Generate or retrieve persistent registration session ID
let registrationSessionId = localStorage.getItem('chronos_reg_session_id');
if (!registrationSessionId) {
  registrationSessionId = `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
  localStorage.setItem('chronos_reg_session_id', registrationSessionId);
}

// State
let allTasks = [];
let allUsers = [];
let currentFilter = 'all';
let searchQuery = '';
let activeLogsTaskId = null;
let countdownTimerInterval = null;
let eventSource = null;
let draftDebounceTimer = null;
let activeDraftTtl = null;

// DOM Elements
const tierFrontendPill = document.getElementById('tierFrontendPill');
const tierBackendPill = document.getElementById('tierBackendPill');
const tierMongoPill = document.getElementById('tierMongoPill');
const mongoStatusText = document.getElementById('mongoStatusText');
const tierRedisPill = document.getElementById('tierRedisPill');
const redisStatusText = document.getElementById('redisStatusText');
const sseLiveBadge = document.getElementById('sseLiveBadge');

const viewTabTasks = document.getElementById('viewTabTasks');
const viewTabRegistration = document.getElementById('viewTabRegistration');
const viewTasksSection = document.getElementById('viewTasksSection');
const viewRegistrationSection = document.getElementById('viewRegistrationSection');
const navDraftBadge = document.getElementById('navDraftBadge');

const statTotalTasks = document.getElementById('statTotalTasks');
const statScheduledTasks = document.getElementById('statScheduledTasks');
const statRunningTasks = document.getElementById('statRunningTasks');
const statTotalUsers = document.getElementById('statTotalUsers');

const countAll = document.getElementById('countAll');
const countScheduled = document.getElementById('countScheduled');
const countRunning = document.getElementById('countRunning');
const countCompleted = document.getElementById('countCompleted');
const countPaused = document.getElementById('countPaused');

const filterTabs = document.getElementById('filterTabs');
const taskSearchInput = document.getElementById('taskSearchInput');
const btnRefreshTasks = document.getElementById('btnRefreshTasks');
const tasksGrid = document.getElementById('tasksGrid');
const emptyState = document.getElementById('emptyState');

// Registration Form Elements
const userRegistrationForm = document.getElementById('userRegistrationForm');
const regFullName = document.getElementById('regFullName');
const regEmail = document.getElementById('regEmail');
const regRole = document.getElementById('regRole');
const regDept = document.getElementById('regDept');
const regPhone = document.getElementById('regPhone');
const regBio = document.getElementById('regBio');
const regNotifications = document.getElementById('regNotifications');
const redisAutoSaveBadge = document.getElementById('redisAutoSaveBadge');
const cacheBadgeText = document.getElementById('cacheBadgeText');
const draftDetectedAlert = document.getElementById('draftDetectedAlert');
const draftTtlNotice = document.getElementById('draftTtlNotice');
const btnDiscardDraft = document.getElementById('btnDiscardDraft');
const btnSimulateLeave = document.getElementById('btnSimulateLeave');
const inspectorKeyName = document.getElementById('inspectorKeyName');
const inspectorTtlSec = document.getElementById('inspectorTtlSec');
const inspectorJsonPreview = document.getElementById('inspectorJsonPreview');
const redisTtlBadge = document.getElementById('redisTtlBadge');
const mongoUsersList = document.getElementById('mongoUsersList');
const mongoUserCount = document.getElementById('mongoUserCount');

// Task Modal & Drawer Elements
const btnOpenCreateModal = document.getElementById('btnOpenCreateModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelModal = document.getElementById('btnCancelModal');
const createTaskModal = document.getElementById('createTaskModal');
const createTaskForm = document.getElementById('createTaskForm');
const btnSubmitSpinner = document.getElementById('btnSubmitSpinner');
const taskTypeSelect = document.getElementById('taskTypeSelect');
const scheduleTypeSelect = document.getElementById('scheduleTypeSelect');
const intervalSecInput = document.getElementById('intervalSecInput');
const timingLabel = document.getElementById('timingLabel');
const timingHelp = document.getElementById('timingHelp');
const payloadTypeBadge = document.getElementById('payloadTypeBadge');
const dynamicPayloadFields = document.getElementById('dynamicPayloadFields');

const logsDrawer = document.getElementById('logsDrawer');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');
const drawerTaskName = document.getElementById('drawerTaskName');
const drawerTaskId = document.getElementById('drawerTaskId');
const drawerRunCount = document.getElementById('drawerRunCount');
const drawerLogsList = document.getElementById('drawerLogsList');

const btnSeedData = document.getElementById('btnSeedData');
const btnEmptySeed = document.getElementById('btnEmptySeed');
const btnEmptyCreate = document.getElementById('btnEmptyCreate');
const toastContainer = document.getElementById('toastContainer');

/* ==========================================================================
   Initialization
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateDynamicPayloadFields('http_ping');
  checkSystemHealth();
  fetchStats();
  fetchTasks();
  fetchUsers();
  checkExistingRegistrationDraft();
  initSSE();

  // Periodic health & stats refresh every 10s
  setInterval(() => {
    checkSystemHealth();
    fetchStats();
  }, 10000);

  // Live countdown ticker every 1s
  countdownTimerInterval = setInterval(updateCountdowns, 1000);
});

/* ==========================================================================
   View Navigation Switcher (Tasks vs Registration)
   ========================================================================== */
function switchView(targetView) {
  if (targetView === 'tasks') {
    viewTabTasks.classList.add('active');
    viewTabRegistration.classList.remove('active');
    viewTasksSection.classList.remove('hidden');
    viewRegistrationSection.classList.add('hidden');
  } else {
    viewTabRegistration.classList.add('active');
    viewTabTasks.classList.remove('active');
    viewRegistrationSection.classList.remove('hidden');
    viewTasksSection.classList.add('hidden');
    checkExistingRegistrationDraft();
  }
}

/* ==========================================================================
   Redis Cache: In-Progress User Registration (Left in Middle)
   ========================================================================== */
async function checkExistingRegistrationDraft() {
  inspectorKeyName.textContent = `draft:user:${registrationSessionId}`;

  try {
    const res = await fetch(`${API_BASE}/register/draft/${registrationSessionId}`);
    const data = await res.json();

    if (data.success && data.exists && data.draft) {
      const draft = data.draft;
      // Populate form with draft retrieved from Redis
      if (draft.name && !regFullName.value) regFullName.value = draft.name;
      if (draft.email && !regEmail.value) regEmail.value = draft.email;
      if (draft.role) regRole.value = draft.role;
      if (draft.department) regDept.value = draft.department;
      if (draft.phone) regPhone.value = draft.phone;
      if (draft.bio) regBio.value = draft.bio;
      if (draft.notificationsEnabled !== undefined) regNotifications.checked = draft.notificationsEnabled;

      activeDraftTtl = data.ttl_remaining_seconds;
      draftDetectedAlert.classList.remove('hidden');
      draftTtlNotice.textContent = `${Math.ceil(activeDraftTtl / 60)}m (${activeDraftTtl}s)`;
      navDraftBadge.textContent = 'Draft In Redis!';
      navDraftBadge.style.display = 'inline-block';

      updateRedisInspectorUI(draft, activeDraftTtl);
    } else {
      draftDetectedAlert.classList.add('hidden');
    }
  } catch (err) {
    console.warn('Could not check Redis draft:', err);
  }
}

function handleRegistrationInput() {
  // Clear any existing debounce timer
  clearTimeout(draftDebounceTimer);

  cacheBadgeText.textContent = 'Syncing to Redis...';
  redisAutoSaveBadge.className = 'cache-badge-live';

  draftDebounceTimer = setTimeout(async () => {
    const draftData = {
      name: regFullName.value,
      email: regEmail.value,
      role: regRole.value,
      department: regDept.value,
      phone: regPhone.value,
      bio: regBio.value,
      notificationsEnabled: regNotifications.checked,
    };

    // If completely empty, do not cache
    if (!draftData.name && !draftData.email && !draftData.bio && !draftData.phone) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/register/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: registrationSessionId,
          draftData,
          ttlSeconds: 1800, // 30 minutes in Redis
        }),
      });

      const result = await res.json();
      if (result.success) {
        cacheBadgeText.textContent = 'Saved to Redis Cache';
        redisAutoSaveBadge.className = 'cache-badge-live saved';
        activeDraftTtl = result.ttl_remaining_seconds;
        updateRedisInspectorUI(draftData, activeDraftTtl);
      }
    } catch (err) {
      cacheBadgeText.textContent = 'Redis Save Failed';
    }
  }, 350);
}

function updateRedisInspectorUI(draftData, ttlSec) {
  inspectorKeyName.textContent = `draft:user:${registrationSessionId}`;
  inspectorTtlSec.textContent = ttlSec ? `${ttlSec}s (Auto-expires in ${Math.ceil(ttlSec / 60)}m)` : '1800s';
  redisTtlBadge.textContent = 'TTL: 30m Active';
  inspectorJsonPreview.textContent = JSON.stringify(draftData, null, 2);
}

async function discardRegistrationDraft() {
  try {
    await fetch(`${API_BASE}/register/draft/${registrationSessionId}`, { method: 'DELETE' });
    userRegistrationForm.reset();
    draftDetectedAlert.classList.add('hidden');
    navDraftBadge.style.display = 'none';
    cacheBadgeText.textContent = 'Redis Cache Cleared';
    redisAutoSaveBadge.className = 'cache-badge-live';
    inspectorJsonPreview.textContent = '/* Draft evicted from Redis cache */';
    inspectorTtlSec.textContent = 'Evicted';
    showToast('Incomplete registration draft discarded from Redis cache', 'info');
  } catch (err) {
    showToast('Failed to discard draft', 'error');
  }
}

async function submitCompleteRegistration(e) {
  e.preventDefault();

  const name = regFullName.value.trim();
  const email = regEmail.value.trim();
  if (!name || !email) {
    showToast('Please enter both name and email', 'error');
    return;
  }

  const payload = {
    sessionId: registrationSessionId,
    name,
    email,
    role: regRole.value,
    department: regDept.value,
    phone: regPhone.value,
    bio: regBio.value,
    notificationsEnabled: regNotifications.checked,
  };

  try {
    const res = await fetch(`${API_BASE}/register/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Saved to MongoDB! Draft evicted from Redis.', 'success');
      userRegistrationForm.reset();
      draftDetectedAlert.classList.add('hidden');
      navDraftBadge.style.display = 'none';
      cacheBadgeText.textContent = 'Committed to MongoDB';
      redisAutoSaveBadge.className = 'cache-badge-live saved';
      inspectorJsonPreview.textContent = '/* Draft committed to MongoDB & evicted from Redis cache */';
      inspectorTtlSec.textContent = 'Evicted from Redis';

      // Generate new session ID for next registration
      registrationSessionId = `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
      localStorage.setItem('chronos_reg_session_id', registrationSessionId);
      inspectorKeyName.textContent = `draft:user:${registrationSessionId}`;

      fetchUsers();
      fetchStats();
    } else {
      showToast(data.error || 'Registration failed', 'error');
    }
  } catch (err) {
    showToast('Failed to complete registration', 'error');
  }
}

async function fetchUsers() {
  try {
    const res = await fetch(`${API_BASE}/users`);
    const data = await res.json();
    if (data.success) {
      allUsers = data.users || [];
      renderUsersList();
      statTotalUsers.textContent = allUsers.length;
      mongoUserCount.textContent = `${allUsers.length} Users`;
    }
  } catch (err) {
    console.warn('Could not load users from MongoDB:', err);
  }
}

function renderUsersList() {
  if (allUsers.length === 0) {
    mongoUsersList.innerHTML = `
      <div style="color: var(--text-dim); font-size: 0.8rem; padding: 1rem 0; text-align: center;">
        No users saved in MongoDB yet. Register a user above to see them saved in MongoDB.
      </div>
    `;
    return;
  }

  mongoUsersList.innerHTML = allUsers.map((u) => `
    <div class="user-item-card">
      <div>
        <div class="user-item-name">${escapeHtml(u.name)}</div>
        <div class="user-item-email">${escapeHtml(u.email)} • ${escapeHtml(u.department || '')}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 0.4rem;">
        <span class="user-item-role">${escapeHtml(u.role || 'Member')}</span>
        <button class="btn-action danger" onclick="deleteUser('${u._id}')" title="Delete from MongoDB">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

window.deleteUser = async function(id) {
  if (!confirm('Remove this user from MongoDB database?')) return;
  try {
    const res = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('User removed from MongoDB', 'info');
      fetchUsers();
      fetchStats();
    }
  } catch (err) {
    showToast('Failed to delete user', 'error');
  }
};

/* ==========================================================================
   Server-Sent Events (SSE) Real-Time Connection
   ========================================================================== */
function initSSE() {
  try {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`${API_BASE}/events`);

    eventSource.onopen = () => {
      sseLiveBadge.classList.remove('hidden');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleLiveEvent(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      setTimeout(initSSE, 5000);
    };
  } catch (err) {
    console.warn('SSE error:', err);
  }
}

function handleLiveEvent(evt) {
  if (evt.type === 'task_started') {
    showToast(`Task '${evt.taskName}' is executing...`, 'info');
    fetchTasks(false);
  } else if (evt.type === 'task_completed') {
    showToast(`Task '${evt.taskName}' completed successfully!`, 'success');
    fetchTasks(false);
    fetchStats();
    if (activeLogsTaskId === evt.taskId) {
      openLogsDrawer(evt.taskId, evt.taskName);
    }
  } else if (evt.type === 'task_failed') {
    showToast(`Task '${evt.taskName}' failed! Check logs.`, 'error');
    fetchTasks(false);
    fetchStats();
  } else if (evt.type === 'task_created' || evt.type === 'task_deleted' || evt.type === 'task_updated') {
    fetchTasks(false);
    fetchStats();
  }
}

/* ==========================================================================
   Multi-Tier Health & Stats API
   ========================================================================== */
async function checkSystemHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();

    tierFrontendPill.querySelector('.status-dot').className = 'status-dot healthy';
    tierBackendPill.querySelector('.status-dot').className = 'status-dot healthy';

    // MongoDB Status Pill
    const mongoDot = tierMongoPill.querySelector('.status-dot');
    if (data.tiers?.database?.connected) {
      mongoDot.className = 'status-dot healthy';
      mongoStatusText.textContent = `MongoDB (${data.tiers.database.database || 'Connected'})`;
    } else {
      mongoDot.className = 'status-dot unreachable';
      mongoStatusText.textContent = 'MongoDB (Unreachable)';
    }

    // Redis Status Pill
    const redisDot = tierRedisPill.querySelector('.status-dot');
    if (data.tiers?.cache?.connected) {
      redisDot.className = 'status-dot healthy';
      const version = data.tiers.cache.redis_version || '7.x';
      redisStatusText.textContent = `Redis (${version})`;
    } else {
      redisDot.className = 'status-dot unreachable';
      redisStatusText.textContent = 'Redis (Unreachable)';
    }
  } catch (err) {
    tierBackendPill.querySelector('.status-dot').className = 'status-dot unreachable';
    tierMongoPill.querySelector('.status-dot').className = 'status-dot unreachable';
    tierRedisPill.querySelector('.status-dot').className = 'status-dot unreachable';
  }
}

async function fetchStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    const data = await res.json();
    if (data.success && data.stats) {
      statTotalTasks.textContent = data.stats.total || 0;
      statScheduledTasks.textContent = data.stats.scheduled || 0;
      statRunningTasks.textContent = data.stats.running || 0;
      statTotalUsers.textContent = data.stats.total_users_in_mongodb || 0;
    }
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

async function fetchTasks(showSpinner = true) {
  if (showSpinner) {
    btnRefreshTasks.classList.add('spinning');
  }

  try {
    const res = await fetch(`${API_BASE}/tasks`);
    const data = await res.json();

    if (data.success) {
      allTasks = data.tasks || [];
      renderTasks();
      updateFilterCounts();
    }
  } catch (err) {
    showToast('Failed to fetch tasks', 'error');
  } finally {
    if (showSpinner) {
      setTimeout(() => btnRefreshTasks.classList.remove('spinning'), 400);
    }
  }
}

/* ==========================================================================
   Render Tasks Grid
   ========================================================================== */
function renderTasks() {
  const filtered = allTasks.filter((task) => {
    if (currentFilter !== 'all' && task.status !== currentFilter) return false;
    if (searchQuery) {
      const matchName = task.name.toLowerCase().includes(searchQuery);
      const matchDesc = (task.description || '').toLowerCase().includes(searchQuery);
      const matchType = (task.type || '').toLowerCase().includes(searchQuery);
      return matchName || matchDesc || matchType;
    }
    return true;
  });

  if (filtered.length === 0) {
    tasksGrid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  tasksGrid.innerHTML = filtered.map((task) => createTaskCardHtml(task)).join('');
  updateCountdowns();
}

function createTaskCardHtml(task) {
  const typeIcons = {
    http_ping: '🌐 Webhook / Ping',
    db_backup: '💾 DB Snapshot',
    email_alert: '✉️ Email Alert',
    cache_purge: '⚡ Cache Purge',
    report_generator: '📊 Report Gen',
    custom: '⚙️ Custom Script',
  };

  const scheduleText = task.schedule_type === 'interval'
    ? `Every ${formatSeconds(task.interval_seconds)}`
    : 'One-Time';

  const lastRunText = task.last_run_at
    ? `Last run: ${timeAgo(new Date(task.last_run_at))}`
    : 'Never run';

  const isPaused = task.status === 'paused';
  const id = task.taskId || task.id;

  return `
    <div class="task-card status-${task.status}" id="task-card-${id}" data-id="${id}" data-run-at="${task.run_at || ''}" data-status="${task.status}">
      <div>
        <div class="card-top">
          <span class="task-type-badge">${typeIcons[task.type] || task.type}</span>
          <span class="task-status-pill ${task.status}">${task.status}</span>
        </div>

        <h3 class="task-title">${escapeHtml(task.name)}</h3>
        <p class="task-desc">${escapeHtml(task.description || 'No description provided')}</p>

        <div class="timing-info-row">
          <div class="timing-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${scheduleText}</span>
          </div>
          <div class="countdown-badge" id="countdown-${id}">
            ${task.status === 'scheduled' ? 'Calculating...' : task.status}
          </div>
        </div>
      </div>

      <div class="card-footer">
        <div class="task-stats-inline">
          <span>Runs: <strong>${task.run_count || 0}</strong></span> • 
          <span>${lastRunText}</span>
        </div>

        <div class="card-actions">
          <button class="btn-action run-btn" onclick="triggerRun('${id}')" title="Trigger execution immediately">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run
          </button>
          <button class="btn-action" onclick="togglePause('${id}')" title="${isPaused ? 'Resume task' : 'Pause task'}">
            ${isPaused ? 'Resume' : 'Pause'}
          </button>
          <button class="btn-action" onclick="openLogsDrawer('${id}', '${escapeHtml(task.name)}')" title="View logs in MongoDB">
            Logs
          </button>
          <button class="btn-action danger" onclick="deleteTask('${id}')" title="Delete task">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function updateCountdowns() {
  const now = Date.now();
  const cards = document.querySelectorAll('.task-card');

  cards.forEach((card) => {
    const taskId = card.getAttribute('data-id');
    const status = card.getAttribute('data-status');
    const runAt = parseInt(card.getAttribute('data-run-at'), 10);
    const badge = document.getElementById(`countdown-${taskId}`);
    if (!badge) return;

    if (status === 'running') {
      badge.textContent = '⚡ Running...';
      badge.style.color = '#c084fc';
    } else if (status === 'paused') {
      badge.textContent = '⏸ Paused';
      badge.style.color = '#fbbf24';
    } else if (status === 'completed') {
      badge.textContent = '✓ Finished';
      badge.style.color = '#60a5fa';
    } else if (status === 'failed') {
      badge.textContent = '✕ Error';
      badge.style.color = '#f87171';
    } else if (status === 'scheduled' && runAt) {
      const diffMs = runAt - now;
      if (diffMs <= 0) {
        badge.textContent = 'Due now';
        badge.style.color = '#34d399';
      } else {
        const sec = Math.ceil(diffMs / 1000);
        badge.textContent = `In ${formatSeconds(sec)}`;
        badge.style.color = '#38bdf8';
      }
    }
  });
}

function updateFilterCounts() {
  countAll.textContent = allTasks.length;
  countScheduled.textContent = allTasks.filter((t) => t.status === 'scheduled').length;
  countRunning.textContent = allTasks.filter((t) => t.status === 'running').length;
  countCompleted.textContent = allTasks.filter((t) => t.status === 'completed').length;
  countPaused.textContent = allTasks.filter((t) => t.status === 'paused').length;
}

/* ==========================================================================
   Task Actions
   ========================================================================== */
window.triggerRun = async function (id) {
  try {
    const card = document.getElementById(`task-card-${id}`);
    if (card) card.classList.add('status-running');
    const res = await fetch(`${API_BASE}/tasks/${id}/run`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Task triggered!', 'success');
    } else {
      showToast(data.error || 'Trigger failed', 'error');
    }
  } catch (err) {
    showToast('Failed to trigger task', 'error');
  }
};

window.togglePause = async function (id) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Task is now ${data.status}`, 'info');
      fetchTasks(false);
    }
  } catch (err) {
    showToast('Failed to toggle task pause state', 'error');
  }
};

window.deleteTask = async function (id) {
  if (!confirm('Are you sure you want to delete this task from MongoDB and Redis?')) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Task removed from MongoDB & Redis', 'info');
      fetchTasks(false);
      fetchStats();
    }
  } catch (err) {
    showToast('Failed to delete task', 'error');
  }
};

window.openLogsDrawer = async function (id, taskName) {
  activeLogsTaskId = id;
  drawerTaskName.textContent = taskName;
  drawerTaskId.textContent = id;
  drawerLogsList.innerHTML = '<div style="color: var(--text-dim); padding: 1rem 0;">Loading execution logs from MongoDB & Redis...</div>';

  logsDrawer.classList.remove('hidden');
  drawerBackdrop.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/tasks/${id}/logs?limit=30`);
    const data = await res.json();
    if (data.success) {
      drawerRunCount.textContent = data.logs.length;
      if (data.logs.length === 0) {
        drawerLogsList.innerHTML = '<div style="color: var(--text-dim); padding: 1.5rem 0; text-align: center;">No execution history recorded yet.</div>';
        return;
      }

      drawerLogsList.innerHTML = data.logs.map((log) => `
        <div class="log-item">
          <div class="log-item-header">
            <span class="log-status-pill ${log.status}">${log.status}</span>
            <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()} (${log.duration_ms}ms)</span>
          </div>
          <div class="log-message">${escapeHtml(log.message || 'Execution completed')}</div>
          ${log.details && Object.keys(log.details).length > 0
            ? `<div class="log-details-block">${escapeHtml(JSON.stringify(log.details, null, 2))}</div>`
            : ''
          }
        </div>
      `).join('');
    }
  } catch (err) {
    drawerLogsList.innerHTML = '<div style="color: #f87171; padding: 1rem 0;">Failed to load logs.</div>';
  }
};

function closeLogsDrawer() {
  logsDrawer.classList.add('hidden');
  drawerBackdrop.classList.add('hidden');
  activeLogsTaskId = null;
}

/* ==========================================================================
   Modal & Dynamic Form Logic
   ========================================================================== */
function openCreateModal() {
  createTaskModal.classList.remove('hidden');
  document.getElementById('taskNameInput').focus();
}

function closeCreateModal() {
  createTaskModal.classList.add('hidden');
  createTaskForm.reset();
  updateDynamicPayloadFields('http_ping');
}

function updateDynamicPayloadFields(type) {
  const typeLabels = {
    http_ping: 'HTTP Ping',
    db_backup: 'Database Snapshot',
    email_alert: 'Email Alert',
    cache_purge: 'Cache Eviction',
    report_generator: 'Report Generation',
    custom: 'Custom Script',
  };
  payloadTypeBadge.textContent = typeLabels[type] || 'Parameters';

  let html = '';
  switch (type) {
    case 'http_ping':
      html = `
        <div class="form-group">
          <label class="form-label">Endpoint URL</label>
          <input type="url" id="payloadUrl" class="form-control" value="https://httpbin.org/status/200" required>
        </div>
        <div class="form-group">
          <label class="form-label">Timeout (ms)</label>
          <input type="number" id="payloadTimeout" class="form-control" value="5000">
        </div>
      `;
      break;

    case 'db_backup':
      html = `
        <div class="form-group">
          <label class="form-label">Database Name</label>
          <input type="text" id="payloadDatabase" class="form-control" value="production_mongodb">
        </div>
        <div class="form-group">
          <label class="form-label">Destination Path</label>
          <input type="text" id="payloadDestination" class="form-control" value="s3://backups/daily/mongo-snapshot.gz">
        </div>
      `;
      break;

    case 'email_alert':
      html = `
        <div class="form-group">
          <label class="form-label">Recipient Email</label>
          <input type="email" id="payloadTo" class="form-control" value="devops@company.internal">
        </div>
        <div class="form-group">
          <label class="form-label">Alert Subject</label>
          <input type="text" id="payloadSubject" class="form-control" value="MongoDB Cluster Health Digest">
        </div>
      `;
      break;

    case 'cache_purge':
      html = `
        <div class="form-group">
          <label class="form-label">Redis Key Pattern</label>
          <input type="text" id="payloadPattern" class="form-control" value="draft:user:*">
        </div>
      `;
      break;

    case 'report_generator':
      html = `
        <div class="form-group">
          <label class="form-label">Report Category</label>
          <select id="payloadReportType" class="form-control">
            <option value="MongoDB Query Latency & IOPS">MongoDB Query Latency & IOPS</option>
            <option value="Redis Cache Hit Ratio & Memory">Redis Cache Hit Ratio & Memory</option>
            <option value="Task Queue Throughput">Task Queue Throughput</option>
          </select>
        </div>
      `;
      break;

    case 'custom':
    default:
      html = `
        <div class="form-group">
          <label class="form-label">Script Command / JSON</label>
          <textarea id="payloadCommand" class="form-control" rows="2" placeholder='echo "Automated task run"'></textarea>
        </div>
      `;
      break;
  }

  dynamicPayloadFields.innerHTML = html;
}

function extractPayloadData(type) {
  const payload = {};
  switch (type) {
    case 'http_ping':
      payload.url = document.getElementById('payloadUrl')?.value || 'https://httpbin.org/status/200';
      payload.timeout = document.getElementById('payloadTimeout')?.value || 5000;
      break;
    case 'db_backup':
      payload.database = document.getElementById('payloadDatabase')?.value || 'primary_db';
      payload.destination = document.getElementById('payloadDestination')?.value || 's3://backups';
      break;
    case 'email_alert':
      payload.to = document.getElementById('payloadTo')?.value || 'admin@domain.internal';
      payload.subject = document.getElementById('payloadSubject')?.value || 'Notification';
      break;
    case 'cache_purge':
      payload.pattern = document.getElementById('payloadPattern')?.value || '*';
      break;
    case 'report_generator':
      payload.report_type = document.getElementById('payloadReportType')?.value || 'Summary';
      break;
    case 'custom':
      payload.command = document.getElementById('payloadCommand')?.value || '';
      break;
  }
  return payload;
}

/* ==========================================================================
   Event Listeners
   ========================================================================== */
function setupEventListeners() {
  // View Switcher
  viewTabTasks.addEventListener('click', () => switchView('tasks'));
  viewTabRegistration.addEventListener('click', () => switchView('registration'));

  // Registration auto-save on user input
  const regInputs = [regFullName, regEmail, regRole, regDept, regPhone, regBio, regNotifications];
  regInputs.forEach((input) => {
    input.addEventListener('input', handleRegistrationInput);
    input.addEventListener('change', handleRegistrationInput);
  });

  // Discard draft
  btnDiscardDraft.addEventListener('click', discardRegistrationDraft);

  // Simulate leaving and returning
  btnSimulateLeave.addEventListener('click', async () => {
    handleRegistrationInput();
    showToast('Simulating page refresh / return to draft...', 'info');
    setTimeout(() => {
      userRegistrationForm.reset();
      checkExistingRegistrationDraft();
      showToast('Draft successfully restored from Redis cache!', 'success');
    }, 600);
  });

  // Complete registration (Commit to MongoDB)
  userRegistrationForm.addEventListener('submit', submitCompleteRegistration);

  // Filter tabs
  filterTabs.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tab-btn');
    if (!tabBtn) return;
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
    tabBtn.classList.add('active');
    currentFilter = tabBtn.getAttribute('data-filter');
    renderTasks();
  });

  // Search input
  taskSearchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderTasks();
  });

  // Force refresh
  btnRefreshTasks.addEventListener('click', () => {
    checkSystemHealth();
    fetchStats();
    fetchTasks(true);
    fetchUsers();
  });

  // Modal open/close
  btnOpenCreateModal.addEventListener('click', openCreateModal);
  btnEmptyCreate.addEventListener('click', openCreateModal);
  btnCloseModal.addEventListener('click', closeCreateModal);
  btnCancelModal.addEventListener('click', closeCreateModal);

  createTaskModal.addEventListener('click', (e) => {
    if (e.target === createTaskModal) closeCreateModal();
  });

  btnCloseDrawer.addEventListener('click', closeLogsDrawer);
  drawerBackdrop.addEventListener('click', closeLogsDrawer);

  taskTypeSelect.addEventListener('change', (e) => updateDynamicPayloadFields(e.target.value));

  scheduleTypeSelect.addEventListener('change', (e) => {
    if (e.target.value === 'once') {
      timingLabel.textContent = 'Delay Before Execution (seconds)';
      timingHelp.textContent = 'The task will execute once after the specified delay, then mark completed.';
    } else {
      timingLabel.textContent = 'Repeat Interval (seconds)';
      timingHelp.textContent = 'The scheduler worker will automatically execute this task every N seconds.';
    }
  });

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      intervalSecInput.value = btn.getAttribute('data-sec');
    });
  });

  // Create Task Form Submit
  createTaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('taskNameInput').value.trim();
    const description = document.getElementById('taskDescInput').value.trim();
    const type = taskTypeSelect.value;
    const scheduleType = scheduleTypeSelect.value;
    const timingSec = parseInt(intervalSecInput.value, 10) || 30;
    const payload = extractPayloadData(type);

    btnSubmitSpinner.classList.remove('hidden');

    try {
      const body = {
        name,
        description,
        type,
        schedule_type: scheduleType,
        interval_seconds: timingSec,
        delay_seconds: scheduleType === 'once' ? timingSec : undefined,
        payload,
      };

      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        showToast(`Task '${name}' saved to MongoDB and scheduled in Redis!`, 'success');
        closeCreateModal();
        fetchTasks(false);
        fetchStats();
      } else {
        showToast(data.error || 'Failed to schedule task', 'error');
      }
    } catch (err) {
      showToast('Error sending task to server', 'error');
    } finally {
      btnSubmitSpinner.classList.add('hidden');
    }
  });

  // Seed sample tasks
  const triggerSeed = async () => {
    try {
      showToast('Loading demonstration tasks into MongoDB & Redis...', 'info');
      const res = await fetch(`${API_BASE}/seed`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Sample tasks loaded!', 'success');
        fetchTasks(false);
        fetchStats();
      } else {
        showToast('Seed failed', 'error');
      }
    } catch (err) {
      showToast('Could not seed data', 'error');
    }
  };

  btnSeedData.addEventListener('click', triggerSeed);
  btnEmptySeed.addEventListener('click', triggerSeed);
}

/* ==========================================================================
   Helpers
   ========================================================================== */
function formatSeconds(sec) {
  if (!sec || isNaN(sec)) return '0s';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function timeAgo(date) {
  if (!date || isNaN(date.getTime())) return 'Never';
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div>${escapeHtml(message)}</div>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
