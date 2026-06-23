const express = require('express');
const cors = require('cors');

const listingRoutes = require('./routes/listingRoutes');
const { listingScoped: photoListingScoped, flat: photoFlat } = require('./routes/photoRoutes');
const { errorHandler } = require('./middleware/errorHandler');
const FileBlob = require('./models/FileBlob');
const { PIPELINE, UPLOAD_LIMITS } = require('./constants');
const { getQueueStatus } = require('./services/photoQueue');
const { getToolQueueStatus } = require('./services/toolQueue');
const { attachDefaultUser, requireListingAccess, requirePhotoAccess } = require('./middleware/auth');

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    })
  );
  app.use(express.json());

  // Serve uploaded originals so the frontend can render thumbnails directly.
  app.get('/api/files/:id', async (req, res, next) => {
    try {
      const blob = await FileBlob.findById(req.params.id);
      if (!blob) return res.status(404).json({ error: 'File not found' });
      res.set('Content-Type', blob.mimeType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(blob.data);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      pipeline: PIPELINE,
      uploadLimits: UPLOAD_LIMITS,
      queue: getQueueStatus(),
      toolQueue: getToolQueueStatus(),
    });
  });

  app.use('/api/listings', attachDefaultUser, listingRoutes);
  app.use('/api/listings/:listingId/photos', attachDefaultUser, requireListingAccess, photoListingScoped);
  app.use('/api/photos', attachDefaultUser, requirePhotoAccess, photoFlat);

  app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
