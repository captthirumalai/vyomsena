/**
 * Expiry-reminder engine. Scans user_documents, escalates through tiers,
 * sends one mail per pilot, dedupes via per-company reminder_logs so a
 * given (document, tier, expiry) fires exactly once.
 *
 * Query design: single-field filters only (no composite indexes required).
 * Company scoping and tier math happen in code.
 */

const {
  MS_PER_DAY,
  DEFAULT_LEAD_DAYS,
  MAX_LEAD_DAYS,
  daysUntil,
  tierToSend,
  reminderKey,
  isDue
} = require('./tiers');
const { sendPilotReminder, sendOpsDigest, sendFailureAlert } = require('./email');

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultLeadDays: DEFAULT_LEAD_DAYS,
  pilotReminderTiers: [60, 30, 15],
  urgentDailyEnabled: true,
  defaultNotifyEmail: null,
  ccEmails: [],
  digestToOps: true,
  digestRecipients: null,
  includeExpiredInDigest: false,
  includeExpired: true,
  maxSendsPerDay: 450
};

function toEmailList(value) {
  if (Array.isArray(value)) return value.map((item) => `${item || ''}`.trim().toLowerCase()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[,\s;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function toSingleEmail(value) {
  const cleaned = `${value || ''}`.trim().toLowerCase();
  return /.+@.+\..+/.test(cleaned) ? cleaned : null;
}

function clampLead(value, fallback) {
  return Math.min(Math.max(Math.round(Number(value) || fallback), 1), MAX_LEAD_DAYS);
}

async function loadSettings(db, companyId) {
  const ref = db.doc(`companies/${companyId}/reminder_settings/current`);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { ...DEFAULT_SETTINGS };
  const raw = snapshot.data() || {};
  return {
    enabled: raw.enabled !== false,
    defaultLeadDays: clampLead(raw.defaultLeadDays, DEFAULT_LEAD_DAYS),
    pilotReminderTiers: Array.isArray(raw.pilotReminderTiers)
      ? [...new Set(raw.pilotReminderTiers.map(Number).filter((value) => [60, 30, 15].includes(value)))].sort((a, b) => b - a)
      : DEFAULT_SETTINGS.pilotReminderTiers,
    urgentDailyEnabled: raw.urgentDailyEnabled !== false,
    defaultNotifyEmail: toSingleEmail(raw.defaultNotifyEmail),
    ccEmails: toEmailList(raw.ccEmails),
    digestToOps: raw.digestToOps !== false,
    digestRecipients: Array.isArray(raw.digestRecipients) ? toEmailList(raw.digestRecipients) : null,
    includeExpiredInDigest: raw.includeExpiredInDigest === true,
    includeExpired: raw.includeExpired !== false,
    maxSendsPerDay: Math.min(Math.max(Math.round(Number(raw.maxSendsPerDay) || DEFAULT_SETTINGS.maxSendsPerDay), 1), 2000)
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

function toExpiryDate(value) {
  if (!value) return null;
  const raw = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return raw instanceof Date && !Number.isNaN(raw.getTime()) ? raw : null;
}

/**
 * Shared scan: pilot reminder items and digest watchlists are grouped per
 * company. Pilot tiers and the 60-day digest are calculated independently.
 */
async function collectCompanyBatches(db, now, scopeCompanyId = null) {
  const futureBound = new Date(now.getTime() + MAX_LEAD_DAYS * MS_PER_DAY);

  const docsSnap = await db.collection('user_documents')
    .where('expiryDate', '<=', futureBound)
    .get();

  const byCompany = new Map();
  for (const docSnap of docsSnap.docs) {
    const data = docSnap.data() || {};
    const operatorId = data.operatorId || null;
    if (!operatorId) continue;
    if (scopeCompanyId && operatorId !== scopeCompanyId) continue;
    if (!byCompany.has(operatorId)) byCompany.set(operatorId, []);
    byCompany.get(operatorId).push({ id: docSnap.id, data });
  }

  const companyIds = new Set(byCompany.keys());
  if (scopeCompanyId) companyIds.add(scopeCompanyId);
  else {
    const companiesSnap = await db.collection('companies').get();
    companiesSnap.docs.forEach((item) => companyIds.add(item.id));
  }

  const batches = [];
  for (const companyId of companyIds) {
    const docs = byCompany.get(companyId) || [];
    const settings = await loadSettings(db, companyId);
    const companySnap = await db.doc(`companies/${companyId}`).get();
    const companyData = companySnap.exists ? companySnap.data() || {} : {};
    const companyName = companyData.name || 'Your operator';
    const alertRecipients = toEmailList([settings.defaultNotifyEmail || companyData.ownerEmail, ...settings.ccEmails]);
    const opsRecipients = settings.digestRecipients === null
      ? alertRecipients
      : settings.digestRecipients;

    const pilotItems = new Map();
    const digestItems = new Map();
    for (const { id, data } of docs) {
      const days = daysUntil(data.expiryDate, now);
      if (days === null) continue;
      const expiry = toExpiryDate(data.expiryDate);
      if (!expiry) continue;
      const userId = data.userId || 'unknown';
      if ((days >= 0 && days <= 60) || (days < 0 && settings.includeExpiredInDigest)) {
        const item = {
          docId: id,
          documentName: data.documentName || 'Document',
          documentCategory: data.documentCategory || null,
          licenseOrCertificateNumber: data.licenseOrCertificateNumber || null,
          expiryDate: expiry,
          expiryMs: expiry.getTime(),
          days,
          tier: days < 0 ? 'expired' : 'digest',
          userId
        };
        if (!digestItems.has(userId)) digestItems.set(userId, []);
        digestItems.get(userId).push(item);
      }
    }
    if (settings.enabled) {
      for (const { id, data } of docs) {
        const days = daysUntil(data.expiryDate, now);
        if (days === null) continue;
        if (days < 0 && !settings.includeExpired) continue;
        const tierSet = [...new Set([...settings.pilotReminderTiers, 7, 1])].sort((a, b) => b - a);
        const tier = tierToSend(days, tierSet);
        if (tier === null) continue;
        const expiry = toExpiryDate(data.expiryDate);
        if (!expiry) continue;
        const item = {
          docId: id,
          documentName: data.documentName || 'Document',
          documentCategory: data.documentCategory || null,
          licenseOrCertificateNumber: data.licenseOrCertificateNumber || null,
          expiryDate: expiry,
          expiryMs: expiry.getTime(),
          days,
          tier,
          urgentDailyEnabled: settings.urgentDailyEnabled,
          userId: data.userId || null
        };
        const key = item.userId || 'unknown';
        if (!pilotItems.has(key)) pilotItems.set(key, []);
        pilotItems.get(key).push(item);
      }
    }
    batches.push({ companyId, companyName, opsRecipients, alertRecipients, settings, pilotItems, digestItems });
  }
  return batches;
}

async function resolvePilotGroups(db, pilotItems) {
  const groups = [];
  for (const [userId, items] of pilotItems.entries()) {
    const contact = userId === 'unknown'
      ? { name: 'Unassigned document', email: null }
      : await resolvePilotContact(db, userId);
    groups.push({ userId, pilotName: contact.name, pilotEmail: contact.email, items });
  }
  return groups;
}

/**
 * Dry-run preview for one company: who would be mailed today, no sends,
 * no log writes. Returns JSON-serializable data for the callable.
 */
async function previewCompanyReminders({ db, companyId, now = new Date() }) {
  const batches = await collectCompanyBatches(db, now, companyId);
  const batch = batches.find((entry) => entry.companyId === companyId);
  if (!batch) {
    return { companyId, companyName: null, enabled: true, groups: [], totalDocs: 0, totalPilots: 0, digest: { enabled: false, recipients: [], groups: [], totalDocs: 0 } };
  }
  const groups = await resolvePilotGroups(db, batch.pilotItems);
  // Due-state per item so the preview shows what today will actually do:
  // mailed (due now), notified already (inside resend interval), or no email.
  const sentAtByKey = batch.settings.enabled ? await loadSentAtByKey(db, companyId, batch.pilotItems) : new Map();
  return {
    companyId,
    companyName: batch.companyName,
    enabled: batch.settings.enabled,
    groups: groups.map((group) => ({
      pilotName: group.pilotName,
      pilotEmail: group.pilotEmail,
      items: group.items.map((item) => {
        if (!group.pilotEmail) return { ...previewItem(item), status: 'no-email' };
        const due = isDue(sentAtByKey.get(reminderKey(item.docId, item.expiryMs, `${item.tier}`)) || 0, item, now.getTime());
        return { ...previewItem(item), status: due ? 'due' : 'notified' };
      })
    })),
    totalDocs: groups.reduce((sum, group) => sum + group.items.length, 0),
    totalPilots: groups.length,
    digest: {
      enabled: batch.settings.digestToOps,
      recipients: batch.opsRecipients,
      groups: await resolvePilotGroups(db, batch.digestItems),
      totalDocs: Array.from(batch.digestItems.values()).reduce((sum, items) => sum + items.length, 0)
    }
  };
}

function previewItem(item) {
  return {
    documentName: item.documentName,
    documentCategory: item.documentCategory,
    licenseOrCertificateNumber: item.licenseOrCertificateNumber || null,
    days: item.days,
    tier: `${item.tier}`,
    expiryDate: item.expiryDate ? item.expiryDate.toISOString().slice(0, 10) : null
  };
}

async function loadSentAtByKey(db, companyId, pilotItems) {
  const allKeys = [];
  for (const items of pilotItems.values()) {
    for (const item of items) allKeys.push(reminderKey(item.docId, item.expiryMs, `${item.tier}`));
  }
  const logRefs = allKeys.map((key) => db.doc(`companies/${companyId}/reminder_logs/${key}`));
  const logSnaps = logRefs.length ? await db.getAll(...logRefs) : [];
  const sentAtByKey = new Map();
  logSnaps.forEach((snap, index) => {
    const data = (snap.exists && snap.data()) || {};
    if (data.status !== 'sent' || !data.sentAt) return;
    const raw = typeof data.sentAt.toDate === 'function' ? data.sentAt.toDate() : new Date(data.sentAt);
    const ms = raw instanceof Date && !Number.isNaN(raw.getTime()) ? raw.getTime() : 0;
    if (ms) sentAtByKey.set(allKeys[index], ms);
  });
  return sentAtByKey;
}

async function collectFullPilotDocumentGroups(db, companyId, now = new Date()) {
  const snapshot = await db.collection('user_documents').where('operatorId', '==', companyId).get();
  const grouped = new Map();
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const expiryDate = toExpiryDate(data.expiryDate);
    const days = expiryDate ? daysUntil(expiryDate, now) : null;
    const userId = data.userId || 'unknown';
    const item = {
      docId: docSnap.id,
      documentName: data.documentName || 'Document',
      documentCategory: data.documentCategory || null,
      licenseOrCertificateNumber: data.licenseOrCertificateNumber || null,
      expiryDate,
      expiryMs: expiryDate ? expiryDate.getTime() : null,
      days,
      tier: days !== null && days < 0 ? 'expired' : 'force-report',
      userId
    };
    if (!grouped.has(userId)) grouped.set(userId, []);
    grouped.get(userId).push(item);
  });
  return resolvePilotGroups(db, grouped);
}

async function previewFullPilotDocumentReport({ db, companyId, now = new Date() }) {
  const groups = await collectFullPilotDocumentGroups(db, companyId, now);
  return {
    totalPilots: groups.length,
    totalDocs: groups.reduce((sum, group) => sum + group.items.length, 0),
    groups: groups.map((group) => ({
      pilotName: group.pilotName,
      pilotEmail: group.pilotEmail,
      items: group.items.map(previewItem)
    }))
  };
}

async function sendFullPilotDocumentReport({ db, transport, from, companyId, actorUid, now = new Date() }) {
  const groups = await collectFullPilotDocumentGroups(db, companyId, now);
  const settings = await loadSettings(db, companyId);
  const companySnap = await db.doc(`companies/${companyId}`).get();
  const companyName = (companySnap.exists && companySnap.data()?.name) || 'Your operator';
  const reportId = `force-report-${now.toISOString().replace(/[:.]/g, '-')}`;
  const summary = {
    runId: reportId,
    at: now.toISOString(),
    triggeredBy: `${actorUid || 'admin'}+force-report`,
    sent: 0,
    resent: 0,
    skippedNoEmail: 0,
    skippedAlreadySent: 0,
    skippedQuota: 0,
    failed: 0,
    details: []
  };
  let batch = db.batch();
  let logCount = 0;
  for (const group of groups) {
    if (!group.pilotEmail) {
      summary.skippedNoEmail += 1;
      summary.details.push(`no email for ${group.pilotName}`);
      continue;
    }
    if (summary.sent >= settings.maxSendsPerDay) {
      summary.skippedQuota += 1;
      summary.details.push(`daily send quota reached; ${group.pilotEmail} not sent`);
      continue;
    }
    try {
      await sendPilotReminder(transport, {
        from,
        to: group.pilotEmail,
        companyName,
        pilotName: group.pilotName,
        items: group.items,
        isFullReport: true
      });
      summary.sent += 1;
      for (const item of group.items) {
        if (logCount === 450) {
          await batch.commit();
          batch = db.batch();
          logCount = 0;
        }
        const key = reminderKey(item.docId, item.expiryMs || 0, 'force-report');
        batch.set(db.doc(`companies/${companyId}/reminder_logs/${key}`), {
          docId: item.docId,
          userId: group.userId,
          pilotEmail: group.pilotEmail,
          tier: 'force-report',
          expiryMs: item.expiryMs,
          status: 'sent',
          sentAt: now,
          triggeredBy: summary.triggeredBy
        }, { merge: true });
        logCount += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.details.push(`send failed for ${group.pilotEmail}: ${error.message || error}`);
    }
  }
  if (logCount) await batch.commit();
  summary.totalPilots = groups.length;
  summary.totalDocs = groups.reduce((sum, group) => sum + group.items.length, 0);
  summary.details.push(`full document report: ${summary.sent} pilot email(s) sent; ${summary.skippedNoEmail} without email; ${summary.skippedQuota} deferred by daily limit`);
  await db.doc(`companies/${companyId}/reminder_runs/${reportId}`).set(summary);
  return summary;
}

/**
 * Scan and send. scopeCompanyId restricts to one company (manual trigger);
 * without it, every company is processed so enabled digests can run daily,
 * including on days with an empty watchlist.
 * forceResend bypasses the already-sent dedupe (manual "mail everyone with
 * the latest details"); the daily schedule always runs with it off.
 * Returns a machine-readable summary (also persisted per company).
 */
async function runExpiryReminders({ db, transport, from, now = new Date(), scopeCompanyId = null, actorUid = null, forceResend = false }) {
  const runId = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const triggeredBy = `${actorUid || 'schedule'}${forceResend ? '+force' : ''}`;
  const summary = { runId, at: now.toISOString(), triggeredBy, companies: {}, forced: forceResend === true };
  const batches = await collectCompanyBatches(db, now, scopeCompanyId);

  for (const batch of batches) {
    const { companyId, companyName, opsRecipients, alertRecipients, settings, pilotItems, digestItems } = batch;
    const companySummary = {
      sent: 0,
      resent: 0,
      skippedNoEmail: 0,
      skippedAlreadySent: 0,
      skippedQuota: 0,
      failed: 0,
      quotaReached: false,
      details: []
    };
    summary.companies[companyId] = companySummary;

    const persistRun = async () => {
      await db.doc(`companies/${companyId}/reminder_runs/${runId}`).set({
        ...companySummary, at: now.toISOString(), triggeredBy
      });
    };

    try {
      if (!settings.enabled) companySummary.details.push('pilot reminders disabled in settings');
      const shouldRunDigest = settings.digestToOps && opsRecipients.length > 0;
      if (!settings.enabled && !shouldRunDigest) {
        await persistRun();
        continue;
      }

      // Selected tiers send once. Urgent and expired reminders repeat daily
      // until the document's expiry date is updated.
      const sentAtByKey = pilotItems.size ? await loadSentAtByKey(db, companyId, pilotItems) : new Map();

      const pilotGroups = [];
      for (const [userId, items] of (settings.enabled ? pilotItems : new Map()).entries()) {
        // Forced resends mail every in-window tier again with the latest
        // details (log entries are refreshed on success).
        const unsent = forceResend
          ? items
          : items.filter((item) => isDue(
              sentAtByKey.get(reminderKey(item.docId, item.expiryMs, `${item.tier}`)) || 0,
              item,
              now.getTime()
            ));
        companySummary.skippedAlreadySent += forceResend ? 0 : items.length - unsent.length;
        if (!unsent.length) continue;
        const contact = userId === 'unknown'
          ? { name: 'Unassigned document', email: null }
          : await resolvePilotContact(db, userId);
        if (!contact.email) {
          companySummary.skippedNoEmail += unsent.length;
          companySummary.details.push(`no email for pilot ${contact.name} (${unsent.length} doc(s))`);
          continue;
        }
        pilotGroups.push({ userId, pilotName: contact.name, pilotEmail: contact.email, items: unsent });
      }

      // Gmail quota guard: stop before the provider locks the mailbox.
      // Unsent groups simply retry on the next run (no log written).
      let sendsUsed = 0;
      const quota = settings.maxSendsPerDay;
      const pilotQuota = shouldRunDigest ? Math.max(0, quota - 1) : quota;
      let batch = db.batch();
      let reminderLogWrites = 0;
      for (const group of pilotGroups) {
        if (sendsUsed >= pilotQuota) {
          companySummary.quotaReached = true;
          companySummary.skippedQuota += group.items.length;
          companySummary.details.push(`daily send quota reached (${quota}); ${group.pilotEmail} deferred to next run`);
          continue;
        }
        try {
          await sendPilotReminder(transport, {
            from,
            to: group.pilotEmail,
            companyName,
            pilotName: group.pilotName,
            items: group.items
          });
          sendsUsed += 1;
          companySummary.sent += 1;
          for (const item of group.items) {
            if (reminderLogWrites === 450) {
              await batch.commit();
              batch = db.batch();
              reminderLogWrites = 0;
            }
            if (!forceResend && sentAtByKey.has(reminderKey(item.docId, item.expiryMs, `${item.tier}`))) {
              companySummary.resent += 1;
            }
            batch.set(db.doc(`companies/${companyId}/reminder_logs/${reminderKey(item.docId, item.expiryMs, `${item.tier}`)}`), {
              docId: item.docId,
              userId: group.userId,
              pilotEmail: group.pilotEmail,
              tier: `${item.tier}`,
              expiryMs: item.expiryMs,
              status: 'sent',
              sentAt: now,
              triggeredBy
            }, { merge: true });
            reminderLogWrites += 1;
          }
        } catch (error) {
          companySummary.failed += 1;
          companySummary.details.push(`send failed for ${group.pilotEmail}: ${error.message || error}`);
        }
      }

      // The operations digest is independent of pilot reminder tiers and
      // contains the next 60 days, plus expired documents when configured.
      if (shouldRunDigest && sendsUsed < quota) {
        try {
          const digestGroups = await resolvePilotGroups(db, digestItems);
          await sendOpsDigest(transport, { from, to: opsRecipients, companyName, groups: digestGroups });
          sendsUsed += 1;
          companySummary.details.push(`60-day ops digest sent to ${opsRecipients.join(', ')} (${digestGroups.reduce((sum, group) => sum + group.items.length, 0)} document(s))`);
        } catch (error) {
          companySummary.details.push(`ops digest failed: ${error.message || error}`);
        }
      } else if (settings.digestToOps && !opsRecipients.length) {
        companySummary.details.push('daily digest enabled but no recipients are configured');
      }

      if (reminderLogWrites) await batch.commit();
      await persistRun();

      // Failure alert: a broken SMTP is otherwise silent. Mail ops directly.
      if ((companySummary.failed > 0 || companySummary.quotaReached) && alertRecipients.length) {
        try {
          await sendFailureAlert(transport, { from, to: alertRecipients, companyName, companySummary });
          companySummary.details.push('failure alert sent to ops');
          await persistRun();
        } catch (error) {
          companySummary.details.push(`failure alert failed: ${error.message || error}`);
          await persistRun();
        }
      }
    } catch (error) {
      companySummary.failed += 1;
      companySummary.details.push(`run error: ${error.message || error}`);
      await persistRun();
      if (alertRecipients.length) {
        try {
          await sendFailureAlert(transport, { from, to: alertRecipients, companyName, companySummary });
        } catch (alertError) {
          companySummary.details.push(`failure alert failed: ${alertError.message || alertError}`);
          await persistRun();
        }
      }
    }
  }

  return summary;
}

module.exports = {
  runExpiryReminders,
  previewCompanyReminders,
  previewFullPilotDocumentReport,
  sendFullPilotDocumentReport,
  loadSettings,
  DEFAULT_SETTINGS
};
