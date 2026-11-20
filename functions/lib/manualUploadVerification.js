const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const MAX_MANUAL_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

function validateStoragePath(storagePath, companyId, manualId) {
  if (typeof storagePath !== 'string') {
    throw new HttpsError('invalid-argument', 'A manual revision storage path is required.');
  }
  const segments = storagePath.split('/');
  if (segments.length !== 6 ||
      segments[0] !== 'manuals' ||
      segments[1] !== companyId ||
      segments[2] !== manualId ||
      segments[3] !== 'revisions' ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new HttpsError('permission-denied', 'The storage path is not a revision file belonging to this company manual.');
  }
}

async function verifyManualRevisionChecksum(bucket, { companyId, manualId, storagePath, expectedSha256 }) {
  if (!companyId || !manualId || !/^[a-f0-9]{64}$/i.test(`${expectedSha256 || ''}`)) {
    throw new HttpsError('invalid-argument', 'companyId, manualId, and a valid SHA-256 checksum are required.');
  }
  validateStoragePath(storagePath, companyId, manualId);

  const file = bucket.file(storagePath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if (error.code === 404) {
      throw new HttpsError('not-found', 'The uploaded manual revision file was not found in Storage.');
    }
    throw new HttpsError('internal', `Unable to read uploaded manual metadata from Storage (code ${error.code || 'unknown'}).`);
  }
  const size = Number(metadata.size);
  if (!Number.isFinite(size) || size < 1 || size > MAX_MANUAL_FILE_SIZE_BYTES) {
    throw new HttpsError('failed-precondition', 'The uploaded manual file is empty or exceeds the 20 MB limit.');
  }
  if (!ALLOWED_CONTENT_TYPES.has(metadata.contentType)) {
    throw new HttpsError('failed-precondition', 'The uploaded manual file has an unsupported content type.');
  }

  let bytes;
  try {
    [bytes] = await file.download();
  } catch (error) {
    throw new HttpsError('internal', `Unable to download the uploaded manual revision for checksum verification (code ${error.code || 'unknown'}).`);
  }
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new HttpsError('failed-precondition', 'The uploaded object does not match the SHA-256 checksum of the selected file.');
  }

  return { verified: true, size, contentType: metadata.contentType };
}

module.exports = { verifyManualRevisionChecksum };
