import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import { validateContract, validateReadersField } from './schemaContract.js';

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function getDocumentComplianceState(document, warningDays = 30) {
  const expiry = toDateValue(document.expiryDate);
  if (!expiry) return 'Valid';

  const diff = expiry.getTime() - Date.now();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return 'Expired';
  if (days < warningDays) return 'Expiring';
  return 'Valid';
}

export async function listDocumentsByUser(userId) {
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('userId', '==', userId));
  const snapshot = await getDocs(docsQuery);
  return snapshot.docs.map((item) => {
    const data = { firestoreId: item.id, ...item.data() };
    validateContract('user_documents', data, 'listDocumentsByUser', 'read');
    validateReadersField(data, 'listDocumentsByUser', 'read');
    return data;
  });
}

export async function listDocumentsByUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  const docsRef = collection('user_documents');
  const chunks = chunk(userIds, 10);
  const snapshots = await Promise.all(chunks.map((group) => getDocs(query(docsRef, where('userId', 'in', group)))));
  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((item) => {
      const data = { firestoreId: item.id, ...item.data() };
      validateContract('user_documents', data, 'listDocumentsByUserIds', 'read');
      validateReadersField(data, 'listDocumentsByUserIds', 'read');
      return data;
    })
  );
}

export async function listReadableDocuments(readerUid) {
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('readers', 'array-contains', readerUid));
  const snapshot = await getDocs(docsQuery);
  return snapshot.docs.map((item) => {
    const data = { firestoreId: item.id, ...item.data() };
    validateContract('user_documents', data, 'listReadableDocuments', 'read');
    validateReadersField(data, 'listReadableDocuments', 'read');
    return data;
  });
}

export function groupDocumentsByUser(documents) {
  return documents.reduce((accumulator, document) => {
    const key = document.userId;
    if (!accumulator.has(key)) {
      accumulator.set(key, []);
    }
    accumulator.get(key).push(document);
    return accumulator;
  }, new Map());
}

export function summarizeCompliance(documents, warningDays = 30) {
  let expired = 0;
  let expiring = 0;

  documents.forEach((document) => {
    const status = getDocumentComplianceState(document, warningDays);
    if (status === 'Expired') expired += 1;
    else if (status === 'Expiring') expiring += 1;
  });

  return {
    expired,
    expiring,
    total: documents.length
  };
}

export async function createUserDocument(payload) {
  const documentsRef = collection('user_documents');
  const nextPayload = {
    userId: payload.userId,
    userName: payload.userName || '',
    documentCategory: payload.documentCategory || 'GENERAL',
    documentName: payload.documentName || 'Untitled Document',
    issueDate: payload.issueDate || null,
    expiryDate: payload.expiryDate || null,
    issuingAuthorityOrBody: payload.issuingAuthorityOrBody || null,
    licenseOrCertificateNumber: payload.licenseOrCertificateNumber || null,
    operatorId: payload.operatorId || null,
    readers: payload.readers || [],
    reminderLeadTimeDays: payload.reminderLeadTimeDays ?? 30,
    documentUri: payload.documentUri || null,
    storagePath: payload.storagePath || null,
    lastEditedBy: payload.lastEditedBy || null,
    lastModified: serverTimestamp()
  };

  validateContract('user_documents', nextPayload, 'createUserDocument', 'write');
  validateReadersField(nextPayload, 'createUserDocument', 'write');
  const createdRef = await addDoc(documentsRef, nextPayload);
  await updateDoc(createdRef, { firestoreId: createdRef.id });
  return { firestoreId: createdRef.id, ...nextPayload };
}

export async function updateUserDocument(documentId, updates, editedBy = null) {
  const payload = {
    ...updates,
    lastEditedBy: editedBy,
    lastModified: serverTimestamp()
  };
  validateReadersField(payload, 'updateUserDocument', 'write');
  await updateDoc(doc('user_documents', documentId), payload);
}

export async function deleteUserDocument(documentId) {
  await deleteDoc(doc('user_documents', documentId));
}

export async function appendDocumentEditLog(documentId, entry) {
  const logsRef = collection(`user_documents/${documentId}/edit_logs`);
  const payload = {
    ...entry,
    timestamp: serverTimestamp()
  };
  await addDoc(logsRef, payload);
}

export function watchDocumentsByUser(userId, onNext, onError) {
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('userId', '==', userId));
  return onSnapshot(docsQuery, onNext, onError);
}
