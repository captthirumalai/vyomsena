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
  VERDICTS,
  VERDICT_LABELS,
  formatDurationMinutes,
  resolveFdpBaseLimit,
  simulateFlightSequence,
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

function fmtMinutes(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return mins ? `${hours}:${String(mins).padStart(2, '0')}` : `${hours}:00`;
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
      <li><span>Break over ${fmtMinutes(split.breakGreaterThanMinutes)}</span><strong>No extension</strong></li>
    </ul>
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
}

function createFlightSequenceRow(index, defaults = {}) {
  const date = defaults.date || '';
  const departure = defaults.departure || '';
  const landing = defaults.landing || '';
  const flightNumber = defaults.flightNumber ?? index + 1;
  const newDuty = defaults.newDuty ? 'checked' : '';

  return `
    <tr data-row-index="${index}">
      <td><input type="date" class="fdtl-sequence-date" value="${escapeHtml(date)}" /></td>
      <td><input type="time" class="fdtl-sequence-departure" value="${escapeHtml(departure)}" /></td>
      <td><input type="time" class="fdtl-sequence-landing" value="${escapeHtml(landing)}" /></td>
      <td><span class="fdtl-sequence-flight-number">${flightNumber}</span></td>
      <td>
        <label class="fdtl-switch" title="Start a new duty period before this flight">
          <input type="checkbox" class="fdtl-sequence-new-duty" ${newDuty} />
          <span class="fdtl-switch-track"></span>
        </label>
      </td>
      <td><button type="button" class="fdtl-remove-sequence-row">Remove</button></td>
    </tr>`;
}

function ensureFlightSequenceRows() {
  const body = activeView?.querySelector('#fdtl-flight-sequence-body');
  if (!body) return;
  if (body.children.length > 0) return;

  body.innerHTML = [
    createFlightSequenceRow(0, { flightNumber: 1, date: new Date().toISOString().slice(0, 10) }),
    createFlightSequenceRow(1, { flightNumber: 2, date: new Date().toISOString().slice(0, 10) })
  ].join('');
}

function renderAll() {
  renderSchemeLine();
  renderSchemeEditor();
  renderDashboard();
  renderCrew();
  renderRecords();
  renderAudit();
  populateSelects();
  ensureFlightSequenceRows();
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

function handleCheckSubmit(event) {
  event.preventDefault();
  const resultElement = activeView?.querySelector('#fdtl-check-result');
  if (!resultElement) return;

  const crewId = activeView.querySelector('#fdtl-check-crew')?.value;
  const member = latestCrew.find((item) => getCrewId(item) === crewId);

  const rows = [...(activeView.querySelectorAll('#fdtl-flight-sequence-body tr') || [])];
  const flights = rows
    .map((row) => {
      const date = row.querySelector('.fdtl-sequence-date')?.value;
      const departure = row.querySelector('.fdtl-sequence-departure')?.value;
      const landing = row.querySelector('.fdtl-sequence-landing')?.value;
      if (!date || !departure || !landing) return null;
      return {
        date,
        departure: `${date}T${departure}:00`,
        landing: `${date}T${landing}:00`,
        newDuty: Boolean(row.querySelector('.fdtl-sequence-new-duty')?.checked)
      };
    })
    .filter(Boolean);

  if (flights.length === 0) {
    resultElement.innerHTML = '<div class="fdtl-check-card"><span class="fdtl-badge fdtl-badge--critical">Add at least one complete flight to the sequence (date, departure, and landing) before checking.</span></div>';
    return;
  }

  const reportOverride = activeView.querySelector('#fdtl-check-report-override')?.value;
  const historical = latestRecords.filter((record) => record.crewProfileId === crewId);

  const simulation = simulateFlightSequence(activeScheme, {
    crewName: member ? getCrewName(member) : crewId || 'Crew',
    flights,
    historicalRecords: historical,
    reportOverrides: reportOverride ? { 0: `${reportOverride}:00` } : {}
  });

  const verdictMap = {
    within: 'good',
    attention: 'watch',
    exceeded: 'critical'
  };
  const verdict = simulation.verdict;
  const tone = verdictMap[verdict] || 'good';

  const allFlights = simulation.duties.flatMap((duty) => duty.flights);
  const flightCounts = allFlights.reduce(
    (acc, flight) => {
      if (flight.notEvaluated) {
        acc.notEvaluated += 1;
      } else if (flight.verdict === VERDICTS.EXCEEDED) {
        acc.exceeded += 1;
      } else if (flight.verdict === VERDICTS.ATTENTION) {
        acc.attention += 1;
      } else {
        acc.within += 1;
      }
      return acc;
    },
    { within: 0, attention: 0, exceeded: 0, notEvaluated: 0 }
  );

  const renderRulePills = (ruleRefs, isViolation) =>
    Array.isArray(ruleRefs) && ruleRefs.length
      ? `<div class="fdtl-rule-pills">${ruleRefs.map((ref) => `<span class="fdtl-rule-pill${isViolation ? ' violation' : ''}">${escapeHtml(ref)}</span>`).join('')}</div>`
      : '<span class="muted">—</span>';

  const renderFlightRow = (flight, dutyIndex) => {
    const rowClass = flight.verdict === VERDICTS.EXCEEDED ? 'fail' : flight.verdict === VERDICTS.ATTENTION ? 'watch' : 'ok';
    const badgeClass = flight.verdict === VERDICTS.EXCEEDED ? 'critical' : flight.verdict === VERDICTS.ATTENTION ? 'watch' : 'good';
    const isViolation = flight.verdict === VERDICTS.EXCEEDED;
    const reason = flight.reason || flight.complianceText || '—';

    return `
      <tr class="${rowClass}">
        <td>F${flight.flightNumber}</td>
        <td>Duty ${dutyIndex}</td>
        <td><span class="fdtl-badge fdtl-badge--${badgeClass}">${escapeHtml(VERDICT_LABELS[flight.verdict] || 'Within Limits')}</span></td>
        <td>${escapeHtml(flight.departure ? formatDateTime(flight.departure) : '—')}</td>
        <td>${escapeHtml(flight.landing ? formatDateTime(flight.landing) : '—')}</td>
        <td>${renderRulePills(flight.ruleRefs, isViolation)}</td>
        <td class="fdtl-td-reason">${escapeHtml(reason)}</td>
      </tr>`;
  };

  const flightTableRows = simulation.duties
    .flatMap((duty) => duty.flights.map((flight) => renderFlightRow(flight, duty.dutyIndex)))
    .join('');

  const violatedDuties = simulation.duties.filter((d) => d.verdict === VERDICTS.EXCEEDED);
  const violationSummaryLine = violatedDuties.length
    ? violatedDuties.map((d) => `Duty ${d.dutyIndex}: ${d.reasons.join(' · ')}`).join('<br>')
    : '';

  resultElement.innerHTML = `
    <div class="fdtl-check-card">
      <div class="fdtl-check-head">
        <strong>${escapeHtml(member ? getCrewName(member) : crewId || 'Crew')}</strong>
        <span class="fdtl-badge fdtl-badge--${tone}">${escapeHtml(VERDICT_LABELS[verdict] || 'Within Limits')}</span>
      </div>
      <div class="fdtl-check-summary-bar">
        <div class="fdtl-check-summary-stat"><span>Duties</span><strong>${simulation.duties.length}</strong></div>
        <div class="fdtl-check-summary-stat"><span>Compliant</span><strong style="color:#166534">${flightCounts.within}</strong></div>
        <div class="fdtl-check-summary-stat"><span>Attention</span><strong style="color:#92400e">${flightCounts.attention}</strong></div>
        <div class="fdtl-check-summary-stat"><span>Exceeded</span><strong style="color:#991b1b">${flightCounts.exceeded}</strong></div>
      </div>
      ${violationSummaryLine ? `<div class="fdtl-check-reason" style="margin-top:0.7rem;font-size:0.82rem;line-height:1.5">${violationSummaryLine}</div>` : ''}
      <div class="fdtl-check-table-wrap">
        <table class="fdtl-check-table">
          <thead>
            <tr>
              <th>Flight</th>
              <th>Duty</th>
              <th>Result</th>
              <th>Departure</th>
              <th>Landing</th>
              <th>Rule refs</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>${flightTableRows}</tbody>
        </table>
      </div>
    </div>`;
}

export async function init(view, context) {
  activeView = view;

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

  view.querySelectorAll('.fdtl-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.fdtlTab));
  });
  view.querySelector('#fdtl-crew-body')?.addEventListener('click', handleSetState);
  view.querySelector('#fdtl-records-body')?.addEventListener('click', handleDeleteRecord);
  view.querySelector('#fdtl-record-form')?.addEventListener('submit', handleRecordSubmit);
  view.querySelector('#fdtl-add-flight-row')?.addEventListener('click', () => {
    const body = activeView?.querySelector('#fdtl-flight-sequence-body');
    if (!body) return;
    const nextIndex = body.children.length;
    body.insertAdjacentHTML('beforeend', createFlightSequenceRow(nextIndex, { flightNumber: nextIndex + 1 }));
  });
  view.querySelector('#fdtl-flight-sequence-body')?.addEventListener('click', (event) => {
    const button = event.target.closest('.fdtl-remove-sequence-row');
    if (!button) return;
    const row = button.closest('tr');
    row?.remove();
    const rows = [...(activeView?.querySelectorAll('#fdtl-flight-sequence-body tr') || [])];
    rows.forEach((currentRow, index) => {
      currentRow.dataset.rowIndex = String(index);
      const numberEl = currentRow.querySelector('.fdtl-sequence-flight-number');
      if (numberEl) numberEl.textContent = String(index + 1);
    });
  });
  view.querySelector('#fdtl-check-form')?.addEventListener('submit', handleCheckSubmit);
  view.querySelector('#fdtl-scheme-form')?.addEventListener('submit', handleSchemeSubmit);
  view.querySelector('#fdtl-scheme-form')?.addEventListener('input', () => {
    const dirty = view.querySelector('#fdtl-scheme-dirty');
    if (dirty) dirty.classList.remove('hidden');
  });
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

    latestCrew = Array.isArray(crewList) ? crewList : [];
    activeScheme = scheme && typeof scheme === 'object' ? { ...getDefaultScheme(), ...scheme } : getDefaultScheme();
    latestStates = Array.isArray(states) ? states : [];
    latestRecords = Array.isArray(records) ? records : [];
    latestFatigue = Array.isArray(fatigue) ? fatigue : [];
    latestAudit = Array.isArray(audit) ? audit : [];
    renderAll();
  } catch (error) {
    console.error('FDTL initial load failed:', error);
    activeScheme = getDefaultScheme();
    latestCrew = [];
    latestStates = [];
    latestRecords = [];
    latestFatigue = [];
    latestAudit = [];
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
