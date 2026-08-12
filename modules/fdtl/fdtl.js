import { getCrew, onCrewSnapshot } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import {
  getDefaultScheme,
  getFdtlScheme,
  saveFdtlScheme,
  onFdtlSchemeSnapshot,
  DUTY_STATES,
  DUTY_STATE_LABELS,
  OPERATION_TYPE_LABELS,
  OPERATION_CREW_LABELS,
  OPERATION_CREW,
  VERDICTS,
  VERDICT_LABELS,
  formatDurationMinutes,
  resolveFdpBaseLimit,
  resolveMaxLandings,
  checkPlannedFdp,
  summarizeCrewFdtl,
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

let activeView = null;
let activeCompanyId = null;
let activeActor = null;
let activeScheme = getDefaultScheme();
let latestCrew = [];
let latestStates = [];
let latestRecords = [];
let latestFatigue = [];
let latestAudit = [];
let messageTimer = null;

let schemeUnsubscribe = null;
let crewUnsubscribe = null;
let statesUnsubscribe = null;
let recordsUnsubscribe = null;
let fatigueUnsubscribe = null;
let auditUnsubscribe = null;

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
  const status = activeView?.querySelector('#fdtl-status');
  if (!status) return;
  status.textContent = message;
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    status.textContent = '';
  }, 5000);
}

function switchTab(tabName) {
  if (!activeView) return;
  activeView.querySelectorAll('.fdtl-tab').forEach((tab) => {
    const isActive = tab.dataset.fdtlTab === tabName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  activeView.querySelectorAll('.fdtl-pane').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.fdtlPane !== tabName);
  });
}

function computeCrewMetrics(member, state) {
  const now = new Date();
  const crewId = getCrewId(member);
  const memberRecords = latestRecords.filter((record) => record.crewProfileId === crewId);
  const summary = summarizeCrewFdtl(activeScheme, {
    crewProfileId: crewId,
    state,
    records: memberRecords,
    now
  });

  if (summary.tone === 'exceeded') {
    return {
      tone: 'exceeded',
      attentionLabel: summary.alertText
    };
  }

  if (summary.tone === 'attention') {
    return {
      tone: 'attention',
      attentionLabel: summary.alertText
    };
  }

  if (state?.state === DUTY_STATES.ON_DUTY) {
    const dutyStarted = toDate(state.dutyStartedAt);
    if (!dutyStarted) {
      return { tone: 'attention', attentionLabel: 'On duty without a recorded start time' };
    }
    const dutyUsedMinutes = Math.max(0, Math.floor((now.getTime() - dutyStarted.getTime()) / 60000));
    const base = resolveFdpBaseLimit(activeScheme, {
      operationCrew: OPERATION_CREW.TWO,
      flightTimeMinutes: 0,
      landings: 0
    });
    const applicable = base ?? 480;
    const threshold = Math.round(applicable * (activeScheme.fdp?.warningThresholdPct ?? 0.8));
    if (dutyUsedMinutes > applicable) {
      return {
        tone: 'exceeded',
        attentionLabel: `FDP exceeded by ${formatDurationMinutes(dutyUsedMinutes - applicable)}`
      };
    }
    if (dutyUsedMinutes >= threshold) {
      return {
        tone: 'attention',
        attentionLabel: `Approaching FDP limit ${formatDurationMinutes(dutyUsedMinutes)} / ${formatDurationMinutes(applicable)}`
      };
    }
  }

  return { tone: 'within' };
}

function renderSchemeLine() {
  const element = activeView?.querySelector('#fdtl-scheme-line');
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

function renderSchemeEditor() {
  const form = activeView?.querySelector('#fdtl-scheme-form');
  if (!form) return;

  const approval = activeScheme.approval || {};
  const adjustments = activeScheme.operationalAdjustments || {};

  const setValue = (selector, value) => {
    const input = form.querySelector(selector);
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
}

function renderDashboard() {
  if (!activeView) return;

  const attentionRows = [];
  let within = 0;
  let attention = 0;
  let exceeded = 0;

  latestCrew.forEach((member) => {
    const state = latestStates.find((item) => item.crewProfileId === getCrewId(member)) || null;
    const metrics = computeCrewMetrics(member, state);
    if (metrics.tone === 'exceeded') {
      exceeded += 1;
      attentionRows.push({ member, label: metrics.attentionLabel, tone: 'exceeded' });
    } else if (metrics.tone === 'attention') {
      attention += 1;
      attentionRows.push({ member, label: metrics.attentionLabel, tone: 'attention' });
    } else {
      within += 1;
    }
  });

  const setText = (id, value) => {
    const element = activeView.querySelector(`#${id}`);
    if (element) element.textContent = value;
  };
  setText('fdtl-stat-within', String(within));
  setText('fdtl-stat-attention', String(attention));
  setText('fdtl-stat-exceeded', String(exceeded));
  setText('fdtl-stat-fatigue', String(latestFatigue.length));

  const listElement = activeView.querySelector('#fdtl-attention-list');
  if (!listElement) return;

  if (!latestCrew.length) {
    listElement.innerHTML = '<p class="muted">No crew profiles found for this operator.</p>';
    return;
  }
  if (!attentionRows.length) {
    listElement.innerHTML = '<p class="fdtl-all-clear">All crew are within applicable FDTL limits.</p>';
    return;
  }
  listElement.innerHTML = attentionRows
    .map(
      ({ member, label, tone }) => `
      <div class="fdtl-attention-item">
        <span class="fdtl-badge fdtl-badge--${tone}">${escapeHtml(label)}</span>
        <strong>${escapeHtml(getCrewName(member))}</strong>
      </div>`
    )
    .join('');
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
    body.innerHTML = '<tr><td colspan="9" class="fdtl-empty">No duty records yet.</td></tr>';
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
        <td>${escapeHtml(OPERATION_CREW_LABELS[record.operationCrew] || '—')}</td>
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

function populateSelects() {
  if (!activeView) return;

  const crewOptions = latestCrew
    .map((member) => `<option value="${escapeHtml(getCrewId(member))}">${escapeHtml(getCrewName(member))}</option>`)
    .join('');
  const crewFallback = '<option value="">No crew</option>';

  ['#fdtl-record-crew', '#fdtl-check-crew', '#fdtl-fatigue-crew'].forEach((selector) => {
    const select = activeView.querySelector(selector);
    if (select) select.innerHTML = crewOptions || crewFallback;
  });

  const opTypeSelect = activeView.querySelector('#fdtl-record-op-type');
  if (opTypeSelect) {
    opTypeSelect.innerHTML = Object.entries(OPERATION_TYPE_LABELS)
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('');
  }

  const crewTypeOptions = Object.entries(OPERATION_CREW_LABELS)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  ['#fdtl-record-op-crew', '#fdtl-check-op-crew'].forEach((selector) => {
    const select = activeView.querySelector(selector);
    if (select) select.innerHTML = crewTypeOptions;
  });
}

function renderAll() {
  renderSchemeLine();
  renderSchemeEditor();
  renderDashboard();
  renderCrew();
  renderRecords();
  renderAudit();
  populateSelects();
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
    }
  };

  try {
    await saveFdtlScheme(activeCompanyId, nextScheme);
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
        operationCrew: read('#fdtl-record-op-crew') || 'two',
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

function handleCheckSubmit(event) {
  event.preventDefault();
  const resultElement = activeView?.querySelector('#fdtl-check-result');
  if (!resultElement) return;

  const read = (selector) => activeView.querySelector(selector)?.value;
  const crewId = read('#fdtl-check-crew');
  const member = latestCrew.find((item) => getCrewId(item) === crewId);
  const reportTime = new Date(read('#fdtl-check-report'));
  const fdpEnd = new Date(read('#fdtl-check-fdp-end'));
  const flightTimeMinutes = Number(read('#fdtl-check-flight-time')) || 0;
  const landings = Number(read('#fdtl-check-landings')) || 0;
  const operationCrew = read('#fdtl-check-op-crew') || OPERATION_CREW.TWO;

  if (Number.isNaN(reportTime.getTime()) || Number.isNaN(fdpEnd.getTime())) {
    resultElement.innerHTML = '<div class="fdtl-check-card"><span class="fdtl-badge fdtl-badge--critical">Enter a valid report time and planned duty end.</span></div>';
    return;
  }

  const plannedFdpMinutes = Math.max(0, Math.floor((fdpEnd.getTime() - reportTime.getTime()) / 60000));
  const result = checkPlannedFdp(activeScheme, {
    operationCrew,
    flightTimeMinutes,
    landings,
    fdpStart: reportTime,
    fdpEnd,
    plannedFdpMinutes
  });

  const maxLandings = resolveMaxLandings(activeScheme, { operationCrew, flightTimeMinutes });
  const maxFlightTime = activeScheme.fdp?.defaultMaxFlightTimeDayMinutes ?? 480;
  const fdpVerdict = result.ok ? result.verdict : VERDICTS.EXCEEDED;
  const tone = fdpVerdict === VERDICTS.EXCEEDED ? 'critical' : fdpVerdict === VERDICTS.ATTENTION ? 'watch' : 'good';

  const checks = [
    {
      label: '24-hour FDP',
      ok: result.ok && plannedFdpMinutes <= result.applicableLimitMinutes,
      value: `${formatDurationMinutes(plannedFdpMinutes)} / ${result.ok ? formatDurationMinutes(result.applicableLimitMinutes) : '—'}`
    },
    {
      label: '24-hour Flight Time',
      ok: flightTimeMinutes <= maxFlightTime,
      value: `${formatDurationMinutes(flightTimeMinutes)} / ${formatDurationMinutes(maxFlightTime)}`
    },
    {
      label: 'Landings',
      ok: maxLandings == null || landings <= maxLandings,
      value: maxLandings == null ? '—' : `${landings} / ${maxLandings}`
    }
  ];

  resultElement.innerHTML = `
    <div class="fdtl-check-card">
      <div class="fdtl-check-head">
        <strong>${escapeHtml(member ? getCrewName(member) : crewId || 'Crew')}</strong>
        <span class="fdtl-badge fdtl-badge--${tone}">${escapeHtml(VERDICT_LABELS[fdpVerdict] || 'Exceeded')}</span>
      </div>
      <div class="fdtl-check-limit">
        <div><span>Base FDP limit</span><strong>${result.ok ? formatDurationMinutes(result.baseLimitMinutes) : '—'}</strong></div>
        <div><span>WOCL adjustment</span><strong>${result.ok && result.woclReductionMinutes ? `-${formatDurationMinutes(result.woclReductionMinutes)}` : '—'}</strong></div>
        <div><span>Applicable FDP limit</span><strong>${result.ok ? formatDurationMinutes(result.applicableLimitMinutes) : 'Exceeds scheme'}</strong></div>
        <div><span>Planned FDP</span><strong>${formatDurationMinutes(plannedFdpMinutes)}</strong></div>
      </div>
      <ul class="fdtl-check-list">
        ${checks
          .map(
            (check) => `
          <li class="${check.ok ? 'ok' : 'fail'}">${check.ok ? '✓' : '✕'} ${escapeHtml(check.label)} <span>${escapeHtml(check.value)}</span></li>`
          )
          .join('')}
      </ul>
      ${result.ok && result.remainingMinutes > 0 ? `<p class="fdtl-check-remaining">Remaining FDP: ${formatDurationMinutes(result.remainingMinutes)}</p>` : ''}
    </div>`;
}

export async function init(view, context) {
  activeView = view;

  const currentUser = context?.currentUser || null;
  activeActor = currentUser
    ? { name: currentUser.name || currentUser.email, email: currentUser.email, uid: currentUser.uid }
    : null;

  const orgContext = getCurrentOrganizationContext(currentUser);
  const companyId = orgContext.organizationId || currentUser?.uid || null;
  activeCompanyId = companyId;

  if (!companyId) {
    activeScheme = getDefaultScheme();
    latestCrew = [];
    latestStates = [];
    latestRecords = [];
    latestFatigue = [];
    latestAudit = [];
    renderAll();
    showMessage('No authorized operator found.');
    return {
      destroy() {}
    };
  }

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'FDTL Monitoring';
  }

  view.querySelectorAll('.fdtl-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.fdtlTab));
  });
  view.querySelector('#fdtl-crew-body')?.addEventListener('click', handleSetState);
  view.querySelector('#fdtl-records-body')?.addEventListener('click', handleDeleteRecord);
  view.querySelector('#fdtl-record-form')?.addEventListener('submit', handleRecordSubmit);
  view.querySelector('#fdtl-check-form')?.addEventListener('submit', handleCheckSubmit);
  view.querySelector('#fdtl-scheme-form')?.addEventListener('submit', handleSchemeSubmit);
  view.querySelector('#fdtl-fatigue-form')?.addEventListener('submit', handleFatigueSubmit);

  try {
    const [crewList, scheme, states, records, fatigue, audit] = await Promise.all([
      getCrew(companyId),
      getFdtlScheme(companyId),
      listDutyStates(companyId),
      listDutyRecords(companyId),
      listFatigueReports(companyId),
      listAuditEntries(companyId)
    ]);
    latestCrew = crewList;
    activeScheme = scheme;
    latestStates = states;
    latestRecords = records;
    latestFatigue = fatigue;
    latestAudit = audit;
    renderAll();
  } catch (error) {
    console.error('FDTL initial load failed:', error);
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

  return {
    destroy() {
      [schemeUnsubscribe, crewUnsubscribe, statesUnsubscribe, recordsUnsubscribe, fatigueUnsubscribe, auditUnsubscribe].forEach((fn) => fn?.());
      schemeUnsubscribe = crewUnsubscribe = statesUnsubscribe = recordsUnsubscribe = fatigueUnsubscribe = auditUnsubscribe = null;
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
    }
  };
}
