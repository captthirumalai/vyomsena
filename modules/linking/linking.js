import { appRoutes } from '../../shared/routes.js';
import { getCrew } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import {
  issueCompanyUserViaCallable,
  listCompanyUsersViaCallable,
  updateCompanyUserViaCallable,
  resetCompanyUserPasscodeViaCallable
} from '../../services/companyUserService.js';

const PILOT_SOURCE = 'CREW_ADD_PILOT';
const ALLOWED_ROLES = ['PILOT', 'OPERATIONS', 'AME'];

function escapeHtml(value) {
  return `${value ?? ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function setStatus(el, message, tone = '') {
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('is-error', 'is-success');
  if (tone) el.classList.add(`is-${tone}`);
}

function moduleOptions() {
  const routes = appRoutes
    .filter((route) => route.showInMenu !== false && route.path && route.name && !['/settings', '/linking'].includes(route.path))
    .map((route) => ({ key: route.path.replace(/^\//, ''), label: route.name }));
  const dataScopes = [
    { key: 'aircraft', label: 'Company Aircraft data' },
    { key: 'crew', label: 'Company Crew data' },
    { key: 'flights', label: 'Company Flight records' }
  ];
  return [...routes, ...dataScopes].sort((a, b) => a.label.localeCompare(b.label));
}

function defaultRights(role) {
  const map = {
    PILOT: { efb: { view: true, edit: false }, reports: { view: true, edit: false }, flights: { view: true, edit: false }, crew: { view: true, edit: false } },
    OPERATIONS: { flightops: { view: true, edit: true }, dispatch: { view: true, edit: true }, efb: { view: true, edit: true }, flights: { view: true, edit: true } },
    AME: { maintenance: { view: true, edit: true }, aircraft: { view: true, edit: true } }
  };
  return map[role] || {};
}

export async function init(view, context) {
  const currentUser = context?.currentUser;
  const adminRole = `${currentUser?.role || ''}`.trim().toUpperCase();
  if (!['OWNER', 'ADMIN'].includes(adminRole)) {
    view.innerHTML = '<section class="vs-card"><h2>Access denied</h2><p>Only the company owner or an admin can manage people and devices.</p></section>';
    return { destroy() {} };
  }

  const companyId = getCurrentOrganizationContext(currentUser).organizationId || currentUser?.companyId || currentUser?.uid || null;
  if (!companyId) {
    view.innerHTML = '<section class="vs-card"><h2>No operator workspace</h2><p>Sign in to a company workspace before managing access.</p></section>';
    return { destroy() {} };
  }

  const $ = (selector) => view.querySelector(selector);
  const roleSelect = $('#ln-role');
  const pilotSelect = $('#ln-pilot');
  const pilotField = $('#ln-pilot-field');
  const form = $('#ln-user-form');
  const permissionsBody = $('#ln-permissions-body');
  const userBody = $('#ln-users-body');
  const statusEl = $('#ln-form-status');
  const listStatus = $('#ln-list-status');
  const credentialPanel = $('#ln-credentials');
  const modules = moduleOptions();
  let crewProfiles = [];
  let users = [];
  let oneTimeCredentials = null;
  let disposed = false;

  function activePilots() {
    return crewProfiles.filter((pilot) => pilot.provisioningSource === PILOT_SOURCE)
      .filter((pilot) =>
        `${pilot.role || 'PILOT'}`.trim().toUpperCase() === 'PILOT'
        && `${pilot.status || 'Active'}`.trim().toUpperCase() === 'ACTIVE');
  }

  function renderPilotOptions(select = pilotSelect, selected = '') {
    select.innerHTML = '<option value="">Select a Crew Management pilot…</option>' + activePilots()
      .map((pilot) => {
        const id = pilot.crewProfileId || pilot.uid;
        const name = pilot.name || pilot.fullName || pilot.email || id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
      }).join('');
    if (selected) select.value = selected;
  }

  function renderPermissions(preset = {}, tbody = permissionsBody) {
    tbody.innerHTML = modules.map(({ key, label }) => {
      const rights = preset[key] || {};
      return `<tr><td>${escapeHtml(label)}</td><td><input type="checkbox" data-module="${escapeHtml(key)}" data-right="view" ${rights.view ? 'checked' : ''} aria-label="${escapeHtml(label)} view" /></td><td><input type="checkbox" data-module="${escapeHtml(key)}" data-right="edit" ${rights.edit ? 'checked' : ''} aria-label="${escapeHtml(label)} edit" /></td></tr>`;
    }).join('');
  }

  function collectPermissions(tbody = permissionsBody) {
    const result = {};
    tbody.querySelectorAll('input[data-module]').forEach((input) => {
      const key = input.dataset.module;
      result[key] ||= { view: false, edit: false };
      result[key][input.dataset.right] = input.checked;
      if (input.dataset.right === 'edit' && input.checked) result[key].view = true;
    });
    tbody.querySelectorAll('input[data-module][data-right="view"]').forEach((input) => {
      const edit = tbody.querySelector(`input[data-module="${CSS.escape(input.dataset.module)}"][data-right="edit"]`);
      if (edit?.checked) {
        input.checked = true;
        result[input.dataset.module].view = true;
      }
    });
    Object.keys(result).forEach((key) => {
      if (!result[key].view && !result[key].edit) delete result[key];
    });
    return { modules: result };
  }

  function setRole(role, applyDefaults = true) {
    const isPilot = role === 'PILOT';
    pilotField.classList.toggle('hidden', !isPilot);
    pilotSelect.required = isPilot;
    $('#ln-pilot-note').classList.toggle('hidden', !isPilot);
    if (applyDefaults) renderPermissions(defaultRights(role));
  }

  function linkedPilotName(id) {
    const pilot = crewProfiles.find((item) => (item.crewProfileId || item.uid) === id);
    return pilot ? (pilot.name || pilot.fullName || pilot.email || id) : (id || '—');
  }

  function permissionSummary(user) {
    const rights = user.permissions?.modules || {};
    const allowed = Object.entries(rights).filter(([, value]) => value?.view || value?.edit).map(([key, value]) => {
      const label = modules.find((mod) => mod.key === key)?.label || key;
      return `${label}${value.edit ? ' (edit)' : ''}`;
    });
    return allowed.length ? allowed.join(', ') : 'No module access';
  }

  function renderUsers() {
    const term = `${$('#ln-search').value || ''}`.trim().toLowerCase();
    const filtered = users.filter((user) => [user.companyUserId, user.displayName, user.role, linkedPilotName(user.linkedCrewProfileId)].join(' ').toLowerCase().includes(term));
    $('#ln-user-count').textContent = `${users.length} account${users.length === 1 ? '' : 's'}`;
    if (!filtered.length) {
      userBody.innerHTML = `<tr><td colspan="6" class="ln-empty">${users.length ? 'No matching accounts.' : 'No access accounts created yet.'}</td></tr>`;
      return;
    }
    userBody.innerHTML = filtered.map((user) => {
      const isActive = `${user.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE';
      return `<tr>
        <td><strong>${escapeHtml(user.displayName || '—')}</strong><br><span class="ln-person-id">${escapeHtml(user.companyUserId)}</span></td>
        <td>${escapeHtml(user.role || '—')}</td>
        <td>${escapeHtml(linkedPilotName(user.linkedCrewProfileId))}</td>
        <td><span class="ln-module-summary">${escapeHtml(permissionSummary(user))}</span></td>
        <td><span class="ln-state ${isActive ? '' : 'is-suspended'}">${isActive ? 'ACTIVE' : 'SUSPENDED'}</span></td>
        <td><div class="ln-row-actions">
          <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="edit" data-id="${escapeHtml(user.companyUserId)}">Edit access</button>
          ${`${user.role || ''}`.toUpperCase() === 'PILOT' && user.linkedCrewProfileId ? `<button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="unlink" data-id="${escapeHtml(user.companyUserId)}">Unlink pilot</button>` : ''}
          <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="reset" data-id="${escapeHtml(user.companyUserId)}">Reset passcode</button>
          <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="status" data-id="${escapeHtml(user.companyUserId)}" data-next="${isActive ? 'SUSPENDED' : 'ACTIVE'}">${isActive ? 'Suspend' : 'Reactivate'}</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  async function reloadUsers() {
    users = await listCompanyUsersViaCallable();
    if (!disposed) renderUsers();
  }

  function clearCredentials() {
    oneTimeCredentials = null;
    $('#ln-created-id').textContent = '—';
    $('#ln-created-passcode').textContent = '—';
    credentialPanel.classList.add('hidden');
  }

  roleSelect.addEventListener('change', () => setRole(roleSelect.value));
  $('#ln-search').addEventListener('input', renderUsers);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const role = roleSelect.value;
    const displayName = $('#ln-name').value.trim();
    const linkedCrewProfileId = role === 'PILOT' ? pilotSelect.value : null;
    if (!ALLOWED_ROLES.includes(role)) return setStatus(statusEl, 'Select a supported access type.', 'error');
    if (!displayName) return setStatus(statusEl, 'Enter the person’s name.', 'error');
    if (role === 'PILOT' && !linkedCrewProfileId) return setStatus(statusEl, 'Select a pilot created with Crew Management → Add Pilot.', 'error');
    const pilot = activePilots().find((item) => (item.crewProfileId || item.uid) === linkedCrewProfileId);
    if (role === 'PILOT' && (!pilot || pilot.operatorId !== companyId)) return setStatus(statusEl, 'Only an Add Pilot record belonging to this company can receive pilot credentials.', 'error');

    const submit = $('#ln-create-submit');
    submit.disabled = true;
    setStatus(statusEl, 'Creating account securely…');
    try {
      oneTimeCredentials = await issueCompanyUserViaCallable({
        displayName,
        role,
        permissions: collectPermissions(),
        linkedCrewProfileId,
        status: 'ACTIVE'
      });
      $('#ln-created-id').textContent = oneTimeCredentials.companyUserId;
      $('#ln-created-passcode').textContent = oneTimeCredentials.passcode;
      credentialPanel.classList.remove('hidden');
      $('#ln-name').value = '';
      if (role === 'PILOT') pilotSelect.value = '';
      setStatus(statusEl, 'Account created. Copy and share the credentials now; the initial passcode is shown only once.', 'success');
      await reloadUsers();
    } catch (error) {
      if (oneTimeCredentials) {
        setStatus(statusEl, `Credentials were created, but the account list did not refresh: ${error.message || 'try refreshing the page.'}`, 'error');
      } else {
        setStatus(statusEl, error.message || 'Unable to create access.', 'error');
      }
    } finally {
      submit.disabled = false;
    }
  });

  credentialPanel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button || !oneTimeCredentials) return;
    const value = button.dataset.copy === 'id' ? oneTimeCredentials.companyUserId : oneTimeCredentials.passcode;
    try {
      await navigator.clipboard.writeText(value);
      setStatus(statusEl, `${button.dataset.copy === 'id' ? 'User ID' : 'Passcode'} copied.`, 'success');
    } catch {
      setStatus(statusEl, 'Copy failed. Select the credential and copy it manually.', 'error');
    }
  });
  $('#ln-credentials-done').addEventListener('click', clearCredentials);
  const editDialog = $('#ln-edit-dialog');
  const editRole = $('#ln-edit-role');
  const editPilotField = $('#ln-edit-pilot-field');
  const editPilot = $('#ln-edit-pilot');
  const editPermissionsBody = $('#ln-edit-permissions');
  const setEditRole = (role) => {
    editPilotField.classList.toggle('hidden', role !== 'PILOT');
    editPilot.required = role === 'PILOT';
  };
  $('#ln-edit-close').addEventListener('click', () => editDialog.close());
  editRole.addEventListener('change', () => setEditRole(editRole.value));
  $('#ln-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const role = editRole.value;
    const linkedCrewProfileId = role === 'PILOT' ? editPilot.value : null;
    const pilot = activePilots().find((item) => (item.crewProfileId || item.uid) === linkedCrewProfileId);
    if (role === 'PILOT' && (!pilot || pilot.operatorId !== companyId)) {
      return setStatus($('#ln-edit-status'), 'Select an eligible Add Pilot record.', 'error');
    }
    const save = event.submitter;
    save.disabled = true;
    try {
      await updateCompanyUserViaCallable($('#ln-edit-id').value, {
        displayName: $('#ln-edit-name').value.trim(),
        role,
        linkedCrewProfileId,
        permissions: collectPermissions(editPermissionsBody)
      });
      editDialog.close();
      setStatus(listStatus, 'Account access updated.', 'success');
      await reloadUsers();
    } catch (error) {
      setStatus($('#ln-edit-status'), error.message || 'Unable to save account access.', 'error');
    } finally {
      save.disabled = false;
    }
  });

  userBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const user = users.find((item) => item.companyUserId === button.dataset.id);
    if (!user) return;
    if (button.dataset.action === 'edit') {
      $('#ln-edit-id').value = user.companyUserId;
      $('#ln-edit-name').value = user.displayName || '';
      editRole.value = ALLOWED_ROLES.includes(user.role) ? user.role : 'OPERATIONS';
      setEditRole(editRole.value);
      renderPilotOptions(editPilot, user.linkedCrewProfileId || '');
      renderPermissions(user.permissions?.modules || {}, editPermissionsBody);
      editDialog.showModal();
      return;
    }
    button.disabled = true;
    try {
      if (button.dataset.action === 'unlink') {
        if (!window.confirm(`Unlink ${user.displayName || user.companyUserId} from ${linkedPilotName(user.linkedCrewProfileId)}? This also suspends Company Home login until a pilot profile is linked again.`)) return;
        await updateCompanyUserViaCallable(user.companyUserId, { linkedCrewProfileId: null, status: 'SUSPENDED' });
        setStatus(listStatus, 'Pilot link removed and Company Home access suspended.', 'success');
        await reloadUsers();
      } else if (button.dataset.action === 'reset') {
        const result = await resetCompanyUserPasscodeViaCallable(user.companyUserId);
        oneTimeCredentials = result;
        $('#ln-created-id').textContent = result.companyUserId;
        $('#ln-created-passcode').textContent = result.passcode;
        credentialPanel.classList.remove('hidden');
        credentialPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setStatus(statusEl, 'New initial passcode created. Copy and share it now.', 'success');
      } else if (button.dataset.action === 'status') {
        const next = button.dataset.next;
        await updateCompanyUserViaCallable(user.companyUserId, { status: next });
        setStatus(listStatus, `${user.displayName || user.companyUserId} ${next.toLowerCase()}.`, 'success');
        await reloadUsers();
      }
    } catch (error) {
      setStatus(listStatus, error.message || 'Unable to update this account.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  try {
    crewProfiles = await getCrew(companyId);
    renderPilotOptions();
  } catch (error) {
    console.warn('Could not load Add Pilot records for Linking:', error);
    setStatus(statusEl, 'Pilot records could not be loaded. Other user types can still be created.', 'error');
  }

  const requestedRole = sessionStorage.getItem('vs-linking-prefill-role');
  sessionStorage.removeItem('vs-linking-prefill-role');
  roleSelect.value = ALLOWED_ROLES.includes(requestedRole) ? requestedRole : 'PILOT';
  setRole(roleSelect.value);
  try {
    await reloadUsers();
  } catch (error) {
    setStatus(listStatus, error.message || 'Could not load linked people.', 'error');
    userBody.innerHTML = '<tr><td colspan="6" class="ln-empty">Unable to load access accounts.</td></tr>';
  }

  return {
    destroy() {
      disposed = true;
      oneTimeCredentials = null;
    }
  };
}
