import { addCompanyModuleDoc, listCompanyModuleDocs, onCompanyModuleSnapshot } from '../../services/companyService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mountModuleActions } from '../../shared/moduleHeader.js';

function escapeHtml(value) { return `${value ?? ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

export async function init(view, context) {
  const heading = view.querySelector('h2'); if (heading) heading.textContent = 'Flight Operations';
  const currentUser = context?.currentUser || {}, role = `${currentUser.role || ''}`.toUpperCase();
  const companyId = getCurrentOrganizationContext(currentUser).organizationId || currentUser.companyId || currentUser.uid;
  const admin = ['OWNER', 'ADMIN'].includes(role);
  mountModuleActions(admin ? '<a href="#/linking" id="fo-add-ops-user" class="vs-button vs-button--secondary vs-button--sm">+ Add Ops User</a>' : '');
  const addAction = document.getElementById('fo-add-ops-user'), form = view.querySelector('#fo-person-form'), list = view.querySelector('#fo-team-list'), status = view.querySelector('#fo-team-status'), message = view.querySelector('#fo-person-message');
  if (!companyId) { if (status) status.textContent = 'No authorized operator found.'; return { destroy() {} }; }
  if (!admin) { const card = view.querySelector('.fo-team-card'); if (card) card.hidden = true; }
  const focusOpsForm = (event) => { event.preventDefault(); form?.scrollIntoView({ behavior: 'smooth', block: 'center' }); view.querySelector('#fo-person-name')?.focus(); };
  if (addAction) addAction.addEventListener('click', focusOpsForm);
  const render = (records) => { const staff = records.filter((p) => `${p.role || ''}`.toUpperCase() === 'OPERATIONS' && `${p.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE').sort((a,b) => `${a.displayName || ''}`.localeCompare(`${b.displayName || ''}`)); if (list) list.innerHTML = staff.length ? staff.map((p) => `<li>${escapeHtml(p.displayName || p.name || 'Unnamed')}</li>`).join('') : '<li>No operations people yet. Add a person here to make them available in Linking &amp; Access.</li>'; };
  if (admin) {
    try { render(await listCompanyModuleDocs(companyId, 'people')); } catch (error) { if (status) status.textContent = `Unable to load operations team: ${error.message || 'check access and refresh.'}`; }
  }
  const unsubscribe = admin ? onCompanyModuleSnapshot(companyId, 'people', render, (error) => { if (status) status.textContent = `Unable to refresh operations team: ${error.message || ''}`; }) : null;
  form?.addEventListener('submit', async (event) => { event.preventDefault(); const input = view.querySelector('#fo-person-name'), name = input.value.trim(); if (!name) return; const button = form.querySelector('button'); button.disabled = true; message.textContent = 'Adding…'; try { await addCompanyModuleDoc(companyId, 'people', { displayName: name, role: 'OPERATIONS', status: 'ACTIVE', createdBy: currentUser.uid || null }); input.value = ''; message.textContent = `${name} added. They can now be selected in Linking & Access.`; } catch (error) { message.textContent = error.message || 'Unable to add this person.'; } finally { button.disabled = false; } });
  return { destroy() { unsubscribe?.(); addAction?.removeEventListener('click', focusOpsForm); } };
}
