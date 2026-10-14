const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      default: 'Developer',
      enum: ['Developer', 'DevOps Engineer', 'System Administrator', 'Product Manager', 'QA Specialist'],
    },
    department: {
      type: String,
      default: 'Infrastructure & Engineering',
    },
    phone: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
    },
    notificationsEnabled: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['active', 'pending_verification'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', UserSchema);
