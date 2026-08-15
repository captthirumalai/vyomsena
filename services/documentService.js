import {
  collection,
  query,
  where,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import { validateContract, validateReadersField } from './schemaContract.js';

const EDIT_LOG_FIELDS = [
  'documentName',
  'documentCategory',
  'licenseOrCertificateNumber',
  'issueDate',
  'expiryDate',
  'issuingAuthorityOrBody',
  'reminderLeadTimeDays',
  'notesOrRemarks',
  'notesOrDetails'
];
const DENORMALIZED_AUDIT_LIMIT = 20;

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

function normalizeComparableValue(value) {
  if (value === undefined) return null;
  if (value?.toDate) {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === 'string' || typeof value === 'number' || value === null) {
    return value;
  }
  return JSON.stringify(value);
}

function pickLatestTemporalValue(leftValue, rightValue) {
  if (!leftValue) return rightValue || null;
  if (!rightValue) return leftValue;

  const leftDate = toDateValue(leftValue);
  const rightDate = toDateValue(rightValue);

  if (!leftDate) return rightValue;
  if (!rightDate) return leftValue;
  return leftDate.getTime() >= rightDate.getTime() ? leftValue : rightValue;
}

function preferLocalEditableValue(localValue, remoteValue) {
  if (localValue === undefined || localValue === null) {
    return remoteValue ?? null;
  }

  if (typeof localValue === 'string') {
    return localValue.trim().length ? localValue : remoteValue ?? localValue;
  }

  return localValue;
}

function dedupeByFirestoreId(documents) {
  const map = new Map();
  documents.forEach((item) => {
    if (!item?.firestoreId) return;
    map.set(item.firestoreId, item);
  });
  return Array.from(map.values());
}

export function mergeConflictingDocuments(localDoc, remoteDoc) {
  if (!localDoc) return remoteDoc;
  if (!remoteDoc) return localDoc;

  return {
    ...remoteDoc,
    issueDate: pickLatestTemporalValue(localDoc.issueDate, remoteDoc.issueDate),
    expiryDate: pickLatestTemporalValue(localDoc.expiryDate, remoteDoc.expiryDate),
    licenseOrCertificateNumber: preferLocalEditableValue(
      localDoc.licenseOrCertificateNumber,
      remoteDoc.licenseOrCertificateNumber
    ),
    issuingAuthorityOrBody: preferLocalEditableValue(localDoc.issuingAuthorityOrBody, remoteDoc.issuingAuthorityOrBody),
    notesOrDetails: preferLocalEditableValue(localDoc.notesOrDetails, remoteDoc.notesOrDetails),
    documentUri: preferLocalEditableValue(localDoc.documentUri, remoteDoc.documentUri),
    lastEditedBy: localDoc.lastEditedBy || remoteDoc.lastEditedBy || null,
    isDirty: false
  };
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

export async function getUserDocumentById(documentId) {
  const snapshot = await getDoc(doc('user_documents', documentId));
  if (!snapshot.exists()) return null;

  const data = { firestoreId: snapshot.id, ...snapshot.data() };
  validateContract('user_documents', data, 'getUserDocumentById', 'read');
  validateReadersField(data, 'getUserDocumentById', 'read');
  return data;
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

export async function listManagedDocuments(operatorUid) {
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('operatorId', '==', operatorUid));
  const snapshot = await getDocs(docsQuery);
  return snapshot.docs.map((item) => {
    const data = { firestoreId: item.id, ...item.data() };
    validateContract('user_documents', data, 'listManagedDocuments', 'read');
    validateReadersField(data, 'listManagedDocuments', 'read');
    return data;
  });
}

export async function listAccessibleDocuments(userUid) {
  const [owned, readable, managed] = await Promise.all([
    listDocumentsByUser(userUid),
    listReadableDocuments(userUid),
    listManagedDocuments(userUid)
  ]);
  return dedupeByFirestoreId([...owned, ...readable, ...managed]);
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
  const explicitId = payload.firestoreId || payload.documentId || null;
  const nextPayload = {
    userId: payload.userId,
    userName: payload.userName || '',
    documentCategory: payload.documentCategory || 'GENERAL',
    documentName: payload.documentName || 'Untitled Document',
    issueDate: payload.issueDate || null,
    expiryDate: payload.expiryDate || null,
    issuingAuthorityOrBody: payload.issuingAuthorityOrBody || null,
    licenseOrCertificateNumber: payload.licenseOrCertificateNumber || null,
    notesOrRemarks: payload.notesOrRemarks || null,
    operatorId: payload.operatorId || null,
    readers: payload.readers || [],
    reminderLeadTimeDays: payload.reminderLeadTimeDays ?? 30,
    documentUri: payload.documentUri || null,
    storagePath: payload.storagePath || null,
    isDirty: payload.isDirty ?? false,
    lastEditedBy: payload.lastEditedBy || null,
    lastModified: serverTimestamp()
  };

  validateContract('user_documents', nextPayload, 'createUserDocument', 'write');
  validateReadersField(nextPayload, 'createUserDocument', 'write');

  if (explicitId) {
    const targetDocRef = doc('user_documents', explicitId);
    await setDoc(targetDocRef, nextPayload);
    await updateDoc(targetDocRef, { firestoreId: explicitId });
    return { firestoreId: explicitId, ...nextPayload };
  }

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

export async function updateUserDocumentWithAudit(documentId, updates, editedBy = null) {
  const docRef = doc('user_documents', documentId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Document ${documentId} not found.`);
  }

  const before = { firestoreId: snapshot.id, ...snapshot.data() };
  const normalizedUpdates = { ...updates, isDirty: updates.isDirty ?? false };

  const changedFields = EDIT_LOG_FIELDS.filter((fieldName) => {
    if (!(fieldName in normalizedUpdates)) return false;
    const oldValue = normalizeComparableValue(before[fieldName]);
    const newValue = normalizeComparableValue(normalizedUpdates[fieldName]);
    return oldValue !== newValue;
  });

  if (changedFields.length > 0) {
    const auditTimestamp = new Date().toISOString();
    const recentAudit = Array.isArray(before.recentAudit) ? before.recentAudit : [];
    const nextEntries = changedFields.map((fieldName) => ({
      field: fieldName,
      oldValue: before[fieldName] ?? null,
      newValue: normalizedUpdates[fieldName] ?? null,
      editedBy: editedBy || null,
      source: 'web',
      timestamp: auditTimestamp
    }));

    normalizedUpdates.recentAudit = [...nextEntries, ...recentAudit].slice(0, DENORMALIZED_AUDIT_LIMIT);
    normalizedUpdates.lastEditLog = nextEntries[0];
  }

  await updateUserDocument(documentId, normalizedUpdates, editedBy);

  await Promise.all(
    changedFields.map((fieldName) =>
      appendDocumentEditLog(documentId, {
        field: fieldName,
        oldValue: before[fieldName] ?? null,
        newValue: normalizedUpdates[fieldName] ?? null,
        editedBy: editedBy || null,
        source: 'web'
      })
    )
  );
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

export function watchDocumentsByUserIds(userIds, onNext, onError) {
  const ids = Array.isArray(userIds) ? [...new Set(userIds.filter(Boolean))] : [];
  if (ids.length === 0) {
    onNext({ docs: [] });
    return () => {};
  }
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('userId', 'in', ids));
  return onSnapshot(docsQuery, onNext, onError);
}

export function watchAccessibleDocuments(userUid, onNext, onError) {
  const docsRef = collection('user_documents');
  const state = {
    owned: [],
    readable: [],
    managed: []
  };

  const emit = () => {
    onNext(dedupeByFirestoreId([...state.owned, ...state.readable, ...state.managed]));
  };

  const unsubOwned = onSnapshot(
    query(docsRef, where('userId', '==', userUid)),
    (snapshot) => {
      state.owned = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      emit();
    },
    onError
  );

  const unsubReadable = onSnapshot(
    query(docsRef, where('readers', 'array-contains', userUid)),
    (snapshot) => {
      state.readable = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      emit();
    },
    onError
  );

  const unsubManaged = onSnapshot(
    query(docsRef, where('operatorId', '==', userUid)),
    (snapshot) => {
      state.managed = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      emit();
    },
    onError
  );

  return () => {
    unsubOwned?.();
    unsubReadable?.();
    unsubManaged?.();
  };
}
