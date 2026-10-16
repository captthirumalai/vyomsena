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
  return `sent ${run.sent || 0} · no email ${run.skippedNoEmail || 0} · already sent ${run.skippedAlreadySent || 0}`
    + (run.skippedQuota ? ` · quota-deferred ${run.skippedQuota}` : '')
    + (run.failed ? ` · failed ${run.failed}` : '');
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
  if (!preview) {
    body.innerHTML = '<tr><td colspan="3" class="nt-empty">Preview unavailable.</td></tr>';
    return;
  }
  if (!preview.enabled) {
    body.innerHTML = '<tr><td colspan="3" class="nt-empty">Daily mails are OFF — no one would be mailed. Turn them on to preview recipients.</td></tr>';
    return;
  }
  if (!preview.groups?.length) {
    body.innerHTML = '<tr><td colspan="3" class="nt-empty">No documents in a reminder window today. Nothing would be sent.</td></tr>';
    return;
  }
  body.innerHTML = preview.groups
    .map((group) => {
      const docs = group.items
        .map((item) => `${escapeHtml(item.documentName)} (${item.days < 0 ? 'expired' : `in ${item.days}d`} · ${escapeHtml(tierLabel(item.tier))})`)
        .join('<br />');
      return `<tr>
        <td>${escapeHtml(group.pilotName)}</td>
        <td>${escapeHtml(group.pilotEmail || 'no email on file')}</td>
        <td>${docs}</td>
      </tr>`;
    })
    .join('');
}

function renderRuns(runs) {
  const body = query('#nt-runs-body');
  if (!body) return;
  if (!runs.length) {
    body.innerHTML = '<tr><td colspan="7" class="nt-empty">No runs recorded yet. Press Run now or wait for the 06:00 IST schedule.</td></tr>';
    return;
  }
  body.innerHTML = runs
    .map((run) => `<tr>
      <td>${escapeHtml(formatShortDateTime(run.at || run.lastModified))}</td>
      <td>${escapeHtml(run.triggeredBy || '—')}</td>
      <td>${run.sent || 0}</td>
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
    renderSettings(settings);
    if (!query('#nt-notify')?.value && company?.ownerEmail) {
      query('#nt-notify').value = company.ownerEmail;
    }
    const latest = await refreshHistory();
    renderStatus(settings, latest);
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
  runButton?.addEventListener('click', handleRunNow);
  testButton?.addEventListener('click', handleTestSend);
  previewButton?.addEventListener('click', handlePreview);

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
