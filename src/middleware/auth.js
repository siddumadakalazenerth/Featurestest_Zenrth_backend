const User = require('../models/User');
const Listing = require('../models/Listing');
const Photo = require('../models/Photo');

// Login/signup has been removed. Every request is treated as the single
// shared workspace user, which is created on first use if it doesn't exist
// yet. This keeps controllers that read `req.user._id` / `req.user.role`
// working unchanged, without requiring anyone to sign in.
const DEFAULT_USER_EMAIL = 'workspace@local';
let cachedDefaultUserId = null;

async function getOrCreateDefaultUser() {
  if (cachedDefaultUserId) {
    const existing = await User.findById(cachedDefaultUserId);
    if (existing) return existing;
  }
  let user = await User.findOne({ email: DEFAULT_USER_EMAIL });
  if (!user) {
    user = await User.create({
      name: 'Workspace',
      email: DEFAULT_USER_EMAIL,
      passwordHash: 'unused',
      role: 'admin',
      plan: 'enterprise',
      monthlyToolLimit: 100000,
    });
  }
  cachedDefaultUserId = user._id;
  return user;
}

async function attachDefaultUser(req, res, next) {
  try {
    req.user = await getOrCreateDefaultUser();
    next();
  } catch (error) {
    next(error);
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

module.exports = { attachDefaultUser, requireListingAccess, requirePhotoAccess };
