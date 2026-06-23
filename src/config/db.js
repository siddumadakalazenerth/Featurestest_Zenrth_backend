const dns = require('dns');
const mongoose = require('mongoose');

async function connectDB() {
  // Reuse an existing connection across warm serverless invocations instead
  // of reconnecting on every request.
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB_NAME || 'zenrth';

  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill it in.');
  }

  if (uri.startsWith('mongodb+srv://')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('[mongo] using public DNS servers for Atlas SRV resolution');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10000,
  });
  console.log(`[mongo] connected -> ${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error:', err.message);
  });

  return mongoose.connection;
}

module.exports = { connectDB };
