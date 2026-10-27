/**
 * VyomSena company-user foundation (Phase C1).
 *
 * Separate identity from Firebase Auth accounts and Pilot records:
 *
 *   PERSON (human, off-system)
 *    ├── Aviation Account — users/{authUid} (existing, untouched)
 *    └── Company User   — company_users/{companyUserId} (this file)
 *           ├── opaque ID (CMU-...), never an email or Auth UID
 *           ├── one-time passcode shown ONCE at issuance, stored as scrypt hash only
 *           ├── organisationId → companies/{companyId} (existing, no migration)
 *           ├── permissions foundation { module: { view, edit } }
 *           └── optional linkedCrewProfileId → EXISTING crew_profiles/{id} (read-only check)
 *
 * Safety rules enforced here, not just in callers:
 *  - Creating a Company User NEVER creates/duplicates a Pilot record.
 *  - Linking NEVER writes to crew_profiles, user_documents, or Storage.
 *  - Plaintext passcodes are NEVER persisted (returned once in the response).
 *  - Verification is server-side only (Firestore rules have no hashing).
 *
 * All functions take an explicit `db` (admin.firestore() in production,
 * a stub in tests) so the logic is unit-testable without credentials.
 */

const crypto = require('node:crypto');

const COLLECTION = 'company_users';
const CREW_PROFILES = 'crew_profiles';
const COMPANY_PEOPLE = 'people';

const USER_ID_PREFIX = 'CMU-';
const USER_ID_BYTES = 9;
const PASSCODE_LENGTH = 12;
// Human-transcribable: no 0/O, 1/I/L confusion.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLength: 32 };

const VALID_STATUSES = ['ACTIVE', 'SUSPENDED'];
const VALID_ACCESS_ROLES = ['PILOT', 'OPERATIONS', 'AME'];
const CREW_PILOT_SOURCE = 'CREW_ADD_PILOT';

function randomFromAlphabet(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function generateCompanyUserId() {
  return `${USER_ID_PREFIX}${randomFromAlphabet(USER_ID_BYTES)}`;
}

function generatePasscode() {
  return randomFromAlphabet(PASSCODE_LENGTH);
}

function hashPasscode(passcode, saltBase64) {
  const salt = saltBase64 ? Buffer.from(saltBase64, 'base64') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(`${passcode}`, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p
  });
  return `scrypt$v=1$n=${SCRYPT_PARAMS.N}$r=${SCRYPT_PARAMS.r}$p=${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPasscodeHash(passcode, stored) {
  try {
    const parts = `${stored || ''}`.split('$');
    // scrypt$v=1$n=..$r=..$p=..$salt$hash
    if (parts.length !== 7 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[5], 'base64');
    const expected = Buffer.from(parts[6], 'base64');
    const derived = crypto.scryptSync(`${passcode}`, salt, expected.length, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p
    });
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function normalizePermissions(input) {
  const modules = (input && input.modules) || input || {};
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
    throw new Error('permissions must be an object shaped like { module: { view, edit } }.');
  }
  const normalized = {};
  Object.entries(modules).forEach(([module, rights]) => {
    if (!rights || typeof rights !== 'object' || Array.isArray(rights)) {
      throw new Error(`permissions for module "${module}" must be shaped like { view, edit }.`);
    }
    const view = rights.view === true || rights.edit === true;
    const edit = rights.edit === true;
    if (view || edit) normalized[`${module}`] = { view, edit };
  });
  return { modules: normalized };
}

function normalizeStatus(status) {
  const normalized = `${status || 'ACTIVE'}`.trim().toUpperCase();
  if (!VALID_STATUSES.includes(normalized)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }
  return normalized;
}

async function assertEligibleCrewPilot(db, companyId, crewProfileId) {
  if (!crewProfileId) throw new Error('A Crew Management Add Pilot record is required for pilot access.');
  const snapshot = await db.doc(`${CREW_PROFILES}/${crewProfileId}`).get();
  if (!snapshot.exists) {
    throw new Error(`Linked pilot record ${crewProfileId} was not found. Link an EXISTING pilot only.`);
  }
  const profile = snapshot.data() || {};
  if (profile.operatorId !== companyId || `${profile.role || ''}`.trim().toUpperCase() !== 'PILOT'
    || `${profile.status || 'ACTIVE'}`.trim().toUpperCase() !== 'ACTIVE'
    || profile.provisioningSource !== CREW_PILOT_SOURCE) {
    throw new Error('Pilot access is limited to pilot profiles created by this company with Crew Management → Add Pilot.');
  }
  return snapshot;
}

async function assertEligibleCompanyPerson(db, companyId, personId, role) {
  if (!personId) throw new Error('Select an existing staff record from its company module.');
  const snapshot = await db.doc(`companies/${companyId}/${COMPANY_PEOPLE}/${personId}`).get();
  if (!snapshot.exists) throw new Error(`Linked staff record ${personId} was not found.`);
  const person = snapshot.data() || {};
  if (person.companyId !== companyId || `${person.role || ''}`.trim().toUpperCase() !== role
    || `${person.status || 'ACTIVE'}`.trim().toUpperCase() !== 'ACTIVE') {
    throw new Error('Select an active staff record with the matching access type from this company.');
  }
  const displayName = `${person.displayName || person.name || ''}`.trim();
  if (!displayName) throw new Error('The selected staff record must have a name.');
  return { snapshot, displayName };
}

async function assertPersonNotAlreadyLinked(db, companyId, personId, excludeUserId = null) {
  const snapshot = await db.collection(COLLECTION).where('companyId', '==', companyId).get();
  const duplicate = snapshot.docs.find((item) => item.id !== excludeUserId && item.data()?.linkedPersonId === personId);
  if (duplicate) throw new Error('This person already has a Company Home account. Edit that account or choose another person.');
}

async function assertPilotNotAlreadyLinked(db, companyId, crewProfileId, excludeUserId = null) {
  const snapshot = await db.collection(COLLECTION).where('companyId', '==', companyId).get();
  const duplicate = snapshot.docs.find((item) => item.id !== excludeUserId && item.data()?.linkedCrewProfileId === crewProfileId);
  if (duplicate) throw new Error('This pilot already has a Company Home account. Edit that account or choose another pilot.');
}

function companyUserRef(db, companyUserId) {
  return db.doc(`${COLLECTION}/${companyUserId}`);
}

/**
 * Issue a Company User. Server-side only (called from an admin-checked callable).
 * Returns the plaintext passcode ONCE — it is never written to Firestore.
 */
async function issueCompanyUser(db, {
  companyId,
  displayName,
  role = 'OPERATIONS',
  permissions = { modules: {} },
  linkedCrewProfileId = null,
  linkedPersonId = null,
  status = 'ACTIVE',
  createdBy = null,
  now = new Date()
} = {}) {
  if (!companyId) throw new Error('companyId is required to issue a company user.');
  const normalizedRole = `${role || 'OPERATIONS'}`.trim().toUpperCase();
  if (!VALID_ACCESS_ROLES.includes(normalizedRole)) {
    throw new Error(`role must be one of: ${VALID_ACCESS_ROLES.join(', ')}.`);
  }
  if (normalizedRole === 'PILOT') {
    if (linkedPersonId) throw new Error('Pilot access must use an Add Pilot record.');
    await assertEligibleCrewPilot(db, companyId, linkedCrewProfileId);
    await assertPilotNotAlreadyLinked(db, companyId, linkedCrewProfileId);
    const pilot = (await db.doc(`${CREW_PROFILES}/${linkedCrewProfileId}`).get()).data() || {};
    displayName = displayName || pilot.name || pilot.fullName;
  } else {
    if (linkedCrewProfileId) throw new Error('Only pilot access can be linked to a Crew Management pilot profile.');
    const person = await assertEligibleCompanyPerson(db, companyId, linkedPersonId, normalizedRole);
    await assertPersonNotAlreadyLinked(db, companyId, linkedPersonId);
    displayName = person.displayName;
  }
  if (!displayName) throw new Error('The selected person must have a name.');

  const companyUserId = generateCompanyUserId();
  const passcode = generatePasscode();

  const payload = {
    companyUserId,
    companyId,
    displayName,
    role: normalizedRole,
    permissions: normalizePermissions(permissions),
    linkedCrewProfileId: linkedCrewProfileId || null,
    linkedPersonId: linkedPersonId || null,
    status: normalizeStatus(status),
    passcodeHash: hashPasscode(passcode),
    failedAttempts: 0,
    lockedUntil: null,
    createdBy,
    createdAt: now,
    lastModified: now
  };

  await companyUserRef(db, companyUserId).set(payload);

  return {
    companyUserId,
    companyId,
    displayName: payload.displayName,
    role: payload.role,
    status: payload.status,
    // ONE-TIME ONLY. Never persisted. The Admin must hand it to the user now.
    passcode
  };
}

async function getCompanyUser(db, companyUserId) {
  if (!companyUserId) return null;
  const snapshot = await companyUserRef(db, companyUserId).get();
  return snapshot.exists ? { companyUserId: snapshot.id, ...snapshot.data() } : null;
}

/**
 * Verify a Company User ID + passcode (server-side login primitive for
 * Company Home; no Android/client integration in C1 beyond this callable).
 * Returns { ok, claims } — claims are minted into the Firebase custom token.
 */
async function verifyCompanyUser(db, { companyUserId, passcode, now = new Date() } = {}) {
  const record = await getCompanyUser(db, companyUserId);
  if (!record) return { ok: false, reason: 'NOT_FOUND' };
  if (record.status !== 'ACTIVE') return { ok: false, reason: 'SUSPENDED' };
  if (`${record.role || ''}`.trim().toUpperCase() === 'PILOT') {
    try {
      await assertEligibleCrewPilot(db, record.companyId, record.linkedCrewProfileId);
    } catch {
      return { ok: false, reason: 'INVALID' };
    }
  } else if (record.linkedPersonId) {
    try {
      await assertEligibleCompanyPerson(db, record.companyId, record.linkedPersonId, `${record.role || ''}`.trim().toUpperCase());
    } catch {
      return { ok: false, reason: 'INVALID' };
    }
  }

  const lockedUntil = record.lockedUntil ? new Date(record.lockedUntil).getTime() : 0;
  if (lockedUntil && lockedUntil > now.getTime()) return { ok: false, reason: 'LOCKED' };

  const valid = verifyPasscodeHash(passcode, record.passcodeHash);
  if (!valid) {
    const nextAttempts = (Number(record.failedAttempts) || 0) + 1;
    const update =
      nextAttempts >= MAX_FAILED_ATTEMPTS
        ? { failedAttempts: nextAttempts, lockedUntil: new Date(now.getTime() + LOCKOUT_MS), lastModified: now }
        : { failedAttempts: nextAttempts, lastModified: now };
    await companyUserRef(db, companyUserId).update(update);
    return { ok: false, reason: 'INVALID' };
  }

  await companyUserRef(db, companyUserId).update({
    failedAttempts: 0,
    lockedUntil: null,
    lastModified: now,
    lastLoginAt: now
  });

  return {
    ok: true,
    claims: {
      home: 'company',
      companyUserId: record.companyUserId,
      companyId: record.companyId,
      role: record.role || 'OPERATIONS',
      displayName: record.displayName || '',
      linkedCrewProfileId: record.linkedCrewProfileId || null,
      linkedPersonId: record.linkedPersonId || null,
      permissions: normalizePermissions(record.permissions)
    }
  };
}

function sanitizeCompanyUser(record) {
  if (!record) return null;
  const {
    passcodeHash,
    failedAttempts,
    lockedUntil,
    ...publicView
  } = record;
  void passcodeHash;
  void failedAttempts;
  void lockedUntil;
  return publicView;
}

async function requireCompanyUserInCompany(db, callerCompanyId, companyUserId) {
  const record = await getCompanyUser(db, companyUserId);
  if (!record) {
    throw new Error(`Company user ${companyUserId} was not found.`);
  }
  if (!callerCompanyId || record.companyId !== callerCompanyId) {
    throw new Error('Company users can only be managed inside your own organisation.');
  }
  return record;
}

async function listCompanyUsers(db, companyId) {
  if (!companyId) return [];
  const snapshot = await db.collection(COLLECTION).where('companyId', '==', companyId).get();
  return snapshot.docs
    .map((item) => sanitizeCompanyUser({ companyUserId: item.id, ...item.data() }))
    .sort((left, right) => `${left.displayName || ''}`.localeCompare(`${right.displayName || ''}`));
}

async function updateCompanyUser(db, { callerCompanyId, companyUserId, patch = {}, now = new Date() } = {}) {
  const current = await requireCompanyUserInCompany(db, callerCompanyId, companyUserId);

  const allowed = {};
  if (patch.displayName !== undefined) {
    const displayName = `${patch.displayName || ''}`.trim();
    if (!displayName) throw new Error('displayName must not be empty.');
    allowed.displayName = displayName;
  }
  if (patch.role !== undefined) {
    const role = `${patch.role || ''}`.trim().toUpperCase();
    if (!VALID_ACCESS_ROLES.includes(role)) throw new Error(`role must be one of: ${VALID_ACCESS_ROLES.join(', ')}.`);
    allowed.role = role;
  }
  if (patch.permissions !== undefined) {
    allowed.permissions = normalizePermissions(patch.permissions);
  }
  if (patch.status !== undefined) {
    allowed.status = normalizeStatus(patch.status);
  }
  if (patch.linkedCrewProfileId !== undefined) {
    allowed.linkedCrewProfileId = patch.linkedCrewProfileId || null;
  }
  if (patch.linkedPersonId !== undefined) allowed.linkedPersonId = patch.linkedPersonId || null;
  const nextRole = allowed.role || current.role;
  const nextPilotId = Object.hasOwn(allowed, 'linkedCrewProfileId') ? allowed.linkedCrewProfileId : current.linkedCrewProfileId;
  const roleChanged = allowed.role !== undefined && allowed.role !== current.role;
  const pilotLinkChanged = Object.hasOwn(allowed, 'linkedCrewProfileId') && allowed.linkedCrewProfileId !== current.linkedCrewProfileId;
  const personLinkChanged = Object.hasOwn(allowed, 'linkedPersonId') && allowed.linkedPersonId !== current.linkedPersonId;
  if (roleChanged || pilotLinkChanged || personLinkChanged) {
    if (nextRole === 'PILOT' && nextPilotId) {
      await assertEligibleCrewPilot(db, callerCompanyId, nextPilotId);
      await assertPilotNotAlreadyLinked(db, callerCompanyId, nextPilotId, companyUserId);
    }
    else if (nextRole === 'PILOT') allowed.status = 'SUSPENDED';
    else if (nextPilotId) throw new Error('Only pilot access can be linked to a Crew Management pilot profile.');
    if (nextRole !== 'PILOT') {
      const nextPersonId = Object.hasOwn(allowed, 'linkedPersonId') ? allowed.linkedPersonId : current.linkedPersonId;
      const staff = await assertEligibleCompanyPerson(db, callerCompanyId, nextPersonId, nextRole);
      await assertPersonNotAlreadyLinked(db, callerCompanyId, nextPersonId, companyUserId);
      allowed.displayName = staff.displayName;
    } else {
      allowed.linkedPersonId = null;
    }
  }
  if (Object.keys(allowed).length === 0) {
    throw new Error('Nothing to update. Provide displayName, role, permissions, status, or linkedCrewProfileId.');
  }

  await companyUserRef(db, companyUserId).update({ ...allowed, lastModified: now });
  return sanitizeCompanyUser(await getCompanyUser(db, companyUserId));
}

async function resetCompanyUserPasscode(db, { callerCompanyId, companyUserId, now = new Date() } = {}) {
  await requireCompanyUserInCompany(db, callerCompanyId, companyUserId);

  const passcode = generatePasscode();
  await companyUserRef(db, companyUserId).update({
    passcodeHash: hashPasscode(passcode),
    failedAttempts: 0,
    lockedUntil: null,
    lastModified: now
  });

  // ONE-TIME ONLY. Never persisted. Hand it to the user now.
  return { companyUserId, passcode };
}

module.exports = {
  COLLECTION,
  VALID_STATUSES,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
  generateCompanyUserId,
  generatePasscode,
  hashPasscode,
  verifyPasscodeHash,
  normalizePermissions,
  normalizeStatus,
  issueCompanyUser,
  getCompanyUser,
  verifyCompanyUser,
  sanitizeCompanyUser,
  listCompanyUsers,
  updateCompanyUser,
  resetCompanyUserPasscode
};
