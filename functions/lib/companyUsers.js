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

const USER_ID_PREFIX = 'CMU-';
const USER_ID_BYTES = 9;
const PASSCODE_LENGTH = 12;
// Human-transcribable: no 0/O, 1/I/L confusion.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLength: 32 };

const VALID_STATUSES = ['ACTIVE', 'SUSPENDED'];

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
    normalized[`${module}`] = {
      view: rights.view === true,
      edit: rights.edit === true
    };
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

async function assertCrewProfileExists(db, crewProfileId) {
  if (!crewProfileId) return null;
  const snapshot = await db.doc(`${CREW_PROFILES}/${crewProfileId}`).get();
  if (!snapshot.exists) {
    throw new Error(`Linked pilot record ${crewProfileId} was not found. Link an EXISTING pilot only.`);
  }
  return snapshot;
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
  status = 'ACTIVE',
  createdBy = null,
  now = new Date()
} = {}) {
  if (!companyId) throw new Error('companyId is required to issue a company user.');
  if (!displayName) throw new Error('displayName is required to issue a company user.');

  // Read-only existence check. NEVER creates, moves, or rewrites the pilot record.
  await assertCrewProfileExists(db, linkedCrewProfileId);

  const companyUserId = generateCompanyUserId();
  const passcode = generatePasscode();

  const payload = {
    companyUserId,
    companyId,
    displayName,
    role: `${role || 'OPERATIONS'}`.trim().toUpperCase(),
    permissions: normalizePermissions(permissions),
    linkedCrewProfileId: linkedCrewProfileId || null,
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
      role: record.role || 'OPERATIONS'
    }
  };
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
  verifyCompanyUser
};
