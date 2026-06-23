// Vercel serverless entry point.
//
// Vercel does not run a long-lived Node process, so src/server.js (which calls
// app.listen(), connects to Mongo, prints Gemini model lists, and resumes
// background queues at startup) cannot be used directly. This file exports a
// (req, res) handler instead, lazily connects to MongoDB on first invocation,
// and reuses that connection (and the Express app instance) across warm
// invocations of the same function instance.

require('dotenv').config();

const { createApp } = require('../src/app');
const { connectDB } = require('../src/config/db');

let app;
let dbConnectPromise;

function getApp() {
  if (!app) {
    app = createApp();
  }
  return app;
}

async function ensureDB() {
  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is not set on this Vercel project. Add it under Project Settings → Environment Variables and redeploy.'
    );
  }
  if (!dbConnectPromise) {
    dbConnectPromise = connectDB().catch((err) => {
      // Reset so the next invocation can retry instead of caching a failure forever.
      dbConnectPromise = undefined;
      throw err;
    });
  }
  return dbConnectPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureDB();
  } catch (err) {
    console.error('[serverless] DB connection failed:', err.message);
    // Don't crash the whole function on a DB error — let individual routes
    // (e.g. /api/health) still respond; routes needing Mongo will 500 with a
    // clear error from their own try/catch instead of a generic crash page.
  }

  return getApp()(req, res);
};
