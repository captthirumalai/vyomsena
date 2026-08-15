import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import { validateContract } from './schemaContract.js';

const CREW_PROFILES = 'crew_profiles';

function normalizeCrewProfile(snapshotDoc) {
  const raw = snapshotDoc.data();
  const data = {
    crewProfileId: snapshotDoc.id,
    uid: raw.uid || snapshotDoc.id,
    operatorId: raw.operatorId || null,
    pilotUid: raw.pilotUid || null,
    linkState: raw.linkState || 'UNLINKED',
    name: raw.name || raw.fullName || '',
    fullName: raw.fullName || raw.name || '',
    email: raw.email || null,
    role: raw.role || 'PILOT',
    status: raw.status || 'Active',
    designation: raw.designation || null,
    organizationBase: raw.organizationBase || raw.base || null,
    base: raw.base || raw.organizationBase || null,
    mobile: raw.mobile || null,
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null,
    ...raw
  };

  validateContract('crew_profiles', data, 'normalizeCrewProfile', 'read');
  return data;
}

export async function listCrewProfilesForOperator(operatorId) {
  if (!operatorId) return [];
  const profilesRef = collection(CREW_PROFILES);
  const profilesQuery = query(profilesRef, where('operatorId', '==', operatorId));
  const snapshot = await getDocs(profilesQuery);
  return snapshot.docs.map((item) => normalizeCrewProfile(item));
}

export async function getCrewProfileById(crewProfileId) {
  if (!crewProfileId) return null;
  const snapshot = await getDoc(doc(CREW_PROFILES, crewProfileId));
  if (!snapshot.exists()) return null;
  return normalizeCrewProfile(snapshot);
}

export async function createCrewProfile(payload) {
  if (!payload?.operatorId) {
    throw new Error('operatorId is required to create crew profile.');
  }

  const nextPayload = {
    operatorId: payload.operatorId,
    pilotUid: payload.pilotUid || null,
    linkState: payload.linkState || 'UNLINKED',
    name: payload.name || payload.fullName || 'Unnamed Crew',
    fullName: payload.fullName || payload.name || 'Unnamed Crew',
    email: `${payload.email || ''}`.trim().toLowerCase() || null,
    role: payload.role || 'PILOT',
    status: payload.status || 'Active',
    designation: payload.designation || null,
    organizationBase: payload.organizationBase || payload.base || null,
    base: payload.base || payload.organizationBase || null,
    mobile: payload.mobile || null,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('crew_profiles', nextPayload, 'createCrewProfile', 'write');
  const createdRef = await addDoc(collection(CREW_PROFILES), nextPayload);
  await updateDoc(createdRef, { crewProfileId: createdRef.id, uid: createdRef.id });
  return {
    crewProfileId: createdRef.id,
    uid: createdRef.id,
    ...nextPayload
  };
}

export async function updateCrewProfile(crewProfileId, updates) {
  if (!crewProfileId) {
    throw new Error('crewProfileId is required to update crew profile.');
  }

  await updateDoc(doc(CREW_PROFILES, crewProfileId), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export async function deleteCrewProfile(crewProfileId) {
  if (!crewProfileId) {
    throw new Error('crewProfileId is required to delete crew profile.');
  }
  await deleteDoc(doc(CREW_PROFILES, crewProfileId));
}

function isPermissionDenied(error) {
  return Boolean(
    error &&
      (error.code === 'permission-denied' ||
        error.code === 'PERMISSION_DENIED' ||
        /missing or insufficient permissions|permission/i.test(`${error.message || ''}`))
  );
}

export async function ensureCrewProfileForUser({ crewProfileId, operatorId, user }) {
  if (!crewProfileId || !operatorId || !user) {
    throw new Error('crewProfileId, operatorId, and user are required.');
  }

  let existing = null;
  try {
    existing = await getCrewProfileById(crewProfileId);
  } catch (error) {
    if (isPermissionDenied(error)) return null;
    throw error;
  }
  if (existing) return existing;

  const fullName = user.fullName || user.name || 'Unnamed Crew';
  const nextPayload = {
    operatorId,
    crewProfileId,
    uid: crewProfileId,
    pilotUid: crewProfileId,
    linkState: 'LINKED',
    name: user.name || fullName,
    fullName,
    email: `${user.email || ''}`.trim().toLowerCase() || null,
    role: user.role || 'PILOT',
    status: 'Active',
    designation: user.designation || null,
    organizationBase: user.organizationBase || user.base || null,
    base: user.base || user.organizationBase || null,
    mobile: user.mobile || null,
    createdAt: user.createdAt || serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('crew_profiles', nextPayload, 'ensureCrewProfileForUser', 'write');
  try {
    await setDoc(doc(CREW_PROFILES, crewProfileId), nextPayload);
  } catch (error) {
    if (isPermissionDenied(error)) return null;
    throw error;
  }
  return nextPayload;
}

export function watchCrewProfilesForOperator(operatorId, onNext, onError) {
  const profilesRef = collection(CREW_PROFILES);
  const profilesQuery = query(profilesRef, where('operatorId', '==', operatorId));
  return onSnapshot(
    profilesQuery,
    (snapshot) => {
      onNext(snapshot.docs.map((item) => normalizeCrewProfile(item)));
    },
    onError
  );
}
