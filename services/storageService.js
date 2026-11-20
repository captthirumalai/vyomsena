import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
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

// Immutable revision upload: bytes are hashed before upload, the object is
// re-fetched and re-hashed by an authenticated server callable, and a mismatch
// aborts the upload without relying on browser cross-origin download access.
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

  let downloadUrl = null;
  let verified = false;
  let verificationError = null;
  try {
    const verify = httpsCallable(getFunctions(), 'verifyManualRevisionChecksum');
    const result = await verify({
      companyId,
      manualId,
      storagePath: path,
      expectedSha256: sha256
    });
    verified = result.data?.verified === true;
    if (!verified) throw new Error('The server did not confirm the uploaded file checksum.');
    const downloadToken = snapshot.metadata?.downloadTokens?.[0];
    downloadUrl = buildTokenDownloadUrl(path, downloadToken) || (await getDownloadURL(targetRef));
  } catch (error) {
    verificationError = error;
  }
  if (!verified) {
    try {
      await deleteObject(targetRef);
    } catch (cleanupError) {
      console.error('Unverified revision file cleanup failed:', cleanupError);
      throw new Error(
        `Uploaded file could not be verified. Verification failed: ${verificationError?.message || 'SHA-256 mismatch.'} Cleanup failed: ${cleanupError.message || cleanupError}`
      );
    }
    throw new Error(
      verificationError
        ? `Uploaded file could not be SHA-256 verified and was removed. ${verificationError.message}`
        : 'Uploaded file failed SHA-256 verification and was removed. Please retry the upload.'
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
