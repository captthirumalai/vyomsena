import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getStorageInstance } from './firebaseService.js';

function sanitizeFileName(fileName) {
  return `${fileName || 'document.bin'}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildUserDocumentStoragePath(userId, documentId, fileName) {
  const safeUserId = `${userId || ''}`.trim();
  const safeDocumentId = `${documentId || ''}`.trim();
  const safeFileName = sanitizeFileName(fileName);
  return `documents/${safeUserId}/${safeDocumentId}/${safeFileName}`;
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

  const path = buildUserDocumentStoragePath(userId, documentId, file.name);
  const targetRef = storageRef(getStorageInstance(), path);
  const snapshot = await uploadBytes(targetRef, file);

  const downloadToken = snapshot.metadata?.downloadTokens?.[0];
  const downloadUrl = buildTokenDownloadUrl(path, downloadToken) || (await getDownloadURL(targetRef));

  return {
    storagePath: path,
    documentUri: downloadUrl
  };
}

export async function deleteUserDocumentFile(storagePath) {
  if (!storagePath) return;
  await deleteObject(storageRef(getStorageInstance(), storagePath));
}
