/**
 * VyomSena backend — scheduled licence-expiry email reminders.
 *
 * Exports:
 *  - sendExpiryReminders    daily 06:00 IST scan across all companies
 *  - sendExpiryRemindersNow callable manual trigger (auth + admin/ops role)
 *
 * Secrets (firebase functions:secrets:set ...):
 *  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 * Local/dev fallback: same names in process.env (functions/.env, never committed).
 */

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { buildTransport, sendTestMail } = require('./lib/email');
const {
  runExpiryReminders,
  previewCompanyReminders,
  sendFullPilotDocumentReport,
  sendSingleDocumentReminder
} = require('./lib/engine');
const companyUsers = require('./lib/companyUsers');

admin.initializeApp();
const db = admin.firestore();

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_SECURE = defineSecret('SMTP_SECURE');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_FROM = defineSecret('SMTP_FROM');
const ALL_SECRETS = [SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM];

function readSmtpConfig() {
  const pick = (secret, envName, fallback = '') => {
    try {
      const value = secret.value();
      if (value) return value;
    } catch (error) {
      // Secret not set in this environment — fall through to process.env.
    }
    return process.env[envName] || fallback;
  };
  const port = Number(pick(SMTP_PORT, 'SMTP_PORT', '587')) || 587;
  return {
    host: pick(SMTP_HOST, 'SMTP_HOST', ''),
    port,
    secure: `${pick(SMTP_SECURE, 'SMTP_SECURE', port === 465 ? 'true' : 'false')}`.toLowerCase() === 'true',
    user: pick(SMTP_USER, 'SMTP_USER', ''),
    pass: pick(SMTP_PASS, 'SMTP_PASS', ''),
    from: pick(SMTP_FROM, 'SMTP_FROM', '')
  };
}

async function assertCallerAllowed(uid) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to run reminders.');
  }
  const snap = await db.doc(`admin_users/${uid}`).get();
  const role = `${(snap.exists ? snap.data() || {} : {}).role || ''}`.toUpperCase();
  if (!snap.exists || !['OWNER', 'ADMIN', 'OPERATIONS'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only company owner, admin or operations accounts can run reminders.');
  }
  return { role, companyId: (snap.data() || {}).companyId || uid };
}

exports.sendExpiryReminders = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'Asia/Kolkata', secrets: ALL_SECRETS },
  async () => {
    const smtp = readSmtpConfig();
    if (!smtp.host || !smtp.from) {
      throw new Error('SMTP_HOST/SMTP_FROM not configured. Set functions secrets first.');
    }
    const transport = buildTransport(smtp);
    const summary = await runExpiryReminders({ db, transport, from: smtp.from, now: new Date() });
    return summary;
  }
);

exports.sendExpiryRemindersNow = onCall({ secrets: ALL_SECRETS }, async (request) => {
  const caller = await assertCallerAllowed(request.auth?.uid);
  const smtp = readSmtpConfig();
  if (!smtp.host || !smtp.from) {
    throw new HttpsError('failed-precondition', 'Email is not configured on the server (SMTP secrets missing).');
  }
  const forceResend = request.data?.forceResend === true;
  const transport = buildTransport(smtp);
  const summary = await runExpiryReminders({
    db,
    transport,
    from: smtp.from,
    now: new Date(),
    scopeCompanyId: caller.companyId,
    actorUid: request.auth.uid,
    forceResend
  });
  const companySummary = summary.companies[caller.companyId] || { sent: 0, details: ['No in-window documents found.'] };
  return { ...companySummary, forced: forceResend };
});

exports.previewReminders = onCall(async (request) => {
  const caller = await assertCallerAllowed(request.auth?.uid);
  return previewCompanyReminders({ db, companyId: caller.companyId, now: new Date() });
});

exports.sendPilotDocumentReport = onCall({ secrets: ALL_SECRETS }, async (request) => {
  const caller = await assertCallerAllowed(request.auth?.uid);
  const smtp = readSmtpConfig();
  if (!smtp.host || !smtp.from) {
    throw new HttpsError('failed-precondition', 'Email is not configured on the server (SMTP secrets missing).');
  }
  return sendFullPilotDocumentReport({
    db,
    transport: buildTransport(smtp),
    from: smtp.from,
    companyId: caller.companyId,
    actorUid: request.auth.uid,
    now: new Date()
  });
});

exports.sendDocumentReminder = onCall({ secrets: ALL_SECRETS }, async (request) => {
  const caller = await assertCallerAllowed(request.auth?.uid);
  const smtp = readSmtpConfig();
  if (!smtp.host || !smtp.from) {
    throw new HttpsError('failed-precondition', 'Email is not configured on the server (SMTP secrets missing).');
  }
  try {
    return await sendSingleDocumentReminder({
      db,
      transport: buildTransport(smtp),
      from: smtp.from,
      companyId: caller.companyId,
      documentId: request.data?.documentId,
      actorUid: request.auth.uid,
      now: new Date()
    });
  } catch (error) {
    const code = ['invalid-argument', 'not-found', 'permission-denied', 'failed-precondition'].includes(error.code)
      ? error.code
      : 'internal';
    throw new HttpsError(code, error.message || 'Unable to send the document reminder.');
  }
});

async function assertOwnerOrAdmin(uid) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to manage company users.');
  }
  const snap = await db.doc(`admin_users/${uid}`).get();
  const data = snap.exists ? snap.data() || {} : {};
  const role = `${data.role || ''}`.toUpperCase();
  if (!snap.exists || !['OWNER', 'ADMIN'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only the company owner or admin can manage company users.');
  }
  return { role, companyId: data.companyId || uid };
}

// Phase C1: Admin-only issuance of Company Users (ID + one-time passcode).
// The plaintext passcode is returned ONCE in this response and never stored.
exports.issueCompanyUser = onCall(async (request) => {
  const caller = await assertOwnerOrAdmin(request.auth?.uid);
  const data = request.data || {};
  const targetCompanyId = data.companyId || caller.companyId;
  if (targetCompanyId !== caller.companyId) {
    throw new HttpsError('permission-denied', 'Company users can only be issued for your own organisation.');
  }
  try {
    return await companyUsers.issueCompanyUser(db, {
      companyId: targetCompanyId,
      displayName: data.displayName,
      role: data.role,
      permissions: data.permissions,
      linkedCrewProfileId: data.linkedCrewProfileId || null,
      status: data.status,
      createdBy: request.auth.uid
    });
  } catch (error) {
    if (error.message && /pilot record .* was not found|required|permissions|status|role must|pilot access|only pilot access/i.test(error.message)) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw new HttpsError('internal', 'Unable to issue the company user.');
  }
});

// Phase C1: server-side Company User verification (Company Home login primitive).
// Unauthenticated by design — this IS the login endpoint. Throttling + lockout
// are enforced inside the library; no Android/client integration in C1.
exports.verifyCompanyUser = onCall(async (request) => {
  const data = request.data || {};
  const result = await companyUsers.verifyCompanyUser(db, {
    companyUserId: data.companyUserId,
    passcode: data.passcode
  });
  if (!result.ok) {
    // Safe generic failure for unknown/wrong/suspended; lockout gets its own
    // retry-later signal so legitimate users know to wait, not re-try blindly.
    if (result.reason === 'LOCKED') {
      throw new HttpsError('failed-precondition', 'Too many attempts. Try again later.');
    }
    throw new HttpsError('unauthenticated', 'Invalid credentials or inactive account.');
  }
  const token = await admin.auth().createCustomToken(result.claims.companyUserId, result.claims);
  return { token, claims: result.claims };
});

// Phase C2: Admin-only Company User management. All reads/mutations go through
// these callables (Admin SDK) so C2 needs NO Firestore console rule changes:
// company_users stays deny-by-default for direct client access.
exports.listCompanyUsers = onCall(async (request) => {
  const caller = await assertOwnerOrAdmin(request.auth?.uid);
  return companyUsers.listCompanyUsers(db, caller.companyId);
});

exports.updateCompanyUser = onCall(async (request) => {
  const caller = await assertOwnerOrAdmin(request.auth?.uid);
  const data = request.data || {};
  try {
    return companyUsers.sanitizeCompanyUser(
      await companyUsers.updateCompanyUser(db, {
        callerCompanyId: caller.companyId,
        companyUserId: data.companyUserId,
        patch: {
          displayName: data.displayName,
          role: data.role,
          permissions: data.permissions,
          status: data.status,
          linkedCrewProfileId: data.linkedCrewProfileId
        }
      })
    );
  } catch (error) {
    if (error.message && /not found|organisation|empty|permissions|status|pilot record|pilot access|only pilot access|role must|update/i.test(error.message)) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw new HttpsError('internal', 'Unable to update the company user.');
  }
});

exports.resetCompanyUserPasscode = onCall(async (request) => {
  const caller = await assertOwnerOrAdmin(request.auth?.uid);
  const data = request.data || {};
  try {
    // Returns the new passcode ONCE — never stored, never logged.
    return await companyUsers.resetCompanyUserPasscode(db, {
      callerCompanyId: caller.companyId,
      companyUserId: data.companyUserId
    });
  } catch (error) {
    if (error.message && /not found|organisation/i.test(error.message)) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw new HttpsError('internal', 'Unable to reset the passcode.');
  }
});

exports.sendTestReminder = onCall({ secrets: ALL_SECRETS }, async (request) => {
  const caller = await assertCallerAllowed(request.auth?.uid);
  const to = `${request.data?.to || ''}`.trim().toLowerCase();
  if (!/.+@.+\..+/.test(to)) {
    throw new HttpsError('invalid-argument', 'Provide a valid "to" email address.');
  }
  const smtp = readSmtpConfig();
  if (!smtp.host || !smtp.from) {
    throw new HttpsError('failed-precondition', 'Email is not configured on the server (SMTP secrets missing).');
  }
  const companySnap = await db.doc(`companies/${caller.companyId}`).get();
  const companyName = (companySnap.exists ? companySnap.data() || {} : {}).name || 'Your operator';
  const transport = buildTransport(smtp);
  await sendTestMail(transport, { from: smtp.from, to, companyName });
  return { ok: true, to };
});
