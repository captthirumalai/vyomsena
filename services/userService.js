import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import { validateContract } from './schemaContract.js';

const ROLE_PILOT = 'PILOT';

function normalizeProfileShape(data) {
  if (!data) return data;
  const fullName = data.fullName || data.name || '';
  return {
    ...data,
    name: data.name || fullName,
    fullName
  };
}

export async function getUserByUid(uid) {
  const userRef = doc('users', uid);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) return null;
  const data = normalizeProfileShape({ uid: snapshot.id, ...snapshot.data() });
  validateContract('users', data, 'getUserByUid', 'read');
  return data;
}

export async function createUserProfile(profile) {
  const uid = profile.uid;
  const fullName = profile.fullName || profile.name || '';
  const payload = {
    uid,
    name: profile.name || fullName,
    fullName,
    email: `${profile.email || ''}`.trim().toLowerCase(),
    role: profile.role || 'OPERATIONS',
    linkedOperator: profile.linkedOperator ?? null,
    operatorType: profile.operatorType || null,
    organizationName: profile.organizationName || null,
    organizationCode: profile.organizationCode || null,
    organizationBase: profile.organizationBase || null,
    companyPhone: profile.companyPhone || null,
    createdAt: profile.createdAt || serverTimestamp()
  };

  validateContract('users', payload, 'createUserProfile', 'write');
  await setDoc(doc('users', uid), payload);
  return payload;
}

export async function createPilotProfile(profile) {
  const usersRef = collection('users');
  const fullName = profile.fullName || profile.name || '';
  const payload = {
    name: profile.name || fullName,
    fullName,
    email: `${profile.email || ''}`.trim().toLowerCase(),
    role: ROLE_PILOT,
    linkedOperator: profile.linkedOperator ?? null,
    createdAt: profile.createdAt || serverTimestamp()
  };

  validateContract('users', { uid: '(pending)', ...payload }, 'createPilotProfile', 'write');
  const createdRef = await addDoc(usersRef, payload);
  await updateDoc(createdRef, { uid: createdRef.id });
  return normalizeProfileShape({
    uid: createdRef.id,
    ...payload
  });
}

export async function updateUserProfile(uid, updates) {
  await updateDoc(doc('users', uid), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export async function listPilotsForOperator(operatorUid) {
  const usersRef = collection('users');
  const crewQuery = query(usersRef, where('linkedOperator', '==', operatorUid), where('role', '==', ROLE_PILOT));
  const snapshot = await getDocs(crewQuery);
  return snapshot.docs.map((item) => {
    const data = normalizeProfileShape({ uid: item.id, ...item.data() });
    validateContract('users', data, 'listPilotsForOperator', 'read');
    return data;
  });
}

export async function findUserByEmail(email) {
  const targetEmail = `${email || ''}`.trim().toLowerCase();
  if (!targetEmail) return null;

  const usersRef = collection('users');
  const emailQuery = query(usersRef, where('email', '==', targetEmail));
  const snapshot = await getDocs(emailQuery);
  if (snapshot.empty) return null;

  const first = snapshot.docs[0];
  const data = normalizeProfileShape({ uid: first.id, ...first.data() });
  validateContract('users', data, 'findUserByEmail', 'read');
  return data;
}

export function watchPilotsForOperator(operatorUid, onNext, onError) {
  const usersRef = collection('users');
  const crewQuery = query(usersRef, where('linkedOperator', '==', operatorUid), where('role', '==', ROLE_PILOT));
  return onSnapshot(crewQuery, onNext, onError);
}

export async function linkPilotToOperator(pilotUid, operatorUid) {
  await updateDoc(doc('users', pilotUid), {
    linkedOperator: operatorUid,
    lastModified: serverTimestamp()
  });
}

export async function unlinkPilotFromOperator(pilotUid) {
  await updateDoc(doc('users', pilotUid), {
    linkedOperator: null,
    lastModified: serverTimestamp()
  });
}

export async function findUsersByRole(role) {
  const usersRef = collection('users');
  const roleQuery = query(usersRef, where('role', '==', role));
  const snapshot = await getDocs(roleQuery);
  return snapshot.docs.map((item) => {
    const data = normalizeProfileShape({ uid: item.id, ...item.data() });
    validateContract('users', data, 'findUsersByRole', 'read');
    return data;
  });
}
