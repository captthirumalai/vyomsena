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
const { buildTransport } = require('./lib/email');
const { runExpiryReminders } = require('./lib/engine');

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
  const transport = buildTransport(smtp);
  const summary = await runExpiryReminders({
    db,
    transport,
    from: smtp.from,
    now: new Date(),
    scopeCompanyId: caller.companyId,
    actorUid: request.auth.uid
  });
  return summary.companies[caller.companyId] || { sent: 0, details: ['No in-window documents found.'] };
});
