import {
  getCompanyAircraft,
  onCompanyAircraftSnapshot,
  addCompanyAircraft,
  updateCompanyAircraft,
  deleteCompanyAircraft
} from '../../services/aircraftService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mountModuleActions, getModuleAction } from '../../shared/moduleHeader.js';

let fleetUnsubscribe = null;
let latestFleet = [];
let activeView = null;
let activeCompanyId = null;
let editingReg = null;

function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setStatus(message) {
  const label = getModuleAction('mx-status');
  if (label) label.textContent = message;
}

function setFormMode() {
  if (!activeView) return;
  const title = activeView.querySelector('#mx-form-title');
  const submit = activeView.querySelector('#mx-fleet-submit');
  const cancelEdit = activeView.querySelector('#mx-fleet-cancel-edit');
  const regInput = activeView.querySelector('#mx-aircraft-reg');
  const isEditing = Boolean(editingReg);
  if (title) title.textContent = isEditing ? `Edit Aircraft ${editingReg}` : 'Add Aircraft';
  if (submit) submit.textContent = isEditing ? 'Save Changes' : 'Add Aircraft';
  if (cancelEdit) cancelEdit.hidden = !isEditing;
  // Registration is the document ID — it cannot change on edit.
  if (regInput) regInput.disabled = isEditing;
}

function renderFleet() {
  const body = activeView?.querySelector('#mx-fleet-body');
  if (!body) return;

  const operational = latestFleet.filter((item) => `${item.status || ''}`.toLowerCase() === 'operational').length;
  setStatus(`Fleet: ${operational}/${latestFleet.length} operational. Changes appear in Dispatch immediately.`);

  if (!latestFleet.length) {
    body.innerHTML = '<tr><td colspan="5" class="mx-empty">No aircraft yet. Add the first registration above — it will show up in the Dispatch dropdown.</td></tr>';
    return;
  }

  const badge = (status) => {
    const normalized = `${status || ''}`.toLowerCase();
    const cls = normalized === 'operational' ? 'mx-badge--good' : normalized === 'maintenance' ? 'mx-badge--watch' : 'mx-badge--critical';
    return `<span class="mx-badge ${cls}">${escapeHtml(status || 'Unknown')}</span>`;
  };

  body.innerHTML = latestFleet
    .slice()
    .sort((left, right) => `${left.reg || ''}`.localeCompare(`${right.reg || ''}`))
    .map(
      (item) => `<tr>
        <td><strong>${escapeHtml(item.reg || '—')}</strong></td>
        <td>${escapeHtml(item.type || '—')}</td>
        <td>${badge(item.status)}</td>
        <td>${escapeHtml(item.nextInspection || '—')}</td>
        <td><div class="mx-row-actions">
          <button type="button" class="vs-button vs-button--sm" data-edit-aircraft="${escapeHtml(item.reg || '')}">Edit</button>
          <button type="button" class="vs-button vs-button--sm vs-button--danger" data-delete-aircraft="${escapeHtml(item.reg || '')}">Remove</button>
        </div></td>
      </tr>`
    )
    .join('');
}

function startEditAircraft(reg) {
  const aircraft = latestFleet.find((item) => item.reg === reg);
  if (!aircraft || !activeView) return;
  editingReg = reg;
  activeView.querySelector('#mx-aircraft-reg').value = aircraft.reg || '';
  activeView.querySelector('#mx-aircraft-type').value = aircraft.type || '';
  activeView.querySelector('#mx-aircraft-status').value = aircraft.status || 'Operational';
  activeView.querySelector('#mx-aircraft-inspection').value = aircraft.nextInspection || '';
  setFormMode();
  activeView.querySelector('#mx-fleet-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus(`Editing ${reg}. Registration itself cannot change.`);
}

function cancelEditMode() {
  editingReg = null;
  activeView?.querySelector('#mx-fleet-form')?.reset();
  setFormMode();
}

async function handleSaveFleet(event) {
  event.preventDefault();
  if (!activeCompanyId) return;

  const regInput = activeView.querySelector('#mx-aircraft-reg');
  const type = activeView.querySelector('#mx-aircraft-type')?.value.trim();
  const status = activeView.querySelector('#mx-aircraft-status')?.value || 'Operational';
  const nextInspection = activeView.querySelector('#mx-aircraft-inspection')?.value || null;
  const reg = editingReg || regInput?.value.trim().toUpperCase();

  if (!reg || !type) {
    setStatus('Registration and type are required.');
    return;
  }

  try {
    if (editingReg) {
      await updateCompanyAircraft(activeCompanyId, editingReg, { type, status, nextInspection });
      setStatus(`Aircraft ${editingReg} updated. Dispatch picks it up live.`);
    } else {
      const exists = latestFleet.some((item) => `${item.reg || ''}`.toUpperCase() === reg);
      if (exists) {
        setStatus(`Aircraft ${reg} already exists — use Edit instead.`);
        return;
      }
      await addCompanyAircraft(activeCompanyId, { reg, type, status, nextInspection });
      setStatus(`Aircraft ${reg} added. It is now in the Dispatch dropdown.`);
    }
    cancelEditMode();
  } catch (error) {
    console.error('Save aircraft failed:', error);
    setStatus(editingReg ? 'Failed to update the aircraft.' : 'Failed to add the aircraft.');
  }
}

async function handleDeleteAircraft(reg) {
  if (!reg || !activeCompanyId) return;
  if (!window.confirm(`Remove aircraft ${reg} from the fleet? Past flight history keeps the registration string.`)) return;
  try {
    await deleteCompanyAircraft(activeCompanyId, reg);
    if (editingReg === reg) cancelEditMode();
    setStatus(`Aircraft ${reg} removed.`);
  } catch (error) {
    console.error('Delete aircraft failed:', error);
    setStatus('Failed to remove the aircraft.');
  }
}

function handleFleetClick(event) {
  const editButton = event.target.closest('[data-edit-aircraft]');
  if (editButton) {
    startEditAircraft(editButton.dataset.editAircraft);
    return;
  }
  const deleteButton = event.target.closest('[data-delete-aircraft]');
  if (deleteButton) {
    handleDeleteAircraft(deleteButton.dataset.deleteAircraft);
  }
}

export async function init(view, context) {
  activeView = view;

  mountModuleActions('<span id="mx-status" class="vs-page-chip">Loading fleet...</span>');

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Maintenance Control';
  }

  const currentUser = context?.currentUser || null;
  const orgContext = getCurrentOrganizationContext(currentUser);
  activeCompanyId = orgContext.organizationId || currentUser?.uid || null;
  editingReg = null;

  if (!activeCompanyId) {
    setStatus('No authorized operator found.');
    return { destroy() {} };
  }

  setFormMode();
  view.querySelector('#mx-fleet-form')?.addEventListener('submit', handleSaveFleet);
  view.querySelector('#mx-fleet-cancel-edit')?.addEventListener('click', () => {
    cancelEditMode();
    setStatus('Editing discarded.');
  });
  view.querySelector('#mx-fleet-body')?.addEventListener('click', handleFleetClick);

  try {
    latestFleet = await getCompanyAircraft(activeCompanyId);
    renderFleet();
  } catch (error) {
    console.error('Maintenance fleet load failed:', error);
    setStatus('Unable to load the fleet right now.');
  }

  fleetUnsubscribe = onCompanyAircraftSnapshot(
    activeCompanyId,
    (fleet) => {
      latestFleet = fleet;
      renderFleet();
    },
    (error) => console.error('Maintenance fleet snapshot error:', error)
  );

  return {
    destroy() {
      fleetUnsubscribe?.();
      fleetUnsubscribe = null;
      latestFleet = [];
      activeView = null;
      activeCompanyId = null;
      editingReg = null;
    }
  };
}
