const multer = require('multer');
const { UPLOAD_LIMITS } = require('../constants');

// Files are kept in memory (not written to disk) and then persisted to
// MongoDB Atlas via src/services/fileStore.js. Vercel's serverless
// filesystem is read-only outside /tmp, so disk storage doesn't work there.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPEG, PNG, WEBP, or HEIC.`));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.maxBytesPerFile,
    files: UPLOAD_LIMITS.maxPhotosPerListing,
  },
});

module.exports = { upload };
