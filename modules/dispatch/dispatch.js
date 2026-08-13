import { getAircraft, onAircraftSnapshot, getCompanyAircraft, onCompanyAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, onCrewSnapshot, getCrewDocumentsByPilots, summarizeCrewDocumentCompliance } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import {
  listFlights,
  onFlightsSnapshot,
  addFlight,
  FLIGHT_STATUSES,
  FLIGHT_SOURCES
} from '../../services/flightService.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;
let flightsUnsubscribe = null;
let latestAircraft = [];
let latestCrew = [];
let latestFlights = [];
let activeView = null;
let activeOperatorUid = null;

function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getCrewId(member) {
  return member.uid || member.crewProfileId || null;
}

function getCrewName(member) {
  return member.name || member.fullName || member.email || member.uid || 'Unnamed Crew';
}

async function renderDispatch() {
  if (!activeView) return;

  const statusLabel = activeView.querySelector('#dispatch-status');
  const queueBody = activeView.querySelector('#dispatch-queue-body');
  if (!statusLabel || !queueBody) return;

  const docsByPilot = await getCrewDocumentsByPilots(latestCrew);

  const crewRows = latestCrew.map((pilot) => {
    const docs = docsByPilot.get(pilot.uid) || [];
    const compliance = summarizeCrewDocumentCompliance(docs);
    const status = compliance.expired > 0 ? 'Expired' : compliance.expiring > 0 ? 'Expiring' : 'Valid';
    return {
      name: pilot.name || pilot.email || pilot.uid,
      status,
      issues: compliance.expired + compliance.expiring
    };
  });

  const totalFleet = latestAircraft.length;
  const operationalFleet = latestAircraft.filter((item) => `${item.status || ''}`.toLowerCase() === 'operational').length;
  const readyCrew = crewRows.filter((item) => item.status === 'Valid').length;
  const constrainedCrew = crewRows.length - readyCrew;
  const constrainedAircraft = latestAircraft.filter((item) => `${item.status || ''}`.toLowerCase() !== 'operational').length;
  const totalConstraints = constrainedCrew + constrainedAircraft;

  activeView.querySelector('#dispatch-fleet-total').textContent = `${totalFleet}`;
  activeView.querySelector('#dispatch-fleet-operational').textContent = `${operationalFleet}`;
  activeView.querySelector('#dispatch-crew-ready').textContent = `${readyCrew}`;
  activeView.querySelector('#dispatch-constraints').textContent = `${totalConstraints}`;

  statusLabel.textContent = `Live readiness for operator ${activeOperatorUid}: ${operationalFleet}/${totalFleet} aircraft operational, ${readyCrew}/${crewRows.length} crew ready.`;

  const queueRows = [];
  latestAircraft.forEach((item) => {
    if (`${item.status || ''}`.toLowerCase() === 'operational') return;
    queueRows.push({
      type: 'Aircraft',
      reference: item.reg || 'Unknown',
      issue: 'Not operational',
      status: item.status || 'Unknown'
    });
  });

  crewRows.forEach((item) => {
    if (item.status === 'Valid') return;
    queueRows.push({
      type: 'Crew',
      reference: item.name,
      issue: item.status === 'Expired' ? 'Critical document expired' : 'Document expiring soon',
      status: item.status
    });
  });

  if (!queueRows.length) {
    queueBody.innerHTML = '<tr><td colspan="4">No active constraints. Dispatch window is clear.</td></tr>';
  } else {
    queueBody.innerHTML = queueRows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.type)}</td>
          <td>${escapeHtml(row.reference)}</td>
          <td>${escapeHtml(row.issue)}</td>
          <td>${escapeHtml(row.status)}</td>
        </tr>`
      )
      .join('');
  }

  renderFlightBoard();
}

function renderFlightBoard() {
  const body = activeView?.querySelector('#dispatch-flights-body');
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

  const sourceLabel = {
    [FLIGHT_SOURCES.DISPATCH]: 'Flight Ops',
    [FLIGHT_SOURCES.EFB]: 'EFB',
    [FLIGHT_SOURCES.DISPATCH_EFB]: 'Flight Ops + EFB',
    [FLIGHT_SOURCES.MANUAL]: 'Manual'
  };

  if (!latestFlights.length) {
    body.innerHTML = '<tr><td colspan="6" class="fdtl-empty">No flights created yet. Use the form above to plan the first flight.</td></tr>';
    return;
  }

  body.innerHTML = latestFlights
    .slice(0, 50)
    .map((flight) => {
      const route = [flight.departure, flight.destination].filter(Boolean).join('–') || '—';
      return `<tr>
        <td>${escapeHtml(flight.flightDate || '—')}</td>
        <td><strong>${escapeHtml(flight.flightNumber || '—')}</strong></td>
        <td>${escapeHtml(route)}</td>
        <td>${escapeHtml(flight.p1?.name || '—')}</td>
        <td>${statusBadge(flight.status)}</td>
        <td>${escapeHtml(sourceLabel[flight.source] || flight.source || '—')}</td>
      </tr>`;
    })
    .join('');
}

function populateFlightForm() {
  if (!activeView) return;

  const aircraftSelect = activeView.querySelector('#dispatch-flight-aircraft');
  if (aircraftSelect) {
    aircraftSelect.innerHTML =
      '<option value="">Select aircraft</option>' +
      latestAircraft.map((item) => `<option value="${escapeHtml(item.reg)}">${escapeHtml(item.reg)} · ${escapeHtml(item.type || '')}</option>`).join('');
  }

  const p1Select = activeView.querySelector('#dispatch-flight-p1');
  const p2Select = activeView.querySelector('#dispatch-flight-p2');
  const crewOptions = latestCrew
    .map((member) => `<option value="${escapeHtml(getCrewId(member))}">${escapeHtml(getCrewName(member))}</option>`)
    .join('');
  if (p1Select) p1Select.innerHTML = '<option value="">Select crew</option>' + crewOptions;
  if (p2Select) p2Select.innerHTML = '<option value="">— None —</option>' + crewOptions;

  const dateInput = activeView.querySelector('#dispatch-flight-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

async function handleCreateFlight(event) {
  event.preventDefault();
  if (!activeOperatorUid) return;

  const read = (selector) => activeView.querySelector(selector)?.value;
  const flightNumber = read('#dispatch-flight-number')?.trim();
  const aircraftReg = read('#dispatch-flight-aircraft');
  const departure = read('#dispatch-flight-departure')?.trim();
  const destination = read('#dispatch-flight-destination')?.trim();
  const flightDate = read('#dispatch-flight-date');
  const p1Id = read('#dispatch-flight-p1');

  if (!flightNumber || !departure || !destination || !flightDate || !p1Id) {
    const status = activeView.querySelector('#dispatch-status');
    if (status) status.textContent = 'Flight number, aircraft, route, date, and P1 are required.';
    return;
  }

  const member1 = latestCrew.find((item) => getCrewId(item) === p1Id);
  const p2Id = read('#dispatch-flight-p2');

  try {
    await addFlight(
      activeOperatorUid,
      {
        flightNumber,
        aircraftReg: aircraftReg || null,
        departure,
        destination,
        route: `${departure}-${destination}`,
        flightDate,
        status: FLIGHT_STATUSES.PLANNED,
        source: FLIGHT_SOURCES.DISPATCH,
        p1: { crewProfileId: p1Id, name: member1 ? getCrewName(member1) : null },
        p2: p2Id
          ? {
              crewProfileId: p2Id,
              name: getCrewName(latestCrew.find((item) => getCrewId(item) === p2Id))
            }
          : null,
        plannedDeparture: read('#dispatch-flight-planned-dep') || null,
        plannedArrival: read('#dispatch-flight-planned-arr') || null,
        distanceNM: Number(read('#dispatch-flight-distance')) || 0,
        operationType: read('#dispatch-flight-op-type') || 'commercial',
        remarks: read('#dispatch-flight-remarks') || null
      },
      null,
      'Planned flight created from dispatch module'
    );

    event.target.reset();
    const dateInput = activeView.querySelector('#dispatch-flight-date');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    const status = activeView.querySelector('#dispatch-status');
    if (status) status.textContent = 'Flight created. It is now visible to the EFB and FDTL modules.';
  } catch (error) {
    console.error('Create flight failed:', error);
    const status = activeView.querySelector('#dispatch-status');
    if (status) status.textContent = 'Failed to create the flight.';
  }
}

export async function init(view, context) {
  activeView = view;

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Dispatch Control';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'dispatch';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;
  const orgContext = getCurrentOrganizationContext(context?.currentUser);
  activeOperatorUid = orgContext.organizationId || operatorUid;

  if (!activeOperatorUid) {
    const statusLabel = view.querySelector('#dispatch-status');
    if (statusLabel) {
      statusLabel.textContent = 'No authorized operator found.';
    }
    return {
      destroy() {}
    };
  }

  view.querySelector('#dispatch-flight-form')?.addEventListener('submit', handleCreateFlight);

  try {
    const [aircraftFleet, crewList, companyAircraft, flights] = await Promise.all([
      getAircraft(),
      getCrew(activeOperatorUid),
      getCompanyAircraft(activeOperatorUid),
      listFlights(activeOperatorUid)
    ]);
    latestAircraft = companyAircraft.length ? companyAircraft : aircraftFleet;
    latestCrew = crewList;
    latestFlights = flights;
    populateFlightForm();
    await renderDispatch();
  } catch (error) {
    console.error('Dispatch initial load failed:', error);
    const statusLabel = view.querySelector('#dispatch-status');
    if (statusLabel) {
      statusLabel.textContent = 'Unable to load dispatch data right now.';
    }
  }

  aircraftUnsubscribe = onAircraftSnapshot(
    async (snapshot) => {
      latestAircraft = snapshot.docs.map((item) => ({ reg: item.id, ...item.data() }));
      populateFlightForm();
      await renderDispatch();
    },
    (error) => console.error('Dispatch aircraft snapshot error:', error)
  );

  crewUnsubscribe = onCrewSnapshot(
    activeOperatorUid,
    async (snapshot) => {
      latestCrew = snapshot.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
      populateFlightForm();
      await renderDispatch();
    },
    (error) => console.error('Dispatch crew snapshot error:', error)
  );

  flightsUnsubscribe = onFlightsSnapshot(
    activeOperatorUid,
    async (snapshot) => {
      latestFlights = snapshot;
      renderFlightBoard();
    },
    (error) => console.error('Dispatch flights snapshot error:', error)
  );

  return {
    destroy() {
      aircraftUnsubscribe?.();
      crewUnsubscribe?.();
      flightsUnsubscribe?.();
      aircraftUnsubscribe = null;
      crewUnsubscribe = null;
      flightsUnsubscribe = null;
      latestAircraft = [];
      latestCrew = [];
      latestFlights = [];
      activeView = null;
      activeOperatorUid = null;
    }
  };
}
