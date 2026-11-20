import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getStorageInstance } from './firebaseService.js';
import { prepareDocumentFile, prepareProfilePhoto, prepareManualFile } from './uploadLimits.js';

function sanitizeFileName(fileName) {
  return `${fileName || 'document.bin'}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildUserDocumentStoragePath(userId, documentId, fileName) {
  const safeUserId = `${userId || ''}`.trim();
  const safeDocumentId = `${documentId || ''}`.trim();
  const safeFileName = sanitizeFileName(fileName);
  return `documents/${safeUserId}/${safeDocumentId}/${safeFileName}`;
}

export function buildCrewPhotoStoragePath(pilotUid, fileName) {
  const safePilotUid = `${pilotUid || ''}`.trim();
  const safeFileName = sanitizeFileName(fileName);
  return `crew_photos/${safePilotUid}/${safeFileName}`;
}

function buildTokenDownloadUrl(storagePath, token) {
  if (!token) return null;
  const bucket = getStorageInstance().app?.options?.storageBucket;
  if (!bucket) return null;
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

export async function uploadUserDocumentFile({ userId, documentId, file }) {
  if (!file) {
    throw new Error('No file selected for upload.');
  }

  const preparedFile = await prepareDocumentFile(file);

  const path = buildUserDocumentStoragePath(userId, documentId, preparedFile.name);
  const targetRef = storageRef(getStorageInstance(), path);
  const snapshot = await uploadBytes(targetRef, preparedFile);

  const downloadToken = snapshot.metadata?.downloadTokens?.[0];
  const downloadUrl = buildTokenDownloadUrl(path, downloadToken) || (await getDownloadURL(targetRef));

  return {
    storagePath: path,
    documentUri: downloadUrl
  };
}

export async function uploadCrewProfilePhoto({ pilotUid, file }) {
  if (!file) {
    throw new Error('No photo selected for upload.');
  }

  const preparedFile = await prepareProfilePhoto(file);

  const path = buildCrewPhotoStoragePath(pilotUid, preparedFile.name);
  const targetRef = storageRef(getStorageInstance(), path);
  const snapshot = await uploadBytes(targetRef, preparedFile);

  const downloadToken = snapshot.metadata?.downloadTokens?.[0];
  const downloadUrl = buildTokenDownloadUrl(path, downloadToken) || (await getDownloadURL(targetRef));

  return {
    storagePath: path,
    photoUri: downloadUrl
  };
}

export async function deleteUserDocumentFile(storagePath) {
  if (!storagePath) return;
  await deleteObject(storageRef(getStorageInstance(), storagePath));
}

export function buildCompanyManualStoragePath(companyId, manualId, fileName) {
  const safeCompanyId = `${companyId || ''}`.trim();
  const safeManualId = `${manualId || ''}`.trim();
  const safeFileName = sanitizeFileName(fileName);
  return `manuals/${safeCompanyId}/${safeManualId}/${safeFileName}`;
}

export async function uploadCompanyManual({ companyId, manualId, file }) {
  if (!companyId || !manualId) {
    throw new Error('companyId and manualId are required to upload a manual.');
  }
  if (!file) {
    throw new Error('No file selected for upload.');
  }

  const preparedFile = await prepareManualFile(file);

  const path = buildCompanyManualStoragePath(companyId, manualId, preparedFile.name);
  const targetRef = storageRef(getStorageInstance(), path);
  const snapshot = await uploadBytes(targetRef, preparedFile);

  const downloadToken = snapshot.metadata?.downloadTokens?.[0];
  const downloadUrl = buildTokenDownloadUrl(path, downloadToken) || (await getDownloadURL(targetRef));

  return {
    storagePath: path,
    documentUri: downloadUrl,
    fileName: preparedFile.name,
    size: preparedFile.size,
    contentType: preparedFile.type || null
  };
}

export async function deleteCompanyManualFile(storagePath) {
  if (!storagePath) return;
  await deleteObject(storageRef(getStorageInstance(), storagePath));
}

export function buildManualRevisionStoragePath(companyId, manualId, revisionId, fileName) {
  const safeCompanyId = `${companyId || ''}`.trim();
  const safeManualId = `${manualId || ''}`.trim();
  const safeRevisionId = `${revisionId || ''}`.trim();
  const safeFileName = sanitizeFileName(fileName);
  return `manuals/${safeCompanyId}/${safeManualId}/revisions/${safeRevisionId}/${safeFileName}`;
}

export async function computeSha256(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Returns null when the uploaded bytes cannot be re-downloaded for verification.
export async function verifyRemoteChecksum(url, expectedSha256) {
  if (!url || !expectedSha256) return null;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const actual = await computeSha256(await response.blob());
    return actual === expectedSha256;
  } catch (error) {
    console.warn('Checksum verification skipped:', error);
    return null;
  }
}

// Immutable revision upload: bytes are hashed before upload, the object is
// re-fetched and re-hashed afterwards, and a mismatch aborts the upload.
export async function uploadManualRevision({ companyId, manualId, revisionId, file }) {
  if (!companyId || !manualId || !revisionId) {
    throw new Error('companyId, manualId and revisionId are required to upload a revision.');
  }
  if (!file) {
    throw new Error('No file selected for upload.');
  }

  const preparedFile = await prepareManualFile(file);
  const sha256 = await computeSha256(preparedFile);

  const path = buildManualRevisionStoragePath(companyId, manualId, revisionId, preparedFile.name);
  const targetRef = storageRef(getStorageInstance(), path);
  const snapshot = await uploadBytes(targetRef, preparedFile);

  const downloadToken = snapshot.metadata?.downloadTokens?.[0];
  const downloadUrl = buildTokenDownloadUrl(path, downloadToken) || (await getDownloadURL(targetRef));

  const verified = await verifyRemoteChecksum(downloadUrl, sha256);
  if (verified !== true) {
    try {
      await deleteObject(targetRef);
    } catch (cleanupError) {
      console.error('Unverified revision file cleanup failed:', cleanupError);
      throw new Error(
        verified === false
          ? 'Uploaded file failed SHA-256 verification, and the invalid file could not be removed.'
          : 'Uploaded file could not be SHA-256 verified, and the unverified file could not be removed.'
      );
    }
    throw new Error(
      verified === false
        ? 'Uploaded file failed SHA-256 verification and was removed. Please retry the upload.'
        : 'Uploaded file could not be SHA-256 verified and was removed. Check storage access and retry.'
    );
  }

  return {
    storagePath: path,
    documentUri: downloadUrl,
    fileName: preparedFile.name,
    size: preparedFile.size,
    contentType: preparedFile.type || null,
    sha256,
    checksumVerified: verified
  };
}
