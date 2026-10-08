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

module.exports = {
  MS_PER_DAY,
  DEFAULT_LEAD_DAYS,
  MAX_LEAD_DAYS,
  toDateValue,
  daysUntil,
  tiersForLead,
  tierToSend,
  reminderKey
};
