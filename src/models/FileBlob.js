const mongoose = require('mongoose');

// Stores uploaded/generated image bytes directly in MongoDB Atlas instead of
// on local disk. Vercel's serverless filesystem is read-only outside /tmp
// (and /tmp doesn't persist between invocations), so this is what makes
// uploads actually survive between requests in that environment.
const fileBlobSchema = new mongoose.Schema(
  {
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FileBlob', fileBlobSchema);
