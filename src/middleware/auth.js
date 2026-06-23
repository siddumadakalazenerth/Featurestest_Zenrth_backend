const User = require('../models/User');
const Listing = require('../models/Listing');
const Photo = require('../models/Photo');
const { verifyToken } = require('../services/authService');

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    const payload = verifyToken(token);
    const user = await User.findOne({ _id: payload.sub, active: true });
    if (!user) return res.status(401).json({ error: 'Account is unavailable' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

async function requireListingAccess(req, res, next) {
  try {
    if (req.user.role === 'admin') return next();
    const listingId = req.params.listingId;
    if (!listingId) return next();
    const listing = await Listing.findOne({ _id: listingId, owner: req.user._id }).select('_id');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    next();
  } catch (error) {
    next(error);
  }
}

async function requirePhotoAccess(req, res, next) {
  try {
    if (req.user.role === 'admin') return next();
    // req.params.photoId isn't populated yet at app.use() level — extract from req.path instead
    const photoId = req.params.photoId || req.path.split('/').filter(Boolean)[0];
    const photo = await Photo.findById(photoId).select('listing');
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const listing = await Listing.findOne({ _id: photo.listing, owner: req.user._id }).select('_id');
    if (!listing) return res.status(404).json({ error: 'Photo not found' });
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth, requireListingAccess, requirePhotoAccess };
