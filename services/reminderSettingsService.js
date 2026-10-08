import {
  query,
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
const DEFAULT_LEAD_DAYS = 30;

export function normalizeReminderSettings(raw) {
  const leadDays = Math.min(
    Math.max(Math.round(Number(raw?.defaultLeadDays) || DEFAULT_LEAD_DAYS), 1),
    365
  );
  const ccEmails = Array.isArray(raw?.ccEmails)
    ? raw.ccEmails
    : `${raw?.ccEmails || ''}`.split(/[,\s;]+/);
  return {
    enabled: raw?.enabled !== false,
    defaultLeadDays: leadDays,
    ccEmails: [...new Set(ccEmails.map((email) => `${email || ''}`.trim().toLowerCase()).filter(Boolean))],
    digestToOps: raw?.digestToOps !== false,
    includeExpired: raw?.includeExpired !== false,
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
    ccEmails: normalized.ccEmails,
    digestToOps: normalized.digestToOps,
    includeExpired: normalized.includeExpired,
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
