import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from './firestoreService.js';
import { validateContract } from './schemaContract.js';

const COLLECTION = 'access_codes';

function normalizeDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function buildAccessCode(ttlMinutes = 15) {
  const max = 999999;
  const min = 100000;
  const code = Math.floor(Math.random() * (max - min + 1)) + min;
  const expiresAt = new Date(Date.now() + Math.max(1, ttlMinutes) * 60 * 1000);
  return {
    code: `${code}`,
    expiresAt
  };
}

export async function createAccessCode({ pilotId, operatorId = null, ttlMinutes = 15 }) {
  const generated = buildAccessCode(ttlMinutes);
  const payload = {
    code: generated.code,
    pilotId,
    operatorId,
    expiresAt: generated.expiresAt,
    createdAt: serverTimestamp()
  };

  validateContract('access_codes', payload, 'createAccessCode', 'write');
  const ref = await addDoc(collection(COLLECTION), payload);
  return {
    accessCodeId: ref.id,
    ...payload
  };
}

export async function listAccessCodesByPilot(pilotId) {
  const refs = collection(COLLECTION);
  const codeQuery = query(refs, where('pilotId', '==', pilotId));
  const snapshot = await getDocs(codeQuery);
  return snapshot.docs.map((item) => {
    const data = { accessCodeId: item.id, ...item.data() };
    validateContract('access_codes', data, 'listAccessCodesByPilot', 'read');
    return data;
  });
}

export async function verifyAccessCode({ pilotId, code }) {
  const refs = collection(COLLECTION);
  const codeQuery = query(refs, where('pilotId', '==', pilotId), where('code', '==', `${code}`));
  const snapshot = await getDocs(codeQuery);
  if (snapshot.empty) {
    return { valid: false, reason: 'NOT_FOUND' };
  }

  const record = { accessCodeId: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  validateContract('access_codes', record, 'verifyAccessCode', 'read');

  const expiresAt = normalizeDate(record.expiresAt?.toDate ? record.expiresAt.toDate() : record.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: 'EXPIRED', record };
  }

  return { valid: true, record };
}

export async function deleteAccessCode(accessCodeId) {
  await deleteDoc(doc(COLLECTION, accessCodeId));
}

export async function cleanupExpiredAccessCodes() {
  const refs = collection(COLLECTION);
  const snapshot = await getDocs(refs);
  const now = Date.now();

  const expired = snapshot.docs
    .map((item) => ({ accessCodeId: item.id, ...item.data() }))
    .filter((item) => {
      const expiresAt = normalizeDate(item.expiresAt?.toDate ? item.expiresAt.toDate() : item.expiresAt);
      return expiresAt && expiresAt.getTime() <= now;
    });

  await Promise.all(expired.map((item) => deleteDoc(doc(COLLECTION, item.accessCodeId))));
  return expired.length;
}
