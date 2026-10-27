import { getCompany } from '../../services/companyService.js';
import { getLatestReminderRun } from '../../services/reminderSettingsService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';

function formatShortDateTime(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export async function init(view, context) {
  const currentUser = context?.currentUser;
  const companyId = getCurrentOrganizationContext(currentUser).organizationId || currentUser?.uid || null;
  if (!companyId) {
    view.querySelector('#st-company-name').textContent = 'No operator workspace found.';
    return { destroy() {} };
  }
  try {
    const [company, run] = await Promise.all([
      getCompany(companyId),
      getLatestReminderRun(companyId).catch(() => null)
    ]);
    view.querySelector('#st-company-name').textContent = company?.name || '—';
    view.querySelector('#st-company-base').textContent = company?.base || '—';
    view.querySelector('#st-company-code').textContent = company?.code || '—';
    view.querySelector('#st-company-owner').textContent = company?.ownerEmail || '—';
    view.querySelector('#st-reminder-last-run').textContent = run ? formatShortDateTime(run.at || run.lastModified) : 'Never';
    view.querySelector('#st-reminder-last-result').textContent = run
      ? `sent ${run.sent || 0} pilot email(s), skipped ${run.skippedNoEmail || 0} without email, already sent ${run.skippedAlreadySent || 0}${run.failed ? `, failed ${run.failed}` : ''}`
      : '—';
  } catch (error) {
    console.error('Workspace settings load failed:', error);
    view.querySelector('#st-company-name').textContent = 'Unable to load workspace.';
  }
  return { destroy() {} };
}
