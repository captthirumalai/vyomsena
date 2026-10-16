import { collection, getDocs, getDoc, query, where, updateDoc, deleteDoc, doc, serverTimestamp } from './firestoreService.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { validateContract } from './schemaContract.js';

// Company User registry lives at the TOP LEVEL (not under companies/{id}/...)
// so one membership lookup resolves any user to their organisation:
//   company_users/{companyUserId} → { companyId, role, permissions, status, linkedCrewProfileId }
//
// Safety: this service NEVER creates, modifies, or deletes Pilot records
// (crew_profiles), licence documents (user_documents), or files. Linking a
// pilot performs a READ-ONLY existence check. Issuance (ID + passcode) and
// passcode verification live server-side in functions/lib/companyUsers.js.

const COLLECTION = 'company_users';

function companyUserDocRef(companyUserId) {
  return doc(`${COLLECTION}`, companyUserId);
}

function normalizePermissionsInput(permissions) {
  const modules = (permissions && permissions.modules) || permissions || {};
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
    throw new Error('permissions must be shaped like { module: { view, edit } }.');
  }
  const normalized = {};
  Object.entries(modules).forEach(([module, rights]) => {
    if (!rights || typeof rights !== 'object' || Array.isArray(rights)) {
      throw new Error(`permissions for module "${module}" must be shaped like { view, edit }.`);
    }
    normalized[`${module}`] = { view: rights.view === true, edit: rights.edit === true };
  });
  return { modules: normalized };
}

export async function getCompanyUser(companyUserId) {
  if (!companyUserId) return null;
  const snapshot = await getDoc(companyUserDocRef(companyUserId));
  if (!snapshot.exists()) return null;
  const data = { companyUserId: snapshot.id, ...snapshot.data() };
  validateContract('company_users', data, 'getCompanyUser', 'read');
  return data;
}

export async function listCompanyUsers(companyId) {
  if (!companyId) return [];
  // Canonical registry read: top-level company_users filtered by companyId.
  const snapshot = await getDocs(query(collection(COLLECTION), where('companyId', '==', companyId)));
  return snapshot.docs.map((item) => {
    const data = { companyUserId: item.id, ...item.data() };
    validateContract('company_users', data, 'listCompanyUsers', 'read');
    return data;
  });
}

export async function updateCompanyUserStatus(companyUserId, status) {
  const normalized = `${status || ''}`.trim().toUpperCase();
  if (!['ACTIVE', 'SUSPENDED'].includes(normalized)) {
    throw new Error('status must be ACTIVE or SUSPENDED.');
  }
  await updateDoc(companyUserDocRef(companyUserId), { status: normalized, lastModified: serverTimestamp() });
  return getCompanyUser(companyUserId);
}

export async function updateCompanyUserPermissions(companyUserId, permissions) {
  const normalized = normalizePermissionsInput(permissions);
  await updateDoc(companyUserDocRef(companyUserId), { permissions: normalized, lastModified: serverTimestamp() });
  return getCompanyUser(companyUserId);
}

export async function linkCompanyUserToPilot(companyUserId, crewProfileId) {
  if (!crewProfileId) throw new Error('crewProfileId is required to link a pilot.');
  // READ-ONLY existence check against the EXISTING pilot record.
  // Never creates, moves, copies, or rewrites the pilot or its documents.
  const pilotSnapshot = await getDoc(doc('crew_profiles', crewProfileId));
  if (!pilotSnapshot.exists()) {
    throw new Error('Pilot record not found. Link an EXISTING pilot only.');
  }
  await updateDoc(companyUserDocRef(companyUserId), {
    linkedCrewProfileId: pilotSnapshot.id,
    lastModified: serverTimestamp()
  });
  return getCompanyUser(companyUserId);
}

export async function unlinkCompanyUserFromPilot(companyUserId) {
  await updateDoc(companyUserDocRef(companyUserId), {
    linkedCrewProfileId: null,
    lastModified: serverTimestamp()
  });
  return getCompanyUser(companyUserId);
}

export async function deleteCompanyUser(companyUserId) {
  await deleteDoc(companyUserDocRef(companyUserId));
  return { companyUserId, deleted: true };
}

// ---------------------------------------------------------------------------
// Admin callable path (Phase C2). The Settings Users UI uses THESE wrappers,
// not the direct Firestore functions above: issuance, verification-adjacent
// management, and listing run through admin-checked callables (Admin SDK), so
// C2 requires NO Firestore console rule changes and company_users stays
// deny-by-default for direct client access. The direct functions remain as
// the documented API for the post-hardening direct-access phase.
// ---------------------------------------------------------------------------

async function callCompanyUserFn(name, payload) {
  const call = httpsCallable(getFunctions(), name);
  const result = await call(payload);
  return result?.data ?? null;
}

export async function issueCompanyUserViaCallable({ displayName, role, permissions, linkedCrewProfileId = null, status = 'ACTIVE' }) {
  // Returns { companyUserId, ..., passcode } — passcode shown ONCE by the UI,
  // never persisted (not in Firestore, storage, logs, or console).
  return callCompanyUserFn('issueCompanyUser', {
    displayName,
    role,
    permissions,
    linkedCrewProfileId,
    status
  });
}

export async function listCompanyUsersViaCallable() {
  const users = await callCompanyUserFn('listCompanyUsers', {});
  return Array.isArray(users) ? users : [];
}

export async function updateCompanyUserViaCallable(companyUserId, patch) {
  return callCompanyUserFn('updateCompanyUser', { companyUserId, ...(patch || {}) });
}

export async function resetCompanyUserPasscodeViaCallable(companyUserId) {
  // Returns { companyUserId, passcode } — display once, never persist.
  return callCompanyUserFn('resetCompanyUserPasscode', { companyUserId });
}
