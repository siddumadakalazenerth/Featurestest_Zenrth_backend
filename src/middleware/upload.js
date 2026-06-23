const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_LIMITS } = require('../constants');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const listingDir = path.join(UPLOAD_ROOT, req.params.listingId);
    fs.mkdirSync(listingDir, { recursive: true });
    cb(null, listingDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPEG, PNG, WEBP, or HEIC.`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.maxBytesPerFile,
    files: UPLOAD_LIMITS.maxPhotosPerListing,
  },
});

module.exports = { upload, UPLOAD_ROOT };
