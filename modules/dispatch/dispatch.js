import { getCompanyAircraft, onCompanyAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, onCrewSnapshot, getCrewDocumentsByPilots, syncCrewDocumentCache, summarizeCrewDocumentCompliance } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mountModuleActions, getModuleAction } from '../../shared/moduleHeader.js';
import {
  listFlights,
  onFlightsSnapshot,
  addFlight,
  updateFlight,
  computeBlockTimeMinutes,
  resolveActualTimes,
  reconcileFlight,
  FLIGHT_STATUSES,
  FLIGHT_SOURCES
} from '../../services/flightService.js';
import { getFdtlScheme, getDefaultScheme, resolveFdpBaseLimit, listFlightAuditEntries } from '../../services/fdtl/index.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;
let flightsUnsubscribe = null;
let latestAircraft = [];
let latestCrew = [];
let latestFlights = [];
let latestDocsByPilot = new Map();
let latestScheme = null;
let activeView = null;
let activeOperatorUid = null;
let activeActor = null;
let editingFlightId = null;
let crewFilter = '__all__';
let statusFilter = '__all__';
let searchQuery = '';
let fleetError = null;
const expandedFlightIds = new Set();
const auditCache = new Map();

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

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    try {
      const converted = value.toDate();
      return converted && !Number.isNaN(converted.getTime()) ? converted : null;
    } catch {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toLocalInput(value) {
  const date = toDate(value);
  if (!date) return '';
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBlock(minutes) {
  if (minutes == null) return '—';
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function flightHasEfbData(flight) {
  const efb = flight?.efb || {};
  return Boolean(efb.chocksOff || efb.chocksOn || efb.takeoff || efb.landing);
}

function crewIdsForFlight(flight) {
  if (Array.isArray(flight?.crewProfileIds) && flight.crewProfileIds.length) return flight.crewProfileIds;
  return [flight?.p1?.crewProfileId, flight?.p2?.crewProfileId].filter(Boolean);
}

function completedFlightsForCrew(crewId) {
  return latestFlights
    .filter((flight) => flight.status === FLIGHT_STATUSES.COMPLETED && crewIdsForFlight(flight).includes(crewId))
    .slice()
    .sort((left, right) => (toDate(left.flightDate)?.getTime() || 0) - (toDate(right.flightDate)?.getTime() || 0));
}

// --- FDTL linkage (pre-flight projection + post-flight verdict) ---

function evaluateCrewForFlight(crewId, flight, blockMinutes) {
  const scheme = latestScheme || getDefaultScheme();
  const postFlight = Number(scheme.operationalAdjustments?.postFlightAllowanceMinutes ?? 0);
  const minRest = Number(scheme.rest?.minimumMinutes ?? 720);
  const warningPct = Number(scheme.fdp?.warningThresholdPct ?? 0.8);

  const crewFlights = completedFlightsForCrew(crewId);
  const isAlreadyCounted = crewFlights.some((item) => item.flightId === flight?.flightId);
  const projection = isAlreadyCounted ? crewFlights : [...crewFlights, flight].filter(Boolean);

  const fdpAllowed = resolveFdpBaseLimit(scheme, { flightTimeMinutes: blockMinutes, landings: 1 });
  const fdpUsed = blockMinutes + postFlight;
  let verdict = 'within';
  const reasons = [];

  if (fdpAllowed == null) {
    verdict = 'exceeded';
    reasons.push(`block ${formatBlock(blockMinutes)} exceeds scheme table`);
  } else if (fdpUsed > fdpAllowed) {
    verdict = 'exceeded';
    reasons.push(`FDP ${formatBlock(fdpUsed)} over limit ${formatBlock(fdpAllowed)}`);
  } else if (fdpUsed >= Math.round(fdpAllowed * warningPct)) {
    verdict = 'attention';
    reasons.push(`FDP ${formatBlock(fdpUsed)} near limit ${formatBlock(fdpAllowed)}`);
  }

  const flightMs = toDate(flight?.flightDate)?.getTime() || Date.now();
  const totals = { 7: 0, 28: 0 };
  projection.forEach((candidate) => {
    const candidateMs = toDate(candidate.flightDate)?.getTime() || 0;
    const candidateBlock = candidate.flightId === flight?.flightId ? blockMinutes : computeBlockTimeMinutes(candidate) ?? 0;
    if (flightMs - candidateMs <= 7 * 86400000) totals[7] += candidateBlock;
    if (flightMs - candidateMs <= 28 * 86400000) totals[28] += candidateBlock;
  });
  [7, 28].forEach((days) => {
    const allowed = Number(scheme.cumulative?.[days]?.flightTimeMinutes ?? 0);
    if (!allowed) return;
    if (totals[days] > allowed) {
      verdict = 'exceeded';
      reasons.push(`${days}d cumulative ${formatBlock(totals[days])} over ${formatBlock(allowed)}`);
    } else if (totals[days] >= Math.round(allowed * 0.8) && verdict === 'within') {
      verdict = 'attention';
      reasons.push(`${days}d cumulative ${formatBlock(totals[days])} near ${formatBlock(allowed)}`);
    }
  });

  const sorted = projection.slice().sort((a, b) => (toDate(a.flightDate)?.getTime() || 0) - (toDate(b.flightDate)?.getTime() || 0));
  const index = Math.max(0, sorted.findIndex((item) => item.flightId === flight?.flightId));
  const previous = sorted[index - 1] || sorted[sorted.length - 2] || null;
  let restAvailable = null;
  let restRequired = null;
  if (previous && flight) {
    const prevResolved = resolveActualTimes(previous);
    const prevEnd = toDate(previous.chocksOn || prevResolved.chocksOn || previous.landing || prevResolved.landing);
    const thisStart =
      toDate(flight.chocksOff) || toDate(resolveActualTimes(flight).chocksOff) || toDate(flight.plannedDeparture);
    if (prevEnd && thisStart) {
      const prevBlock = computeBlockTimeMinutes(previous) ?? 0;
      restRequired = Math.max(minRest, prevBlock);
      restAvailable = Math.max(0, Math.round((thisStart.getTime() - prevEnd.getTime()) / 60000));
      if (restAvailable < restRequired) {
        verdict = 'exceeded';
        reasons.push(`rest ${formatBlock(restAvailable)} short of ${formatBlock(restRequired)}`);
      }
    }
  }

  return { verdict, reasons, totals, restAvailable, restRequired, fdpUsed, fdpAllowed };
}

function buildDispatchCompliance(flight) {
  if (flight?.status !== FLIGHT_STATUSES.COMPLETED) return null;
  const block = computeBlockTimeMinutes(flight);
  if (block == null) return { verdict: 'attention', reason: 'Completed without usable times', blockTime: null };
  const crewIds = crewIdsForFlight(flight);
  if (!crewIds.length) return { verdict: 'within', reason: 'No crew linked', blockTime: block };
  let worst = 'within';
  const reasons = [];
  crewIds.forEach((crewId) => {
    const result = evaluateCrewForFlight(crewId, flight, block);
    if (result.verdict === 'exceeded') worst = 'exceeded';
    else if (result.verdict === 'attention' && worst === 'within') worst = 'attention';
    result.reasons.forEach((reason) => reasons.push(reason));
  });
  return { verdict: worst, reason: reasons.join(' · ') || 'Within limits', blockTime: block };
}

function updateFdtlPreview() {
  if (!activeView) return;
  const text = activeView.querySelector('#dispatch-fdtl-preview-text');
  const panel = activeView.querySelector('#dispatch-fdtl-preview');
  if (!text || !panel) return;

  const read = (selector) => activeView.querySelector(selector)?.value;
  const p1Id = read('#dispatch-flight-p1');
  const p2Id = read('#dispatch-flight-p2');
  const plannedDep = read('#dispatch-flight-planned-dep');
  const plannedArr = read('#dispatch-flight-planned-arr');

  panel.classList.remove('dispatch-fdtl-preview--good', 'dispatch-fdtl-preview--watch', 'dispatch-fdtl-preview--critical');

  if (!p1Id && !p2Id) {
    text.textContent = 'Select crew and scheduled times to project compliance.';
    return;
  }
  const depDate = toDate(plannedDep);
  const arrDate = toDate(plannedArr);
  if (!depDate || !arrDate || arrDate <= depDate) {
    text.textContent = 'Enter scheduled departure/arrival to project FDP, rest and cumulative load.';
    return;
  }

  const projectedBlock = Math.max(0, Math.round((arrDate.getTime() - depDate.getTime()) / 60000));
  const crewIds = [p1Id, p2Id].filter(Boolean);
  const probe = {
    flightId: editingFlightId || '__draft__',
    flightDate: read('#dispatch-flight-date') || new Date().toISOString().slice(0, 10),
    plannedDeparture: plannedDep,
    chocksOff: plannedDep
  };
  let worst = 'within';
  const parts = crewIds.map((crewId) => {
    const member = latestCrew.find((item) => getCrewId(item) === crewId);
    const result = evaluateCrewForFlight(crewId, probe, projectedBlock);
    if (result.verdict === 'exceeded') worst = 'exceeded';
    else if (result.verdict === 'attention' && worst === 'within') worst = 'attention';
    const label = getCrewName(member || { uid: crewId });
    const detail = result.reasons.length ? ` — ${result.reasons.join('; ')}` : '';
    return `${label}: ${result.verdict.toUpperCase()} (FDP ${formatBlock(result.fdpUsed)}${result.fdpAllowed != null ? `/${formatBlock(result.fdpAllowed)}` : ''})${detail}`;
  });

  text.textContent = `Projected block ${formatBlock(projectedBlock)} · ${parts.join(' | ')} — advisory, dispatch may still save.`;
  panel.classList.add(worst === 'exceeded' ? 'dispatch-fdtl-preview--critical' : worst === 'attention' ? 'dispatch-fdtl-preview--watch' : 'dispatch-fdtl-preview--good');
}

function updateBlockHint() {
  if (!activeView) return;
  const read = (selector) => activeView.querySelector(selector)?.value;
  const off = toDate(read('#dispatch-actual-chocks-off'));
  const on = toDate(read('#dispatch-actual-chocks-on'));
  const blockEl = activeView.querySelector('#dispatch-actual-block');
  if (blockEl) blockEl.textContent = off && on && on >= off ? formatBlock(Math.round((on.getTime() - off.getTime()) / 60000)) : '—';
}

// --- Board rendering ---

async function renderDispatch() {
  if (!activeView) return;

  const statusLabel = getModuleAction('dispatch-status');
  const queueBody = activeView.querySelector('#dispatch-queue-body');
  if (!statusLabel || !queueBody) return;

  const docsByPilot = latestDocsByPilot;

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

function filteredFlights() {
  const query = searchQuery.trim().toLowerCase();
  return latestFlights.filter((flight) => {
    if (statusFilter !== '__all__' && flight.status !== statusFilter) return false;
    if (crewFilter !== '__all__' && !crewIdsForFlight(flight).includes(crewFilter)) return false;
    if (query) {
      const haystack = [
        flight.flightNumber,
        flight.departure,
        flight.destination,
        flight.route,
        flight.aircraftReg,
        flight.p1?.name,
        flight.p2?.name
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
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

  const fdtlBadge = (flight) => {
    if (flight.status === FLIGHT_STATUSES.CANCELLED) return '<span class="muted">—</span>';
    const compliance = buildDispatchCompliance(flight);
    if (!compliance) return '<span class="muted">Pre-flight only</span>';
    const cls = compliance.verdict === 'exceeded' ? 'fdtl-badge--critical' : compliance.verdict === 'attention' ? 'fdtl-badge--watch' : 'fdtl-badge--good';
    return `<span class="fdtl-badge ${cls}" title="${escapeHtml(compliance.reason)}">${escapeHtml(compliance.verdict.toUpperCase())}</span>`;
  };

  const sourceLabel = {
    [FLIGHT_SOURCES.DISPATCH]: 'Flight Ops',
    [FLIGHT_SOURCES.EFB]: 'EFB',
    [FLIGHT_SOURCES.DISPATCH_EFB]: 'Flight Ops + EFB',
    [FLIGHT_SOURCES.MANUAL]: 'Manual'
  };

  const rows = filteredFlights();

  if (!latestFlights.length) {
    body.innerHTML = '<tr><td colspan="9" class="fdtl-empty">No flights created yet. Use the form above to plan the first movement.</td></tr>';
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="fdtl-empty">No movements match the current filters.</td></tr>';
    return;
  }

  const actionsFor = (flight) => {
    const id = escapeHtml(flight.flightId || '');
    const expanded = expandedFlightIds.has(flight.flightId);
    if (flight.status === FLIGHT_STATUSES.CANCELLED) {
      return `<div class="dispatch-row-actions">
        <button type="button" class="vs-button vs-button--sm" data-details-flight="${id}">${expanded ? 'Hide' : 'Details'}</button>
        <button type="button" class="vs-button vs-button--sm" data-reactivate-flight="${id}">Reactivate</button>
      </div>`;
    }
    const cancelButton =
      flight.status === FLIGHT_STATUSES.COMPLETED
        ? ''
        : `<button type="button" class="vs-button vs-button--sm vs-button--danger" data-cancel-flight="${id}">Cancel</button>`;
    return `<div class="dispatch-row-actions">
        <button type="button" class="vs-button vs-button--sm" data-details-flight="${id}">${expanded ? 'Hide' : 'Details'}</button>
        <button type="button" class="vs-button vs-button--sm" data-edit-flight="${id}">Edit</button>
        ${cancelButton}
      </div>`;
  };

  const detailRowFor = (flight) => {
    if (!expandedFlightIds.has(flight.flightId)) return '';
    const resolved = resolveActualTimes(flight);
    const recon = flight.reconciliation || reconcileFlight(flight);
    const mismatch = (recon.mismatches || [])
      .map((item) => `${item.field}: FOps ${item.fops || '—'} vs EFB ${item.efb || '—'}`)
      .join('; ');
    const cached = auditCache.get(flight.flightId);
    const auditHtml = !cached
      ? '<span class="muted">Loading audit…</span>'
      : cached.error
        ? `<span class="muted">${escapeHtml(cached.error)}</span>`
        : !cached.entries.length
          ? '<span class="muted">No audit entries yet.</span>'
          : `<ul class="dispatch-audit-list">${cached.entries
              .slice(0, 12)
              .map(
                (entry) =>
                  `<li><strong>${escapeHtml(entry.field || 'change')}</strong> — ${escapeHtml(entry.reason || 'no reason')} <span class="muted">by ${escapeHtml(entry.actorName || 'Unknown')}</span></li>`
              )
              .join('')}</ul>`;
    return `<tr class="dispatch-detail-row"><td colspan="9">
      <div class="dispatch-detail">
        <div class="dispatch-detail-grid">
          <div><strong>Planned:</strong> ${escapeHtml(flight.plannedDeparture || '—')} → ${escapeHtml(flight.plannedArrival || '—')}</div>
          <div><strong>Actual:</strong> ${escapeHtml(resolved.chocksOff || '—')} → ${escapeHtml(resolved.chocksOn || '—')} (TO ${escapeHtml(resolved.takeoff || '—')} / LDG ${escapeHtml(resolved.landing || '—')})</div>
          <div><strong>Block:</strong> ${formatBlock(computeBlockTimeMinutes(flight))} · IR ${escapeHtml(`${Number(flight.irTimeMinutes) || 0}`)}m · XC ${escapeHtml(`${Number(flight.xcTimeMinutes) || 0}`)}m</div>
          <div><strong>Reconciliation:</strong> ${escapeHtml(recon.status || '—')}${mismatch ? ` — ${escapeHtml(mismatch)}` : ''}</div>
        </div>
        <div><strong>Remarks:</strong> ${escapeHtml(flight.remarks || '—')}</div>
        <div><strong>Audit trail:</strong> ${auditHtml}</div>
      </div>
    </td></tr>`;
  };

  body.innerHTML = rows
    .slice(0, 100)
    .map((flight) => {
      const route = [flight.departure, flight.destination].filter(Boolean).join('–') || '—';
      const crew = [flight.p1?.name, flight.p2?.name].filter(Boolean).join(' / ') || '—';
      const compliance = buildDispatchCompliance(flight);
      const blockTitle = compliance?.reason || '';
      return `<tr>
        <td>${escapeHtml(flight.flightDate || '—')}</td>
        <td><strong>${escapeHtml(flight.flightNumber || '—')}</strong><br /><span class="muted">${escapeHtml(flight.aircraftReg || '')}</span></td>
        <td>${escapeHtml(route)}</td>
        <td>${escapeHtml(crew)}</td>
        <td title="${escapeHtml(blockTitle)}">${formatBlock(computeBlockTimeMinutes(flight))}</td>
        <td>${statusBadge(flight.status)}</td>
        <td>${fdtlBadge(flight)}</td>
        <td>${escapeHtml(sourceLabel[flight.source] || flight.source || '—')}</td>
        <td>${actionsFor(flight)}</td>
      </tr>${detailRowFor(flight)}`;
    })
    .join('');
}

async function loadFlightAudit(flightId) {
  if (!flightId || !activeOperatorUid) return;
  if (auditCache.has(flightId)) return;
  auditCache.set(flightId, null);
  renderFlightBoard();
  try {
    const entries = await listFlightAuditEntries(activeOperatorUid, flightId, 100);
    auditCache.set(flightId, { entries });
  } catch (error) {
    console.error('Dispatch audit load failed:', error);
    auditCache.set(flightId, { entries: [], error: 'Audit unavailable right now.' });
  }
  if (expandedFlightIds.has(flightId)) renderFlightBoard();
}

// --- Form handling ---

function renderFleetState() {
  if (!activeView) return;
  const hasFleet = latestAircraft.length > 0;
  const warning = activeView.querySelector('#dispatch-fleet-warning');
  const errorBox = activeView.querySelector('#dispatch-fleet-error');
  const errorText = activeView.querySelector('#dispatch-fleet-error-text');
  if (warning) warning.hidden = hasFleet || Boolean(fleetError);
  if (errorBox) errorBox.hidden = !fleetError || hasFleet;
  if (errorText && fleetError) errorText.textContent = fleetError;
}

// Single authoritative fleet source: companies/{companyId}/aircraft.
// No fallback to any legacy collection — empty means empty, failure means error.
async function loadFleet() {
  if (!activeOperatorUid) return;
  try {
    latestAircraft = await getCompanyAircraft(activeOperatorUid);
    fleetError = null;
  } catch (error) {
    console.error('Dispatch fleet load failed:', error);
    fleetError = `Unable to load company aircraft (${error?.code || error?.message || 'unknown error'}).`;
  }
  populateFlightForm();
  await renderDispatch();
}

function populateFlightForm() {
  if (!activeView) return;

  const aircraftSelect = activeView.querySelector('#dispatch-flight-aircraft');
  if (aircraftSelect) {
    const previous = aircraftSelect.value;
    if (!latestAircraft.length) {
      aircraftSelect.innerHTML = fleetError
        ? '<option value="">Aircraft unavailable — see error below</option>'
        : '<option value="">No aircraft — add fleet in Maintenance</option>';
    } else {
      aircraftSelect.innerHTML =
        '<option value="">Select aircraft</option>' +
        latestAircraft.map((item) => `<option value="${escapeHtml(item.reg)}">${escapeHtml(item.reg)} · ${escapeHtml(item.type || '')}</option>`).join('');
      if (previous) aircraftSelect.value = previous;
    }
  }

  renderFleetState();

  const p1Select = activeView.querySelector('#dispatch-flight-p1');
  const p2Select = activeView.querySelector('#dispatch-flight-p2');
  const previousP1 = p1Select?.value || null;
  const previousP2 = p2Select?.value || null;
  const crewOptions = latestCrew
    .map((member) => `<option value="${escapeHtml(getCrewId(member))}">${escapeHtml(getCrewName(member))}</option>`)
    .join('');
  if (p1Select) {
    p1Select.innerHTML = '<option value="">Select crew</option>' + crewOptions;
    if (previousP1) p1Select.value = previousP1;
  }
  if (p2Select) {
    p2Select.innerHTML = '<option value="">— None —</option>' + crewOptions;
    if (previousP2) p2Select.value = previousP2;
  }

  const crewFilterSelect = activeView.querySelector('#dispatch-crew-filter');
  if (crewFilterSelect) {
    const previousFilter = crewFilter;
    crewFilterSelect.innerHTML =
      '<option value="__all__">All pilots</option>' +
      latestCrew
        .map((member) => `<option value="${escapeHtml(getCrewId(member))}">${escapeHtml(getCrewName(member))}</option>`)
        .join('');
    crewFilterSelect.value = previousFilter;
    if (!crewFilterSelect.value) {
      crewFilterSelect.value = '__all__';
      crewFilter = '__all__';
    }
  }

  const dateInput = activeView.querySelector('#dispatch-flight-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
  updateBlockHint();
  updateFdtlPreview();
}

function setFlightFormMode() {
  if (!activeView) return;
  const title = activeView.querySelector('#dispatch-form-title');
  const submit = activeView.querySelector('#dispatch-flight-submit');
  const cancelEdit = activeView.querySelector('#dispatch-flight-cancel-edit');
  const isEditing = Boolean(editingFlightId);
  if (title) title.textContent = isEditing ? 'Edit Flight Movement' : 'Plan Flight Movement';
  if (submit) submit.textContent = isEditing ? 'Save Changes' : 'Create Flight';
  if (cancelEdit) cancelEdit.hidden = !isEditing;
}

function startEditFlight(flightId) {
  const flight = latestFlights.find((item) => item.flightId === flightId);
  if (!flight || !activeView) return;
  if (flight.status === FLIGHT_STATUSES.CANCELLED) return;

  editingFlightId = flightId;
  populateFlightForm();

  const set = (selector, value) => {
    const input = activeView.querySelector(selector);
    if (input) input.value = value ?? '';
  };
  set('#dispatch-flight-number', flight.flightNumber || '');
  set('#dispatch-flight-aircraft', flight.aircraftReg || '');
  set('#dispatch-flight-departure', flight.departure || '');
  set('#dispatch-flight-destination', flight.destination || '');
  set('#dispatch-flight-date', flight.flightDate || '');
  set('#dispatch-flight-planned-dep', flight.plannedDeparture || '');
  set('#dispatch-flight-planned-arr', flight.plannedArrival || '');
  set('#dispatch-flight-distance', Number(flight.distanceNM) || 0);
  set('#dispatch-flight-op-type', flight.operationType || 'commercial');
  set('#dispatch-flight-p1', flight.p1?.crewProfileId || '');
  set('#dispatch-flight-p2', flight.p2?.crewProfileId || '');
  set('#dispatch-flight-remarks', flight.remarks || '');

  const resolved = resolveActualTimes(flight);
  set('#dispatch-actual-chocks-off', toLocalInput(flight.chocksOff || resolved.chocksOff));
  set('#dispatch-actual-takeoff', toLocalInput(flight.takeoff || resolved.takeoff));
  set('#dispatch-actual-landing', toLocalInput(flight.landing || resolved.landing));
  set('#dispatch-actual-chocks-on', toLocalInput(flight.chocksOn || resolved.chocksOn));
  set('#dispatch-actual-ir', Number(flight.irTimeMinutes) || 0);
  set('#dispatch-actual-xc', Number(flight.xcTimeMinutes) || 0);

  setFlightFormMode();
  updateBlockHint();
  updateFdtlPreview();
  activeView.querySelector('#dispatch-flight-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const status = getModuleAction('dispatch-status');
  if (status) {
    status.textContent =
      flight.status === FLIGHT_STATUSES.COMPLETED
        ? `Correcting completed movement ${flight.flightNumber || flightId}. EFB data is preserved; changes are audited.`
        : `Editing ${flight.flightNumber || flightId}. Save to update, or cancel editing to discard.`;
  }
}

function cancelEditMode(resetForm = true) {
  editingFlightId = null;
  if (resetForm && activeView) {
    activeView.querySelector('#dispatch-flight-form')?.reset();
    const dateInput = activeView.querySelector('#dispatch-flight-date');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    updateBlockHint();
  }
  setFlightFormMode();
  updateFdtlPreview();
}

function collectFlightFormInput() {
  const read = (selector) => activeView.querySelector(selector)?.value;
  const flightNumber = read('#dispatch-flight-number')?.trim();
  const aircraftReg = read('#dispatch-flight-aircraft');
  const departure = read('#dispatch-flight-departure')?.trim().toUpperCase();
  const destination = read('#dispatch-flight-destination')?.trim().toUpperCase();
  const flightDate = read('#dispatch-flight-date');
  const p1Id = read('#dispatch-flight-p1');
  const p2Id = read('#dispatch-flight-p2');

  if (!flightNumber || !departure || !destination || !flightDate || !p1Id) {
    return { error: 'Flight number, route, date, and P1 are required.' };
  }
  if (!aircraftReg) {
    return { error: 'Aircraft registration is required for a flight movement.' };
  }
  if (p2Id && p2Id === p1Id) {
    return { error: 'P1 and P2 must be different pilots.' };
  }

  const member1 = latestCrew.find((item) => getCrewId(item) === p1Id);
  const member2 = p2Id ? latestCrew.find((item) => getCrewId(item) === p2Id) : null;

  const chocksOff = read('#dispatch-actual-chocks-off') || null;
  const takeoff = read('#dispatch-actual-takeoff') || null;
  const landing = read('#dispatch-actual-landing') || null;
  const chocksOn = read('#dispatch-actual-chocks-on') || null;
  const actualTimes = [chocksOff, takeoff, landing, chocksOn];
  const filledCount = actualTimes.filter(Boolean).length;
  // Partial actuals are allowed: the movement stays active until all four are known.

  const ordered = actualTimes.map((value) => (value ? toDate(value) : null));
  if (ordered.some((value, index) => actualTimes[index] && !value)) {
    return { error: 'Actual times must be valid dates.' };
  }
  const present = ordered.filter(Boolean);
  for (let index = 1; index < present.length; index += 1) {
    if (present[index].getTime() < present[index - 1].getTime()) {
      return { error: 'Actual times must run chocks-off ≤ takeoff ≤ landing ≤ chocks-on.' };
    }
  }

  return {
    value: {
      flightNumber,
      aircraftReg,
      departure,
      destination,
      route: `${departure}-${destination}`,
      flightDate,
      p1: { crewProfileId: p1Id, name: member1 ? getCrewName(member1) : null },
      p2: p2Id ? { crewProfileId: p2Id, name: member2 ? getCrewName(member2) : null } : null,
      plannedDeparture: read('#dispatch-flight-planned-dep') || null,
      plannedArrival: read('#dispatch-flight-planned-arr') || null,
      distanceNM: Number(read('#dispatch-flight-distance')) || 0,
      operationType: read('#dispatch-flight-op-type') || 'commercial',
      remarks: read('#dispatch-flight-remarks') || null,
      actuals: { chocksOff, takeoff, landing, chocksOn, filledCount },
      irTimeMinutes: Number(read('#dispatch-actual-ir')) || 0,
      xcTimeMinutes: Number(read('#dispatch-actual-xc')) || 0
    }
  };
}

function deriveMovementStatus(formValue, before) {
  const { filledCount } = formValue.actuals;
  if (!editingFlightId) {
    if (filledCount === 4) return FLIGHT_STATUSES.COMPLETED;
    if (filledCount > 0) return FLIGHT_STATUSES.ACTIVE;
    return FLIGHT_STATUSES.PLANNED;
  }
  // Editing: an emptied actuals section means "plan-fields only" on completed
  // movements, so EFB-final times are never wiped by accident.
  if (filledCount === 0 && before?.status === FLIGHT_STATUSES.COMPLETED) return FLIGHT_STATUSES.COMPLETED;
  if (filledCount === 4) return FLIGHT_STATUSES.COMPLETED;
  if (filledCount > 0) return FLIGHT_STATUSES.ACTIVE;
  if (before?.status === FLIGHT_STATUSES.ACTIVE) return FLIGHT_STATUSES.PLANNED;
  return before?.status || FLIGHT_STATUSES.PLANNED;
}

async function handleSaveFlight(event) {
  event.preventDefault();
  if (!activeOperatorUid) return;

  const { value, error } = collectFlightFormInput();
  const status = getModuleAction('dispatch-status');
  if (error) {
    if (status) status.textContent = error;
    return;
  }

  try {
    if (editingFlightId) {
      const before = latestFlights.find((item) => item.flightId === editingFlightId);
      if (!before) {
        if (status) status.textContent = 'Flight no longer exists.';
        return;
      }
      if (before.status === FLIGHT_STATUSES.CANCELLED) {
        if (status) status.textContent = 'Cancelled movements must be reactivated before editing.';
        return;
      }
      if (before.status === FLIGHT_STATUSES.COMPLETED) {
        if (!window.confirm('This movement is completed (actuals/EFB final). Save corrections anyway? The change is audited.')) return;
      }

      const nextStatus = deriveMovementStatus(value, before);
      const planOnlyTouch = value.actuals.filledCount === 0 && before.status === FLIGHT_STATUSES.COMPLETED;
      const writesFops = value.actuals.filledCount > 0;
      const jointSource = flightHasEfbData(before) || before.source === FLIGHT_SOURCES.EFB || before.source === FLIGHT_SOURCES.DISPATCH_EFB;
      const updates = {
        flightNumber: value.flightNumber,
        aircraftReg: value.aircraftReg,
        departure: value.departure,
        destination: value.destination,
        route: value.route,
        flightDate: value.flightDate,
        p1: value.p1,
        p2: value.p2,
        plannedDeparture: value.plannedDeparture,
        plannedArrival: value.plannedArrival,
        distanceNM: value.distanceNM,
        operationType: value.operationType,
        remarks: value.remarks,
        status: nextStatus
      };
      if (writesFops) {
        updates.fops = {
          chocksOff: value.actuals.chocksOff,
          takeoff: value.actuals.takeoff,
          landing: value.actuals.landing,
          chocksOn: value.actuals.chocksOn
        };
        updates.chocksOff = value.actuals.chocksOff;
        updates.takeoff = value.actuals.takeoff;
        updates.landing = value.actuals.landing;
        updates.chocksOn = value.actuals.chocksOn;
        updates.irTimeMinutes = value.irTimeMinutes;
        updates.xcTimeMinutes = value.xcTimeMinutes;
        updates.source = jointSource ? FLIGHT_SOURCES.DISPATCH_EFB : FLIGHT_SOURCES.DISPATCH;
      } else if (!planOnlyTouch) {
        updates.source = before.source || FLIGHT_SOURCES.DISPATCH;
      }
      await updateFlight(activeOperatorUid, editingFlightId, updates, activeActor, 'Flight movement updated from dispatch module');
      auditCache.delete(editingFlightId);
      cancelEditMode(true);
      if (status) status.textContent = 'Movement updated. Board, FDTL and audit refresh automatically.';
    } else {
      const nextStatus = deriveMovementStatus(value, null);
      const payload = {
        flightNumber: value.flightNumber,
        aircraftReg: value.aircraftReg,
        departure: value.departure,
        destination: value.destination,
        route: value.route,
        flightDate: value.flightDate,
        p1: value.p1,
        p2: value.p2,
        plannedDeparture: value.plannedDeparture,
        plannedArrival: value.plannedArrival,
        distanceNM: value.distanceNM,
        operationType: value.operationType,
        remarks: value.remarks,
        status: nextStatus,
        source: FLIGHT_SOURCES.DISPATCH
      };
      if (value.actuals.filledCount > 0) {
        payload.fops = {
          chocksOff: value.actuals.chocksOff,
          takeoff: value.actuals.takeoff,
          landing: value.actuals.landing,
          chocksOn: value.actuals.chocksOn
        };
        payload.chocksOff = value.actuals.chocksOff;
        payload.takeoff = value.actuals.takeoff;
        payload.landing = value.actuals.landing;
        payload.chocksOn = value.actuals.chocksOn;
        payload.irTimeMinutes = value.irTimeMinutes;
        payload.xcTimeMinutes = value.xcTimeMinutes;
      }
      await addFlight(activeOperatorUid, payload, activeActor, 'Flight movement created from dispatch module');
      event.target.reset();
      const dateInput = activeView.querySelector('#dispatch-flight-date');
      if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
      updateBlockHint();
      updateFdtlPreview();
      if (status) {
        status.textContent =
          nextStatus === FLIGHT_STATUSES.COMPLETED
            ? 'Movement created as completed with actuals. Visible to FDTL now.'
            : nextStatus === FLIGHT_STATUSES.ACTIVE
              ? 'Movement created as active (partial actuals). Complete it once chocks-on is known.'
              : 'Movement planned. It is now visible to the EFB and FDTL modules.';
      }
    }
  } catch (err) {
    console.error('Save flight failed:', err);
    if (status) status.textContent = editingFlightId ? 'Failed to update the movement.' : 'Failed to create the movement.';
  }
}

async function handleCancelFlight(flightId) {
  const flight = latestFlights.find((item) => item.flightId === flightId);
  if (!flight || !activeOperatorUid) return;
  if (flight.status === FLIGHT_STATUSES.COMPLETED || flight.status === FLIGHT_STATUSES.CANCELLED) return;
  if (!window.confirm(`Cancel movement ${flight.flightNumber || flightId}? It stays in the audit trail but leaves the active board.`)) return;

  try {
    await updateFlight(activeOperatorUid, flightId, { status: FLIGHT_STATUSES.CANCELLED }, activeActor, 'Flight movement cancelled from dispatch module');
    auditCache.delete(flightId);
    if (editingFlightId === flightId) cancelEditMode(true);
    const status = getModuleAction('dispatch-status');
    if (status) status.textContent = 'Movement cancelled (kept for audit).';
  } catch (error) {
    console.error('Cancel flight failed:', error);
    const status = getModuleAction('dispatch-status');
    if (status) status.textContent = 'Failed to cancel the movement.';
  }
}

async function handleReactivateFlight(flightId) {
  const flight = latestFlights.find((item) => item.flightId === flightId);
  if (!flight || !activeOperatorUid) return;
  if (flight.status !== FLIGHT_STATUSES.CANCELLED) return;

  try {
    await updateFlight(activeOperatorUid, flightId, { status: FLIGHT_STATUSES.PLANNED }, activeActor, 'Cancelled movement reactivated from dispatch module');
    auditCache.delete(flightId);
    const status = getModuleAction('dispatch-status');
    if (status) status.textContent = 'Movement reactivated as planned.';
  } catch (error) {
    console.error('Reactivate flight failed:', error);
    const status = getModuleAction('dispatch-status');
    if (status) status.textContent = 'Failed to reactivate the movement.';
  }
}

function handleBoardClick(event) {
  const detailsButton = event.target.closest('[data-details-flight]');
  if (detailsButton) {
    const flightId = detailsButton.dataset.detailsFlight;
    if (expandedFlightIds.has(flightId)) {
      expandedFlightIds.delete(flightId);
      renderFlightBoard();
    } else {
      expandedFlightIds.add(flightId);
      renderFlightBoard();
      loadFlightAudit(flightId);
    }
    return;
  }
  const editButton = event.target.closest('[data-edit-flight]');
  if (editButton) {
    startEditFlight(editButton.dataset.editFlight);
    return;
  }
  const cancelButton = event.target.closest('[data-cancel-flight]');
  if (cancelButton) {
    handleCancelFlight(cancelButton.dataset.cancelFlight);
    return;
  }
  const reactivateButton = event.target.closest('[data-reactivate-flight]');
  if (reactivateButton) {
    handleReactivateFlight(reactivateButton.dataset.reactivateFlight);
  }
}

export async function init(view, context) {
  activeView = view;

  mountModuleActions('<span id="dispatch-status" class="vs-page-chip">Loading dispatch readiness...</span>');

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Dispatch Control';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'dispatch';
    card.setAttribute('data-index', index + 1);
  });

  const currentUser = context?.currentUser || null;
  const operatorUid = currentUser?.uid || null;
  const orgContext = getCurrentOrganizationContext(currentUser);
  activeOperatorUid = orgContext.organizationId || operatorUid;
  activeActor = currentUser
    ? { name: currentUser.name || currentUser.email, email: currentUser.email, uid: currentUser.uid }
    : null;
  editingFlightId = null;
  crewFilter = '__all__';
  statusFilter = '__all__';
  searchQuery = '';
  fleetError = null;
  expandedFlightIds.clear();
  auditCache.clear();
  latestScheme = getDefaultScheme();

  if (!activeOperatorUid) {
    const statusLabel = getModuleAction('dispatch-status');
    if (statusLabel) {
      statusLabel.textContent = 'No authorized operator found.';
    }
    return {
      destroy() {}
    };
  }

  setFlightFormMode();
  view.querySelector('#dispatch-flight-form')?.addEventListener('submit', handleSaveFlight);
  view.querySelector('#dispatch-flight-form')?.addEventListener('input', () => {
    updateBlockHint();
    updateFdtlPreview();
  });
  view.querySelector('#dispatch-flight-cancel-edit')?.addEventListener('click', () => {
    cancelEditMode(true);
    const status = getModuleAction('dispatch-status');
    if (status) status.textContent = 'Editing discarded.';
  });
  view.querySelector('#dispatch-flights-body')?.addEventListener('click', handleBoardClick);
  view.querySelector('#dispatch-fleet-retry')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button) button.disabled = true;
    try {
      await loadFleet();
    } finally {
      if (button) button.disabled = false;
    }
  });
  view.querySelector('#dispatch-crew-filter')?.addEventListener('change', (event) => {
    crewFilter = event.target.value;
    renderFlightBoard();
  });
  view.querySelector('#dispatch-status-filter')?.addEventListener('change', (event) => {
    statusFilter = event.target.value;
    renderFlightBoard();
  });
  view.querySelector('#dispatch-flight-search')?.addEventListener('input', (event) => {
    searchQuery = event.target.value || '';
    renderFlightBoard();
  });

  // Attach live listeners first: the board must stay live even if one of the
  // one-off loads below fails (previously a single throw left dispatch frozen).
  aircraftUnsubscribe = onCompanyAircraftSnapshot(
    activeOperatorUid,
    (fleet) => {
      latestAircraft = fleet;
      fleetError = null;
      populateFlightForm();
      renderDispatch();
    },
    (error) => {
      console.error('Dispatch aircraft snapshot error:', error);
      fleetError = `Fleet live update failed (${error?.code || error?.message || 'unknown error'}).`;
      populateFlightForm();
    }
  );

  crewUnsubscribe = onCrewSnapshot(
    activeOperatorUid,
    async (snapshot) => {
      latestCrew = snapshot.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
      try {
        latestDocsByPilot = await syncCrewDocumentCache(latestDocsByPilot, latestCrew);
      } catch (docsError) {
        console.warn('Dispatch crew-doc sync failed:', docsError);
      }
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
      updateFdtlPreview();
    },
    (error) => console.error('Dispatch flights snapshot error:', error)
  );

  await loadFleet();

  try {
    const [crewList, flights] = await Promise.all([
      getCrew(activeOperatorUid),
      listFlights(activeOperatorUid)
    ]);
    latestCrew = crewList;
    latestFlights = flights;
    try {
      latestDocsByPilot = await getCrewDocumentsByPilots(crewList);
    } catch (docsError) {
      console.warn('Dispatch crew-doc load failed:', docsError);
    }
    try {
      latestScheme = await getFdtlScheme(activeOperatorUid);
    } catch (schemeError) {
      console.warn('Dispatch scheme load failed, using default:', schemeError);
      latestScheme = getDefaultScheme();
    }
    populateFlightForm();
    await renderDispatch();
  } catch (error) {
    console.error('Dispatch initial load failed:', error);
    const statusLabel = getModuleAction('dispatch-status');
    if (statusLabel) {
      statusLabel.textContent = `Unable to load dispatch data right now (${error?.code || 'unknown error'}). Live updates still active — refresh to retry.`;
    }
  }

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
      latestDocsByPilot = new Map();
      latestScheme = null;
      activeView = null;
      activeOperatorUid = null;
      fleetError = null;
      activeActor = null;
      editingFlightId = null;
      expandedFlightIds.clear();
      auditCache.clear();
    }
  };
}
