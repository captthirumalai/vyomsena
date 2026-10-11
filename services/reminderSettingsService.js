import {
  query,
  where,
  orderBy,
  limit,
  getDocs
} from './firestoreService.js';
import {
  getCompanyModuleDoc,
  setCompanyModuleDoc,
  companyModuleCollection
} from './companyService.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

const REMINDER_MODULE = 'reminder_settings';
const REMINDER_DOC_ID = 'current';
const RUNS_MODULE = 'reminder_runs';
const LOGS_MODULE = 'reminder_logs';
const DEFAULT_LEAD_DAYS = 30;
const DEFAULT_MAX_SENDS = 450;

function toEmailList(value) {
  const list = Array.isArray(value) ? value : `${value || ''}`.split(/[,\s;]+/);
  return [...new Set(list.map((email) => `${email || ''}`.trim().toLowerCase()).filter(Boolean))];
}

function toSingleEmail(value) {
  const cleaned = `${value || ''}`.trim().toLowerCase();
  return /.+@.+\..+/.test(cleaned) ? cleaned : null;
}

export function normalizeReminderSettings(raw) {
  const leadDays = Math.min(
    Math.max(Math.round(Number(raw?.defaultLeadDays) || DEFAULT_LEAD_DAYS), 1),
    365
  );
  const maxSends = Math.min(
    Math.max(Math.round(Number(raw?.maxSendsPerDay) || DEFAULT_MAX_SENDS), 1),
    2000
  );
  return {
    enabled: raw?.enabled !== false,
    defaultLeadDays: leadDays,
    defaultNotifyEmail: toSingleEmail(raw?.defaultNotifyEmail),
    ccEmails: toEmailList(raw?.ccEmails),
    digestToOps: raw?.digestToOps !== false,
    includeExpired: raw?.includeExpired !== false,
    maxSendsPerDay: maxSends,
    lastModified: raw?.lastModified || null
  };
}

export async function getReminderSettings(companyId) {
  if (!companyId) return normalizeReminderSettings(null);
  const raw = await getCompanyModuleDoc(companyId, REMINDER_MODULE, REMINDER_DOC_ID);
  return normalizeReminderSettings(raw);
}

export async function saveReminderSettings(companyId, payload, updatedBy = null) {
  if (!companyId) {
    throw new Error('Company workspace is required to save reminder settings.');
  }
  const normalized = normalizeReminderSettings(payload);
  await setCompanyModuleDoc(companyId, REMINDER_MODULE, REMINDER_DOC_ID, {
    enabled: normalized.enabled,
    defaultLeadDays: normalized.defaultLeadDays,
    defaultNotifyEmail: normalized.defaultNotifyEmail,
    ccEmails: normalized.ccEmails,
    digestToOps: normalized.digestToOps,
    includeExpired: normalized.includeExpired,
    maxSendsPerDay: normalized.maxSendsPerDay,
    updatedBy: updatedBy || null
  });
  return normalized;
}

export async function getLatestReminderRun(companyId) {
  if (!companyId) return null;
  const snapshot = await getDocs(
    query(companyModuleCollection(companyId, RUNS_MODULE), orderBy('at', 'desc'), limit(1))
  );
  if (snapshot.empty) return null;
  const latest = snapshot.docs[0];
  return { id: latest.id, ...latest.data() };
}

export async function listReminderRuns(companyId, count = 10) {
  if (!companyId) return [];
  const snapshot = await getDocs(
    query(companyModuleCollection(companyId, RUNS_MODULE), orderBy('at', 'desc'), limit(Math.min(Math.max(count, 1), 25)))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function listRecentReminderLogs(companyId, count = 25) {
  if (!companyId) return [];
  const snapshot = await getDocs(
    query(companyModuleCollection(companyId, LOGS_MODULE), orderBy('sentAt', 'desc'), limit(Math.min(Math.max(count, 1), 50)))
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

// Session cache: reminder logs change at most once a day, so one read per
// pilot per session keeps the crew UI cheap.
const pilotLogCache = new Map();

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

/**
 * Latest sent log per document for one pilot, keyed by docId.
 * Single-field equality query (no composite index needed).
 */
export async function getReminderLogsForPilot(companyId, pilotUid, { refresh = false } = {}) {
  if (!companyId || !pilotUid) return new Map();
  const cacheKey = `${companyId}:${pilotUid}`;
  if (!refresh && pilotLogCache.has(cacheKey)) return pilotLogCache.get(cacheKey);
  const snapshot = await getDocs(
    query(companyModuleCollection(companyId, LOGS_MODULE), where('userId', '==', pilotUid))
  );
  const latestByDoc = new Map();
  snapshot.docs.forEach((item) => {
    const data = item.data() || {};
    if ((data.status || '') !== 'sent' || !data.docId) return;
    const sentAt = toDateValue(data.sentAt);
    const current = latestByDoc.get(data.docId);
    const currentAt = current ? toDateValue(current.sentAt) : null;
    if (!current || (sentAt && (!currentAt || sentAt.getTime() > currentAt.getTime()))) {
      latestByDoc.set(data.docId, data);
    }
  });
  pilotLogCache.set(cacheKey, latestByDoc);
  return latestByDoc;
}

/**
 * Manually trigger the daily job for this company (Cloud Function
 * `sendExpiryRemindersNow`). Throws a readable error when the function
 * is not deployed or the caller lacks permission.
 */
export async function runRemindersNow() {
  const call = httpsCallable(getFunctions(), 'sendExpiryRemindersNow');
  const result = await call({});
  return result?.data || null;
}

/**
 * Dry-run preview: who would be mailed today, without sending anything.
 */
export async function previewReminders() {
  const call = httpsCallable(getFunctions(), 'previewReminders');
  const result = await call({});
  return result?.data || null;
}

/**
 * Send a test mail to one address to verify the SMTP pipeline.
 */
export async function sendTestReminder(to) {
  const call = httpsCallable(getFunctions(), 'sendTestReminder');
  const result = await call({ to });
  return result?.data || null;
}
