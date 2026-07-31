import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import { validateContract } from './schemaContract.js';

const TRAINING_RECORDS_COLLECTION = 'operator_training_records';

function normalizeTrainingRecord(snapshotDoc) {
  const raw = snapshotDoc.data();
  const data = {
    recordId: snapshotDoc.id,
    bookingId: raw.bookingId || raw.recordId || snapshotDoc.id,
    operatorId: raw.operatorId || null,
    userId: raw.userId || null,
    trainingType: raw.trainingType || raw.courseType || raw.courseName || 'GENERAL',
    trainingCode: raw.trainingCode || raw.offeringId || null,
    completedAt: raw.completedAt || raw.completionDate || null,
    dueAt: raw.dueAt || raw.dueDate || null,
    status: raw.status || 'PENDING',
    instructor: raw.instructor || raw.instructorName || null,
    result: raw.result || raw.outcome || null,
    certificateNumber: raw.certificateNumber || null,
    source: raw.source || 'web',
    notes: raw.notes || null,
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null,
    ...raw
  };

  validateContract('operator_training_records', data, 'normalizeTrainingRecord', 'read');
  return data;
}

export async function listTrainingRecordsByUser(userId) {
  if (!userId) return [];
  const recordsRef = collection(TRAINING_RECORDS_COLLECTION);
  const recordsQuery = query(recordsRef, where('userId', '==', userId));
  const snapshot = await getDocs(recordsQuery);
  return snapshot.docs.map((item) => normalizeTrainingRecord(item));
}

export async function createTrainingRecord(payload) {
  if (!payload?.userId) {
    throw new Error('userId is required to create a training record.');
  }

  const operatorId = payload.operatorId || null;
  if (!operatorId) {
    throw new Error('operatorId is required to create an operator training record.');
  }

  const nextPayload = {
    operatorId,
    userId: payload.userId,
    trainingType: payload.trainingType || 'GENERAL',
    trainingCode: payload.trainingCode || null,
    completedAt: payload.completedAt || null,
    dueAt: payload.dueAt || null,
    status: payload.status || 'PENDING',
    instructor: payload.instructor || null,
    result: payload.result || null,
    certificateNumber: payload.certificateNumber || null,
    source: payload.source || 'web',
    notes: payload.notes || null,
    readers: payload.readers || [payload.userId, operatorId],
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('operator_training_records', nextPayload, 'createTrainingRecord', 'write');
  const createdRef = await addDoc(collection(TRAINING_RECORDS_COLLECTION), nextPayload);
  await updateDoc(createdRef, { bookingId: createdRef.id, recordId: createdRef.id });
  return { recordId: createdRef.id, bookingId: createdRef.id, ...nextPayload };
}

export async function updateTrainingRecord(recordId, updates) {
  if (!recordId) {
    throw new Error('recordId is required to update a training record.');
  }

  await updateDoc(doc(TRAINING_RECORDS_COLLECTION, recordId), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export function watchTrainingRecordsByUser(userId, onNext, onError) {
  const recordsRef = collection(TRAINING_RECORDS_COLLECTION);
  const target = userId ? query(recordsRef, where('userId', '==', userId)) : recordsRef;
  return onSnapshot(
    target,
    (snapshot) => {
      onNext(snapshot.docs.map((item) => normalizeTrainingRecord(item)));
    },
    onError
  );
}
