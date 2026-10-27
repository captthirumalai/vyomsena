import { appRoutes } from '../../shared/routes.js';
import { getCrew } from '../../services/crewService.js';
import { listCompanyModuleDocs } from '../../services/companyService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import {
  issueCompanyUserViaCallable,
  listCompanyUsersViaCallable,
  updateCompanyUserViaCallable,
  resetCompanyUserPasscodeViaCallable
} from '../../services/companyUserService.js';

const PILOT_SOURCE = 'CREW_ADD_PILOT';
const ALLOWED_ROLES = ['PILOT', 'OPERATIONS', 'AME'];
const SOURCE_ROUTES = { PILOT: ['Crew Management', '#/crew'], OPERATIONS: ['Flight Ops', '#/flightops'], AME: ['Maintenance', '#/maintenance'] };
const ROLE_NAMES = { PILOT: 'pilot', OPERATIONS: 'operations person', AME: 'technical person' };
function escapeHtml(value) { return `${value ?? ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function setStatus(el, message, tone = '') { if (!el) return; el.textContent = message || ''; el.classList.remove('is-error', 'is-success'); if (tone) el.classList.add(`is-${tone}`); }
function moduleOptions() {
  const routes = appRoutes.filter((route) => route.showInMenu !== false && route.path && route.name && !['/settings', '/linking'].includes(route.path)).map((route) => ({ key: route.path.replace(/^\//, ''), label: route.name }));
  return [...routes, { key: 'aircraft', label: 'Company Aircraft data' }, { key: 'crew', label: 'Company Crew data' }, { key: 'flights', label: 'Company Flight records' }].sort((a, b) => a.label.localeCompare(b.label));
}
function defaultRights(role) {
  return ({ PILOT: { efb: { view: true }, reports: { view: true }, flights: { view: true }, crew: { view: true } }, OPERATIONS: { flightops: { view: true, edit: true }, dispatch: { view: true, edit: true }, efb: { view: true, edit: true }, flights: { view: true, edit: true } }, AME: { maintenance: { view: true, edit: true }, aircraft: { view: true, edit: true } } })[role] || {};
}

export async function init(view, context) {
  const currentUser = context?.currentUser;
  if (!['OWNER', 'ADMIN'].includes(`${currentUser?.role || ''}`.trim().toUpperCase())) { view.innerHTML = '<section class="vs-card"><h2>Access denied</h2><p>Only the company owner or an admin can manage people and devices.</p></section>'; return { destroy() {} }; }
  const companyId = getCurrentOrganizationContext(currentUser).organizationId || currentUser?.companyId || currentUser?.uid || null;
  if (!companyId) { view.innerHTML = '<section class="vs-card"><h2>No operator workspace</h2><p>Sign in to a company workspace before managing access.</p></section>'; return { destroy() {} }; }
  const $ = (selector) => view.querySelector(selector);
  const roleSelect = $('#ln-role'), personSelect = $('#ln-person'), form = $('#ln-user-form'), permissionsBody = $('#ln-permissions-body'), userBody = $('#ln-users-body');
  const statusEl = $('#ln-form-status'), listStatus = $('#ln-list-status'), credentialPanel = $('#ln-credentials'), modules = moduleOptions();
  let crewProfiles = [], people = [], users = [], oneTimeCredentials = null, disposed = false;
  const personId = (person) => person.id || person.crewProfileId || person.uid;
  const personName = (person) => person.name || person.fullName || person.displayName || person.email || personId(person);
  function activePilots() { return crewProfiles.filter((p) => p.provisioningSource === PILOT_SOURCE && `${p.role || 'PILOT'}`.toUpperCase() === 'PILOT' && `${p.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE' && p.operatorId === companyId); }
  function eligiblePeople(role) {
    if (role === 'PILOT') return activePilots();
    const sourceRole = role === 'OPERATIONS' ? 'OPERATIONS' : 'AME';
    return people.filter((p) => `${p.role || ''}`.toUpperCase() === sourceRole && `${p.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE');
  }
  function linkedId(user) { return user.role === 'PILOT' ? user.linkedCrewProfileId : user.linkedPersonId; }
  function renderPersonOptions(select, role, selected = '', editingId = '') {
    const used = new Set(users.filter((u) => u.companyUserId !== editingId).map(linkedId).filter(Boolean));
    const options = eligiblePeople(role).filter((p) => !used.has(personId(p)) || personId(p) === selected);
    const source = SOURCE_ROUTES[role];
    select.innerHTML = `<option value="">Select an existing ${ROLE_NAMES[role]}…</option>` + options.map((p) => `<option value="${escapeHtml(personId(p))}">${escapeHtml(personName(p))}</option>`).join('');
    select.value = selected || '';
    const note = $('#ln-person-note');
    if (note) {
      note.innerHTML = options.length ? (role === 'PILOT' ? 'Pilots must be active records created with Crew Management → Add Pilot.' : 'Choose an existing staff record. Company User credentials are issued here.') : `No eligible ${ROLE_NAMES[role]} found. Add one in <a href="${source[1]}">${source[0]}</a>.`;
    }
    return options.length > 0;
  }
  function renderPermissions(preset = {}, tbody = permissionsBody) {
    tbody.innerHTML = modules.map(({ key, label }) => { const rights = preset[key] || {}; return `<tr><td>${escapeHtml(label)}</td><td><input type="checkbox" data-module="${escapeHtml(key)}" data-right="view" ${rights.view ? 'checked' : ''} aria-label="${escapeHtml(label)} view" /></td><td><input type="checkbox" data-module="${escapeHtml(key)}" data-right="edit" ${rights.edit ? 'checked' : ''} aria-label="${escapeHtml(label)} edit" /></td></tr>`; }).join('');
  }
  function collectPermissions(tbody = permissionsBody) {
    const result = {};
    tbody.querySelectorAll('input[data-module]').forEach((input) => { const key = input.dataset.module; result[key] ||= { view: false, edit: false }; result[key][input.dataset.right] = input.checked; if (input.dataset.right === 'edit' && input.checked) result[key].view = true; });
    Object.keys(result).forEach((key) => { if (!result[key].view && !result[key].edit) delete result[key]; });
    return { modules: result };
  }
  function selectedName(role, id) { const person = eligiblePeople(role).find((p) => personId(p) === id); return person ? personName(person) : id || '—'; }
  function permissionSummary(user) { const rights = user.permissions?.modules || {}; const allowed = Object.entries(rights).filter(([, v]) => v?.view || v?.edit).map(([key, v]) => `${modules.find((m) => m.key === key)?.label || key}${v.edit ? ' (edit)' : ''}`); return allowed.length ? allowed.join(', ') : 'No module access'; }
  function renderUsers() {
    const term = `${$('#ln-search').value || ''}`.trim().toLowerCase();
    const filtered = users.filter((u) => [u.companyUserId, u.displayName, u.role, selectedName(u.role, linkedId(u))].join(' ').toLowerCase().includes(term));
    $('#ln-user-count').textContent = `${users.length} account${users.length === 1 ? '' : 's'}`;
    if (!filtered.length) { userBody.innerHTML = `<tr><td colspan="6" class="ln-empty">${users.length ? 'No matching accounts.' : 'No access accounts created yet.'}</td></tr>`; return; }
    userBody.innerHTML = filtered.map((u) => { const active = `${u.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE'; return `<tr><td><strong>${escapeHtml(u.displayName || '—')}</strong><br><span class="ln-person-id">${escapeHtml(u.companyUserId)}</span></td><td>${escapeHtml(u.role || '—')}</td><td>${escapeHtml(selectedName(u.role, linkedId(u)))}</td><td><span class="ln-module-summary">${escapeHtml(permissionSummary(u))}</span></td><td><span class="ln-state ${active ? '' : 'is-suspended'}">${active ? 'ACTIVE' : 'SUSPENDED'}</span></td><td><div class="ln-row-actions"><button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="edit" data-id="${escapeHtml(u.companyUserId)}">Edit access</button><button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="reset" data-id="${escapeHtml(u.companyUserId)}">Reset passcode</button><button type="button" class="vs-button vs-button--secondary vs-button--sm" data-action="status" data-id="${escapeHtml(u.companyUserId)}" data-next="${active ? 'SUSPENDED' : 'ACTIVE'}">${active ? 'Suspend' : 'Reactivate'}</button></div></td></tr>`; }).join('');
  }
  async function reloadUsers() { users = await listCompanyUsersViaCallable(); if (!disposed) { renderPersonOptions(personSelect, roleSelect.value, personSelect.value); renderUsers(); } }
  function setRole(role, defaults = true) { renderPersonOptions(personSelect, role); if (defaults) renderPermissions(defaultRights(role)); }
  function clearCredentials() { oneTimeCredentials = null; $('#ln-created-id').textContent = '—'; $('#ln-created-passcode').textContent = '—'; credentialPanel.classList.add('hidden'); }
  roleSelect.addEventListener('change', () => setRole(roleSelect.value));
  $('#ln-search').addEventListener('input', renderUsers);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const role = roleSelect.value, selected = personSelect.value;
    if (!ALLOWED_ROLES.includes(role)) return setStatus(statusEl, 'Select a supported access type.', 'error');
    const person = eligiblePeople(role).find((p) => personId(p) === selected);
    if (!person) return setStatus(statusEl, `Select an existing ${ROLE_NAMES[role]} record.`, 'error');
    const submit = $('#ln-create-submit'); submit.disabled = true; setStatus(statusEl, 'Creating account securely…');
    try {
      oneTimeCredentials = await issueCompanyUserViaCallable({ role, permissions: collectPermissions(), linkedCrewProfileId: role === 'PILOT' ? selected : null, linkedPersonId: role === 'PILOT' ? null : selected, status: 'ACTIVE' });
      $('#ln-created-id').textContent = oneTimeCredentials.companyUserId; $('#ln-created-passcode').textContent = oneTimeCredentials.passcode; credentialPanel.classList.remove('hidden');
      setStatus(statusEl, 'Account created. Copy and share the credentials now; the initial passcode is shown only once.', 'success'); personSelect.value = ''; await reloadUsers();
    } catch (error) { setStatus(statusEl, error.message || 'Unable to create access.', 'error'); }
    finally { submit.disabled = false; }
  });
  credentialPanel.addEventListener('click', async (event) => { const button = event.target.closest('[data-copy]'); if (!button || !oneTimeCredentials) return; const value = button.dataset.copy === 'id' ? oneTimeCredentials.companyUserId : oneTimeCredentials.passcode; try { await navigator.clipboard.writeText(value); setStatus(statusEl, `${button.dataset.copy === 'id' ? 'User ID' : 'Passcode'} copied.`, 'success'); } catch { setStatus(statusEl, 'Copy failed. Select the credential and copy it manually.', 'error'); } });
  $('#ln-credentials-done').addEventListener('click', clearCredentials);
  const editDialog = $('#ln-edit-dialog'), editRole = $('#ln-edit-role'), editPerson = $('#ln-edit-person'), editPermissions = $('#ln-edit-permissions');
  editRole.addEventListener('change', () => renderPersonOptions(editPerson, editRole.value));
  $('#ln-edit-close').addEventListener('click', () => editDialog.close());
  $('#ln-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const role = editRole.value, selected = editPerson.value, person = eligiblePeople(role).find((p) => personId(p) === selected);
    if (!person) return setStatus($('#ln-edit-status'), `Select an existing ${ROLE_NAMES[role]} record.`, 'error');
    const save = event.submitter; save.disabled = true;
    try { await updateCompanyUserViaCallable($('#ln-edit-id').value, { displayName: personName(person), role, linkedCrewProfileId: role === 'PILOT' ? selected : null, linkedPersonId: role === 'PILOT' ? null : selected, permissions: collectPermissions(editPermissions) }); editDialog.close(); setStatus(listStatus, 'Account access updated.', 'success'); await reloadUsers(); }
    catch (error) { setStatus($('#ln-edit-status'), error.message || 'Unable to save account access.', 'error'); }
    finally { save.disabled = false; }
  });
  userBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return; const user = users.find((u) => u.companyUserId === button.dataset.id); if (!user) return;
    if (button.dataset.action === 'edit') { $('#ln-edit-id').value = user.companyUserId; editRole.value = ALLOWED_ROLES.includes(user.role) ? user.role : 'OPERATIONS'; renderPersonOptions(editPerson, editRole.value, linkedId(user), user.companyUserId); renderPermissions(user.permissions?.modules || {}, editPermissions); editDialog.showModal(); return; }
    button.disabled = true;
    try { if (button.dataset.action === 'reset') { const result = await resetCompanyUserPasscodeViaCallable(user.companyUserId); oneTimeCredentials = result; $('#ln-created-id').textContent = result.companyUserId; $('#ln-created-passcode').textContent = result.passcode; credentialPanel.classList.remove('hidden'); credentialPanel.scrollIntoView({ behavior: 'smooth', block: 'center' }); setStatus(statusEl, 'New initial passcode created. Copy and share it now.', 'success'); } else if (button.dataset.action === 'status') { await updateCompanyUserViaCallable(user.companyUserId, { status: button.dataset.next }); setStatus(listStatus, `${user.displayName || user.companyUserId} ${button.dataset.next.toLowerCase()}.`, 'success'); await reloadUsers(); } }
    catch (error) { setStatus(listStatus, error.message || 'Unable to update this account.', 'error'); } finally { button.disabled = false; }
  });
  try { [crewProfiles, people] = await Promise.all([getCrew(companyId), listCompanyModuleDocs(companyId, 'people')]); }
  catch (error) { console.warn('Could not load eligible people for Linking:', error); setStatus(statusEl, 'People could not be loaded. Check access and try refreshing.', 'error'); }
  roleSelect.value = 'PILOT'; setRole(roleSelect.value);
  try { await reloadUsers(); } catch (error) { setStatus(listStatus, error.message || 'Could not load linked people.', 'error'); userBody.innerHTML = '<tr><td colspan="6" class="ln-empty">Unable to load access accounts.</td></tr>'; }
  return { destroy() { disposed = true; oneTimeCredentials = null; } };
}
