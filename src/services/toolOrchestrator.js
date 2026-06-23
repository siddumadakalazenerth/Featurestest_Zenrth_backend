const Photo = require('../models/Photo');
const ToolJob = require('../models/ToolJob');
const AssetVersion = require('../models/AssetVersion');
const { enqueueToolJobs } = require('./toolQueue');
const User = require('../models/User');
const { reserveUsage } = require('./operationsService');

const DEFAULT_PROMPTS = {
  multi_image_analysis:
    'Review the property photo set for duplicate views, room consistency, missing context, gallery order, and best cover image.',
  floor_plan_recognition:
    'Extract visible room labels and relationships. Do not invent measurements or structural details.',
  virtual_staging:
    'Estimate room dimensions from visible reference objects and suggest furniture pieces that suit the space.',
  listing_copy:
    'Prepare accurate property copy using only confirmed listing details and analyzed visual evidence.',
  content_moderation:
    'Review for people, private information, number plates, documents, watermarks, unsafe content, and misleading edits.',
};

const GEMINI_SUPPORTED_TOOLS = [
  'photo_enhancement',
  'defurnishing',
  'smart_editing',
  'multi_image_analysis',
  'content_moderation',
  'floor_plan_recognition',
  'virtual_staging',
  'virtual_staging_render',
  'listing_copy',
  'custom_edit',
];

const IMAGE_EDIT_TOOLS = ['photo_enhancement', 'defurnishing', 'smart_editing', 'custom_edit', 'virtual_staging_render'];

async function createToolJob({ listing, action, prompt }) {
  const existing = await ToolJob.findOne({
    listing: listing._id,
    actionId: action.actionId,
    status: { $in: ['queued', 'processing', 'ready_for_review'] },
  }).sort({ createdAt: -1 });
  if (existing) return existing;

  const photo = action.photoId ? await Photo.findOne({ _id: action.photoId, listing: listing._id }) : null;
  if (action.tool === 'custom_edit' && !String(prompt || '').trim()) {
    throw new Error('Describe the change you want before applying it.');
  }
  const owner = await User.findById(listing.owner);
  if (!owner) throw new Error('Listing owner is unavailable');
  await reserveUsage(owner, listing._id, action.tool);
  const geminiSupported = GEMINI_SUPPORTED_TOOLS.includes(action.tool);
  const status = geminiSupported ? 'queued' : 'failed';
  const message = geminiSupported
    ? 'The task has been added to the Gemini workflow.'
    : 'This tool is not supported.';
  const isImageEdit = IMAGE_EDIT_TOOLS.includes(action.tool);
  const photoIssues = photo?.analysis?.issues || [];
  const obstructionIssue = action.primaryIssue || photoIssues.find((i) => /obstruct|foreground/i.test(i));
  const obstructionFallback =
    action.tool === 'smart_editing' && obstructionIssue
      ? `Remove the foreground obstruction (${obstructionIssue}) from the image. Blend the revealed area naturally with the existing background. Do not add, invent, or enlarge any property features.`
      : null;
  const derivedEditPrompt =
    prompt ||
    photo?.analysis?.recommendation?.editPrompt ||
    obstructionFallback ||
    (isImageEdit && photoIssues.length
      ? `Fix the following issues: ${photoIssues.join(', ')}. Preserve all structural elements, walls, windows, doors, flooring, and fixed fittings exactly as they are.`
      : '');
  if (isImageEdit && !derivedEditPrompt) {
    throw new Error('Re-run Gemini analysis to generate an image-specific editing plan first.');
  }

  if (photo) {
    await AssetVersion.findOneAndUpdate(
      { photo: photo._id, kind: 'original' },
      {
        listing: listing._id,
        photo: photo._id,
        kind: 'original',
        url: photo.url,
        diskPath: photo.diskPath,
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
        selected: true,
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const job = await ToolJob.create({
    listing: listing._id,
    photo: photo?._id || null,
    actionId: action.actionId,
    tool: action.tool,
    status,
    prompt: String(derivedEditPrompt || DEFAULT_PROMPTS[action.tool] || '').slice(0, 1500),
    provider: 'gemini',
    sourceUrl: photo?.url || null,
    message,
    metadata: {
      roomType: action.roomType || null,
      reasonCodes: action.reasonCodes || [],
      geminiConfidence: photo?.analysis?.recommendation?.confidence ?? null,
      preserve: photo?.analysis?.recommendation?.preserve || [],
      preserveOriginal: true,
      requiresUserApproval: true,
    },
  });
  if (status === 'queued') enqueueToolJobs([job._id]);
  return job;
}

function publicToolJob(job) {
  return {
    _id: job._id,
    tool: job.tool,
    status: job.status,
    sourceUrl: job.sourceUrl,
    resultUrl: job.resultUrl,
    resultType: job.resultType,
    resultData: job.resultData,
    message: job.message,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

function syntheticActionId(key, photoId) {
  return [key, photoId].join(':').replace(/\s+/g, '-').toLowerCase();
}

/**
 * Scenario 4/6: the seller clicks (or hovers) on any photo and types what they want
 * changed. Same truthful-edit guardrails as the Gemini-recommended actions, just with
 * a user-authored prompt instead of one Gemini derived from analysis.
 */
async function createCustomEditJob({ listing, photo, prompt }) {
  return createToolJob({
    listing,
    action: {
      actionId: syntheticActionId('custom-edit', photo._id) + ':' + Date.now(),
      tool: 'custom_edit',
      photoId: photo._id,
      roomType: photo.analysis?.roomType || null,
      reasonCodes: ['user_prompt'],
    },
    prompt,
  });
}

/**
 * Scenario 5: once the seller accepts a furniture suggestion (text, already generated),
 * immediately queue the actual staged-image render using the accepted pieces as the
 * brief — no second approval needed for *starting* the render, since accepting the
 * suggestion already was the seller's go-ahead. The render result still goes through
 * the normal accept/reject review before it replaces anything.
 */
async function createFurnishingRenderJob({ listing, photo }) {
  const suggestion = photo.furnishingSuggestion;
  if (!suggestion?.generatedAt) throw new Error('No furnishing suggestion exists for this photo yet.');
  const pieceLines = (suggestion.pieces || [])
    .map((piece) => `- ${piece.item}: ${piece.placement}`)
    .join('\n');
  const lightingLines = (suggestion.lighting || [])
    .map((l) => `- ${l.item}: ${l.placement}`)
    .join('\n');
  const wt = suggestion.windowTreatments;
  const wtLine = wt?.type ? `Window treatments: ${wt.type} in ${wt.color || 'neutral tones'}.` : '';
  const paletteLine = suggestion.colorPalette?.length
    ? `Color palette: ${suggestion.colorPalette.join(', ')}.`
    : '';
  const dims = suggestion.estimatedDimensions || {};
  const dimsLine = dims.widthMeters && dims.lengthMeters
    ? `Estimated room size: ${dims.widthMeters}m x ${dims.lengthMeters}m.`
    : '';
  const roomLabel = suggestion.roomSubtype || suggestion.roomType || photo.analysis?.roomType || 'room';
  const style = suggestion.style || 'neutral';
  // Plain item list only — no generation-sounding intro. The image service wraps
  // this with the full editing context and room-specific preservation checklist.
  const prompt = `Style: ${style}${paletteLine ? `\n${paletteLine}` : ''}
${dimsLine ? `Room size: ${dimsLine}` : ''}

Furniture to place:
${pieceLines}
${lightingLines ? `\nLighting to place:\n${lightingLines}` : ''}
${wtLine ? `\n${wtLine}` : ''}`;
  return createToolJob({
    listing,
    action: {
      actionId: syntheticActionId('virtual-staging-render', photo._id),
      tool: 'virtual_staging_render',
      photoId: photo._id,
      roomType: photo.analysis?.roomType || null,
      reasonCodes: ['furnishing_accepted'],
    },
    prompt,
  });
}

module.exports = {
  createToolJob,
  createCustomEditJob,
  createFurnishingRenderJob,
  publicToolJob,
  GEMINI_SUPPORTED_TOOLS,
};
