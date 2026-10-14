const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/task_scheduler';

let isConnected = false;

async function connectMongo() {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`[MongoDB] Connected successfully to ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
  } catch (err) {
    isConnected = false;
    console.error('[MongoDB Error]', err.message);
  }
}

mongoose.connection.on('connected', () => {
  isConnected = true;
  console.log('[MongoDB] Connection state: Connected');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  console.error('[MongoDB] Connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('[MongoDB] Connection disconnected');
});

async function checkMongoHealth() {
  try {
    const readyState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const stateMap = { 0: 'disconnected', 1: 'healthy', 2: 'connecting', 3: 'disconnecting' };
    const ping = isConnected && readyState === 1 ? await mongoose.connection.db.admin().ping() : null;

    return {
      status: ping && ping.ok === 1 ? 'healthy' : (stateMap[readyState] || 'degraded'),
      connected: readyState === 1,
      uri: MONGO_URI.replace(/\/\/.*@/, '//***@'),
      database: mongoose.connection.name || 'task_scheduler',
    };
  } catch (err) {
    return {
      status: 'unreachable',
      connected: false,
      uri: MONGO_URI,
      error: err.message,
    };
  }
}

module.exports = {
  connectMongo,
  checkMongoHealth,
  mongoose,
};
