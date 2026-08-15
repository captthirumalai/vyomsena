import { getCrew, onCrewSnapshot } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mountModuleActions, getModuleAction } from '../../shared/moduleHeader.js';
import {
  getDefaultScheme,
  getFdtlScheme,
  saveFdtlScheme,
  onFdtlSchemeSnapshot,
  DUTY_STATES,
  DUTY_STATE_LABELS,
  OPERATION_TYPE_LABELS,
  VERDICTS,
  VERDICT_LABELS,
  formatDurationMinutes,
  resolveFdpBaseLimit,
  summarizeCrewFdtl,
  computeRestStatus,
  computeCumulativeStatus,
  submitFatigueReport,
  setDutyState,
  listDutyStates,
  onDutyStatesSnapshot,
  listDutyRecords,
  onDutyRecordsSnapshot,
  addDutyRecord,
  deleteDutyRecord,
  listFatigueReports,
  onFatigueSnapshot,
  listAuditEntries,
  onAuditSnapshot
} from '../../services/fdtl/index.js';
import {
  listFlights,
  onFlightsSnapshot,
  addFlight,
  updateFlight,
  deleteFlight,
  recordEfbActuals,
  resolveActualTimes,
  computeBlockTimeMinutes,
  reconcileFlight,
  flightsToDutyRecords,
  FLIGHT_STATUSES,
  FLIGHT_SOURCES
} from '../../services/flightService.js';

let activeView = null;
let activeCompanyId = null;
let activeActor = null;
let activeScheme = getDefaultScheme();
let latestCrew = [];
let latestStates = [];
let latestRecords = [];
let latestFatigue = [];
let latestAudit = [];
let latestFlights = [];
let selectedFlightId = null;
let overviewCrewFilter = '__all__';
let messageTimer = null;

let schemeUnsubscribe = null;
let crewUnsubscribe = null;
let statesUnsubscribe = null;
let recordsUnsubscribe = null;
let fatigueUnsubscribe = null;
let auditUnsubscribe = null;
let flightsUnsubscribe = null;

const SOURCE_LABELS = {
  [FLIGHT_SOURCES.DISPATCH]: 'Flight Ops',
  [FLIGHT_SOURCES.EFB]: 'EFB',
  [FLIGHT_SOURCES.DISPATCH_EFB]: 'Flight Ops + EFB',
  [FLIGHT_SOURCES.MANUAL]: 'Manual / Historical'
};

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

function formatDateTime(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatTimeOfDay(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDayShort(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleString('default', { month: 'short' })}`;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDatetimeLocalValue(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getCrewId(member) {
  return member.uid || member.crewProfileId || null;
}

function getCrewName(member) {
  return member.name || member.fullName || member.email || member.uid || 'Unnamed Crew';
}

function showMessage(message) {
  const status = getModuleAction('fdtl-status');
  if (!status) return;
  status.textContent = message;
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    status.textContent = '';
  }, 5000);
}

function switchTab(tabName) {
  if (!activeView) return;
  activeView.querySelectorAll('.fdtl-pane').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.fdtlPane !== tabName);
  });
  activeView.querySelectorAll('[data-fdtl-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.fdtlTab === tabName);
  });
  if (tabName === 'dashboard') {
    renderFlightsDashboard();
  }
}

function renderSchemeLine() {
  const element = getModuleAction('fdtl-scheme-line');
  if (!element) return;
  const approval = activeScheme.approval?.status || 'draft';
  const opsManualRef = activeScheme.approval?.opsManualRef ? ` · OM ${activeScheme.approval.opsManualRef}` : '';
  const operationalAdjustments = activeScheme.operationalAdjustments || {};
  const reporting = Number(operationalAdjustments.reportingTimeMinutes ?? 0);
  const postFlight = Number(operationalAdjustments.postFlightAllowanceMinutes ?? 0);
  const localNightStart = Number(operationalAdjustments.localNightStartHour ?? 22);
  const localNightEnd = Number(operationalAdjustments.localNightEndHour ?? 6);
  const transportation = Number(operationalAdjustments.transportationMinutes ?? 0);
  element.textContent = `Scheme: ${activeScheme.schemeName} · ${activeScheme.schemeVersion} · ${approval.toUpperCase()}${opsManualRef} · Reporting ${reporting}m · Post-flight ${postFlight}m · Local night ${localNightStart}:00-${localNightEnd}:00 · Transport ${transportation}m`;
}

function fmtMinutes(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return mins ? `${hours}:${String(mins).padStart(2, '0')}` : `${hours}:00`;
}

function setText(id, value) {
  const element = activeView?.querySelector(`#${id}`);
  if (element) element.textContent = value;
}

function getSourceLabel(flight) {
  return SOURCE_LABELS[flight.source] || flight.source || 'Unknown';
}

function getCrewLabelForFlight(flight) {
  if (flight.p1?.name) return flight.p1.name;
  return flight.p1?.crewProfileId || '—';
}

function buildFlightCompliance(flight, scheme, crewFlights) {
  const { takeoff, landing, chocksOff, chocksOn } = resolveActualTimes(flight);
  const blockTime = computeBlockTimeMinutes(flight) ?? 0;
  const postFlight = Number(scheme.operationalAdjustments?.postFlightAllowanceMinutes ?? 0);
  const minRest = Number(scheme.rest?.minimumMinutes ?? 720);
  const warningThresholdPct = Number(scheme.fdp?.warningThresholdPct ?? 0.8);

  const index = crewFlights.indexOf(flight);
  const previous = index > 0 ? crewFlights[index - 1] : null;
  const flightDateMs = toDate(flight.flightDate)?.getTime() || Date.now();

  const rules = {};

  const fdpAllowed = resolveFdpBaseLimit(scheme, { flightTimeMinutes: blockTime, landings: 1 });
  const fdpUsed = blockTime + postFlight;
  const fdp = {
    used: fdpUsed,
    allowed: fdpAllowed,
    status: fdpAllowed == null
      ? VERDICTS.EXCEEDED
      : fdpUsed > fdpAllowed
        ? VERDICTS.EXCEEDED
        : fdpUsed >= Math.round(fdpAllowed * warningThresholdPct)
          ? VERDICTS.ATTENTION
          : VERDICTS.WITHIN
  };
  rules.fdp = fdp;

  const cumulativeTotals = { 7: 0, 28: 0 };
  const sevenMs = 7 * 24 * 60 * 60 * 1000;
  const twentyEightMs = 28 * 24 * 60 * 60 * 1000;
  crewFlights.slice(0, index + 1).forEach((candidate) => {
    const candidateMs = toDate(candidate.flightDate)?.getTime() || 0;
    const candidateBlock = computeBlockTimeMinutes(candidate) ?? 0;
    if (flightDateMs - candidateMs <= sevenMs) cumulativeTotals[7] += candidateBlock;
    if (flightDateMs - candidateMs <= twentyEightMs) cumulativeTotals[28] += candidateBlock;
  });

  const cumulative = {
    7: {
      used: cumulativeTotals[7],
      allowed: Number(scheme.cumulative?.[7]?.flightTimeMinutes ?? 0),
      status: cumulativeTotals[7] > Number(scheme.cumulative?.[7]?.flightTimeMinutes ?? 0)
        ? VERDICTS.EXCEEDED
        : cumulativeTotals[7] >= Math.round(Number(scheme.cumulative?.[7]?.flightTimeMinutes ?? 0) * 0.8)
          ? VERDICTS.ATTENTION
          : VERDICTS.WITHIN
    },
    28: {
      used: cumulativeTotals[28],
      allowed: Number(scheme.cumulative?.[28]?.flightTimeMinutes ?? 0),
      status: cumulativeTotals[28] > Number(scheme.cumulative?.[28]?.flightTimeMinutes ?? 0)
        ? VERDICTS.EXCEEDED
        : cumulativeTotals[28] >= Math.round(Number(scheme.cumulative?.[28]?.flightTimeMinutes ?? 0) * 0.8)
          ? VERDICTS.ATTENTION
          : VERDICTS.WITHIN
    }
  };
  rules.cumulative = cumulative;

  let rest = { used: null, allowed: minRest, status: VERDICTS.WITHIN };
  if (previous) {
    const prevBlock = computeBlockTimeMinutes(previous) ?? 0;
    const prevEnd = toDate(previous.chocksOn || previous.landing);
    const thisStart = toDate(flight.chocksOff || flight.takeoff);
    if (prevEnd && thisStart) {
      const available = Math.max(0, Math.round((thisStart.getTime() - prevEnd.getTime()) / 60000));
      const required = Math.max(minRest, prevBlock);
      rest = {
        used: available,
        allowed: required,
        status: available < required ? VERDICTS.EXCEEDED : available < Math.round(required * 1.15) ? VERDICTS.ATTENTION : VERDICTS.WITHIN
      };
    }
  }
  rules.rest = rest;

  const statuses = [fdp.status, cumulative[7].status, cumulative[28].status, rest.status];
  const verdict = statuses.includes(VERDICTS.EXCEEDED)
    ? VERDICTS.EXCEEDED
    : statuses.includes(VERDICTS.ATTENTION)
      ? VERDICTS.ATTENTION
      : VERDICTS.WITHIN;

  return {
    blockTime,
    fdp,
    rest,
    cumulative,
    verdict,
    takeoff,
    landing,
    chocksOff,
    chocksOn
  };
}

function computeCrewFlightComplianceMap() {
  const map = new Map();
  latestCrew.forEach((member) => {
    const crewId = getCrewId(member);
    const crewFlights = latestFlights
      .filter((flight) => flight.status === FLIGHT_STATUSES.COMPLETED && flight.p1?.crewProfileId === crewId)
      .sort((left, right) => (toDate(left.flightDate)?.getTime() || 0) - (toDate(right.flightDate)?.getTime() || 0));
    map.set(crewId, crewFlights.map((flight) => ({ flight, compliance: buildFlightCompliance(flight, activeScheme, crewFlights) })));
  });
  return map;
}

function getFlightCompliance(flight, crewFlights) {
  return buildFlightCompliance(flight, activeScheme, crewFlights);
}

function renderFlightsDashboard() {
  if (!activeView) return;

  const crewId = overviewCrewFilter === '__all__' ? null : overviewCrewFilter;
  const scopeFlights = latestFlights.filter((flight) => {
    if (crewId && flight.p1?.crewProfileId !== crewId && flight.p2?.crewProfileId !== crewId) return false;
    return true;
  });

  const completed = scopeFlights.filter((flight) => flight.status === FLIGHT_STATUSES.COMPLETED);
  const dutyRecords = flightsToDutyRecords(activeScheme, latestFlights);
  const crewScopedRecords = crewId
    ? dutyRecords.filter((record) => record.crewProfileId === crewId)
    : dutyRecords;

  const now = new Date();
  const restSummary = computeRestStatus(activeScheme, { records: crewScopedRecords, now });
  const cumulativeSummary = computeCumulativeStatus(activeScheme, { records: crewScopedRecords, now });
  const sevenPeriod = cumulativeSummary.periods.find((period) => period.days === 7);
  const twentyEightPeriod = cumulativeSummary.periods.find((period) => period.days === 28);

  const todayKey = now.toISOString().slice(0, 10);
  const todayFlights = completed.filter((flight) => (flight.flightDate || '').slice(0, 10) === todayKey);
  const flightTimeToday = todayFlights.reduce((sum, flight) => sum + (computeBlockTimeMinutes(flight) ?? 0), 0);
  const dutyTimeToday = todayFlights.reduce((sum, flight) => {
    const compliance = getFlightCompliance(flight, completed);
    return sum + (compliance.fdp.used || 0);
  }, 0);

  const kpiStatus = crewScopedRecords.some((record) => !restSummary.ok)
    ? 'Exceeded'
    : cumulativeSummary.periods.some((period) => period.flightExceeded || period.dutyExceeded)
      ? 'Exceeded'
      : restSummary.ok && cumulativeSummary.ok
        ? 'OK'
        : 'Attention';

  setText('fdtl-kpi-flight-time', fmtMinutes(flightTimeToday));
  setText('fdtl-kpi-duty-time', fmtMinutes(dutyTimeToday));
  setText('fdtl-kpi-7day', sevenPeriod ? `${fmtMinutes(sevenPeriod.flightUsed)} / ${fmtMinutes(sevenPeriod.flightLimit)}` : '--:--');
  setText('fdtl-kpi-28day', twentyEightPeriod ? `${fmtMinutes(twentyEightPeriod.flightUsed)} / ${fmtMinutes(twentyEightPeriod.flightLimit)}` : '--:--');
  setText('fdtl-kpi-rest', restSummary.restUntil ? `Until ${formatTimeOfDay(restSummary.restUntil)}` : '—');
  setText('fdtl-kpi-status', kpiStatus);
  setText('fdtl-kpi-status-note', kpiStatus === 'OK' ? 'All FDTL requirements met' : kpiStatus === 'Attention' ? 'Review approaching limits' : 'Action required before release');

  const setProgress = (id, used, limit) => {
    const element = activeView.querySelector(`#${id}`);
    if (!element) return;
    const ratio = limit > 0 ? Math.min(100, Math.max(0, (Number(used) || 0) / limit * 100)) : 0;
    element.style.width = `${ratio}%`;
    element.className = ratio >= 100 ? 'fdtl-progress-critical' : ratio >= 80 ? 'fdtl-progress-watch' : '';
  };
  const todayFlightLimit = Number(activeScheme.fdp?.defaultMaxFlightTimeDayMinutes ?? 420);
  const todayDutyLimit = Number(activeScheme.cumulative?.[1]?.dutyMinutes ?? activeScheme.fdp?.defaultMaxFdpMinutes ?? 630);
  const sevenLimit = Number(sevenPeriod?.flightLimit ?? activeScheme.cumulative?.[7]?.flightTimeMinutes ?? 0);
  const twentyEightLimit = Number(twentyEightPeriod?.flightLimit ?? activeScheme.cumulative?.[28]?.flightTimeMinutes ?? 0);
  setText('fdtl-kpi-flight-limit', fmtMinutes(todayFlightLimit));
  setText('fdtl-kpi-duty-limit', fmtMinutes(todayDutyLimit));
  setProgress('fdtl-kpi-flight-progress', flightTimeToday, todayFlightLimit);
  setProgress('fdtl-kpi-duty-progress', dutyTimeToday, todayDutyLimit);
  setProgress('fdtl-kpi-7day-progress', sevenPeriod?.flightUsed, sevenLimit);
  setProgress('fdtl-kpi-28day-progress', twentyEightPeriod?.flightUsed, twentyEightLimit);
  setProgress('fdtl-kpi-rest-progress', restSummary.restUntil ? Math.max(0, (now.getTime() - restSummary.restUntil.getTime()) / 60000) : 0, Number(activeScheme.rest?.minimumMinutes ?? 720));
  const overall = activeView.querySelector('#fdtl-overall-status');
  if (overall) overall.className = `fdtl-overall-status fdtl-overall-status--${kpiStatus === 'OK' ? 'good' : kpiStatus === 'Attention' ? 'watch' : 'critical'}`;

  const kpiStatusEl = activeView.querySelector('#fdtl-kpi-status');
  if (kpiStatusEl) {
    kpiStatusEl.className = kpiStatus === 'OK'
      ? 'fdtl-kpi-ok'
      : kpiStatus === 'Attention'
        ? 'fdtl-kpi-watch'
        : 'fdtl-kpi-critical';
  }

  const statusEl = activeView.querySelector('#fdtl-sync-status');
  if (statusEl) {
    const completedCount = completed.length;
    const plannedCount = latestFlights.filter((flight) => flight.status === FLIGHT_STATUSES.PLANNED).length;
    const efbLinked = latestFlights.filter((flight) => flight.efb && (flight.efb.chocksOff || flight.efb.chocksOn)).length;
    statusEl.textContent = `${latestFlights.length} flight records · ${completedCount} completed · ${plannedCount} planned · ${efbLinked} with EFB actuals`;
  }

  renderFlightsTable();
  renderFlightDetails();
  renderDashboardSubpanes(cumulativeSummary, restSummary);
}

function renderDashboardSubpanes(cumulativeSummary, restSummary) {
  const summary = activeView?.querySelector('#fdtl-summary-content');
  if (summary) {
    summary.innerHTML = `<div class="fdtl-summary-periods">${cumulativeSummary.periods.map((period) => `<div class="fdtl-summary-period"><strong>${period.days}-Day</strong><span>${fmtMinutes(period.flightUsed)} / ${fmtMinutes(period.flightLimit)}</span><b class="fdtl-badge fdtl-badge--${period.ok ? 'good' : 'critical'}">${period.ok ? 'Within Limits' : 'Exceeded'}</b></div>`).join('')}</div><p class="muted">Rest: ${restSummary.ok ? 'Within minimum requirement' : 'Attention required'}</p>`;
  }
  const alerts = activeView?.querySelector('#fdtl-alerts-content');
  const mismatches = latestFlights.filter((flight) => (flight.reconciliation || reconcileFlight(flight)).status === 'mismatch');
  const attentionCount = latestFlights.filter((flight) => flight.status === FLIGHT_STATUSES.COMPLETED && getFlightCompliance(flight, latestFlights.filter((item) => item.p1?.crewProfileId === flight.p1?.crewProfileId))?.verdict !== VERDICTS.WITHIN).length;
  if (alerts) alerts.innerHTML = mismatches.length || attentionCount ? `<ul class="fdtl-alert-list">${mismatches.map((flight) => `<li class="fdtl-alert-item fdtl-alert-item--watch"><strong>Data mismatch</strong><span>${escapeHtml(flight.flightNumber || 'Flight')} has conflicting Flight Ops / EFB times.</span></li>`).join('')}${attentionCount ? `<li class="fdtl-alert-item fdtl-alert-item--watch"><strong>Compliance attention</strong><span>${attentionCount} completed flight record(s) require review.</span></li>` : ''}</ul>` : '<p class="muted">No alerts or inconsistencies.</p>';
  setText('fdtl-alert-count', mismatches.length + attentionCount);
  const fatigue = activeView?.querySelector('#fdtl-fatigue-list');
  if (fatigue) fatigue.innerHTML = latestFatigue.length ? latestFatigue.map((report) => `<div class="fdtl-alert-item"><strong>${escapeHtml(report.crewName || report.crewProfileId || 'Crew')}</strong><span>${escapeHtml(report.description || 'Fatigue report submitted')}</span></div>`).join('') : '<p class="muted">No fatigue reports.</p>';
}

function applyFlightFilters() {
  const search = activeView?.querySelector('#fdtl-flight-search')?.value?.trim().toLowerCase() || '';
  const statusFilter = activeView?.querySelector('#fdtl-flight-status-filter')?.value || '__all__';
  const sourceFilter = activeView?.querySelector('#fdtl-flight-source-filter')?.value || '__all__';

  const crewFlightsMap = new Map();
  latestCrew.forEach((member) => {
    const crewId = getCrewId(member);
    const sorted = latestFlights
      .filter((flight) => flight.status === FLIGHT_STATUSES.COMPLETED && flight.p1?.crewProfileId === crewId)
      .sort((left, right) => (toDate(left.flightDate)?.getTime() || 0) - (toDate(right.flightDate)?.getTime() || 0));
    crewFlightsMap.set(crewId, sorted);
  });

  const rows = latestFlights
    .filter((flight) => {
      if (overviewCrewFilter !== '__all__') {
        if (flight.p1?.crewProfileId !== overviewCrewFilter && flight.p2?.crewProfileId !== overviewCrewFilter) return false;
      }
      if (statusFilter !== '__all__' && flight.status !== statusFilter) return false;
      if (sourceFilter !== '__all__' && flight.source !== sourceFilter) return false;
      if (search) {
        const haystack = [
          flight.flightNumber,
          flight.route,
          flight.departure,
          flight.destination,
          flight.p1?.name,
          flight.p2?.name
        ].join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .map((flight) => {
      const crewFlights = crewFlightsMap.get(flight.p1?.crewProfileId) || [];
      const compliance = flight.status === FLIGHT_STATUSES.COMPLETED
        ? getFlightCompliance(flight, crewFlights)
        : null;
      return { flight, compliance };
    });

  const body = activeView?.querySelector('#fdtl-flights-body');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="12" class="fdtl-empty">No flight records match the current filters.</td></tr>';
    return;
  }

  const verdictBadge = (verdict) => {
    const map = {
      [VERDICTS.WITHIN]: 'good',
      [VERDICTS.ATTENTION]: 'watch',
      [VERDICTS.EXCEEDED]: 'critical'
    };
    const label = {
      [VERDICTS.WITHIN]: 'OK',
      [VERDICTS.ATTENTION]: 'Attention',
      [VERDICTS.EXCEEDED]: 'Exceeded'
    };
    return `<span class="fdtl-badge fdtl-badge--${map[verdict] || 'good'}">${label[verdict] || 'OK'}</span>`;
  };

  const sourceBadge = (flight) => {
    const recon = flight.reconciliation || reconcileFlight(flight);
    const manual = flight.source === FLIGHT_SOURCES.MANUAL;
    const cls = manual ? 'fdtl-badge--watch' : recon.status === 'mismatch' ? 'fdtl-badge--critical' : 'fdtl-badge--good';
    const mismatchNote = recon.status === 'mismatch' ? ' ⚠ mismatch' : '';
    return `<span class="fdtl-badge ${cls}" title="${escapeHtml(JSON.stringify(recon))}">${escapeHtml(getSourceLabel(flight))}${mismatchNote}</span>`;
  };

  const statusCell = (compliance) => {
    if (!compliance) return '—';
    const mark = (verdict) => verdict === VERDICTS.WITHIN ? '✓' : verdict === VERDICTS.ATTENTION ? '⚠' : '✗';
    return `
      <span class="fdtl-flight-status-cell">
        <span class="fdtl-status-mark fdtl-status-mark--${compliance.fdp.status}">${mark(compliance.fdp.status)}</span>
        <span class="fdtl-status-mark fdtl-status-mark--${compliance.rest.status}">${mark(compliance.rest.status)}</span>
        <span class="fdtl-status-mark fdtl-status-mark--${compliance.cumulative[7].status}">${mark(compliance.cumulative[7].status)}</span>
        <span class="fdtl-status-mark fdtl-status-mark--${compliance.cumulative[28].status}">${mark(compliance.cumulative[28].status)}</span>
      </span>`;
  };

  body.innerHTML = rows
    .map(({ flight, compliance }) => {
      const route = [flight.departure, flight.destination].filter(Boolean).join('–') || '—';
      const block = compliance ? fmtMinutes(compliance.blockTime) : (flight.flightTimeMinutes ? fmtMinutes(flight.flightTimeMinutes) : '—');
      const fdpCell = compliance
        ? compliance.fdp.allowed == null
          ? '<span class="muted">—</span>'
          : `${fmtMinutes(compliance.fdp.used)} / ${fmtMinutes(compliance.fdp.allowed)}`
        : '—';
      const restCell = compliance?.rest?.used != null
        ? `${fmtMinutes(compliance.rest.used)} / ${fmtMinutes(compliance.rest.allowed)}`
        : '✓';
      const cumCell = compliance
        ? `${compliance.cumulative[7].status === VERDICTS.WITHIN ? '✓' : '⚠'}/${compliance.cumulative[28].status === VERDICTS.WITHIN ? '✓' : '⚠'}`
        : '—';
      return `<tr class="fdtl-flight-row${selectedFlightId === flight.flightId ? ' selected' : ''}" data-flight="${escapeHtml(flight.flightId)}">
        <td>${rows.indexOf(rows.find((row) => row.flight.flightId === flight.flightId)) + 1}</td>
        <td>${escapeHtml(formatDayShort(flight.flightDate))}</td>
        <td><strong>${escapeHtml(flight.flightNumber || '—')}</strong></td>
        <td>${escapeHtml(route)}</td>
        <td>${escapeHtml(getCrewLabelForFlight(flight))}</td>
        <td>${sourceBadge(flight)}</td>
        <td>${escapeHtml(block)}</td>
        <td>${fdpCell}</td>
        <td>${restCell}</td>
        <td>${escapeHtml(cumCell)}</td>
        <td>${compliance ? verdictBadge(compliance.verdict) : escapeHtml((flight.status || 'planned').toUpperCase())}</td>
        <td><button type="button" class="fdtl-row-action" data-view-flight="${escapeHtml(flight.flightId)}" aria-label="View flight">◉</button><button type="button" class="fdtl-row-action" data-export-flight="${escapeHtml(flight.flightId)}" aria-label="Export flight">⇩</button></td>
      </tr>`;
    })
    .join('');
}

function renderFlightsTable() {
  applyFlightFilters();
}

function renderFlightDetails() {
  const container = activeView?.querySelector('#fdtl-flight-details');
  if (!container) return;

  container.classList.toggle('fdtl-details-open', Boolean(selectedFlightId));

  if (!selectedFlightId) {
    container.innerHTML = '<div class="fdtl-details-empty muted">Select a flight record to view source, FDTL calculation, and audit history.</div>';
    return;
  }

  const flight = latestFlights.find((item) => item.flightId === selectedFlightId);
  if (!flight) {
    container.innerHTML = '<div class="fdtl-details-empty muted">Selected flight no longer available.</div>';
    return;
  }

  const recon = flight.reconciliation || reconcileFlight(flight);
  const crewFlights = latestFlights
    .filter((item) => item.status === FLIGHT_STATUSES.COMPLETED && item.p1?.crewProfileId === flight.p1?.crewProfileId)
    .sort((left, right) => (toDate(left.flightDate)?.getTime() || 0) - (toDate(right.flightDate)?.getTime() || 0));
  const compliance = flight.status === FLIGHT_STATUSES.COMPLETED
    ? getFlightCompliance(flight, crewFlights)
    : null;

  const flightAudit = latestAudit.filter((entry) => entry.entityType === 'flight' && entry.entityId === flight.flightId);
  const auditHtml = flightAudit.length
    ? flightAudit.map((entry) => `
        <div class="fdtl-audit-entry">
          <div class="fdtl-audit-head">
            <strong>${escapeHtml(entry.actorName || 'Unknown')}</strong>
            <span>${escapeHtml(entry.field || '')} · ${formatDateTime(entry.timestamp)}</span>
          </div>
          ${entry.reason ? `<div class="fdtl-audit-reason">Reason: ${escapeHtml(entry.reason)}</div>` : ''}
        </div>`).join('')
    : '<p class="muted">No audit entries for this flight yet.</p>';

  const ruleBlock = (label, rule) => `
    <div class="fdtl-rule fdtl-rule--${rule.status === VERDICTS.WITHIN ? 'ok' : rule.status === VERDICTS.ATTENTION ? 'watch' : 'fail'}">
      <div class="fdtl-rule-head"><span class="fdtl-rule-label">${escapeHtml(label)}</span></div>
      <div class="fdtl-rule-meter">
        <span class="fdtl-meter-cell"><small>Allowed</small><b>${rule.allowed == null ? '—' : rule.allowed && rule.allowed > 200 ? fmtMinutes(rule.allowed) : rule.allowed}</b></span>
        <span class="fdtl-meter-cell"><small>Actual</small><b>${rule.used == null ? '—' : rule.used > 200 ? fmtMinutes(rule.used) : rule.used}</b></span>
        <span class="fdtl-meter-cell fdtl-meter-margin"><small>Status</small><b>${rule.status === VERDICTS.WITHIN ? 'OK' : rule.status === VERDICTS.ATTENTION ? 'Attention' : 'Exceeded'}</b></span>
      </div>
    </div>`;

  const calculationsHtml = compliance
    ? `<div class="fdtl-flight-rules">
        ${ruleBlock('FDP (flight time + post-flight allowance)', compliance.fdp)}
        ${ruleBlock('Rest before next duty', compliance.rest)}
        ${ruleBlock('7-Day flight time', { ...compliance.cumulative[7], allowed: compliance.cumulative[7].allowed, used: compliance.cumulative[7].used, status: compliance.cumulative[7].status })}
        ${ruleBlock('28-Day flight time', { ...compliance.cumulative[28], allowed: compliance.cumulative[28].allowed, used: compliance.cumulative[28].used, status: compliance.cumulative[28].status })}
      </div>`
    : '<p class="muted">Compliance is evaluated for completed flights only.</p>';

  const mismatchHtml = recon.status === 'mismatch' && recon.mismatches.length
    ? `<div class="fdtl-mismatch-box">
        <strong>⚠ Data Mismatch</strong>
        <p class="muted">Flight Operations and EFB disagree on the following times:</p>
        <div class="fdtl-mismatch-table">
          <table>
            <thead><tr><th>Field</th><th>Flight Operations</th><th>EFB</th></tr></thead>
            <tbody>
              ${recon.mismatches.map((mismatch) => `
                <tr>
                  <td>${escapeHtml(mismatch.field)}</td>
                  <td>${escapeHtml(formatTimeOfDay(mismatch.fops))}</td>
                  <td>${escapeHtml(formatTimeOfDay(mismatch.efb))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="fdtl-mismatch-actions">
          <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-resolve-flight="${escapeHtml(flight.flightId)}" data-source="efb">Accept EFB Data</button>
          <button type="button" class="vs-button vs-button--secondary vs-button--sm" data-resolve-flight="${escapeHtml(flight.flightId)}" data-source="fops">Accept Flight Ops Data</button>
        </div>
      </div>`
    : '';

  const sourceRow = (label, value) => value
    ? `<div class="fdtl-detail-row"><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    : '';

  const manualActions = flight.source === FLIGHT_SOURCES.MANUAL
    ? `<button type="button" class="vs-button vs-button--secondary vs-button--sm" data-delete-flight="${escapeHtml(flight.flightId)}">Delete Historical Flight</button>`
    : '';

  const detailFields = `
    <div class="fdtl-detail-grid">
      ${sourceRow('Flight Number', flight.flightNumber)}
      ${sourceRow('Route', [flight.departure, flight.destination].filter(Boolean).join('–'))}
      ${sourceRow('Aircraft', flight.aircraftReg)}
      ${sourceRow('Date', formatDayShort(flight.flightDate))}
      ${sourceRow('P1', flight.p1?.name)}
      ${sourceRow('P2', flight.p2?.name)}
      ${sourceRow('Operation', flight.operationType)}
      ${sourceRow('IR Time', flight.irTimeMinutes ? `${fmtMinutes(flight.irTimeMinutes)}` : null)}
      ${sourceRow('XC Time', flight.xcTimeMinutes ? `${fmtMinutes(flight.xcTimeMinutes)}` : null)}
      ${sourceRow('Distance', flight.distanceNM ? `${flight.distanceNM} NM` : null)}
      ${sourceRow('Remarks', flight.remarks)}
    </div>`;

  container.innerHTML = `
    <div class="fdtl-details-card">
      <div class="fdtl-details-head">
        <div>
          <h4>${escapeHtml(flight.flightNumber || 'Flight')}</h4>
          <p class="muted">${escapeHtml([flight.departure, flight.destination].filter(Boolean).join('–') || '')} · ${escapeHtml(getSourceLabel(flight))}</p>
        </div>
        <div class="fdtl-details-head-actions">
          ${manualActions}
          <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="fdtl-details-close">Close</button>
        </div>
      </div>
      <div class="fdtl-details-body">
        <div class="fdtl-details-col">
          <h5>Flight Data</h5>
          ${detailFields}
          <div class="fdtl-detail-row"><span class="muted">Times</span><strong>${escapeHtml(`CO ${formatTimeOfDay(flight.chocksOff)} → ON ${formatTimeOfDay(flight.chocksOn)} · TO ${formatTimeOfDay(flight.takeoff)} → LDG ${formatTimeOfDay(flight.landing)}`)}</strong></div>
          ${mismatchHtml}
        </div>
        <div class="fdtl-details-col">
          <h5>FDTL Calculation</h5>
          ${calculationsHtml}
        </div>
        <div class="fdtl-details-col fdtl-details-col--audit">
          <h5>Audit History</h5>
          <div class="fdtl-audit-list">${auditHtml}</div>
        </div>
      </div>
    </div>`;
}

function populateSelects() {
  if (!activeView) return;

  const crewOptions = latestCrew
    .map((member) => `<option value="${escapeHtml(getCrewId(member))}">${escapeHtml(getCrewName(member))}</option>`)
    .join('');
  const crewFallback = '<option value="">No crew</option>';

  ['#fdtl-record-crew', '#fdtl-fatigue-crew', '#fdtl-manual-p1', '#fdtl-manual-p2'].forEach((selector) => {
    const select = activeView.querySelector(selector);
    if (select) {
      const isP2 = selector === '#fdtl-manual-p2';
      select.innerHTML = (isP2 ? '<option value="">— None —</option>' : '') + (crewOptions || crewFallback);
    }
  });

  const opTypeSelects = activeView.querySelectorAll('#fdtl-record-op-type, #fdtl-manual-op-type');
  opTypeSelects.forEach((select) => {
    select.innerHTML = Object.entries(OPERATION_TYPE_LABELS)
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('');
  });

  const overviewSelect = activeView.querySelector('#fdtl-overview-crew');
  if (overviewSelect) {
    const selected = overviewCrewFilter;
    overviewSelect.innerHTML =
      '<option value="__all__">All Crew</option>' +
      latestCrew
        .map((member) => `<option value="${escapeHtml(getCrewId(member))}" ${selected === getCrewId(member) ? 'selected' : ''}>${escapeHtml(getCrewName(member))}</option>`)
        .join('');
  }
}

function renderAll() {
  renderSchemeLine();
  renderSchemeEditor();
  renderCrew();
  renderRecords();
  renderAudit();
  populateSelects();
  renderFlightsDashboard();
}

function renderSchemeEditor() {
  const view = activeView;
  if (!view) return;

  const approval = activeScheme.approval || {};
  const adjustments = activeScheme.operationalAdjustments || {};

  const setValue = (selector, value) => {
    const input = view.querySelector(selector);
    if (input) input.value = value ?? '';
  };

  setValue('#fdtl-scheme-name', activeScheme.schemeName || '');
  setValue('#fdtl-scheme-version', activeScheme.schemeVersion || '');
  setValue('#fdtl-scheme-approval-status', approval.status || 'draft');
  setValue('#fdtl-scheme-ops-manual-ref', approval.opsManualRef || '');
  setValue('#fdtl-scheme-reporting-time', Number(adjustments.reportingTimeMinutes ?? 0));
  setValue('#fdtl-scheme-post-flight-allowance', Number(adjustments.postFlightAllowanceMinutes ?? 0));
  setValue('#fdtl-scheme-local-night-start', Number(adjustments.localNightStartHour ?? 22));
  setValue('#fdtl-scheme-local-night-end', Number(adjustments.localNightEndHour ?? 6));
  setValue('#fdtl-scheme-transportation', Number(adjustments.transportationMinutes ?? 0));
  setValue('#fdtl-scheme-retention-months', Number(activeScheme.records?.retentionMonths ?? 18));

  const status = approval.status || 'draft';
  const badge = view.querySelector('#fdtl-scheme-status-badge');
  if (badge) {
    badge.textContent = status.toUpperCase();
    badge.className = `fdtl-scheme-status fdtl-scheme-status--${status}`;
  }

  const meta = view.querySelector('#fdtl-scheme-approval-meta');
  if (meta) {
    let when = null;
    try {
      if (approval.approvedDate) {
        const date = approval.approvedDate?.toDate ? approval.approvedDate.toDate() : new Date(approval.approvedDate);
        when = isNaN(date.getTime()) ? null : date.toLocaleDateString();
      }
    } catch (error) {
      when = null;
    }
    const source = activeScheme.source ? ` · ${activeScheme.source}` : '';
    meta.textContent = approval.approvedBy
      ? `Approved by ${approval.approvedBy}${when ? ' on ' + when : ''}${source}`
      : `Not yet approved${source}`;
  }

  renderSchemeBoard();
}

function renderSchemeBoard() {
  const view = activeView;
  if (!view) return;

  const set = (id, html) => {
    const element = view.querySelector(`#${id}`);
    if (element) element.innerHTML = html;
  };

  const fdp = activeScheme.fdp || {};
  const fdpRows = (fdp.twoPilot || [])
    .slice()
    .sort((a, b) => a.maxFlightTimeMinutes - b.maxFlightTimeMinutes || b.landings - a.landings)
    .map(
      (row) =>
        `<tr><td>${fmtMinutes(row.maxFlightTimeMinutes)}</td><td>${row.landings}</td><td><strong>${fmtMinutes(row.maxFdpMinutes)}</strong></td></tr>`
    )
    .join('');
  set(
    'fdtl-card-fdp',
    `
    <h4>FDP Limits · Two-Pilot</h4>
    <p class="fdtl-board-sub">Maximum flight time per duty day and the FDP allowed at each landing count.</p>
    <table class="fdtl-board-table">
      <thead><tr><th>Flight Time</th><th>Landings</th><th>Max FDP</th></tr></thead>
      <tbody>${fdpRows || '<tr><td colspan="3">No FDP rows configured.</td></tr>'}</tbody>
    </table>
    <p class="fdtl-rule-note">Default max flight time / day <strong>${fmtMinutes(fdp.defaultMaxFlightTimeDayMinutes)}</strong> · warning threshold ${Math.round((fdp.warningThresholdPct ?? 0.8) * 100)}%</p>
    `
  );

  const wocl = activeScheme.wocl || {};
  set(
    'fdtl-card-wocl',
    `
    <h4>Window of Circadian Low (WOCL)</h4>
    <p class="fdtl-board-sub">Acclimatised crew · local time.</p>
    <ul class="fdtl-rule-list">
      <li><span>Window</span><strong>${wocl.startHour}:00 – ${wocl.endHour}:00</strong></li>
      <li><span>FDP starts inside WOCL</span><strong>−${Math.round((wocl.startEncroachmentReductionPct ?? 1) * 100)}% (cap ${fmtMinutes(wocl.maxStartReductionMinutes)})</strong></li>
      <li><span>FDP ends in / covers WOCL</span><strong>−${Math.round((wocl.endOrEncompassReductionPct ?? 0.5) * 100)}%</strong></li>
    </ul>
    `
  );

  const rest = activeScheme.rest || {};
  const timeZone = activeScheme.timeZoneCrossing || {};
  const twoLanding = rest.twoLandingProvision || {};
  const twoLandingLine =
    twoLanding.enabled !== false
      ? `<li><span>Two-landing provision (split duty)</span><strong>+${fmtMinutes(twoLanding.increaseMinutes)}</strong></li>`
      : '';
  const restNotes = Array.isArray(rest.notes)
    ? rest.notes.map((note) => `<p class="fdtl-rule-note">${escapeHtml(note)}</p>`).join('')
    : '';
  set(
    'fdtl-card-rest',
    `
    <h4>Rest Rules</h4>
    <p class="fdtl-board-sub">Minimum rest before the next duty.</p>
    <ul class="fdtl-rule-list">
      <li><span>Standard minimum</span><strong>${fmtMinutes(rest.minimumMinutes)}</strong></li>
      <li><span>3 – 7 time zones</span><strong>${fmtMinutes(rest.timeZoneCrossing3To7Minutes ?? timeZone.zone3To7Minutes)}</strong></li>
      <li><span>Over 7 time zones</span><strong>${fmtMinutes(rest.timeZoneCrossingOver7Minutes ?? timeZone.over7Minutes)}</strong></li>
      ${twoLandingLine}
    </ul>
    <p class="fdtl-rule-note">${escapeHtml(rest.ruleLabel || '')}</p>
    ${restNotes}
    `
  );

  const weekly = rest.weekly || {};
  set(
    'fdtl-card-weekly',
    `
    <h4>Weekly Rest</h4>
    <p class="fdtl-board-sub">Rolling 168-hour window measured from the first report time.</p>
    <ul class="fdtl-rule-list">
      <li><span>Required rest</span><strong>${fmtMinutes(weekly.minimumMinutes)}</strong></li>
      <li><span>Must include local nights</span><strong>${weekly.localNights}</strong></li>
      <li><span>Never exceed span</span><strong>${weekly.maxSpanHours} h</strong></li>
      <li><span>Extended after</span><strong>${weekly.nightDutyTriggerCount} night/WOCL duties</strong></li>
      <li><span>Extended rest</span><strong>${fmtMinutes(weekly.extendedMinimumMinutes)}</strong></li>
    </ul>
    `
  );

  const night = activeScheme.nightDuty || {};
  set(
    'fdtl-card-night',
    `
    <h4>Night Duty</h4>
    <ul class="fdtl-rule-list">
      <li><span>Window</span><strong>${night.startHour}:00 – ${night.endHour}:00</strong></li>
      <li><span>Max consecutive nights</span><strong>${night.maxConsecutiveNights}</strong></li>
      <li><span>Exception once per</span><strong>${night.exceptionOncePerHours} h</strong></li>
    </ul>
    `
  );

  const split = activeScheme.splitDuty || {};
  set(
    'fdtl-card-split',
    `
    <h4>Split Duty</h4>
    <ul class="fdtl-rule-list">
      <li><span>Break under ${fmtMinutes(split.breakLessThanMinutes)}</span><strong>No extension</strong></li>
      <li><span>Break ${fmtMinutes(split.breakLessThanMinutes)} – ${fmtMinutes(split.breakGreaterThanMinutes)}</span><strong>Extend ${Math.round((split.extensionFactor ?? 0.5) * 100)}% of break</strong></li>
      <li><span>Break over ${fmtMinutes(split.breakGreaterThanMinutes)}</span><strong>No extension · new duty</strong></li>
      <li><span>FDP part before / after break</span><strong>Max ${fmtMinutes(split.preAndPostBreakMaxMinutes)} each</strong></li>
      <li><span>Break over ${fmtMinutes(split.accommodationBreakMinutes)} or WOCL</span><strong>Suitable accommodation</strong></li>
    </ul>
    <p class="fdtl-rule-note">${escapeHtml(split.ruleLabel || '')}</p>
    <p class="fdtl-rule-note">${escapeHtml(split.applicabilityNote || '')}</p>
    <p class="fdtl-rule-note">${escapeHtml(split.accommodationNote || '')}</p>
    `
  );

  const standby = activeScheme.standby || {};
  const standbyRows = standby.enabled === true
    ? `<li><span>Home standby counts</span><strong>${Math.round((standby.homeCountPct ?? 0) * 100)}%</strong></li>
       <li><span>Hotel standby counts</span><strong>${Math.round((standby.hotelCountPct ?? 0.5) * 100)}%</strong></li>
       <li><span>Airport standby counts</span><strong>${Math.round((standby.airportCountPct ?? 1) * 100)}%</strong></li>`
    : '<li><span>Status</span><strong>Disabled</strong></li>';
  set(
    'fdtl-card-standby',
    `
    <h4>Standby</h4>
    <p class="fdtl-board-sub">${escapeHtml(standby.appliesToLabel || '')}</p>
    <ul class="fdtl-rule-list">${standbyRows}</ul>
    `
  );

  const unforeseen = activeScheme.unforeseen || {};
  set(
    'fdtl-card-unforeseen',
    `
    <h4>Unforeseen Circumstances</h4>
    <ul class="fdtl-rule-list">
      <li><span>Max flight time extension</span><strong>+${fmtMinutes(unforeseen.maxFlightTimeExtensionMinutes)}</strong></li>
      <li><span>Max FDP extension</span><strong>+${fmtMinutes(unforeseen.maxFdpExtensionMinutes)}</strong></li>
      <li><span>PIC consent</span><strong>${unforeseen.requiresPICConsent ? 'Required' : 'No'}</strong></li>
      <li><span>Head of Ops approval</span><strong>${unforeseen.requiresHeadOfOpsApproval ? 'Required' : 'No'}</strong></li>
    </ul>
    `
  );

  const acclimatisation = activeScheme.acclimatisation || {};
  set(
    'fdtl-card-acclimatisation',
    `
    <h4>Acclimatisation</h4>
    <ul class="fdtl-rule-list">
      <li><span>Default state</span><strong>${acclimatisation.defaultIsAcclimatised ? 'Acclimatised' : 'Unacclimatised'}</strong></li>
      <li><span>Night window</span><strong>${acclimatisation.nightWindowStartHour}:00 – ${acclimatisation.nightWindowEndHour}:00</strong></li>
      <li><span>Unacclimatised reduction</span><strong>−${Math.round((acclimatisation.unacclimatisedReductionPct ?? 0.5) * 100)}%</strong></li>
    </ul>
    `
  );

  const cumulative = activeScheme.cumulative || {};
  const cumulativeRows = Object.keys(cumulative)
    .sort((a, b) => Number(a) - Number(b))
    .map((days) => {
      const row = cumulative[days];
      return `<tr><td>${days} days</td><td>${fmtMinutes(row.flightTimeMinutes)}</td><td>${fmtMinutes(row.dutyMinutes)}</td></tr>`;
    })
    .join('');
  set(
    'fdtl-card-cumulative',
    `
    <h4>Cumulative Limits</h4>
    <p class="fdtl-board-sub">Rolling flight-time and duty maxima.</p>
    <table class="fdtl-board-table">
      <thead><tr><th>Window</th><th>Flight Time</th><th>Duty Time</th></tr></thead>
      <tbody>${cumulativeRows || '<tr><td colspan="3">No cumulative limits configured.</td></tr>'}</tbody>
    </table>
    `
  );
}

function renderCrew() {
  const body = activeView?.querySelector('#fdtl-crew-body');
  if (!body) return;

  if (!latestCrew.length) {
    body.innerHTML = '<tr><td colspan="7" class="fdtl-empty">No crew profiles found for this operator.</td></tr>';
    return;
  }

  body.innerHTML = latestCrew
    .map((member) => {
      const crewId = getCrewId(member);
      const state = latestStates.find((item) => item.crewProfileId === crewId) || {};
      const stateValue = state.state || DUTY_STATES.AVAILABLE;
      const dutyStarted = toDate(state.dutyStartedAt);
      const lastEnded = toDate(state.lastDutyEndedAt);
      const minRest = activeScheme.rest?.minimumMinutes ?? 720;
      const restUntil = lastEnded ? new Date(lastEnded.getTime() + minRest * 60000) : null;
      const summary = summarizeCrewFdtl(activeScheme, {
        crewProfileId: crewId,
        state,
        records: latestRecords.filter((record) => record.crewProfileId === crewId)
      });

      const options = Object.entries(DUTY_STATE_LABELS)
        .map(
          ([value, label]) =>
            `<option value="${value}" ${value === stateValue ? 'selected' : ''}>${label}</option>`
        )
        .join('');

      return `<tr>
        <td>${escapeHtml(getCrewName(member))}</td>
        <td>${escapeHtml(member.designation || '—')}</td>
        <td>${escapeHtml(member.base || member.organizationBase || '—')}</td>
        <td><span class="fdtl-badge">${escapeHtml(DUTY_STATE_LABELS[stateValue] || 'Unknown')}</span>${summary.issues.length ? `<br><small>${escapeHtml(summary.alertText)}</small>` : ''}</td>
        <td>${dutyStarted ? formatDateTime(dutyStarted) : '—'}</td>
        <td>${restUntil ? formatDateTime(restUntil) : '—'}</td>
        <td>
          <div class="fdtl-crew-actions">
            <select class="fdtl-state-select">${options}</select>
            <input type="datetime-local" class="fdtl-state-duty-start" value="${toDatetimeLocalValue(dutyStarted)}" title="Duty start" />
            <input type="datetime-local" class="fdtl-state-duty-end" value="${toDatetimeLocalValue(lastEnded)}" title="Last duty end" />
            <button type="button" class="vs-button vs-button--secondary vs-button--sm fdtl-set-state" data-crew="${escapeHtml(crewId)}">Set</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

function renderRecords() {
  const body = activeView?.querySelector('#fdtl-records-body');
  if (!body) return;

  if (!latestRecords.length) {
    body.innerHTML = '<tr><td colspan="8" class="fdtl-empty">No duty records yet.</td></tr>';
    return;
  }

  body.innerHTML = latestRecords
    .map((record) => {
      const fdpStart = toDate(record.fdpStart);
      const fdpEnd = toDate(record.fdpEnd);
      const fdpMinutes = fdpStart && fdpEnd ? (fdpEnd.getTime() - fdpStart.getTime()) / 60000 : null;
      return `<tr>
        <td>${escapeHtml(record.dutyDate || '—')}</td>
        <td>${escapeHtml(record.crewName || record.crewProfileId || '—')}</td>
        <td>${escapeHtml(OPERATION_TYPE_LABELS[record.operationType] || record.operationType || '—')}</td>
        <td>${fdpMinutes != null ? formatDurationMinutes(fdpMinutes) : '—'}</td>
        <td>${formatDurationMinutes(record.flightTimeMinutes)}</td>
        <td>${Number(record.landings) || 0}</td>
        <td>${escapeHtml(record.sector || '—')}</td>
        <td>
          <button type="button" class="fdtl-delete-record" data-record="${escapeHtml(record.recordId)}">Delete</button>
        </td>
      </tr>`;
    })
    .join('');
}

function renderAudit() {
  const element = activeView?.querySelector('#fdtl-audit-list');
  if (!element) return;

  if (!latestAudit.length) {
    element.innerHTML = '<p class="muted">No audit entries yet.</p>';
    return;
  }

  const renderValue = (label, value) => {
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `<span><em>${label}</em> ${escapeHtml(text)}</span>`;
  };

  element.innerHTML = latestAudit
    .map((entry) => {
      const timestamp = entry.timestamp ? formatDateTime(entry.timestamp) : '—';
      return `<div class="fdtl-audit-entry">
        <div class="fdtl-audit-head">
          <strong>${escapeHtml(entry.actorName || 'Unknown')}</strong>
          <span>${escapeHtml(entry.entityType || '')} · ${escapeHtml(entry.field || '')} · ${timestamp}</span>
        </div>
        <div class="fdtl-audit-diff">
          ${renderValue('Before', entry.before)}
          ${renderValue('After', entry.after)}
        </div>
        ${entry.reason ? `<div class="fdtl-audit-reason">Reason: ${escapeHtml(entry.reason)}</div>` : ''}
      </div>`;
    })
    .join('');
}

async function handleSchemeSubmit(event) {
  event.preventDefault();
  if (!activeCompanyId) return;

  const form = activeView?.querySelector('#fdtl-scheme-form');
  if (!form) return;

  const action = event.submitter?.dataset?.action || 'save';
  const readValue = (selector, fallback = '') => {
    const element = form.querySelector(selector);
    const value = element ? element.value : fallback;
    return value === '' ? fallback : value;
  };

  const normalizedStatus = readValue('#fdtl-scheme-approval-status', 'draft');
  const nextApproval = {
    ...(activeScheme.approval || {}),
    status: action === 'approve' ? 'approved' : normalizedStatus,
    opsManualRef: readValue('#fdtl-scheme-ops-manual-ref', null),
    approvedBy: action === 'approve' ? activeActor?.name || activeActor?.email || 'Operator' : activeScheme.approval?.approvedBy || null,
    approvedDate: action === 'approve' ? new Date().toISOString() : activeScheme.approval?.approvedDate || null
  };

  const nextScheme = {
    ...activeScheme,
    schemeName: readValue('#fdtl-scheme-name', activeScheme.schemeName || 'Operator FDTL Scheme'),
    schemeVersion: readValue('#fdtl-scheme-version', activeScheme.schemeVersion || 'Rev 1'),
    approval: nextApproval,
    operationalAdjustments: {
      ...(activeScheme.operationalAdjustments || {}),
      reportingTimeMinutes: Number(readValue('#fdtl-scheme-reporting-time', 0)) || 0,
      postFlightAllowanceMinutes: Number(readValue('#fdtl-scheme-post-flight-allowance', 0)) || 0,
      localNightStartHour: Number(readValue('#fdtl-scheme-local-night-start', 22)) || 22,
      localNightEndHour: Number(readValue('#fdtl-scheme-local-night-end', 6)) || 6,
      transportationMinutes: Number(readValue('#fdtl-scheme-transportation', 0)) || 0
    },
    records: {
      ...(activeScheme.records || {}),
      retentionMonths: Number(readValue('#fdtl-scheme-retention-months', 18)) || 18
    }
  };

  try {
    await saveFdtlScheme(activeCompanyId, nextScheme, {
      mode: action === 'approve' ? 'approve' : 'draft',
      actor: activeActor,
      reason: action === 'approve' ? 'Scheme approved from FDTL module' : 'Scheme draft updated from FDTL module',
      trackHistory: true,
      forceOverride: false
    });
    const dirty = activeView?.querySelector('#fdtl-scheme-dirty');
    if (dirty) dirty.classList.add('hidden');
    showMessage(action === 'approve' ? 'FDTL scheme approved and saved.' : 'FDTL scheme settings saved.');
  } catch (error) {
    console.error('Save FDTL scheme failed:', error);
    showMessage('Unable to save the FDTL scheme settings.');
  }
}

async function handleFatigueSubmit(event) {
  event.preventDefault();
  if (!activeCompanyId) return;

  const form = activeView?.querySelector('#fdtl-fatigue-form');
  if (!form) return;

  const crewId = form.querySelector('#fdtl-fatigue-crew')?.value;
  const member = latestCrew.find((item) => getCrewId(item) === crewId);
  if (!crewId || !member) {
    showMessage('Select a crew member before submitting a fatigue report.');
    return;
  }

  const reportedOn = form.querySelector('#fdtl-fatigue-reported-on')?.value;
  const description = form.querySelector('#fdtl-fatigue-description')?.value?.trim();
  const actionTaken = form.querySelector('#fdtl-fatigue-action')?.value?.trim();

  if (!reportedOn || !description) {
    showMessage('Report time and description are required for the fatigue report.');
    return;
  }

  try {
    await submitFatigueReport(
      activeCompanyId,
      {
        crewProfileId: crewId,
        crewName: getCrewName(member),
        reportedOn: toIso(reportedOn),
        description,
        actionTaken: actionTaken || null
      },
      activeActor
    );
    form.reset();
    showMessage('Fatigue report submitted.');
  } catch (error) {
    console.error('Submit fatigue report failed:', error);
    showMessage('Failed to submit fatigue report.');
  }
}

async function handleSetState(event) {
  const button = event.target.closest('.fdtl-set-state');
  if (!button || !activeCompanyId) return;

  const crewId = button.dataset.crew;
  const row = button.closest('tr');
  const select = row?.querySelector('.fdtl-state-select');
  const dutyStartInput = row?.querySelector('.fdtl-state-duty-start');
  const dutyEndInput = row?.querySelector('.fdtl-state-duty-end');
  if (!select || !crewId) return;

  try {
    await setDutyState(
      activeCompanyId,
      crewId,
      {
        state: select.value,
        dutyStartedAt: toIso(dutyStartInput?.value),
        lastDutyEndedAt: toIso(dutyEndInput?.value)
      },
      activeActor,
      'Duty state updated from crew roster'
    );
    showMessage('Duty state updated.');
  } catch (error) {
    console.error('Set duty state failed:', error);
    showMessage('Failed to update duty state.');
  }
}

async function handleDeleteRecord(event) {
  const button = event.target.closest('.fdtl-delete-record');
  if (!button || !activeCompanyId) return;
  if (!window.confirm('Delete this duty record? The change is recorded in the audit trail.')) return;

  try {
    await deleteDutyRecord(activeCompanyId, button.dataset.record, activeActor, 'Duty record deleted from FDTL module');
    showMessage('Duty record deleted.');
  } catch (error) {
    console.error('Delete duty record failed:', error);
    showMessage('Failed to delete duty record.');
  }
}

async function handleRecordSubmit(event) {
  event.preventDefault();
  if (!activeCompanyId) return;

  const crewId = activeView.querySelector('#fdtl-record-crew')?.value;
  const member = latestCrew.find((item) => getCrewId(item) === crewId);
  if (!crewId || !member) {
    showMessage('Select a crew member first.');
    return;
  }

  const read = (selector) => activeView.querySelector(selector)?.value;

  try {
    await addDutyRecord(
      activeCompanyId,
      {
        crewProfileId: crewId,
        crewName: getCrewName(member),
        operationType: read('#fdtl-record-op-type') || 'commercial',
        operationCrew: 'two',
        dutyDate: read('#fdtl-record-date') || null,
        reportTime: toIso(read('#fdtl-record-report')),
        dutyStart: toIso(read('#fdtl-record-duty-start')),
        dutyEnd: toIso(read('#fdtl-record-duty-end')),
        fdpStart: toIso(read('#fdtl-record-fdp-start')),
        fdpEnd: toIso(read('#fdtl-record-fdp-end')),
        flightTimeMinutes: Number(read('#fdtl-record-flight-time')) || 0,
        landings: Number(read('#fdtl-record-landings')) || 0,
        sector: read('#fdtl-record-sector') || null,
        note: read('#fdtl-record-note') || null
      },
      activeActor,
      read('#fdtl-record-reason') || 'Duty record added from FDTL module'
    );
    event.target.reset();
    showMessage('Duty record added.');
  } catch (error) {
    console.error('Add duty record failed:', error);
    showMessage('Failed to add duty record.');
  }
}

function timeToMinutes(timeValue) {
  if (!timeValue) return null;
  const [hours, minutes] = String(timeValue).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

const MANUAL_TIME_FIELDS = [
  { key: 'chocksOff', label: 'Chocks Off', id: 'fdtl-manual-chocks-off' },
  { key: 'takeoff', label: 'Takeoff', id: 'fdtl-manual-takeoff' },
  { key: 'landing', label: 'Landing', id: 'fdtl-manual-landing' },
  { key: 'chocksOn', label: 'Chocks On', id: 'fdtl-manual-chocks-on' }
];

function validateManualTimes() {
  const form = activeView?.querySelector('#fdtl-manual-form');
  const warning = activeView?.querySelector('#fdtl-manual-time-warning');
  const values = {};

  MANUAL_TIME_FIELDS.forEach(({ key, id }) => {
    const field = form?.querySelector(`#${id}`);
    values[key] = timeToMinutes(field?.value);
    field?.classList.remove('fdtl-field-invalid');
  });
  if (warning) warning.classList.add('hidden');

  for (let index = 1; index < MANUAL_TIME_FIELDS.length; index += 1) {
    const prev = MANUAL_TIME_FIELDS[index - 1];
    const curr = MANUAL_TIME_FIELDS[index];
    if (values[curr.key] != null && values[prev.key] != null && values[curr.key] <= values[prev.key]) {
      const message = `${curr.label} cannot be at or before ${prev.label}.`;
      form?.querySelector(`#${curr.id}`)?.classList.add('fdtl-field-invalid');
      if (warning) {
        warning.textContent = message;
        warning.classList.remove('hidden');
      }
      return message;
    }
  }
  return null;
}

async function handleManualSubmit(event) {
  event.preventDefault();
  if (!activeCompanyId) return;

  const form = activeView.querySelector('#fdtl-manual-form');
  if (!form) return;

  const validationError = validateManualTimes();
  if (validationError) {
    showMessage(validationError);
    return;
  }

  const read = (selector) => form.querySelector(selector)?.value;

  const flightDate = read('#fdtl-manual-date');
  const p1Id = read('#fdtl-manual-p1');
  const p2Id = read('#fdtl-manual-p2');
  const member1 = latestCrew.find((item) => getCrewId(item) === p1Id);

  if (!flightDate || !p1Id || !member1) {
    showMessage('Date and P1 are required for a historical flight.');
    return;
  }

  const toFlightTime = (date, time) => {
    if (!time) return null;
    return `${date}T${time}:00`;
  };

  const fops = {};
  [['chocksOff', 'chocks-off'], ['takeoff', 'takeoff'], ['landing', 'landing'], ['chocksOn', 'chocks-on']].forEach(([key, suffix]) => {
    const timeValue = read(`#fdtl-manual-${suffix}`);
    if (timeValue) fops[key] = toFlightTime(flightDate, timeValue);
  });

  try {
    await addFlight(
      activeCompanyId,
      {
        flightNumber: read('#fdtl-manual-flight-number'),
        departure: read('#fdtl-manual-departure'),
        destination: read('#fdtl-manual-destination'),
        route: [read('#fdtl-manual-departure'), read('#fdtl-manual-destination')].filter(Boolean).join('-') || null,
        flightDate,
        status: FLIGHT_STATUSES.COMPLETED,
        source: FLIGHT_SOURCES.MANUAL,
        p1: { crewProfileId: p1Id, name: getCrewName(member1) },
        p2: p2Id ? { crewProfileId: p2Id, name: getCrewName(latestCrew.find((item) => getCrewId(item) === p2Id)) } : null,
        chocksOff: fops.chocksOff,
        chocksOn: fops.chocksOn,
        takeoff: fops.takeoff,
        landing: fops.landing,
        irTimeMinutes: timeToMinutes(read('#fdtl-manual-ir')) || 0,
        xcTimeMinutes: timeToMinutes(read('#fdtl-manual-xc')) || 0,
        distanceNM: Number(read('#fdtl-manual-distance')) || 0,
        operationType: read('#fdtl-manual-op-type') || 'commercial',
        remarks: read('#fdtl-manual-remarks') || null,
        fops
      },
      activeActor,
      'Historical flight added from FDTL module'
    );

    const keepOpen = form.querySelector('#fdtl-manual-keep-open')?.checked;
    if (!keepOpen) {
      form.reset();
      const entry = activeView.querySelector('#fdtl-manual-entry');
      if (entry) entry.removeAttribute('open');
    } else {
      form.querySelector('#fdtl-manual-date').value = flightDate;
      form.querySelector('#fdtl-manual-p1').value = p1Id;
      if (p2Id) form.querySelector('#fdtl-manual-p2').value = p2Id;
      form.querySelector('#fdtl-manual-flight-number').value = '';
      form.querySelector('#fdtl-manual-departure').value = '';
      form.querySelector('#fdtl-manual-destination').value = '';
      form.querySelector('#fdtl-manual-chocks-off').value = '';
      form.querySelector('#fdtl-manual-takeoff').value = '';
      form.querySelector('#fdtl-manual-landing').value = '';
      form.querySelector('#fdtl-manual-chocks-on').value = '';
      form.querySelector('#fdtl-manual-ir').value = '';
      form.querySelector('#fdtl-manual-xc').value = '';
    }
    validateManualTimes();
    showMessage('Historical flight added. It will appear with the Manual / Historical source badge.');
  } catch (error) {
    console.error('Add historical flight failed:', error);
    showMessage('Failed to add the historical flight.');
  }
}

async function handleResolveMismatch(event) {
  const button = event.target.closest('[data-resolve-flight]');
  if (!button || !activeCompanyId) return;
  const flightId = button.dataset.resolveFlight;
  const source = button.dataset.source;

  const flight = latestFlights.find((item) => item.flightId === flightId);
  if (!flight) return;

  const recon = flight.reconciliation || reconcileFlight(flight);
  const chosen = recon[source] || {};

  try {
    await updateFlight(
      activeCompanyId,
      flightId,
      {
        chocksOff: chosen.chocksOff || null,
        chocksOn: chosen.chocksOn || null,
        takeoff: chosen.takeoff || null,
        landing: chosen.landing || null,
        fops: recon.fops,
        efb: recon.efb
      },
      activeActor,
      `Data mismatch resolved in FDTL; accepted ${source === 'efb' ? 'EFB' : 'Flight Ops'} data`
    );
    showMessage(`Mismatch resolved — ${source === 'efb' ? 'EFB' : 'Flight Ops'} data accepted.`);
  } catch (error) {
    console.error('Resolve mismatch failed:', error);
    showMessage('Failed to resolve the mismatch.');
  }
}

async function handleDeleteFlight(event) {
  const button = event.target.closest('[data-delete-flight]');
  if (!button || !activeCompanyId) return;
  if (!window.confirm('Delete this historical flight record? The change is recorded in the audit trail.')) return;

  try {
    await deleteFlight(activeCompanyId, button.dataset.deleteFlight, activeActor, 'Historical flight deleted from FDTL module');
    selectedFlightId = null;
    showMessage('Historical flight deleted.');
  } catch (error) {
    console.error('Delete flight failed:', error);
    showMessage('Failed to delete the historical flight.');
  }
}

async function refreshFlights() {
  if (!activeCompanyId) return;
  const status = activeView?.querySelector('#fdtl-sync-status');
  if (status) status.textContent = 'Syncing with Flight Operations and EFB...';
  try {
    latestFlights = await listFlights(activeCompanyId);
    renderFlightsDashboard();
    if (status) status.textContent = `Last sync: ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error('FDTL flight refresh failed:', error);
    if (status) status.textContent = 'Sync error. Existing records are still shown.';
  }
}

function exportFlightDetails(flightId) {
  const flight = latestFlights.find((item) => item.flightId === flightId);
  if (!flight) return;
  const payload = JSON.stringify(flight, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${flight.flightNumber || 'flight'}-details.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function init(view, context) {
  activeView = view;

  mountModuleActions(`
    <span id="fdtl-scheme-line" class="vs-page-chip">Scheme: loading...</span>
    <span id="fdtl-status" class="vs-page-status" aria-live="polite"></span>
  `);

  const currentUser = context?.currentUser || null;
  activeActor = currentUser
    ? { name: currentUser.name || currentUser.email, email: currentUser.email, uid: currentUser.uid }
    : null;

  activeScheme = getDefaultScheme();
  latestCrew = [];
  latestStates = [];
  latestRecords = [];
  latestFatigue = [];
  latestAudit = [];
  latestFlights = [];
  selectedFlightId = null;
  overviewCrewFilter = '__all__';
  renderAll();

  const orgContext = getCurrentOrganizationContext(currentUser);
  const companyId = orgContext.organizationId || currentUser?.uid || null;
  activeCompanyId = companyId;

  if (!companyId) {
    showMessage('No authorized operator found.');
    return {
      destroy() {}
    };
  }

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'FDTL Monitoring';
  }

  view.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-fdtl-tab]');
    if (tabButton) {
      switchTab(tabButton.dataset.fdtlTab);
      return;
    }
    const subTab = event.target.closest('[data-fdtl-subtab]');
    if (subTab) {
      view.querySelectorAll('[data-fdtl-subtab]').forEach((item) => item.classList.toggle('active', item === subTab));
      view.querySelectorAll('[data-fdtl-subpane]').forEach((pane) => pane.classList.toggle('active', pane.dataset.fdtlSubpane === subTab.dataset.fdtlSubtab));
    }
  });
  view.querySelector('#fdtl-filter-toggle')?.addEventListener('click', () => view.querySelector('#fdtl-filters')?.classList.toggle('hidden'));
  view.querySelector('#fdtl-sync-now')?.addEventListener('click', refreshFlights);
  view.querySelector('#fdtl-crew-body')?.addEventListener('click', handleSetState);
  view.querySelector('#fdtl-records-body')?.addEventListener('click', handleDeleteRecord);
  view.querySelector('#fdtl-record-form')?.addEventListener('submit', handleRecordSubmit);
  view.querySelector('#fdtl-scheme-form')?.addEventListener('submit', handleSchemeSubmit);
  view.querySelector('#fdtl-scheme-form')?.addEventListener('input', () => {
    const dirty = view.querySelector('#fdtl-scheme-dirty');
    if (dirty) dirty.classList.remove('hidden');
  });
  view.querySelector('#fdtl-fatigue-form')?.addEventListener('submit', handleFatigueSubmit);

  view.querySelector('#fdtl-manual-form')?.addEventListener('submit', handleManualSubmit);
  ['chocks-off', 'takeoff', 'landing', 'chocks-on'].forEach((suffix) => {
    const input = view.querySelector(`#fdtl-manual-${suffix}`);
    if (input) {
      input.addEventListener('input', validateManualTimes);
      input.addEventListener('change', validateManualTimes);
    }
  });
  view.querySelector('#fdtl-manual-entry')?.addEventListener('toggle', () => {
    if (activeView?.querySelector('#fdtl-manual-entry')?.open) {
      populateSelects();
      validateManualTimes();
    }
  });
  view.querySelector('#fdtl-manual-cancel')?.addEventListener('click', () => {
    const form = activeView?.querySelector('#fdtl-manual-form');
    if (form) form.reset();
    validateManualTimes();
    const entry = activeView?.querySelector('#fdtl-manual-entry');
    if (entry) entry.removeAttribute('open');
  });
  view.querySelector('#fdtl-overview-crew')?.addEventListener('change', (event) => {
    overviewCrewFilter = event.target.value || '__all__';
    renderFlightsDashboard();
  });
  view.querySelector('#fdtl-flight-search')?.addEventListener('input', renderFlightsTable);
  view.querySelector('#fdtl-flight-status-filter')?.addEventListener('change', renderFlightsTable);
  view.querySelector('#fdtl-flight-source-filter')?.addEventListener('change', renderFlightsTable);
  view.querySelector('#fdtl-flights-body')?.addEventListener('click', (event) => {
    const exportButton = event.target.closest('[data-export-flight]');
    if (exportButton) {
      exportFlightDetails(exportButton.dataset.exportFlight);
      return;
    }
    const viewButton = event.target.closest('[data-view-flight]');
    if (viewButton) {
      selectedFlightId = viewButton.dataset.viewFlight;
      renderFlightsTable();
      renderFlightDetails();
      return;
    }
    const row = event.target.closest('.fdtl-flight-row');
    if (!row) return;
    selectedFlightId = row.dataset.flight;
    renderFlightsTable();
    renderFlightDetails();
  });
  view.querySelector('#fdtl-flight-details')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      selectedFlightId = null;
      renderFlightsTable();
      renderFlightDetails();
      return;
    }
    if (event.target.closest('[data-resolve-flight]')) {
      handleResolveMismatch(event);
      return;
    }
    if (event.target.closest('[data-delete-flight]')) {
      handleDeleteFlight(event);
      return;
    }
    if (event.target.closest('#fdtl-details-close')) {
      selectedFlightId = null;
      renderFlightsTable();
      renderFlightDetails();
    }
  });

  try {
    const crewList = await getCrew(companyId);
    latestCrew = Array.isArray(crewList) ? crewList : [];
  } catch (error) {
    console.error('FDTL crew load failed:', error);
    latestCrew = [];
  }
  populateSelects();

  try {
    const [scheme, states, records, fatigue, audit, flights] = await Promise.all([
      getFdtlScheme(companyId),
      listDutyStates(companyId),
      listDutyRecords(companyId),
      listFatigueReports(companyId),
      listAuditEntries(companyId),
      listFlights(companyId)
    ]);

    activeScheme = scheme && typeof scheme === 'object' ? { ...getDefaultScheme(), ...scheme } : getDefaultScheme();
    latestStates = Array.isArray(states) ? states : [];
    latestRecords = Array.isArray(records) ? records : [];
    latestFatigue = Array.isArray(fatigue) ? fatigue : [];
    latestAudit = Array.isArray(audit) ? audit : [];
    latestFlights = Array.isArray(flights) ? flights : [];
    renderAll();
  } catch (error) {
    console.error('FDTL initial load failed:', error);
    activeScheme = getDefaultScheme();
    latestCrew = [];
    latestStates = [];
    latestRecords = [];
    latestFatigue = [];
    latestAudit = [];
    latestFlights = [];
    renderAll();
    showMessage('Unable to load FDTL monitoring data right now.');
  }

  schemeUnsubscribe = onFdtlSchemeSnapshot(
    companyId,
    (scheme) => {
      activeScheme = scheme;
      renderAll();
    },
    (error) => console.error('FDTL scheme snapshot error:', error)
  );
  crewUnsubscribe = onCrewSnapshot(
    companyId,
    (crewList) => {
      latestCrew = crewList;
      renderAll();
    },
    (error) => console.error('FDTL crew snapshot error:', error)
  );
  statesUnsubscribe = onDutyStatesSnapshot(
    companyId,
    (states) => {
      latestStates = states;
      renderAll();
    },
    (error) => console.error('FDTL duty state snapshot error:', error)
  );
  recordsUnsubscribe = onDutyRecordsSnapshot(
    companyId,
    (records) => {
      latestRecords = records;
      renderAll();
    },
    (error) => console.error('FDTL duty records snapshot error:', error)
  );
  fatigueUnsubscribe = onFatigueSnapshot(
    companyId,
    (fatigue) => {
      latestFatigue = fatigue;
      renderAll();
    },
    (error) => console.error('FDTL fatigue snapshot error:', error)
  );
  auditUnsubscribe = onAuditSnapshot(
    companyId,
    (audit) => {
      latestAudit = audit;
      renderAll();
    },
    (error) => console.error('FDTL audit snapshot error:', error)
  );
  flightsUnsubscribe = onFlightsSnapshot(
    companyId,
    (flights) => {
      latestFlights = flights;
      renderAll();
    },
    (error) => console.error('FDTL flights snapshot error:', error)
  );

  return {
    destroy() {
      [schemeUnsubscribe, crewUnsubscribe, statesUnsubscribe, recordsUnsubscribe, fatigueUnsubscribe, auditUnsubscribe, flightsUnsubscribe].forEach((fn) => fn?.());
      schemeUnsubscribe = crewUnsubscribe = statesUnsubscribe = recordsUnsubscribe = fatigueUnsubscribe = auditUnsubscribe = flightsUnsubscribe = null;
      if (messageTimer) clearTimeout(messageTimer);
      activeView = null;
      activeCompanyId = null;
      activeActor = null;
      activeScheme = getDefaultScheme();
      latestCrew = [];
      latestStates = [];
      latestRecords = [];
      latestFatigue = [];
      latestAudit = [];
      latestFlights = [];
      selectedFlightId = null;
    }
  };
}
