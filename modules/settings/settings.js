import {
  getCompany,
  listCompanyAccounts,
  createCompanyAccount,
  listCompanyInvites,
  generateCompanyInvite
} from '../../services/companyService.js';
import { getLatestReminderRun } from '../../services/reminderSettingsService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import {
  issueCompanyUserViaCallable,
  listCompanyUsersViaCallable,
  updateCompanyUserViaCallable,
  resetCompanyUserPasscodeViaCallable
} from '../../services/companyUserService.js';
import { getCrew } from '../../services/crewService.js';
import { appRoutes } from '../../shared/routes.js';

const ROLE_LABELS = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATIONS: 'Operations',
  PILOT: 'Pilot',
  AME: 'AME (Maintenance)',
  MEMBER: 'Member'
};

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

function getInviteStatus(invite) {
  if (invite.usedBy) return { label: 'Used', tone: 'green' };
  const expiresAt = toDateValue(invite.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return { label: 'Expired', tone: 'red' };
  return { label: 'Active', tone: 'blue' };
}

function roleLabel(role) {
  return ROLE_LABELS[`${role || ''}`.trim().toUpperCase()] || role || 'Member';
}

function renderCompanyInfo(company) {
  if (!company) return;
  query('#st-company-name').textContent = company.name || '—';
  query('#st-company-base').textContent = company.base || '—';
  query('#st-company-code').textContent = company.code || '—';
  query('#st-company-owner').textContent = company.ownerEmail || '—';
}

function renderAccounts(accounts) {
  const body = query('#st-accounts-body');
  if (!body) return;

  if (!accounts.length) {
    body.innerHTML = '<tr><td colspan="4" class="st-empty">No accounts yet. Invite the first user.</td></tr>';
    return;
  }

  body.innerHTML = accounts
    .map((account) => {
      const statusTone = `${account.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE' ? 'green' : 'red';
      return `<tr>
        <td>${escapeHtml(account.displayName || '—')}</td>
        <td>${escapeHtml(account.email || '—')}</td>
        <td>${escapeHtml(roleLabel(account.role))}</td>
        <td><span class="st-badge st-badge-${statusTone}">${escapeHtml(account.status || 'ACTIVE')}</span></td>
      </tr>`;
    })
    .join('');
}

function renderInvites(invites) {
  const body = query('#st-invites-body');
  if (!body) return;

  if (!invites.length) {
    body.innerHTML = '<tr><td colspan="5" class="st-empty">No invites generated yet.</td></tr>';
    return;
  }

  body.innerHTML = invites
    .map((invite) => {
      const status = getInviteStatus(invite);
      return `<tr>
        <td><strong>${escapeHtml(invite.code)}</strong></td>
        <td>${escapeHtml(invite.email || '—')}</td>
        <td>${escapeHtml(roleLabel(invite.role))}</td>
        <td>${escapeHtml(formatShortDateTime(invite.expiresAt))}</td>
        <td><span class="st-badge st-badge-${status.tone}">${status.label}</span></td>
      </tr>`;
    })
    .join('');
}

function renderReminderRun(run) {
  const when = query('#st-reminder-last-run');
  const result = query('#st-reminder-last-result');
  if (!when || !result) return;
  if (!run) {
    when.textContent = 'Never';
    result.textContent = '—';
    return;
  }
  when.textContent = formatShortDateTime(run.at || run.lastModified) || '—';
  result.textContent = `sent ${run.sent || 0} pilot mail(s)`
    + `, skipped ${run.skippedNoEmail || 0} (no email)`
    + `, already sent ${run.skippedAlreadySent || 0}`
    + (run.failed ? `, failed ${run.failed}` : '');
}

function setButtonState(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.querySelector('.st-btn-spinner')?.classList.toggle('hidden', !loading);
}

function setStatus(element, message, tone = '') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('is-success', 'is-error');
  if (tone) element.classList.add(`is-${tone}`);
}

export async function init(view, context) {
  const currentUser = context?.currentUser;
  const companyId = getCurrentOrganizationContext(currentUser).organizationId || currentUser?.uid || null;

  if (!companyId) {
    const content = view.querySelector('#st-company-name');
    if (content) content.textContent = 'No operator workspace found.';
    return { destroy() {} };
  }

  let company = null;
  let accounts = [];
  let invites = [];
  let lastInvite = null;

  async function loadAll() {
    const [companyResult, accountsResult, invitesResult, reminderRun] = await Promise.all([
      getCompany(companyId),
      listCompanyAccounts(companyId),
      listCompanyInvites(companyId),
      getLatestReminderRun(companyId).catch(() => null)
    ]);
    company = companyResult;
    accounts = accountsResult;
    invites = invitesResult;
    renderCompanyInfo(company);
    renderAccounts(accounts);
    renderInvites(invites);
    renderReminderRun(reminderRun);
  }

  const form = query('#st-invite-form');
  const submit = query('#st-invite-submit');
  const statusEl = query('#st-invite-status');
  const resultEl = query('#st-invite-result');
  const codeEl = query('#st-invite-code');

  function showInvite(invite) {
    lastInvite = invite;
    if (!codeEl) return;
    codeEl.textContent = invite.code;
    resultEl?.classList.remove('hidden');
  }

  async function handleInviteSubmit(event) {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;

    const displayName = form.displayName?.value?.trim();
    const email = form.email?.value?.trim().toLowerCase();
    const role = form.role?.value || 'PILOT';

    if (!displayName || !email) {
      setStatus(statusEl, 'Display name and email are required.', 'error');
      return;
    }

    setButtonState(submit, true);
    setStatus(statusEl, 'Creating account and generating invite...');

    try {
      const account = await createCompanyAccount({ companyId, role, displayName, email });
      const invite = await generateCompanyInvite({ companyId, accountId: account.accountId, email, role });
      form.reset();
      showInvite(invite);
      setStatus(statusEl, 'Invite ready.', 'success');
      await loadAll();
    } catch (error) {
      console.error('Invite generation failed:', error);
      setStatus(statusEl, error.message || 'Unable to generate invite.', 'error');
    } finally {
      setButtonState(submit, false);
    }
  }

  form?.addEventListener('submit', handleInviteSubmit);

  const companyName = () => company?.name || 'VyomSena';

  function shareMessage() {
    if (!lastInvite) return '';
    return `Join ${companyName()} on VyomSena. Your invite code is ${lastInvite.code}. It expires in 5 minutes and can be used once.`;
  }

  query('#st-invite-copy')?.addEventListener('click', async () => {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.code);
      setStatus(statusEl, 'Code copied to clipboard.', 'success');
    } catch (error) {
      setStatus(statusEl, 'Copy failed. Select and copy the code manually.', 'error');
    }
  });

  query('#st-share-whatsapp')?.addEventListener('click', () => {
    if (!lastInvite) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage())}`, '_blank', 'noopener');
  });

  query('#st-share-sms')?.addEventListener('click', () => {
    if (!lastInvite) return;
    window.location.href = `sms:?body=${encodeURIComponent(shareMessage())}`;
  });

  query('#st-share-email')?.addEventListener('click', () => {
    if (!lastInvite) return;
    const subject = `Join ${companyName()} on VyomSena`;
    window.location.href = `mailto:${encodeURIComponent(lastInvite.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareMessage())}`;
  });

  query('#st-share-close')?.addEventListener('click', () => {
    resultEl?.classList.add('hidden');
  });

  try {
    await loadAll();
  } catch (error) {
    console.error('Company workspace load failed:', error);
    renderCompanyInfo(null);
    renderAccounts([]);
    renderInvites([]);
  }

  // ---- Users & Access — Company Users (Phase C2, Admin only) ----
  // Company Users (company_users/{CMU-…}) are separate from Aviation accounts.
  // Issuance/verification stay server-side; the UI only ever displays a
  // passcode ONCE and never persists, logs, or caches it.
  const usersCard = view.querySelector('#st-users-card');
  const canManageUsers = ['OWNER', 'ADMIN'].includes(`${currentUser?.role || ''}`.trim().toUpperCase());
  if (usersCard && canManageUsers) {
    usersCard.hidden = false;
    initCompanyUsers();
  }

  function permissionModules() {
    return appRoutes
      .filter((route) => route && route.showInMenu !== false && route.path && route.name)
      .map((route) => ({ key: `${route.path}`.replace(/^\//, ''), label: route.name }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  function initCompanyUsers() {
    let usersCache = [];
    let crewCache = [];
    let expandedId = null;
    let pendingCreds = null;

    const statusEl = query('#st-users-status');
    const form = query('#st-user-form');
    const searchInput = query('#st-user-search');
    const body = query('#st-users-body');
    const permsBody = query('#st-user-perms');
    const resultEl = query('#st-user-result');

    const setUsersStatus = (message, tone = '') => setStatus(statusEl, message, tone);

    const pilotName = (crewProfileId) => {
      if (!crewProfileId) return '—';
      const found = crewCache.find((item) => (item.uid || item.crewProfileId) === crewProfileId);
      if (!found) return crewProfileId;
      return found.name || found.fullName || found.email || crewProfileId;
    };

    const permsSummary = (user) => {
      const modules = (user.permissions && user.permissions.modules) || {};
      const editable = Object.entries(modules).filter(([, rights]) => rights && rights.edit).map(([name]) => name);
      const viewOnly = Object.entries(modules).filter(([, rights]) => rights && rights.view && !rights.edit).map(([name]) => name);
      const parts = [];
      if (editable.length) parts.push(`Edit: ${editable.join(', ')}`);
      if (viewOnly.length) parts.push(`View: ${viewOnly.join(', ')}`);
      return parts.length ? parts.join(' · ') : 'No module access';
    };

    function renderPermMatrix(tbody, preset) {
      if (!tbody) return;
      const modules = (preset && preset.modules) || {};
      tbody.innerHTML = permissionModules()
        .map((mod) => {
          const rights = modules[mod.key] || {};
          return `<tr>
            <td>${escapeHtml(mod.label)}</td>
            <td><input type="checkbox" data-perm-module="${escapeHtml(mod.key)}" data-perm-right="view" ${rights.view ? 'checked' : ''} aria-label="${escapeHtml(mod.label)} view" /></td>
            <td><input type="checkbox" data-perm-module="${escapeHtml(mod.key)}" data-perm-right="edit" ${rights.edit ? 'checked' : ''} aria-label="${escapeHtml(mod.label)} edit" /></td>
          </tr>`;
        })
        .join('');
    }

    function collectPermMatrix(tbody) {
      const modules = {};
      tbody?.querySelectorAll('input[data-perm-module]').forEach((input) => {
        const key = input.dataset.permModule;
        if (!modules[key]) modules[key] = { view: false, edit: false };
        modules[key][input.dataset.permRight === 'edit' ? 'edit' : 'view'] = input.checked;
      });
      return { modules };
    }

    function renderPilotOptions(select, selectedId) {
      if (!select) return;
      const previous = selectedId !== undefined ? selectedId : select.value;
      select.innerHTML = '<option value="">— No link —</option>' + crewCache
        .map((member) => {
          const id = member.uid || member.crewProfileId;
          const label = `${member.name || member.fullName || member.email || id}`;
          return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
        })
        .join('');
      if (previous) select.value = previous;
    }

    function filteredUsers() {
      const term = `${searchInput?.value || ''}`.trim().toLowerCase();
      if (!term) return usersCache;
      return usersCache.filter((user) => [user.displayName, user.companyUserId, user.role]
        .filter(Boolean).join(' ').toLowerCase().includes(term));
    }

    function detailRowHtml(user) {
      const isActive = `${user.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE';
      const perms = user.permissions || { modules: {} };
      return `<tr class="st-user-detail-row"><td colspan="4">
        <div class="st-user-detail">
          <dl class="st-dl">
            <div class="st-dl-row"><dt>Company User ID</dt><dd>${escapeHtml(user.companyUserId)}</dd></div>
            <div class="st-dl-row"><dt>Linked pilot</dt><dd>${escapeHtml(pilotName(user.linkedCrewProfileId))}</dd></div>
            <div class="st-dl-row"><dt>Permissions</dt><dd>${escapeHtml(permsSummary(user))}</dd></div>
          </dl>
          <form class="st-user-edit-form" data-edit-form="${escapeHtml(user.companyUserId)}">
            <div class="st-form-row">
              <label class="st-field"><span>Display name</span><input type="text" data-field="displayName" value="${escapeHtml(user.displayName || '')}" required /></label>
              <label class="st-field"><span>Role</span><select data-field="role">
                ${['OPERATIONS', 'ADMIN', 'PILOT', 'AME', 'MEMBER'].map((role) => `<option value="${role}" ${`${user.role || ''}`.toUpperCase() === role ? 'selected' : ''}>${escapeHtml(roleLabel(role))}</option>`).join('')}
              </select></label>
              <label class="st-field"><span>Link existing pilot</span><select data-field="linkedCrewProfileId"></select></label>
            </div>
            <div class="st-table-scroll"><table class="st-perm-matrix">
              <thead><tr><th>Module</th><th>View</th><th>Edit</th></tr></thead>
              <tbody data-perms-body></tbody>
            </table></div>
            <div class="st-form-actions">
              <button type="submit" class="vs-button vs-button--primary vs-button--sm">Save changes</button>
              <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="reset" data-id="${escapeHtml(user.companyUserId)}">Reset passcode</button>
              <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="toggle-status" data-id="${escapeHtml(user.companyUserId)}">${isActive ? 'Suspend' : 'Reactivate'}</button>
            </div>
          </form>
          <div class="st-invite-result hidden" data-once-panel hidden>
            <p><strong>New passcode issued.</strong> Share it once — it is never shown again.</p>
            <div class="st-code-box"><span>Passcode<br /><strong data-once-pass>—</strong></span>
            <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="copy-once">Copy</button></div>
            <div class="st-form-actions"><button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="dismiss-once">Done</button></div>
          </div>
        </div>
      </td></tr>`;
    }

    function renderUsers() {
      if (!body) return;
      const rows = filteredUsers();
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="4" class="st-empty">${usersCache.length ? 'No users match the search.' : 'No Company Users yet. Create the first one above.'}</td></tr>`;
        return;
      }
      body.innerHTML = rows
        .map((user) => {
          const isActive = `${user.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE';
          const expanded = expandedId === user.companyUserId;
          return `<tr>
            <td><strong>${escapeHtml(user.displayName || '—')}</strong><br /><span class="st-muted">${escapeHtml(user.companyUserId)}</span></td>
            <td>${escapeHtml(roleLabel(user.role))}</td>
            <td><span class="st-badge st-badge-${isActive ? 'green' : 'red'}">${escapeHtml(user.status || 'ACTIVE')}</span></td>
            <td><div class="st-row-actions">
              <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="toggle" data-id="${escapeHtml(user.companyUserId)}">${expanded ? 'Hide' : 'View'}</button>
            </div></td>
          </tr>${expanded ? detailRowHtml(user) : ''}`;
        })
        .join('');

      if (expandedId) {
        const detailForm = body.querySelector(`[data-edit-form="${expandedId}"]`);
        if (detailForm) {
          renderPilotOptions(detailForm.querySelector('[data-field="linkedCrewProfileId"]'), usersCache.find((item) => item.companyUserId === expandedId)?.linkedCrewProfileId || '');
          renderPermMatrix(detailForm.querySelector('[data-perms-body]'), usersCache.find((item) => item.companyUserId === expandedId)?.permissions);
        }
      }
    }

    async function reloadUsers() {
      usersCache = await listCompanyUsersViaCallable();
      renderUsers();
    }

    async function refreshCrewOptions() {
      try {
        crewCache = await getCrew(companyId);
      } catch (error) {
        console.warn('Company user pilot options unavailable:', error);
        crewCache = [];
      }
      renderPilotOptions(query('#st-user-pilot'));
    }

    query('#st-user-create-toggle')?.addEventListener('click', () => {
      form?.classList.toggle('hidden');
      if (form && !form.classList.contains('hidden')) {
        renderPilotOptions(query('#st-user-pilot'));
        query('#st-user-name')?.focus();
      }
    });

    query('#st-user-form-cancel')?.addEventListener('click', () => {
      form?.classList.add('hidden');
      form?.reset();
      renderPermMatrix(permsBody);
    });

    searchInput?.addEventListener('input', renderUsers);

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const displayName = query('#st-user-name')?.value?.trim();
      const role = query('#st-user-role')?.value || 'OPERATIONS';
      const linkedCrewProfileId = query('#st-user-pilot')?.value || null;
      if (!displayName) {
        setUsersStatus('Display name is required.', 'error');
        return;
      }
      const submit = query('#st-user-submit');
      setButtonState(submit, true);
      setUsersStatus('Creating Company User on the server...');
      try {
        // Server generates the ID + passcode. Plaintext is returned ONCE here
        // and held in memory only until Done — never persisted or logged.
        pendingCreds = await issueCompanyUserViaCallable({
          displayName,
          role,
          permissions: collectPermMatrix(permsBody),
          linkedCrewProfileId,
          status: 'ACTIVE'
        });
        query('#st-user-result-id').textContent = pendingCreds.companyUserId;
        query('#st-user-result-pass').textContent = pendingCreds.passcode;
        resultEl?.classList.remove('hidden');
        form.reset();
        form.classList.add('hidden');
        renderPermMatrix(permsBody);
        setUsersStatus(`Company User ${pendingCreds.companyUserId} created.`, 'success');
        await reloadUsers();
      } catch (error) {
        pendingCreds = null;
        setUsersStatus(error.message || 'Unable to create the user.', 'error');
      } finally {
        setButtonState(submit, false);
      }
    });

    const clearOnceCreds = () => {
      pendingCreds = null;
      query('#st-user-result-id').textContent = '—';
      query('#st-user-result-pass').textContent = '—';
      resultEl?.classList.add('hidden');
    };

    query('#st-user-copy-id')?.addEventListener('click', async () => {
      if (!pendingCreds) return;
      try {
        await navigator.clipboard.writeText(pendingCreds.companyUserId);
        setUsersStatus('User ID copied.', 'success');
      } catch {
        setUsersStatus('Copy failed. Select and copy manually.', 'error');
      }
    });

    query('#st-user-copy-pass')?.addEventListener('click', async () => {
      if (!pendingCreds) return;
      try {
        await navigator.clipboard.writeText(pendingCreds.passcode);
        setUsersStatus('Passcode copied. Share it now — it will not be shown again.', 'success');
      } catch {
        setUsersStatus('Copy failed. Select and copy manually.', 'error');
      }
    });

    query('#st-user-result-done')?.addEventListener('click', clearOnceCreds);

    body?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const { action, id } = button.dataset;

      if (action === 'toggle') {
        expandedId = expandedId === id ? null : id;
        renderUsers();
        return;
      }

      if (action === 'dismiss-once') {
        const panel = button.closest('[data-once-panel]');
        panel?.setAttribute('hidden', '');
        const passEl = panel?.querySelector('[data-once-pass]');
        if (passEl) passEl.textContent = '—';
        return;
      }

      if (action === 'copy-once') {
        const passEl = button.closest('[data-once-panel]')?.querySelector('[data-once-pass]');
        const value = passEl?.textContent || '';
        if (!value || value === '—') return;
        try {
          await navigator.clipboard.writeText(value);
          setUsersStatus('Passcode copied.', 'success');
        } catch {
          setUsersStatus('Copy failed. Select and copy manually.', 'error');
        }
        return;
      }

      if (action === 'reset') {
        const user = usersCache.find((item) => item.companyUserId === id);
        if (!user) return;
        if (!window.confirm(`Reset the passcode for ${user.displayName || id}? The previous passcode stops working immediately.`)) return;
        button.disabled = true;
        try {
          const reset = await resetCompanyUserPasscodeViaCallable(id);
          const panel = button.closest('.st-user-detail')?.querySelector('[data-once-panel]');
          const passEl = panel?.querySelector('[data-once-pass]');
          if (panel && passEl) {
            passEl.textContent = reset.passcode;
            panel.classList.remove('hidden');
            panel.removeAttribute('hidden');
          }
          setUsersStatus(`New passcode issued for ${user.displayName || id}.`, 'success');
        } catch (error) {
          setUsersStatus(error.message || 'Unable to reset the passcode.', 'error');
        } finally {
          button.disabled = false;
        }
        return;
      }

      if (action === 'toggle-status') {
        const user = usersCache.find((item) => item.companyUserId === id);
        if (!user) return;
        const next = `${user.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
        const verb = next === 'ACTIVE' ? 'reactivate' : 'suspend';
        if (!window.confirm(`${verb === 'reactivate' ? 'Reactivate' : 'Suspend'} ${user.displayName || id}?${next === 'SUSPENDED' ? ' Logins will fail until reactivated.' : ''}`)) return;
        button.disabled = true;
        try {
          await updateCompanyUserViaCallable(id, { status: next });
          setUsersStatus(`${user.displayName || id} ${next === 'ACTIVE' ? 'reactivated' : 'suspended'}.`, 'success');
          await reloadUsers();
        } catch (error) {
          setUsersStatus(error.message || 'Unable to update status.', 'error');
        } finally {
          button.disabled = false;
        }
      }
    });

    body?.addEventListener('submit', async (event) => {
      const editForm = event.target.closest('[data-edit-form]');
      if (!editForm) return;
      event.preventDefault();
      const id = editForm.dataset.editForm;
      const read = (field) => editForm.querySelector(`[data-field="${field}"]`)?.value;
      const linkValue = read('linkedCrewProfileId');
      const patch = {
        displayName: read('displayName')?.trim(),
        role: read('role'),
        permissions: collectPermMatrix(editForm.querySelector('[data-perms-body]')),
        linkedCrewProfileId: linkValue === '' ? null : linkValue
      };
      if (!patch.displayName) {
        setUsersStatus('Display name is required.', 'error');
        return;
      }
      try {
        await updateCompanyUserViaCallable(id, patch);
        setUsersStatus('Company User updated.', 'success');
        await reloadUsers();
      } catch (error) {
        setUsersStatus(error.message || 'Unable to save changes.', 'error');
      }
    });

    renderPermMatrix(permsBody);
    refreshCrewOptions();
    reloadUsers().catch((error) => {
      console.error('Company users load failed:', error);
      setUsersStatus(error.message || 'Unable to load Company Users.', 'error');
    });
  }

  return {
    destroy() {
      // No long-lived listeners in this module.
    }
  };
}
