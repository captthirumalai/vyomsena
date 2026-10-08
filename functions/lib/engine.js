/**
 * Expiry-reminder engine. Scans user_documents, escalates through tiers,
 * sends one mail per pilot, dedupes via per-company reminder_logs so a
 * given (document, tier, expiry) fires exactly once.
 */

const {
  MS_PER_DAY,
  DEFAULT_LEAD_DAYS,
  MAX_LEAD_DAYS,
  daysUntil,
  tiersForLead,
  tierToSend,
  reminderKey
} = require('./tiers');
const { sendPilotReminder, sendOpsDigest } = require('./email');

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultLeadDays: DEFAULT_LEAD_DAYS,
  ccEmails: [],
  digestToOps: true,
  includeExpired: true
};

function toEmailList(value) {
  if (Array.isArray(value)) return value.map((item) => `${item || ''}`.trim().toLowerCase()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[,\s;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

async function loadSettings(db, companyId) {
  const ref = db.doc(`companies/${companyId}/reminder_settings/current`);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { ...DEFAULT_SETTINGS };
  const raw = snapshot.data() || {};
  return {
    enabled: raw.enabled !== false,
    defaultLeadDays: Math.min(Math.max(Math.round(Number(raw.defaultLeadDays) || DEFAULT_LEAD_DAYS), 1), MAX_LEAD_DAYS),
    ccEmails: toEmailList(raw.ccEmails),
    digestToOps: raw.digestToOps !== false,
    includeExpired: raw.includeExpired !== false
  };
}

async function resolvePilotContact(db, userId) {
  if (!userId) return { name: 'Pilot', email: null };
  const userSnap = await db.doc(`users/${userId}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  let name = userData.fullName || userData.name || userData.displayName || null;
  let email = userData.email || null;

  const profileSnap = await db.doc(`crew_profiles/${userId}`).get();
  const profileData = profileSnap.exists ? profileSnap.data() || {} : {};
  name = name || profileData.fullName || profileData.name || 'Pilot';
  email = email || profileData.email || null;

  if (!email) {
    const byPilot = await db.collection('crew_profiles').where('pilotUid', '==', userId).limit(1).get();
    if (!byPilot.empty) {
      const data = byPilot.docs[0].data() || {};
      name = name === 'Pilot' ? data.fullName || data.name || name : name;
      email = data.email || email;
    }
  }
  return { name, email: email ? `${email}`.trim().toLowerCase() : null };
}

/**
 * Scan and send. scopeCompanyId restricts to one company (manual trigger);
 * without it, every company with in-window documents is processed.
 * Returns a machine-readable summary (also persisted per company).
 */
async function runExpiryReminders({ db, transport, from, now = new Date(), scopeCompanyId = null, actorUid = null }) {
  const pastBound = new Date(now.getTime() - 60 * MS_PER_DAY);
  const futureBound = new Date(now.getTime() + MAX_LEAD_DAYS * MS_PER_DAY);

  let docsQuery = db.collection('user_documents')
    .where('expiryDate', '>=', pastBound)
    .where('expiryDate', '<=', futureBound);
  if (scopeCompanyId) docsQuery = docsQuery.where('operatorId', '==', scopeCompanyId);
  const docsSnap = await docsQuery.get();

  const byCompany = new Map();
  for (const docSnap of docsSnap.docs) {
    const data = docSnap.data() || {};
    const operatorId = data.operatorId || null;
    if (!operatorId) continue;
    if (!byCompany.has(operatorId)) byCompany.set(operatorId, []);
    byCompany.get(operatorId).push({ id: docSnap.id, data });
  }

  const runId = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const summary = { runId, at: now.toISOString(), triggeredBy: actorUid || 'schedule', companies: {} };

  for (const [companyId, docs] of byCompany.entries()) {
    const companySummary = { sent: 0, skippedNoEmail: 0, skippedAlreadySent: 0, failed: 0, details: [] };
    summary.companies[companyId] = companySummary;

    const settings = await loadSettings(db, companyId);
    if (!settings.enabled) {
      companySummary.details.push('reminders disabled in settings');
      continue;
    }

    const companySnap = await db.doc(`companies/${companyId}`).get();
    const companyData = companySnap.exists ? companySnap.data() || {} : {};
    const companyName = companyData.name || 'Your operator';
    const opsRecipients = toEmailList([companyData.ownerEmail, ...settings.ccEmails]);

    // Group in-window documents per pilot.
    const pilots = new Map();
    for (const { id, data } of docs) {
      const days = daysUntil(data.expiryDate, now);
      if (days === null) continue;
      if (days < 0 && !settings.includeExpired) continue;
      const lead = Math.min(Math.max(Math.round(Number(data.reminderLeadTimeDays) || settings.defaultLeadDays), 1), MAX_LEAD_DAYS);
      const tier = tierToSend(days, tiersForLead(lead));
      if (tier === null) continue;
      const expiry = data.expiryDate?.toDate ? data.expiryDate.toDate() : new Date(data.expiryDate);
      const item = {
        docId: id,
        documentName: data.documentName || 'Document',
        documentCategory: data.documentCategory || null,
        licenseOrCertificateNumber: data.licenseOrCertificateNumber || null,
        expiryDate: expiry,
        expiryMs: expiry.getTime(),
        days,
        tier,
        userId: data.userId || null
      };
      const key = item.userId || 'unknown';
      if (!pilots.has(key)) pilots.set(key, []);
      pilots.get(key).push(item);
    }

    if (!pilots.size) {
      await db.doc(`companies/${companyId}/reminder_runs/${runId}`).set({
        ...companySummary, at: now.toISOString(), triggeredBy: actorUid || 'schedule'
      });
      continue;
    }

    // Dedupe: one mail per (document, tier, expiry). All tiers for a pilot
    // land in a single mail only if every tier is unsent; sent tiers are
    // excluded so nothing fires twice.
    const allKeys = [];
    for (const items of pilots.values()) {
      for (const item of items) allKeys.push(reminderKey(item.docId, item.expiryMs, `${item.tier}`));
    }
    const logRefs = allKeys.map((key) => db.doc(`companies/${companyId}/reminder_logs/${key}`));
    const logSnaps = logRefs.length ? await db.getAll(...logRefs) : [];
    const alreadySent = new Set();
    logSnaps.forEach((snap, index) => {
      if (snap.exists && (snap.data() || {}).status === 'sent') alreadySent.add(allKeys[index]);
    });

    const pilotGroups = [];
    for (const [userId, items] of pilots.entries()) {
      const unsent = items.filter((item) => !alreadySent.has(reminderKey(item.docId, item.expiryMs, `${item.tier}`)));
      companySummary.skippedAlreadySent += items.length - unsent.length;
      if (!unsent.length) continue;
      const contact = await resolvePilotContact(db, userId);
      if (!contact.email) {
        companySummary.skippedNoEmail += unsent.length;
        companySummary.details.push(`no email for pilot ${contact.name} (${unsent.length} doc(s))`);
        continue;
      }
      pilotGroups.push({ userId, pilotName: contact.name, pilotEmail: contact.email, items: unsent });
    }

    const batch = db.batch();
    const sentItems = [];
    for (const group of pilotGroups) {
      try {
        await sendPilotReminder(transport, {
          from,
          to: group.pilotEmail,
          companyName,
          pilotName: group.pilotName,
          items: group.items
        });
        companySummary.sent += 1;
        for (const item of group.items) {
          batch.set(db.doc(`companies/${companyId}/reminder_logs/${reminderKey(item.docId, item.expiryMs, `${item.tier}`)}`), {
            docId: item.docId,
            userId: group.userId,
            pilotEmail: group.pilotEmail,
            tier: `${item.tier}`,
            expiryMs: item.expiryMs,
            status: 'sent',
            sentAt: now,
            triggeredBy: actorUid || 'schedule'
          }, { merge: true });
        }
        sentItems.push(group);
      } catch (error) {
        companySummary.failed += 1;
        companySummary.details.push(`send failed for ${group.pilotEmail}: ${error.message || error}`);
      }
    }

    if (settings.digestToOps && opsRecipients.length && sentItems.length) {
      try {
        await sendOpsDigest(transport, { from, to: opsRecipients, companyName, groups: sentItems });
        companySummary.details.push(`ops digest sent to ${opsRecipients.join(', ')}`);
      } catch (error) {
        companySummary.details.push(`ops digest failed: ${error.message || error}`);
      }
    }

    await batch.commit();
    await db.doc(`companies/${companyId}/reminder_runs/${runId}`).set({
      ...companySummary, at: now.toISOString(), triggeredBy: actorUid || 'schedule'
    });
  }

  return summary;
}

module.exports = { runExpiryReminders, loadSettings, DEFAULT_SETTINGS };
