import {
  getReminderSettings,
  saveReminderSettings,
  getLatestReminderRun,
  listReminderRuns,
  listRecentReminderLogs,
  runRemindersNow,
  previewReminders,
  sendTestReminder
} from '../../services/reminderSettingsService.js';
import { getCompany } from '../../services/companyService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { listManagedDocuments } from '../../services/documentService.js';
import { listCrewProfilesForOperator } from '../../services/crewProfileService.js';

function query(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatShortDateTime(value) {
  const date = toDateValue(value);
  if (!date) return '—';
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function setButtonState(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.querySelector('.nt-btn-spinner')?.classList.toggle('hidden', !loading);
}

function setStatus(element, message, tone = '') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('is-success', 'is-error');
  if (tone) element.classList.add(`is-${tone}`);
}

function summarizeRun(run) {
  if (!run) return '—';
  return `sent ${run.sent || 0}${run.resent ? ` (${run.resent} reminders)` : ''} · no email ${run.skippedNoEmail || 0} · skipped ${run.skippedAlreadySent || 0}`
    + (run.skippedQuota ? ` · quota-deferred ${run.skippedQuota}` : '')
    + (run.failed ? ` · failed ${run.failed}` : '');
}

let dashboardRows = [];
let dashboardPilotCount = 0;
let dashboardTab = 'all';
let dashboardMetric = 'all';
let selectedDocumentId = null;

function docCategory(document) {
  const text = `${document.documentCategory || ''} ${document.documentName || ''}`.toLowerCase();
  if (/medical|medic/.test(text)) return 'medical';
  if (/training|crm|proficiency|check|course/.test(text)) return 'training';
  if (/licen[cs]e|rating|endorsement|rtr|frtol|instrument/.test(text)) return 'license';
  return 'other';
}

function daysUntilExpiry(document) {
  const date = toDateValue(document.expiryDate);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / 86400000);
}

function expiryState(days) {
  if (days === null) return { key: 'unknown', label: 'No expiry date', tone: 'muted' };
  if (days < 0) return { key: 'expired', label: `Expired ${Math.abs(days)}d ago`, tone: 'red' };
  if (days <= 7) return { key: 'urgent', label: `Critical · ${days}d left`, tone: 'red' };
  if (days <= 30) return { key: 'urgent', label: `${days}d remaining`, tone: 'amber' };
  if (days <= 90) return { key: 'upcoming', label: `${days}d remaining`, tone: 'blue' };
  return { key: 'valid', label: 'Valid', tone: 'green' };
}

function safeDate(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString(undefined, options) : 'Not recorded';
}

function renderDashboard() {
  const rows = dashboardRows;
  const expiring90 = rows.filter((row) => row.days !== null && row.days > 30 && row.days <= 90).length;
  const valid = rows.filter((row) => row.days !== null && row.days > 90).length;
  query('#nt-metric-urgent').textContent = rows.filter((row) => row.days !== null && row.days <= 30).length;
  query('#nt-metric-upcoming').textContent = expiring90;
  query('#nt-metric-valid').textContent = valid;
  query('#nt-metric-scheduled').textContent = rows.filter((row) => row.days !== null && row.days >= 0 && row.days <= row.leadDays).length;
  query('#nt-metric-pilots').textContent = dashboardPilotCount;
  query('#nt-count-all').textContent = rows.length;
  query('#nt-count-license').textContent = rows.filter((row) => row.category === 'license').length;
  query('#nt-count-medical').textContent = rows.filter((row) => row.category === 'medical').length;
  query('#nt-count-training').textContent = rows.filter((row) => row.category === 'training').length;
  query('#nt-count-other').textContent = rows.filter((row) => row.category === 'other').length;

  const text = `${query('#nt-table-search')?.value || ''} ${query('#nt-global-search')?.value || ''}`.trim().toLowerCase();
  const type = query('#nt-filter-type')?.value || 'all';
  const status = query('#nt-filter-status')?.value || 'all';
  const dateRange = query('#nt-filter-date')?.value || 'all';
  const filtered = rows.filter((row) => {
    const state = expiryState(row.days);
    const haystack = `${row.pilotName} ${row.email} ${row.name} ${row.number} ${row.category}`.toLowerCase();
    return (!text || haystack.includes(text))
      && (dashboardTab === 'all' || row.category === dashboardTab)
      && (type === 'all' || row.category === type)
      && (status === 'all' || (status === 'urgent' ? row.days !== null && row.days >= 0 && row.days <= 30 : state.key === status))
      && (dateRange === 'all' || (row.days !== null && row.days >= 0 && row.days <= Number(dateRange)))
      && (dashboardMetric !== 'scheduled' || (row.days !== null && row.days >= 0 && row.days <= row.leadDays))
      && (dashboardMetric !== 'urgent' || (row.days !== null && row.days <= 30))
      && (dashboardMetric !== 'upcoming' || (row.days !== null && row.days > 30 && row.days <= 90))
      && (dashboardMetric !== 'valid' || (row.days !== null && row.days > 90));
  }).sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));
  const body = query('#nt-documents-body');
  const empty = '<tr><td colspan="6" class="nt-empty">No documents match these filters.</td></tr>';
  body.innerHTML = filtered.length ? filtered.map((row) => {
    const state = expiryState(row.days);
    const selected = row.id === selectedDocumentId ? ' is-selected' : '';
    return `<tr class="nt-doc-row${selected}" data-document-id="${escapeHtml(row.id)}" tabindex="0"><td>${escapeHtml(safeDate(row.expiryDate))}</td><td><span class="nt-category nt-category-${row.category}">${escapeHtml(row.categoryLabel)}</span></td><td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.number || 'No document number')}</small></td><td>${escapeHtml(row.pilotName)}<small>${escapeHtml(row.email || 'No email on file')}</small></td><td><span class="nt-badge nt-badge-${state.tone}">${escapeHtml(state.label)}</span><small>${escapeHtml(row.reminderStatus)}</small></td><td><button class="nt-row-open" type="button" aria-label="View ${escapeHtml(row.name)}">›</button></td></tr>`;
  }).join('') : empty;
  const mobile = query('#nt-mobile-documents');
  mobile.innerHTML = filtered.length ? filtered.map((row) => {
    const state = expiryState(row.days);
    return `<button class="nt-mobile-doc${row.id === selectedDocumentId ? ' is-selected' : ''}" type="button" data-document-id="${escapeHtml(row.id)}"><span class="nt-mobile-doc-top"><span class="nt-category nt-category-${row.category}">${escapeHtml(row.categoryLabel)}</span><span class="nt-badge nt-badge-${state.tone}">${escapeHtml(state.label)}</span></span><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.pilotName)} · ${escapeHtml(safeDate(row.expiryDate))}</span><small>${escapeHtml(row.reminderStatus)}</small></button>`;
  }).join('') : '<p class="nt-empty">No documents match these filters.</p>';
  if (selectedDocumentId && rows.some((row) => row.id === selectedDocumentId)) renderDocumentDetail(rows.find((row) => row.id === selectedDocumentId));
}

function renderDocumentDetail(row) {
  if (!row) return;
  const days = row.days;
  const leftText = days === null ? 'Expiry date not recorded' : days < 0 ? `${Math.abs(days)} day(s) overdue` : `${days} day(s) remaining`;
  const panel = query('#nt-detail-panel');
  panel.innerHTML = `<div class="nt-detail-head"><div><span class="nt-eyebrow">DOCUMENT REMINDER</span><h3>Notification Details</h3></div><button type="button" class="nt-detail-close" id="nt-detail-close" aria-label="Clear selection">×</button></div>
    <div class="nt-detail-summary"><span class="nt-detail-alert nt-detail-${expiryState(days).tone}">${days !== null && days < 0 ? '!' : '◷'}</span><div><strong>${escapeHtml(row.name)} Expiry Reminder</strong><p>${escapeHtml(row.name)} ${days !== null && days < 0 ? 'expired' : 'expires'} ${escapeHtml(leftText)}</p><small>${escapeHtml(safeDate(row.expiryDate))}</small></div></div>
    <dl class="nt-detail-list"><div><dt>Pilot</dt><dd>${escapeHtml(row.pilotName)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(row.email || 'No email on file')}</dd></div><div><dt>Document</dt><dd>${escapeHtml(row.name)}</dd></div><div><dt>Document number</dt><dd>${escapeHtml(row.number || 'Not recorded')}</dd></div><div><dt>Expiry date</dt><dd class="${days !== null && days <= 30 ? 'nt-risk-text' : ''}">${escapeHtml(safeDate(row.expiryDate))} · ${escapeHtml(leftText)}</dd></div><div><dt>Reminder status</dt><dd>${escapeHtml(row.reminderStatus)}</dd></div><div><dt>Reminder window</dt><dd>${escapeHtml(String(row.leadDays))} days before expiry</dd></div><div><dt>Last email</dt><dd>${escapeHtml(row.lastSent ? formatShortDateTime(row.lastSent) : 'No email recorded')}</dd></div></dl>
    <div class="nt-email-preview"><div class="nt-preview-brand">✈ <strong>VyomSena</strong><small>Pilot Operations Platform</small></div><h4>${escapeHtml(row.name)} Expiry Reminder</h4><p>Dear ${escapeHtml(row.pilotName)},</p><p>Your ${escapeHtml(row.name)} is expiring on <strong>${escapeHtml(safeDate(row.expiryDate))}</strong> (${escapeHtml(leftText)}). Please take the necessary action for renewal and upload the updated document in the VyomSena portal.</p><div class="nt-email-meta"><span>Document</span><strong>${escapeHtml(row.name)}</strong><span>Document No.</span><strong>${escapeHtml(row.number || 'Not recorded')}</strong><span>Expiry Date</span><strong>${escapeHtml(safeDate(row.expiryDate))}</strong></div><span class="nt-email-link">Login to VyomSena</span><small>Reminder preview generated from the selected document.</small></div>
    <div class="nt-detail-actions"><button type="button" class="vs-button vs-button--primary vs-button--md" id="nt-detail-run">Run reminder scan</button><p>Runs the existing company-wide expiry reminder job. Individual force-send and broadcast actions are not available in the current backend.</p></div>`;
  query('#nt-detail-close')?.addEventListener('click', () => { selectedDocumentId = null; renderDashboard(); panel.innerHTML = '<div class="nt-detail-placeholder"><span>✉</span><h3>Select a document</h3><p>Choose an expiry record to review its compliance and reminder details.</p></div>'; });
  query('#nt-detail-run')?.addEventListener('click', () => query('#nt-run-now')?.click());
}

let cachedOwnerEmail = null;

function renderRecipients() {
  const list = query('#nt-recipients-list');
  if (!list) return;
  const read = (selector) => query(selector)?.value || '';
  const to = read('#nt-notify').trim().toLowerCase() || cachedOwnerEmail || null;
  const ccs = `${read('#nt-cc')}`.split(/[,\s;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const uniqueCcs = [...new Set(ccs.filter((email) => email !== to))];
  if (!to && !uniqueCcs.length) {
    list.textContent = 'No mailbox configured — set the operations mailbox above.';
    return;
  }
  const parts = [];
  if (to) parts.push(`${to} (digest + alerts)`);
  uniqueCcs.forEach((email) => parts.push(`${email} (CC)`));
  list.textContent = parts.join(' · ');
}

function renderSettings(settings) {
  if (!settings) return;
  const set = (selector, value) => {
    const el = query(selector);
    if (el) el.value = value;
  };
  const setChecked = (selector, checked) => {
    const el = query(selector);
    if (el) el.checked = checked !== false;
  };
  setChecked('#nt-enabled', settings.enabled);
  setChecked('#nt-digest', settings.digestToOps);
  setChecked('#nt-expired', settings.includeExpired);
  set('#nt-lead', settings.defaultLeadDays);
  set('#nt-notify', settings.defaultNotifyEmail || '');
  set('#nt-cc', (settings.ccEmails || []).join(', '));
  set('#nt-maxsends', settings.maxSendsPerDay);
  renderRecipients();
}

function renderStatus(settings, run) {
  const status = query('#nt-status');
  if (status) {
    status.textContent = settings && settings.enabled !== false ? 'ON — mails every day 06:00 IST' : 'OFF — daily mails paused';
  }
  const when = query('#nt-last-run');
  if (when) when.textContent = run ? formatShortDateTime(run.at || run.lastModified) : 'Never';
  const result = query('#nt-last-result');
  if (result) result.textContent = summarizeRun(run);
}

function tierLabel(tier) {
  return `${tier}` === 'expired' ? 'Expired' : `${tier}-day`;
}

function renderPreview(preview) {
  const body = query('#nt-preview-body');
  if (!body) return;
  const groupStatus = (group) => {
    if (!group.pilotEmail) return { label: 'No email', tone: 'red' };
    const states = (group.items || []).map((item) => item.status || 'due');
    if (states.includes('due')) return { label: 'Will be mailed', tone: 'green' };
    return { label: 'Already notified', tone: 'blue' };
  };
  if (!preview) {
    body.innerHTML = '<tr><td colspan="4" class="nt-empty">Preview unavailable.</td></tr>';
    return;
  }
  if (!preview.enabled) {
    body.innerHTML = '<tr><td colspan="4" class="nt-empty">Daily mails are OFF — no one would be mailed. Turn them on to preview recipients.</td></tr>';
    return;
  }
  if (!preview.groups?.length) {
    body.innerHTML = '<tr><td colspan="4" class="nt-empty">No documents in a reminder window today. Nothing would be sent.</td></tr>';
    return;
  }
  body.innerHTML = preview.groups
    .map((group) => {
      const docs = group.items
        .map((item) => `${escapeHtml(item.documentName)} (${item.days < 0 ? 'expired' : `in ${item.days}d`} · ${escapeHtml(tierLabel(item.tier))})`)
        .join('<br />');
      const status = groupStatus(group);
      return `<tr>
        <td>${escapeHtml(group.pilotName)}</td>
        <td>${escapeHtml(group.pilotEmail || 'no email on file')}</td>
        <td>${docs}</td>
        <td><span class="nt-badge nt-badge-${status.tone}">${status.label}</span></td>
      </tr>`;
    })
    .join('');
}

function renderRuns(runs) {
  const body = query('#nt-runs-body');
  if (!body) return;
  if (!runs.length) {
    body.innerHTML = '<tr><td colspan="8" class="nt-empty">No runs recorded yet. Press Run now or wait for the 06:00 IST schedule.</td></tr>';
    return;
  }
  body.innerHTML = runs
    .map((run) => `<tr>
      <td>${escapeHtml(formatShortDateTime(run.at || run.lastModified))}</td>
      <td>${escapeHtml(run.triggeredBy || '—')}</td>
      <td>${run.sent || 0}</td>
      <td>${run.resent || 0}</td>
      <td>${run.skippedNoEmail || 0}</td>
      <td>${run.skippedAlreadySent || 0}</td>
      <td>${run.failed || 0}</td>
      <td>${escapeHtml((run.details || []).slice(0, 2).join(' · ') || '—')}</td>
    </tr>`)
    .join('');
}

function renderLogs(logs) {
  const body = query('#nt-logs-body');
  if (!body) return;
  if (!logs.length) {
    body.innerHTML = '<tr><td colspan="4" class="nt-empty">No reminder mails recorded yet.</td></tr>';
    return;
  }
  body.innerHTML = logs
    .map((log) => `<tr>
      <td>${escapeHtml(formatShortDateTime(log.sentAt))}</td>
      <td>${escapeHtml(log.pilotEmail || '—')}</td>
      <td>${escapeHtml(tierLabel(log.tier))}</td>
      <td>${escapeHtml(log.docId || '—')}</td>
    </tr>`)
    .join('');
}

export async function init(view, context) {
  const currentUser = context?.currentUser;
  const companyId = getCurrentOrganizationContext(currentUser).organizationId || currentUser?.uid || null;

  if (!companyId) {
    const title = view.querySelector('.vs-card__title');
    if (title) title.textContent = 'No operator workspace found.';
    return { destroy() {} };
  }

  async function refreshHistory() {
    try {
      const [runs, logs, latest] = await Promise.all([
        listReminderRuns(companyId, 10).catch(() => []),
        listRecentReminderLogs(companyId, 25).catch(() => []),
        getLatestReminderRun(companyId).catch(() => null)
      ]);
      renderRuns(runs);
      renderLogs(logs);
      return latest;
    } catch (error) {
      console.error('Notification history load failed:', error);
      return null;
    }
  }

  async function loadAll() {
    let settings = null;
    let company = null;
    try {
      [settings, company] = await Promise.all([
        getReminderSettings(companyId).catch(() => null),
        getCompany(companyId).catch(() => null)
      ]);
    } catch (error) {
      console.error('Notification settings load failed:', error);
    }
    cachedOwnerEmail = `${company?.ownerEmail || ''}`.trim().toLowerCase() || null;
    renderSettings(settings);
    if (!query('#nt-notify')?.value && cachedOwnerEmail) {
      query('#nt-notify').value = cachedOwnerEmail;
    }
    renderRecipients();
    const latest = await refreshHistory();
    renderStatus(settings, latest);
    try {
      const [profiles, documents, logs] = await Promise.all([
        listCrewProfilesForOperator(companyId),
        listManagedDocuments(companyId),
        listRecentReminderLogs(companyId, 50).catch(() => [])
      ]);
      const pilots = profiles.filter((profile) => `${profile.role || 'PILOT'}`.toUpperCase() === 'PILOT' && `${profile.status || 'Active'}`.toLowerCase() === 'active');
      const profileByUser = new Map();
      profiles.forEach((profile) => [profile.uid, profile.pilotUid, profile.crewProfileId].filter(Boolean).forEach((id) => profileByUser.set(id, profile)));
      const latestByDoc = new Map();
      logs.forEach((log) => { if (log.docId && !latestByDoc.has(log.docId)) latestByDoc.set(log.docId, log); });
      dashboardRows = documents.map((document) => {
        const pilot = profileByUser.get(document.userId);
        if (!pilot) return null;
        const sent = latestByDoc.get(document.firestoreId);
        const category = docCategory(document);
        return {
          id: document.firestoreId,
          pilotId: pilot.uid || pilot.crewProfileId,
          pilotName: pilot.name || pilot.fullName || document.userName || 'Pilot',
          email: pilot.email || '',
          name: document.documentName || document.documentCategory || 'Document',
          number: document.licenseOrCertificateNumber || '',
          expiryDate: document.expiryDate,
          days: daysUntilExpiry(document),
          leadDays: Number(document.reminderLeadTimeDays || settings?.defaultLeadDays || 30),
          category,
          categoryLabel: ({ license: 'Licence', medical: 'Medical', training: 'Training', other: 'Other' })[category],
          lastSent: sent?.sentAt || null,
          reminderStatus: sent ? 'Sent in recent history' : 'No recent send found'
        };
      }).filter(Boolean);
      const status = query('#nt-data-status');
      if (status) status.textContent = `${dashboardRows.length} document(s) across ${pilots.length} active pilot(s). Expiry records and reminder history are loaded from the operator workspace.`;
      dashboardPilotCount = pilots.length;
      renderDashboard();
    } catch (error) {
      console.error('Notification dashboard load failed:', error);
      const status = query('#nt-data-status');
      if (status) status.textContent = 'Unable to load operator documents. Check your workspace access and try again.';
      query('#nt-documents-body').innerHTML = '<tr><td colspan="6" class="nt-empty">Documents could not be loaded.</td></tr>';
    }
  }

  const form = query('#nt-settings-form');
  const saveButton = query('#nt-save');
  const saveStatus = query('#nt-save-status');

  async function handleSave(event) {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    setButtonState(saveButton, true);
    setStatus(saveStatus, 'Saving notification settings...');
    try {
      const saved = await saveReminderSettings(
        companyId,
        {
          enabled: form.enabled?.checked !== false,
          defaultLeadDays: form.defaultLeadDays?.value,
          defaultNotifyEmail: form.defaultNotifyEmail?.value,
          ccEmails: form.ccEmails?.value,
          digestToOps: form.digestToOps?.checked !== false,
          includeExpired: form.includeExpired?.checked !== false,
          maxSendsPerDay: form.maxSendsPerDay?.value
        },
        currentUser?.email || currentUser?.uid || null
      );
      renderSettings(saved);
      const latest = await getLatestReminderRun(companyId).catch(() => null);
      renderStatus(saved, latest);
      setStatus(saveStatus, 'Settings saved. Everyday mails use these from the next run.', 'success');
    } catch (error) {
      console.error('Notification settings save failed:', error);
      setStatus(saveStatus, error.message || 'Unable to save settings.', 'error');
    } finally {
      setButtonState(saveButton, false);
    }
  }

  const runButton = query('#nt-run-now');
  const runStatus = query('#nt-run-status');

  async function handleRunNow() {
    const forceResend = query('#nt-force')?.checked === true;
    setButtonState(runButton, true);
    setStatus(
      runStatus,
      forceResend
        ? 'Resending to every in-window pilot with the latest details...'
        : 'Running expiry reminders for this company...'
    );
    try {
      const result = await runRemindersNow({ forceResend });
      setStatus(
        runStatus,
        `Run finished: ${result?.sent || 0} pilot mail(s) sent${result?.forced ? ' (forced resend).' : '.'}`,
        'success'
      );
      const latest = await refreshHistory();
      const settings = await getReminderSettings(companyId).catch(() => null);
      renderStatus(settings, latest);
    } catch (error) {
      console.error('Manual reminder run failed:', error);
      setStatus(runStatus, error.message || 'Unable to run reminders.', 'error');
    } finally {
      setButtonState(runButton, false);
    }
  }

  const testButton = query('#nt-test-send');
  const testStatus = query('#nt-test-status');

  async function handleTestSend() {
    const to = query('#nt-test-email')?.value?.trim() || '';
    if (!/.+@.+\..+/.test(to)) {
      setStatus(testStatus, 'Enter a valid email address first.', 'error');
      return;
    }
    setButtonState(testButton, true);
    setStatus(testStatus, `Sending test mail to ${to}...`);
    try {
      await sendTestReminder(to);
      setStatus(testStatus, `Test mail sent to ${to}. Check inbox (and spam).`, 'success');
    } catch (error) {
      console.error('Test mail failed:', error);
      setStatus(testStatus, error.message || 'Unable to send test mail.', 'error');
    } finally {
      setButtonState(testButton, false);
    }
  }

  const previewButton = query('#nt-preview-btn');
  const previewStatus = query('#nt-preview-status');

  async function handlePreview() {
    setButtonState(previewButton, true);
    setStatus(previewStatus, 'Scanning who would be mailed today...');
    try {
      const preview = await previewReminders();
      renderPreview(preview);
      const count = preview?.totalPilots || 0;
      setStatus(
        previewStatus,
        preview && preview.enabled === false
          ? 'Daily mails are OFF — nothing would be sent.'
          : `${count} pilot(s) would be mailed today. Nothing was sent.`,
        'success'
      );
    } catch (error) {
      console.error('Reminder preview failed:', error);
      setStatus(previewStatus, error.message || 'Unable to preview.', 'error');
    } finally {
      setButtonState(previewButton, false);
    }
  }

  form?.addEventListener('submit', handleSave);
  form?.addEventListener('input', renderRecipients);
  runButton?.addEventListener('click', handleRunNow);
  testButton?.addEventListener('click', handleTestSend);
  previewButton?.addEventListener('click', handlePreview);

  const dashboard = query('.nt-dashboard');
  dashboard?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-nt-tab]');
    if (tab) {
      dashboardTab = tab.dataset.ntTab;
      dashboard.querySelectorAll('[data-nt-tab]').forEach((item) => item.classList.toggle('active', item === tab));
      renderDashboard();
      return;
    }
    const metric = event.target.closest('[data-metric-filter]');
    if (metric) {
      const kind = metric.dataset.metricFilter;
      dashboardMetric = kind;
      query('#nt-filter-status').value = 'all';
      query('#nt-filter-date').value = 'all';
      renderDashboard();
      query('.nt-feed-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const row = event.target.closest('[data-document-id]');
    if (row) {
      selectedDocumentId = row.dataset.documentId;
      renderDashboard();
      if (window.matchMedia('(max-width: 900px)').matches) query('#nt-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  dashboard?.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.nt-doc-row')) {
      event.preventDefault();
      selectedDocumentId = event.target.dataset.documentId;
      renderDashboard();
    }
  });
  ['#nt-global-search', '#nt-table-search', '#nt-filter-type', '#nt-filter-status', '#nt-filter-date'].forEach((selector) => {
    query(selector)?.addEventListener('input', renderDashboard);
    query(selector)?.addEventListener('change', renderDashboard);
  });

  try {
    await loadAll();
  } catch (error) {
    console.error('Notification centre load failed:', error);
  }

  return {
    destroy() {
      // No long-lived listeners in this module.
    }
  };
}
