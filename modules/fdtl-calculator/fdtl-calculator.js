import { getCrew, onCrewSnapshot } from '../../services/crewService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import {
  getDefaultScheme,
  getFdtlScheme,
  onFdtlSchemeSnapshot,
  simulateFlightSequence,
  VERDICTS,
  VERDICT_LABELS,
  formatDurationMinutes
} from '../../services/fdtl/index.js';
import { listDutyRecords } from '../../services/fdtl/dutyRecords.js';

let view = null;
let scheme = getDefaultScheme();
let crew = [];
let records = [];
let crewUnsubscribe = null;
let schemeUnsubscribe = null;

const escapeHtml = (value) => `${value ?? ''}`
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const getCrewId = (member) => member.uid || member.crewProfileId || null;
const getCrewName = (member) => member.name || member.fullName || member.email || member.uid || 'Unnamed Crew';
const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
};
const formatTime = (value) => {
  const date = toDate(value);
  return date && !Number.isNaN(date.getTime())
    ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : '-';
};
const formatDayTime = (value) => {
  const date = toDate(value);
  return date && !Number.isNaN(date.getTime())
    ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${formatTime(date)}`
    : '-';
};

function showStatus(message) {
  const element = view?.querySelector('#fdtl-calculator-status');
  if (element) element.textContent = message;
}

function renderCrewSelect() {
  const select = view?.querySelector('#fdtl-calculator-crew');
  if (!select) return;
  select.innerHTML = crew.length
    ? crew.map((member) => `<option value="${escapeHtml(getCrewId(member))}">${escapeHtml(getCrewName(member))}</option>`).join('')
    : '<option value="">No crew available</option>';
}

function createRow(index, defaults = {}) {
  return `<tr data-row-index="${index}">
    <td><input type="date" class="fdtl-sequence-date" value="${escapeHtml(defaults.date || '')}" /></td>
    <td><input type="time" class="fdtl-sequence-departure" value="${escapeHtml(defaults.departure || '')}" /></td>
    <td><input type="time" class="fdtl-sequence-landing" value="${escapeHtml(defaults.landing || '')}" /></td>
    <td><span class="fdtl-sequence-flight-number">${index + 1}</span></td>
    <td><input type="number" class="fdtl-sequence-break" min="0" max="600" step="5" placeholder="min" title="Split-duty break before this flight" /><span class="fdtl-gap-hint"></span></td>
    <td><label class="fdtl-switch" title="Start a new duty period before this flight"><input type="checkbox" class="fdtl-sequence-new-duty" /><span class="fdtl-switch-track"></span></label></td>
    <td><button type="button" class="fdtl-remove-sequence-row">Remove</button></td>
  </tr>`;
}

function updateHints() {
  const body = view?.querySelector('#fdtl-calculator-sequence');
  if (!body) return;
  const rows = [...body.querySelectorAll('tr')];
  let previousLanding = null;
  rows.forEach((row) => {
    const date = row.querySelector('.fdtl-sequence-date')?.value;
    const departure = row.querySelector('.fdtl-sequence-departure')?.value;
    const landing = row.querySelector('.fdtl-sequence-landing')?.value;
    const hint = row.querySelector('.fdtl-gap-hint');
    const breakInput = row.querySelector('.fdtl-sequence-break');
    if (!hint || !date || !departure || !landing) {
      if (hint) hint.textContent = '';
      return;
    }
    const departureDate = new Date(`${date}T${departure}:00`);
    const landingDate = new Date(`${date}T${landing}:00`);
    const gap = previousLanding ? Math.max(0, Math.round((departureDate - previousLanding) / 60000)) : null;
    previousLanding = landingDate;
    if (gap == null) {
      hint.textContent = '';
      breakInput.disabled = false;
    } else {
      hint.textContent = `${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')} gap`;
      hint.className = `fdtl-gap-hint${gap >= 180 && gap <= 600 ? ' fdtl-gap-hint--split' : gap > 600 ? ' fdtl-gap-hint--warn' : ''}`;
      breakInput.disabled = gap < 180 || gap > 600;
    }
  });
}

function readFlights() {
  return [...(view?.querySelectorAll('#fdtl-calculator-sequence tr') || [])]
    .map((row) => {
      const date = row.querySelector('.fdtl-sequence-date')?.value;
      const departure = row.querySelector('.fdtl-sequence-departure')?.value;
      const landing = row.querySelector('.fdtl-sequence-landing')?.value;
      if (!date || !departure || !landing) return null;
      return {
        date,
        departure: `${date}T${departure}:00`,
        landing: `${date}T${landing}:00`,
        newDuty: Boolean(row.querySelector('.fdtl-sequence-new-duty')?.checked),
        breakMinutes: Number(row.querySelector('.fdtl-sequence-break')?.value) || 0
      };
    })
    .filter(Boolean);
}

function statusClass(verdict) {
  return verdict === VERDICTS.EXCEEDED ? 'fail' : verdict === VERDICTS.ATTENTION ? 'watch' : 'ok';
}

function renderRule(rule) {
  if (!rule) return '';
  const value = (item) => item == null ? '-' : rule.count ? String(item) : formatDurationMinutes(item);
  return `<div class="fdtl-rule fdtl-rule--${statusClass(rule.status)}">
    <div class="fdtl-rule-head"><span class="fdtl-rule-label">${escapeHtml(rule.label)}</span><span class="fdtl-rule-ref">${escapeHtml(rule.ref)}</span></div>
    <div class="fdtl-rule-meter"><span class="fdtl-meter-cell"><small>Allowed</small><b>${value(rule.allowed)}</b></span><span class="fdtl-meter-cell"><small>Actual</small><b>${value(rule.actual)}</b></span><span class="fdtl-meter-cell fdtl-meter-margin"><small>Margin</small><b>${escapeHtml(rule.margin || '-')}</b></span></div>
    ${rule.note ? `<div class="fdtl-rule-note">${escapeHtml(rule.note)}</div>` : ''}
  </div>`;
}

function renderResult(simulation, member) {
  const result = view?.querySelector('#fdtl-calculator-result');
  if (!result) return;
  const verdict = simulation.verdict;
  const duties = simulation.duties || [];
  const flights = duties.flatMap((duty) => duty.flights || []);
  const counts = flights.reduce((summary, flight) => {
    const key = flight.notEvaluated ? 'notEvaluated' : flight.verdict === VERDICTS.EXCEEDED ? 'exceeded' : flight.verdict === VERDICTS.ATTENTION ? 'attention' : 'within';
    summary[key] += 1;
    return summary;
  }, { within: 0, attention: 0, exceeded: 0, notEvaluated: 0 });
  const renderFlight = (flight) => `<div class="fdtl-flight-card fdtl-flight-card--${statusClass(flight.verdict)}"><div class="fdtl-flight-head"><span class="fdtl-flight-id">F${escapeHtml(flight.flightNumber)}</span><span class="fdtl-flight-range">${escapeHtml(flight.departure ? `${formatDayTime(flight.departure)} -> ${formatTime(flight.landing)}` : '-')}</span><span class="fdtl-badge fdtl-badge--${statusClass(flight.verdict) === 'fail' ? 'critical' : statusClass(flight.verdict) === 'watch' ? 'watch' : 'good'}">${escapeHtml(VERDICT_LABELS[flight.verdict] || 'Within Limits')}</span></div><div class="fdtl-flight-rules">${(flight.rules || []).map(renderRule).join('')}</div></div>`;
  const renderDuty = (duty) => `<div class="fdtl-duty-card fdtl-duty-card--${statusClass(duty.verdict)}"><div class="fdtl-duty-head"><div class="fdtl-duty-title"><strong>Duty ${duty.dutyIndex}</strong><span>${escapeHtml(duty.reportTime ? `Report ${formatDayTime(duty.reportTime)} -> Land ${formatTime(duty.finalLanding)}` : '-')}</span></div><span class="fdtl-badge fdtl-badge--${statusClass(duty.verdict) === 'fail' ? 'critical' : statusClass(duty.verdict) === 'watch' ? 'watch' : 'good'}">${escapeHtml(VERDICT_LABELS[duty.verdict] || 'Within Limits')}</span></div>${(duty.rules || []).map(renderRule).join('')}<div class="fdtl-flight-list">${(duty.flights || []).map(renderFlight).join('')}</div></div>`;
  const violatedDuties = simulation.duties.filter((d) => d.verdict === VERDICTS.EXCEEDED);
  const violationSummaryLine = violatedDuties.length
    ? violatedDuties.map((d) => `Duty ${d.dutyIndex}: ${d.reasons.join(' · ')}`).join('<br>')
    : '';
  const boundaryWarnings = simulation.duties
    .flatMap((d) => d.flights)
    .filter((f) => f.gapBeforeMinutes != null && f.gapBeforeMinutes > 600)
    .map((f) => `Gap before F${f.flightNumber} is ${formatDurationMinutes(f.gapBeforeMinutes)} (>10h) — a new duty cycle starts there; split duty does not apply. Watch FDP and rest warnings on that duty.`)
    .join('<br>');
  result.innerHTML = `<div class="fdtl-check-card"><div class="fdtl-check-head"><strong>${escapeHtml(getCrewName(member))}</strong><span class="fdtl-badge fdtl-badge--${verdict === VERDICTS.EXCEEDED ? 'critical' : verdict === VERDICTS.ATTENTION ? 'watch' : 'good'}">${escapeHtml(VERDICT_LABELS[verdict] || 'Within Limits')}</span></div><div class="fdtl-check-summary-bar"><div class="fdtl-check-summary-stat"><span>Duties</span><strong>${duties.length}</strong></div><div class="fdtl-check-summary-stat"><span>Within Limits</span><strong>${counts.within}</strong></div><div class="fdtl-check-summary-stat"><span>Not Evaluated</span><strong>${counts.notEvaluated}</strong></div><div class="fdtl-check-summary-stat"><span>Attention</span><strong>${counts.attention}</strong></div><div class="fdtl-check-summary-stat"><span>Exceeded</span><strong>${counts.exceeded}</strong></div></div>${violationSummaryLine ? `<div class="fdtl-check-reason">${violationSummaryLine}</div>` : ''}${boundaryWarnings ? `<div class="fdtl-check-note-block">${boundaryWarnings}</div>` : ''}<div class="fdtl-duty-list">${duties.map(renderDuty).join('')}</div></div>`;
}

function handleSubmit(event) {
  event.preventDefault();
  const crewId = view?.querySelector('#fdtl-calculator-crew')?.value;
  const member = crew.find((item) => getCrewId(item) === crewId);
  const flights = readFlights();
  if (!member || !flights.length) {
    showStatus('Select a crew member and add at least one complete flight.');
    return;
  }
  const reportOverride = view.querySelector('#fdtl-calculator-report-override')?.value;
  const simulation = simulateFlightSequence(scheme, {
    crewName: getCrewName(member),
    flights,
    historicalRecords: records.filter((record) => record.crewProfileId === crewId),
    reportOverrides: reportOverride ? { 0: `${reportOverride}:00` } : {}
  });
  renderResult(simulation, member);
  showStatus(`Checked ${flights.length} flight${flights.length === 1 ? '' : 's'} against ${scheme.schemeName || 'the approved scheme'}.`);
}

export async function init(moduleView, context) {
  view = moduleView;
  const user = context?.currentUser || null;
  const companyId = getCurrentOrganizationContext(user).organizationId || user?.uid || null;
  if (!companyId) {
    showStatus('No authorized operator found.');
    return { destroy() {} };
  }

  const sequence = view.querySelector('#fdtl-calculator-sequence');
  const today = new Date().toISOString().slice(0, 10);
  sequence.innerHTML = `${createRow(0, { date: today })}${createRow(1, { date: today })}`;
  view.querySelector('#fdtl-calculator-add-row')?.addEventListener('click', () => {
    sequence.insertAdjacentHTML('beforeend', createRow(sequence.children.length));
    updateHints();
  });
  sequence.addEventListener('input', updateHints);
  sequence.addEventListener('change', updateHints);
  sequence.addEventListener('click', (event) => {
    const row = event.target.closest('.fdtl-remove-sequence-row');
    if (!row) return;
    row.closest('tr')?.remove();
    [...sequence.children].forEach((item, index) => {
      item.dataset.rowIndex = String(index);
      item.querySelector('.fdtl-sequence-flight-number').textContent = String(index + 1);
    });
    updateHints();
  });
  view.querySelector('#fdtl-calculator-form')?.addEventListener('submit', handleSubmit);
  renderCrewSelect();
  updateHints();

  try {
    const [crewList, loadedScheme, dutyRecords] = await Promise.all([getCrew(companyId), getFdtlScheme(companyId), listDutyRecords(companyId)]);
    crew = Array.isArray(crewList) ? crewList : [];
    scheme = loadedScheme && typeof loadedScheme === 'object' ? { ...getDefaultScheme(), ...loadedScheme } : getDefaultScheme();
    records = Array.isArray(dutyRecords) ? dutyRecords : [];
    renderCrewSelect();
    view.querySelector('#fdtl-calculator-scheme').textContent = `${scheme.schemeName || 'Approved FDTL Scheme'} ${scheme.schemeVersion || ''}`.trim();
  } catch (error) {
    console.error('FDTL calculator initial load failed:', error);
    showStatus('Unable to load the approved scheme or crew list.');
  }

  crewUnsubscribe = onCrewSnapshot(companyId, (items) => { crew = items; renderCrewSelect(); }, (error) => console.error('FDTL calculator crew snapshot error:', error));
  schemeUnsubscribe = onFdtlSchemeSnapshot(companyId, (loadedScheme) => {
    scheme = loadedScheme;
    view.querySelector('#fdtl-calculator-scheme').textContent = `${scheme.schemeName || 'Approved FDTL Scheme'} ${scheme.schemeVersion || ''}`.trim();
  }, (error) => console.error('FDTL calculator scheme snapshot error:', error));

  return {
    destroy() {
      crewUnsubscribe?.();
      schemeUnsubscribe?.();
      crewUnsubscribe = null;
      schemeUnsubscribe = null;
      view = null;
      crew = [];
      records = [];
      scheme = getDefaultScheme();
    }
  };
}
