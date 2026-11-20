import { getCrew, onCrewSnapshot } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mountModuleActions, getModuleAction } from '../../shared/moduleHeader.js';
import {
  addCompanyModuleDoc,
  updateCompanyModuleDoc,
  deleteCompanyModuleDoc,
  onCompanyModuleSnapshot
} from '../../services/companyService.js';
import { uploadCompanyManual, deleteCompanyManualFile } from '../../services/storageService.js';
import {
  listFlights,
  onFlightsSnapshot,
  recordEfbActuals,
  reconcileFlight,
  FLIGHT_STATUSES,
  FLIGHT_SOURCES
} from '../../services/flightService.js';

let flightsUnsubscribe = null;
let crewUnsubscribe = null;
let manualsUnsubscribe = null;
let latestFlights = [];
let latestCrew = [];
let latestManuals = [];
let selectedFlightId = null;
let activeView = null;
let activeOperatorUid = null;
let activeUserUid = null;
let manualsCanManage = false;

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

function formatDayShort(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleString('default', { month: 'short' })}`;
}

function formatDurationMinutes(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

function computeBlockMinutes(flight) {
  const start = toDate(flight.chocksOff);
  const end = toDate(flight.chocksOn);
  if (!start || !end) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function setTab(tabName) {
  if (!activeView) return;
  activeView.querySelectorAll('.efb-tab').forEach((button) => {
    const isActive = button.getAttribute('data-tab') === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  activeView.querySelectorAll('.efb-tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.getAttribute('data-panel') === tabName);
  });
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  const mb = size / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  if (size <= 0) return '—';
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function setManualStatus(message, tone = '') {
  const status = activeView?.querySelector('#efb-manual-status');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-error', tone === 'error');
  status.classList.toggle('is-success', tone === 'success');
}

function renderManuals() {
  const body = activeView?.querySelector('#efb-manuals-body');
  const hint = activeView?.querySelector('#efb-manuals-hint');
  if (!body) return;

  const sorted = [...latestManuals].sort((left, right) => {
    const leftTime = toDate(left.createdAt || left.lastModified)?.getTime() || 0;
    const rightTime = toDate(right.createdAt || right.lastModified)?.getTime() || 0;
    return rightTime - leftTime;
  });

  if (!sorted.length) {
    body.innerHTML = '<tr><td colspan="5" class="fdtl-empty">No company manuals yet.</td></tr>';
    if (hint) hint.textContent = 'Manuals uploaded here are available to all linked users.';
    return;
  }

  if (hint) {
    hint.textContent = `${sorted.length} manual${sorted.length === 1 ? '' : 's'} available to linked users.`;
  }

  body.innerHTML = sorted
    .map((manual) => {
      const hasFile = Boolean(manual.documentUri);
      const actions = hasFile
        ? `<div class="efb-manual-actions">
             <a href="${escapeHtml(manual.documentUri)}" target="_blank" rel="noopener noreferrer" data-action="view">View</a>
             <button type="button" data-action="download">Download</button>
             ${manualsCanManage ? `<button type="button" class="efb-manual-delete" data-action="delete">Delete</button>` : ''}
           </div>`
        : '<span class="fdtl-badge fdtl-badge--watch">Uploading…</span>';
      return `<tr data-manual="${escapeHtml(manual.id)}">
        <td><strong>${escapeHtml(manual.title || 'Untitled manual')}</strong></td>
        <td>${escapeHtml(manual.fileName || '—')}</td>
        <td>${escapeHtml(formatBytes(manual.size))}</td>
        <td>${escapeHtml(formatDayShort(manual.createdAt || manual.lastModified))}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');
}

async function downloadManual(manual) {
  if (!manual?.documentUri) return;
  try {
    const response = await fetch(manual.documentUri);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = manual.fileName || `${manual.title || 'manual'}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn('Manual download failed, opening in a new tab instead:', error);
    window.open(manual.documentUri, '_blank', 'noopener,noreferrer');
  }
}

async function handleManualUpload(event) {
  event.preventDefault();
  if (!manualsCanManage || !activeOperatorUid) return;

  const titleInput = activeView.querySelector('#efb-manual-title');
  const fileInput = activeView.querySelector('#efb-manual-file');
  const button = activeView.querySelector('#efb-manual-upload-btn');
  const title = titleInput?.value.trim() || '';
  const file = fileInput?.files?.[0] || null;

  if (!title) {
    setManualStatus('Enter a title for the manual.', 'error');
    return;
  }
  if (!file) {
    setManualStatus('Choose a file to upload.', 'error');
    return;
  }

  if (button) button.disabled = true;
  setManualStatus('Uploading manual…');

  let created = null;
  let uploaded = null;
  try {
    created = await addCompanyModuleDoc(activeOperatorUid, 'manuals', {
      title,
      fileName: file.name,
      size: file.size,
      contentType: file.type || null,
      status: 'uploading',
      uploadedBy: activeUserUid
    });

    uploaded = await uploadCompanyManual({
      companyId: activeOperatorUid,
      manualId: created.id,
      file
    });

    await updateCompanyModuleDoc(activeOperatorUid, 'manuals', created.id, {
      fileName: uploaded.fileName,
      size: uploaded.size,
      contentType: uploaded.contentType,
      storagePath: uploaded.storagePath,
      documentUri: uploaded.documentUri,
      status: 'active'
    });

    if (titleInput) titleInput.value = '';
    if (fileInput) fileInput.value = '';
    setManualStatus(`"${title}" uploaded. Linked users can now view and download it.`, 'success');
  } catch (error) {
    console.error('Manual upload failed:', error);
    if (uploaded?.storagePath) {
      try {
        await deleteCompanyManualFile(uploaded.storagePath);
      } catch (cleanupError) {
        console.warn('Manual file cleanup failed:', cleanupError);
      }
    }
    if (created?.id) {
      try {
        await deleteCompanyModuleDoc(activeOperatorUid, 'manuals', created.id);
      } catch (cleanupError) {
        console.warn('Manual metadata cleanup failed:', cleanupError);
      }
    }
    setManualStatus(error.message || 'Failed to upload manual.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleManualDelete(manualId) {
  const manual = latestManuals.find((item) => item.id === manualId);
  if (!manual) return;
  const confirmed = window.confirm(`Delete "${manual.title || 'this manual'}"? Linked users will lose access to it.`);
  if (!confirmed) return;

  setManualStatus('Deleting manual…');
  try {
    await deleteCompanyManualFile(manual.storagePath);
    await deleteCompanyModuleDoc(activeOperatorUid, 'manuals', manualId);
    setManualStatus('Manual deleted.', 'success');
  } catch (error) {
    console.error('Manual delete failed:', error);
    setManualStatus(error.message || 'Failed to delete manual.', 'error');
  }
}

function renderFlights() {
  const body = activeView?.querySelector('#efb-flights-body');
  if (!body) return;

  const statusBadge = (status) => {
    const map = {
      [FLIGHT_STATUSES.PLANNED]: 'fdtl-badge--watch',
      [FLIGHT_STATUSES.ACTIVE]: 'fdtl-badge--good',
      [FLIGHT_STATUSES.COMPLETED]: 'fdtl-badge--good',
      [FLIGHT_STATUSES.CANCELLED]: 'fdtl-badge--critical'
    };
    return `<span class="fdtl-badge ${map[status] || 'fdtl-badge--watch'}">${escapeHtml(status || 'planned')}</span>`;
  };

  if (!latestFlights.length) {
    body.innerHTML = '<tr><td colspan="6" class="fdtl-empty">No flight assignments yet. Create flights from the Dispatch module.</td></tr>';
    return;
  }

  body.innerHTML = latestFlights
    .filter((flight) => flight.status !== FLIGHT_STATUSES.CANCELLED)
    .slice(0, 50)
    .map((flight) => {
      const route = [flight.departure, flight.destination].filter(Boolean).join('–') || '—';
      const hasEfb = Boolean(flight.efb && (flight.efb.chocksOff || flight.efb.chocksOn));
      const isSelected = selectedFlightId === flight.flightId;
      return `<tr class="efb-flight-row${isSelected ? ' selected' : ''}" data-flight="${escapeHtml(flight.flightId)}">
        <td>${escapeHtml(formatDayShort(flight.flightDate))}</td>
        <td><strong>${escapeHtml(flight.flightNumber || '—')}</strong></td>
        <td>${escapeHtml(route)}</td>
        <td>${escapeHtml(flight.p1?.name || '—')}</td>
        <td>${statusBadge(flight.status)}</td>
        <td>${hasEfb ? '<span class="fdtl-badge fdtl-badge--good">Recorded</span>' : '<span class="fdtl-badge fdtl-badge--watch">Pending</span>'}</td>
      </tr>`;
    })
    .join('');
}

function populateActualsForm() {
  if (!activeView) return;
  const form = activeView.querySelector('#efb-actuals-form');
  const hint = activeView.querySelector('#efb-selected-hint');
  const saveButton = activeView.querySelector('#efb-save-actuals');

  const flight = latestFlights.find((item) => item.flightId === selectedFlightId);

  if (!flight) {
    if (form) form.reset();
    if (hint) hint.textContent = 'Select a flight from the list above.';
    if (saveButton) saveButton.disabled = true;
    return;
  }

  if (hint) {
    const route = [flight.departure, flight.destination].filter(Boolean).join('–') || '—';
    hint.textContent = `Selected: ${flight.flightNumber || '—'} · ${route} · ${flight.flightDate || ''}. Enter actual times to sync and evaluate FDTL compliance.`;
  }

  const existing = flight.efb || {};
  const setTime = (id, value) => {
    const input = activeView.querySelector(id);
    if (input) {
      const date = toDate(value);
      if (date && !Number.isNaN(date.getTime())) {
        input.value = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      }
    }
  };
  setTime('#efb-actual-chocks-off', existing.chocksOff || flight.chocksOff);
  setTime('#efb-actual-chocks-on', existing.chocksOn || flight.chocksOn);
  setTime('#efb-actual-takeoff', existing.takeoff || flight.takeoff);
  setTime('#efb-actual-landing', existing.landing || flight.landing);

  const irInput = activeView.querySelector('#efb-actual-ir');
  const xcInput = activeView.querySelector('#efb-actual-xc');
  if (irInput) irInput.value = Number(flight.irTimeMinutes) || 0;
  if (xcInput) xcInput.value = Number(flight.xcTimeMinutes) || 0;

  if (saveButton) saveButton.disabled = false;
  updateBlockHint();
}

function updateBlockHint() {
  const chocksOffInput = activeView?.querySelector('#efb-actual-chocks-off');
  const chocksOnInput = activeView?.querySelector('#efb-actual-chocks-on');
  const blockInput = activeView?.querySelector('#efb-actual-block');
  if (!blockInput || !chocksOffInput || !chocksOnInput) return;

  const date = selectedFlightId ? latestFlights.find((item) => item.flightId === selectedFlightId)?.flightDate : null;
  if (!date || !chocksOffInput.value || !chocksOnInput.value) {
    blockInput.value = '—';
    return;
  }
  const start = new Date(`${date}T${chocksOffInput.value}:00`);
  const end = new Date(`${date}T${chocksOnInput.value}:00`);
  if (end <= start) {
    blockInput.value = 'Invalid times';
    return;
  }
  blockInput.value = formatDurationMinutes(Math.round((end.getTime() - start.getTime()) / 60000));
}

async function handleSaveActuals(event) {
  event.preventDefault();
  if (!activeOperatorUid || !selectedFlightId) return;

  const read = (selector) => activeView.querySelector(selector)?.value;
  const flight = latestFlights.find((item) => item.flightId === selectedFlightId);
  if (!flight) return;

  const toTime = (timeValue) => {
    if (!timeValue) return null;
    return `${flight.flightDate}T${timeValue}:00`;
  };

  try {
    await recordEfbActuals(
      activeOperatorUid,
      selectedFlightId,
      {
        chocksOff: toTime(read('#efb-actual-chocks-off')),
        chocksOn: toTime(read('#efb-actual-chocks-on')),
        takeoff: toTime(read('#efb-actual-takeoff')),
        landing: toTime(read('#efb-actual-landing')),
        irTimeMinutes: Number(read('#efb-actual-ir')) || 0,
        xcTimeMinutes: Number(read('#efb-actual-xc')) || 0
      },
      null,
      'EFB actuals recorded'
    );
    const status = getModuleAction('efb-status');
    if (status) status.textContent = 'Actuals saved and synced. FDTL will now evaluate this flight for compliance.';
  } catch (error) {
    console.error('Save EFB actuals failed:', error);
    const status = getModuleAction('efb-status');
    if (status) status.textContent = 'Failed to save actuals.';
  }
}

export async function init(view, context) {
  activeView = view;

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'EFB';
  }

  mountModuleActions('<span id="efb-status" class="vs-page-chip">Loading flight assignments...</span>');

  const operatorUid = context?.currentUser?.uid || null;
  const orgContext = getCurrentOrganizationContext(context?.currentUser);
  activeOperatorUid = orgContext.organizationId || operatorUid;
  activeUserUid = operatorUid;
  const userRole = `${context?.currentUser?.role || ''}`.toUpperCase();
  manualsCanManage = ['ADMIN', 'OWNER'].includes(userRole);

  if (!activeOperatorUid) {
    const status = getModuleAction('efb-status');
    if (status) status.textContent = 'No authorized operator found.';
    return { destroy() {} };
  }

  if (!manualsCanManage) {
    view.querySelector('#efb-manual-upload-card')?.setAttribute('hidden', '');
  }

  view.querySelectorAll('.efb-tab').forEach((button) => {
    button.addEventListener('click', () => setTab(button.getAttribute('data-tab')));
  });

  view.querySelector('#efb-flights-body')?.addEventListener('click', (event) => {
    const row = event.target.closest('.efb-flight-row');
    if (!row) return;
    selectedFlightId = row.dataset.flight;
    renderFlights();
    populateActualsForm();
  });

  view.querySelector('#efb-actuals-form')?.addEventListener('submit', handleSaveActuals);
  ['#efb-actual-chocks-off', '#efb-actual-chocks-on', '#efb-actual-takeoff', '#efb-actual-landing'].forEach((selector) => {
    view.querySelector(selector)?.addEventListener('input', updateBlockHint);
  });

  view.querySelector('#efb-manual-upload-form')?.addEventListener('submit', handleManualUpload);
  view.querySelector('#efb-manuals-body')?.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const row = actionButton.closest('[data-manual]');
    if (!row) return;
    const manual = latestManuals.find((item) => item.id === row.dataset.manual);
    if (!manual) return;
    const action = actionButton.getAttribute('data-action');
    if (action === 'view') return;
    if (action === 'download') downloadManual(manual);
    if (action === 'delete' && manualsCanManage) handleManualDelete(manual.id);
  });

  try {
    const [crewList, flights] = await Promise.all([
      getCrew(activeOperatorUid),
      listFlights(activeOperatorUid)
    ]);
    latestCrew = crewList;
    latestFlights = flights;
    renderFlights();
  } catch (error) {
    console.error('EFB initial load failed:', error);
    const status = getModuleAction('efb-status');
    if (status) status.textContent = 'Unable to load EFB data right now.';
  }

  flightsUnsubscribe = onFlightsSnapshot(
    activeOperatorUid,
    (flights) => {
      latestFlights = flights;
      renderFlights();
      populateActualsForm();
    },
    (error) => console.error('EFB flights snapshot error:', error)
  );

  crewUnsubscribe = onCrewSnapshot(
    activeOperatorUid,
    (crewList) => {
      latestCrew = crewList;
    },
    (error) => console.error('EFB crew snapshot error:', error)
  );

  manualsUnsubscribe = onCompanyModuleSnapshot(
    activeOperatorUid,
    'manuals',
    (manuals) => {
      latestManuals = manuals;
      renderManuals();
    },
    (error) => {
      console.error('EFB manuals snapshot error:', error);
      const hint = view.querySelector('#efb-manuals-hint');
      if (hint) hint.textContent = 'Unable to load manuals right now.';
    }
  );

  return {
    destroy() {
      flightsUnsubscribe?.();
      crewUnsubscribe?.();
      manualsUnsubscribe?.();
      flightsUnsubscribe = null;
      crewUnsubscribe = null;
      manualsUnsubscribe = null;
      latestFlights = [];
      latestCrew = [];
      latestManuals = [];
      selectedFlightId = null;
      activeView = null;
      activeOperatorUid = null;
      activeUserUid = null;
      manualsCanManage = false;
    }
  };
}
