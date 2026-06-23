const FileBlob = require('../models/FileBlob');

/**
 * Drop-in replacement for local-disk file storage, backed by MongoDB Atlas
 * (a FileBlob document per file). Every "diskPath" in the codebase now holds
 * a FileBlob _id string instead of a filesystem path.
 */

async function writeFile(buffer, mimeType) {
  const blob = await FileBlob.create({ data: buffer, mimeType });
  return blob._id.toString();
}

async function readFile(fileId) {
  if (!fileId) throw new Error('No file id provided to fileStore.readFile');
  const blob = await FileBlob.findById(fileId);
  if (!blob) throw new Error(`File ${fileId} not found in storage`);
  return blob.data;
}

async function getFile(fileId) {
  const blob = await FileBlob.findById(fileId);
  if (!blob) return null;
  return { buffer: blob.data, mimeType: blob.mimeType };
}

async function unlink(fileId) {
  if (!fileId) return;
  await FileBlob.deleteOne({ _id: fileId }).catch(() => {});
}

function urlFor(fileId) {
  return `/api/files/${fileId}`;
}

module.exports = { writeFile, readFile, getFile, unlink, urlFor };
