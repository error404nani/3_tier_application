const mongoose = require('mongoose');

const ExecutionLogSchema = new mongoose.Schema(
  {
    run_id: {
      type: String,
      required: true,
      index: true,
    },
    taskId: {
      type: String,
      required: true,
      index: true,
    },
    taskName: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },
    duration_ms: {
      type: Number,
      default: 0,
    },
    message: {
      type: String,
      default: '',
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ExecutionLog', ExecutionLogSchema);
