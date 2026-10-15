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

function setFormMessage(message, tone = '') {
  if (!activeView) return;
  const el = activeView.querySelector('#mx-form-message');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.classList.toggle('mx-form-message--error', tone === 'error');
  el.classList.toggle('mx-form-message--ok', tone === 'ok');
}

function describeError(error) {
  const code = error?.code ? ` (${error.code})` : '';
  const detail = error?.message ? `: ${error.message}` : '';
  return `${code}${detail}`;
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

function cancelEditMode(keepMessage = false) {
  editingReg = null;
  activeView?.querySelector('#mx-fleet-form')?.reset();
  setFormMode();
  if (!keepMessage) setFormMessage('');
}

async function handleSaveFleet(event) {
  event.preventDefault();
  if (!activeCompanyId) {
    setStatus('No authorized operator found — cannot save.');
    setFormMessage('No authorized operator found — please sign in again.', 'error');
    return;
  }

  const regInput = activeView.querySelector('#mx-aircraft-reg');
  const type = activeView.querySelector('#mx-aircraft-type')?.value.trim();
  const status = activeView.querySelector('#mx-aircraft-status')?.value || 'Operational';
  const nextInspection = activeView.querySelector('#mx-aircraft-inspection')?.value || null;
  const reg = editingReg || regInput?.value.trim().toUpperCase();

  if (!reg || !type) {
    const message = 'Registration and type are required.';
    setStatus(message);
    setFormMessage(message, 'error');
    return;
  }

  const submitButton = activeView.querySelector('#mx-fleet-submit');
  if (submitButton) submitButton.disabled = true;
  setFormMessage(editingReg ? `Saving ${editingReg}…` : `Adding ${reg}…`);

  try {
    if (editingReg) {
      await updateCompanyAircraft(activeCompanyId, editingReg, { type, status, nextInspection });
      const message = `Aircraft ${editingReg} updated. Dispatch picks it up live.`;
      setStatus(message);
      setFormMessage(message, 'ok');
    } else {
      const exists = latestFleet.some((item) => `${item.reg || ''}`.toUpperCase() === reg);
      if (exists) {
        const message = `Aircraft ${reg} already exists — use Edit instead.`;
        setStatus(message);
        setFormMessage(message, 'error');
        return;
      }
      await addCompanyAircraft(activeCompanyId, { reg, type, status, nextInspection });
      const message = `Aircraft ${reg} added. It is now in the Dispatch dropdown.`;
      setStatus(message);
      setFormMessage(message, 'ok');
    }
    cancelEditMode(true);
  } catch (error) {
    console.error('Save aircraft failed:', error);
    const message = `${editingReg ? 'Failed to update' : 'Failed to add'} the aircraft${describeError(error)}.`;
    setStatus(message);
    setFormMessage(message, 'error');
  } finally {
    if (submitButton) submitButton.disabled = false;
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
    const message = `Unable to load the fleet right now${describeError(error)}.`;
    setStatus(message);
    const body = activeView?.querySelector('#mx-fleet-body');
    if (body) body.innerHTML = `<tr><td colspan="5" class="mx-empty">${escapeHtml(message)}</td></tr>`;
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
