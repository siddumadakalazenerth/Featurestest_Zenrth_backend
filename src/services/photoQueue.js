const Photo = require('../models/Photo');
const Listing = require('../models/Listing');
const { runAnalysisForPhoto, updatePhotoRanking } = require('./analysisService');
const { refreshPropertyAssessment } = require('./propertyAssessmentService');

// On Vercel, a serverless function can be frozen/killed the moment its HTTP
// response is sent — there is no persistent process to keep "background"
// work alive. waitUntil() (from @vercel/functions) tells Vercel to keep the
// function instance running until the given promise settles, even after the
// response has gone out. Locally (no VERCEL env var), it just runs the
// promise normally.
let waitUntil = (promise) => promise;
if (process.env.VERCEL) {
  try {
    waitUntil = require('@vercel/functions').waitUntil;
  } catch {
    // @vercel/functions not installed — falls back to plain fire-and-forget.
  }
}

const queue = [];
const queuedIds = new Set();
let processing = false;

function enqueuePhotos(photoIds) {
  const ids = photoIds.map(String).filter((id) => {
    if (queuedIds.has(id)) return false;
    queuedIds.add(id);
    return true;
  });
  if (!ids.length) return;
  queue.push(...ids);
  waitUntil(processQueue());
}

async function analyzeOne(photoId) {
  try {
    const photo = await Photo.findById(photoId);
    if (!photo) return;
    await runAnalysisForPhoto(photo);
    await updatePhotoRanking(photo.listing);
    const [listing, photos] = await Promise.all([
      Listing.findById(photo.listing).lean(),
      Photo.find({ listing: photo.listing }).lean(),
    ]);
    if (listing) await refreshPropertyAssessment(listing, photos);
  } catch (error) {
    console.error(`[photo-queue] failed for ${photoId}:`, error.message);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    // Listings are capped at a handful of photos, so analyzing the whole
    // batch concurrently (instead of one-by-one) cuts wall-clock time from
    // "sum of every Gemini call" down to roughly "the slowest single call".
    while (queue.length > 0) {
      const batch = queue.splice(0, queue.length);
      for (const id of batch) queuedIds.delete(id);
      await Promise.all(batch.map(analyzeOne));
    }
  } finally {
    processing = false;
  }
}

async function resumePendingPhotos() {
  const pending = await Photo.find({ status: 'pending' }).sort({ createdAt: 1 }).select('_id').lean();
  enqueuePhotos(pending.map((photo) => photo._id));
}

function getQueueStatus() {
  return {
    waiting: queue.length,
    processing,
  };
}

module.exports = { enqueuePhotos, resumePendingPhotos, getQueueStatus };
