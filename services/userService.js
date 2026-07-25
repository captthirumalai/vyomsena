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

export async function getUserByUid(uid) {
  const userRef = doc('users', uid);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) return null;
  const data = { uid: snapshot.id, ...snapshot.data() };
  validateContract('users', data, 'getUserByUid', 'read');
  return data;
}

export async function createUserProfile(profile) {
  const uid = profile.uid;
  const payload = {
    uid,
    name: profile.name || '',
    email: profile.email || '',
    role: profile.role || 'OPERATIONS',
    linkedOperator: profile.linkedOperator ?? null,
    createdAt: profile.createdAt || serverTimestamp()
  };

  validateContract('users', payload, 'createUserProfile', 'write');
  await setDoc(doc('users', uid), payload);
  return payload;
}

export async function createPilotProfile(profile) {
  const usersRef = collection('users');
  const payload = {
    name: profile.name || '',
    email: profile.email || '',
    role: ROLE_PILOT,
    linkedOperator: profile.linkedOperator ?? null,
    createdAt: profile.createdAt || serverTimestamp()
  };

  validateContract('users', { uid: '(pending)', ...payload }, 'createPilotProfile', 'write');
  const createdRef = await addDoc(usersRef, payload);
  await updateDoc(createdRef, { uid: createdRef.id });
  return {
    uid: createdRef.id,
    ...payload
  };
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
    const data = { uid: item.id, ...item.data() };
    validateContract('users', data, 'listPilotsForOperator', 'read');
    return data;
  });
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
    const data = { uid: item.id, ...item.data() };
    validateContract('users', data, 'findUsersByRole', 'read');
    return data;
  });
}
