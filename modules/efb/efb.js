import { getCrew, onCrewSnapshot } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
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
let latestFlights = [];
let latestCrew = [];
let selectedFlightId = null;
let activeView = null;
let activeOperatorUid = null;

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
    const status = activeView.querySelector('#efb-status');
    if (status) status.textContent = 'Actuals saved and synced. FDTL will now evaluate this flight for compliance.';
  } catch (error) {
    console.error('Save EFB actuals failed:', error);
    const status = activeView.querySelector('#efb-status');
    if (status) status.textContent = 'Failed to save actuals.';
  }
}

export async function init(view, context) {
  activeView = view;

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Electronic Flight Bag';
  }

  const operatorUid = context?.currentUser?.uid || null;
  const orgContext = getCurrentOrganizationContext(context?.currentUser);
  activeOperatorUid = orgContext.organizationId || operatorUid;

  if (!activeOperatorUid) {
    const status = view.querySelector('#efb-status');
    if (status) status.textContent = 'No authorized operator found.';
    return { destroy() {} };
  }

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
    const status = view.querySelector('#efb-status');
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

  return {
    destroy() {
      flightsUnsubscribe?.();
      crewUnsubscribe?.();
      flightsUnsubscribe = null;
      crewUnsubscribe = null;
      latestFlights = [];
      latestCrew = [];
      selectedFlightId = null;
      activeView = null;
      activeOperatorUid = null;
    }
  };
}
