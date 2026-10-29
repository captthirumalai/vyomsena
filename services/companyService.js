import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import { validateContract } from './schemaContract.js';

const ADMIN_USERS = 'admin_users';
const COMPANIES = 'companies';
const COMPANY_ACCOUNTS = 'company_accounts';

const ROLE_ADMIN = 'ADMIN';

function normalizeAdminUser(snapshotDoc) {
  const raw = snapshotDoc.data();
  return {
    uid: snapshotDoc.id,
    email: raw.email || null,
    displayName: raw.displayName || raw.name || null,
    companyId: raw.companyId || null,
    role: raw.role || ROLE_ADMIN,
    status: raw.status || 'ACTIVE',
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null,
    ...raw
  };
}

function normalizeCompany(snapshotDoc) {
  const raw = snapshotDoc.data();
  return {
    companyId: snapshotDoc.id,
    name: raw.name || '',
    base: raw.base || null,
    code: raw.code || null,
    ownerEmail: raw.ownerEmail || null,
    ownerUid: raw.ownerUid || null,
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null,
    ...raw
  };
}

function normalizeAccount(snapshotDoc) {
  const raw = snapshotDoc.data();
  return {
    accountId: snapshotDoc.id,
    companyId: raw.companyId || null,
    role: raw.role || 'MEMBER',
    displayName: raw.displayName || raw.name || '',
    email: raw.email || null,
    uid: raw.uid || null,
    status: raw.status || 'ACTIVE',
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null,
    ...raw
  };
}

export async function isAdminUser(uid) {
  if (!uid) return false;
  const snapshot = await getDoc(doc(ADMIN_USERS, uid));
  return snapshot.exists();
}

export async function getAdminUser(uid) {
  if (!uid) return null;
  const snapshot = await getDoc(doc(ADMIN_USERS, uid));
  return snapshot.exists() ? normalizeAdminUser(snapshot) : null;
}

export async function createCompany({ companyId, name, base = null, code = null, ownerEmail = null, ownerUid = null, ownerDisplayName = null }) {
  if (!companyId) {
    throw new Error('companyId is required to create a company.');
  }
  if (!name) {
    throw new Error('Company name is required.');
  }

  const companyPayload = {
    companyId,
    name,
    base: base || null,
    code: code || null,
    ownerEmail: ownerEmail ? `${ownerEmail}`.trim().toLowerCase() : null,
    ownerUid: ownerUid || null,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('companies', companyPayload, 'createCompany', 'write');
  await setDoc(doc(COMPANIES, companyId), companyPayload);

  return companyPayload;
}

export async function getCompany(companyId) {
  if (!companyId) return null;
  const snapshot = await getDoc(doc(COMPANIES, companyId));
  return snapshot.exists() ? normalizeCompany(snapshot) : null;
}

export async function updateCompany(companyId, updates) {
  if (!companyId) {
    throw new Error('companyId is required to update a company.');
  }
  await updateDoc(doc(COMPANIES, companyId), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export async function listCompanies() {
  const snapshot = await getDocs(collection(COMPANIES));
  return snapshot.docs.map((item) => normalizeCompany(item));
}

export async function createCompanyAccount({ companyId, role = 'MEMBER', displayName = null, email = null, uid = null, accountId = null }) {
  if (!companyId) {
    throw new Error('companyId is required to create a company account.');
  }

  const createdRef = accountId ? doc(COMPANY_ACCOUNTS, accountId) : (await addDoc(collection(COMPANY_ACCOUNTS), {}));

  const payload = {
    accountId: createdRef.id,
    companyId,
    role: `${role || 'MEMBER'}`.trim().toUpperCase(),
    displayName: displayName || '',
    email: email ? `${email}`.trim().toLowerCase() : null,
    uid: uid || null,
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('company_accounts', payload, 'createCompanyAccount', 'write');
  await setDoc(createdRef, payload);

  return payload;
}

export async function getCompanyAccount(accountId) {
  if (!accountId) return null;
  const snapshot = await getDoc(doc(COMPANY_ACCOUNTS, accountId));
  return snapshot.exists() ? normalizeAccount(snapshot) : null;
}

export async function getUserMembership(uid) {
  if (!uid) return null;
  // Direct document read, NOT a collection query: Firestore cannot prove a
  // where('uid','==',X) list query satisfies the document-ID self-read rule
  // (request.auth.uid == accountId), so the whole query is denied even when
  // every matching document would pass. A direct get of the uid-keyed row
  // passes trivially. Membership rows are always keyed by uid (bootstrap,
  // pilot-linkage, and P2 upsert all use deterministic uid keys), so no
  // reachable membership is missed by skipping the query.
  // Only rows explicitly marked as staff membership count: pilot-linkage rows
  // (role PILOT without isMember) and unclaimed placeholders (uid null) never
  // confer a company context.
  const snapshot = await getDoc(doc(COMPANY_ACCOUNTS, uid));
  if (!snapshot.exists()) return null;
  const account = normalizeAccount(snapshot);
  if (account.isMember !== true || !account.companyId) return null;
  return account;
}

export async function listCompanyAccounts(companyId) {
  if (!companyId) return [];
  const accountsRef = collection(COMPANY_ACCOUNTS);
  const accountsQuery = query(accountsRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(accountsQuery);
  return snapshot.docs.map((item) => normalizeAccount(item));
}

export async function updateCompanyAccount(accountId, updates) {
  if (!accountId) {
    throw new Error('accountId is required to update a company account.');
  }
  await updateDoc(doc(COMPANY_ACCOUNTS, accountId), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export function companyModuleCollection(companyId, module) {
  if (!companyId || !module) {
    throw new Error('companyId and module are required to access company module data.');
  }
  return collection(`${COMPANIES}/${companyId}/${module}`);
}

export function companyModuleDocRef(companyId, module, docId) {
  if (!companyId || !module || !docId) {
    throw new Error('companyId, module, and docId are required.');
  }
  return doc(`${COMPANIES}/${companyId}/${module}`, docId);
}

export async function listCompanyModuleDocs(companyId, module) {
  const snapshot = await getDocs(companyModuleCollection(companyId, module));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function getCompanyModuleDoc(companyId, module, docId) {
  const snapshot = await getDoc(companyModuleDocRef(companyId, module, docId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function setCompanyModuleDoc(companyId, module, docId, data) {
  await setDoc(companyModuleDocRef(companyId, module, docId), {
    ...data,
    companyId,
    lastModified: serverTimestamp()
  });
  return { id: docId, ...data, companyId };
}

export async function addCompanyModuleDoc(companyId, module, data) {
  const createdRef = await addDoc(companyModuleCollection(companyId, module), {
    ...data,
    companyId,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });
  return { id: createdRef.id, ...data, companyId };
}

export async function updateCompanyModuleDoc(companyId, module, docId, updates) {
  await updateDoc(companyModuleDocRef(companyId, module, docId), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export async function deleteCompanyModuleDoc(companyId, module, docId) {
  await deleteDoc(companyModuleDocRef(companyId, module, docId));
}

export function onCompanyModuleSnapshot(companyId, module, onNext, onError) {
  return onSnapshot(
    companyModuleCollection(companyId, module),
    (snapshot) => {
      onNext(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export async function mirrorCrewProfilesToCompany(companyId, crewProfiles = []) {
  if (!companyId) return 0;
  await Promise.all(
    crewProfiles
      .filter((profile) => profile && profile.uid)
      .map((profile) =>
        setCompanyModuleDoc(companyId, 'crew', profile.uid, {
          uid: profile.uid,
          name: profile.fullName || profile.name || '',
          email: profile.email || null,
          role: profile.role || 'PILOT',
          status: profile.status || 'Active',
          operatorId: profile.operatorId || companyId,
          createdAt: profile.createdAt || serverTimestamp()
        })
      )
  );
  return crewProfiles.length;
}
