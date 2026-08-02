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
const COMPANY_INVITES = 'company_invites';
const INVITE_TTL_MS = 5 * 60 * 1000;

const ROLE_ADMIN = 'ADMIN';
const ROLE_OWNER = 'OWNER';

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

function normalizeInvite(snapshotDoc) {
  const raw = snapshotDoc.data();
  return {
    code: snapshotDoc.id,
    companyId: raw.companyId || null,
    accountId: raw.accountId || null,
    email: raw.email || null,
    role: raw.role || 'MEMBER',
    createdAt: raw.createdAt || null,
    expiresAt: raw.expiresAt || null,
    usedBy: raw.usedBy ?? null,
    usedAt: raw.usedAt ?? null,
    ...raw
  };
}

function generateCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export async function ensureAdminUser({ uid, email = null, displayName = null, companyId = null, role = ROLE_ADMIN }) {
  if (!uid) {
    throw new Error('uid is required to register an admin user.');
  }

  const existingRef = doc(ADMIN_USERS, uid);
  const existing = await getDoc(existingRef);
  if (existing.exists()) {
    const current = normalizeAdminUser(existing);
    const patches = {};
    if (companyId && current.companyId !== companyId) patches.companyId = companyId;
    if (email && !current.email) patches.email = `${email}`.trim().toLowerCase();
    if (displayName && !current.displayName) patches.displayName = displayName;
    if (Object.keys(patches).length > 0) {
      await updateDoc(existingRef, { ...patches, lastModified: serverTimestamp() });
      return { ...current, ...patches, lastModified: serverTimestamp() };
    }
    return current;
  }

  const payload = {
    uid,
    email: email ? `${email}`.trim().toLowerCase() : null,
    displayName: displayName || null,
    companyId,
    role,
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  validateContract('admin_users', payload, 'ensureAdminUser', 'write');
  await setDoc(existingRef, payload);
  return payload;
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

  if (ownerUid) {
    await ensureAdminUser({ uid: ownerUid, email: ownerEmail, displayName: ownerDisplayName, companyId, role: ROLE_OWNER });
  }

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

export async function generateCompanyInvite({ companyId, accountId, email = null, role = 'MEMBER', ttlMs = INVITE_TTL_MS }) {
  if (!companyId || !accountId) {
    throw new Error('companyId and accountId are required to generate an invite.');
  }

  const account = await getCompanyAccount(accountId);
  if (account && account.companyId !== companyId) {
    throw new Error('The selected account does not belong to this company.');
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + Math.max(1, ttlMs));
  const payload = {
    code,
    companyId,
    accountId,
    email: email ? `${email}`.trim().toLowerCase() : (account?.email || null),
    role: `${role || 'MEMBER'}`.trim().toUpperCase(),
    createdAt: serverTimestamp(),
    expiresAt,
    usedBy: null,
    usedAt: null
  };

  validateContract('company_invites', payload, 'generateCompanyInvite', 'write');
  await setDoc(doc(COMPANY_INVITES, code), payload);

  return {
    code,
    ...payload
  };
}

export async function getCompanyInviteByCode(code) {
  const normalized = `${code || ''}`.trim();
  if (!normalized) return null;
  const snapshot = await getDoc(doc(COMPANY_INVITES, normalized));
  return snapshot.exists() ? normalizeInvite(snapshot) : null;
}

export async function listCompanyInvites(companyId) {
  if (!companyId) return [];
  const invitesRef = collection(COMPANY_INVITES);
  const invitesQuery = query(invitesRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(invitesQuery);
  return snapshot.docs
    .map((item) => normalizeInvite(item))
    .sort((left, right) => {
      const leftTs = toDateValue(left.createdAt)?.getTime() || 0;
      const rightTs = toDateValue(right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    });
}

export async function markCompanyInviteUsed({ code, uid }) {
  const invite = await getCompanyInviteByCode(code);
  if (!invite) {
    throw new Error('Invite code was not found.');
  }

  const expiresAt = toDateValue(invite.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    throw new Error('Invite code has expired. Ask the operator for a new one.');
  }

  if (invite.usedBy) {
    throw new Error('Invite code was already used.');
  }

  await updateDoc(doc(COMPANY_INVITES, code), {
    usedBy: uid,
    usedAt: serverTimestamp()
  });
  return { ...invite, usedBy: uid, usedAt: new Date() };
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
