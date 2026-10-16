/**
 * Pure reminder-window logic shared by the scheduled job and the manual trigger.
 * No firebase imports here so the math stays unit-testable.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_LEAD_DAYS = 30;
const MAX_LEAD_DAYS = 365;

function toDateValue(value) {
  if (!value) return null;
  const raw = typeof value.toDate === 'function' ? value.toDate() : value;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function daysUntil(expiryDate, now = new Date()) {
  const expiry = toDateValue(expiryDate);
  if (!expiry) return null;
  return Math.ceil((expiry.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Escalation tiers for a lead window, highest first.
 * e.g. lead 30 -> [30, 15, 7, 1]; lead 7 -> [7, 4, 1].
 */
function tiersForLead(leadDays) {
  const lead = Math.min(Math.max(Math.round(Number(leadDays) || DEFAULT_LEAD_DAYS), 1), MAX_LEAD_DAYS);
  const tiers = new Set([lead, Math.ceil(lead / 2), 7, 1]);
  return Array.from(tiers)
    .filter((tier) => tier >= 1 && tier <= lead)
    .sort((left, right) => right - left);
}

/**
 * Which tier (if any) fires today for a document `days` away from expiry.
 * tiers must be sorted descending. Returns the tier number, 'expired', or null.
 */
function tierToSend(days, tiers) {
  if (days === null || days === undefined) return null;
  if (days < 0) return 'expired';
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const nextLower = index + 1 < tiers.length ? tiers[index + 1] : -1;
    if (days <= tier && days > nextLower) return tier;
  }
  return null;
}

function reminderKey(docId, expiryMs, tier) {
  return `${docId}|${expiryMs}|${tier}`;
}

const URGENT_DAYS = 7;
const RESEND_INTERVAL_DAYS = 7;

/**
 * How often the same (document, tier) may re-notify, in days.
 * Expired documents repeat weekly; anything within the urgent window
 * re-notifies daily; all other in-window tiers repeat weekly.
 */
function resendIntervalDays(item) {
  if (!item) return RESEND_INTERVAL_DAYS;
  if (`${item.tier}` === 'expired') return RESEND_INTERVAL_DAYS;
  if (Number(item.days) <= URGENT_DAYS) return 1;
  return RESEND_INTERVAL_DAYS;
}

/**
 * True when a reminder is due: never sent, or the last send is older than
 * the item's resend interval. Pure and unit-testable.
 */
function isDue(lastSentMs, item, nowMs = Date.now()) {
  if (!lastSentMs) return true;
  const intervalMs = resendIntervalDays(item) * MS_PER_DAY;
  return nowMs - lastSentMs >= intervalMs;
}

module.exports = {
  MS_PER_DAY,
  DEFAULT_LEAD_DAYS,
  MAX_LEAD_DAYS,
  URGENT_DAYS,
  RESEND_INTERVAL_DAYS,
  toDateValue,
  daysUntil,
  tiersForLead,
  tierToSend,
  reminderKey,
  resendIntervalDays,
  isDue
};
