const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema(
  {
    taskId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      required: true,
      enum: ['http_ping', 'db_backup', 'email_alert', 'cache_purge', 'report_generator', 'custom'],
      default: 'http_ping',
    },
    schedule_type: {
      type: String,
      enum: ['interval', 'once'],
      default: 'interval',
    },
    interval_seconds: {
      type: Number,
      default: 60,
    },
    run_at: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'running', 'completed', 'failed', 'paused'],
      default: 'scheduled',
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    run_count: {
      type: Number,
      default: 0,
    },
    last_run_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Task', TaskSchema);
