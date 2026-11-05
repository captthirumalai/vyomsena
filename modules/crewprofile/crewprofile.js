import {
  getCrew,
  getPilotDocuments,
  getPilotDocumentsForProfile,
  getPilotTrainingRecords,
  getCrewDocumentsByPilots,
  summarizeCrewDocumentCompliance,
  updatePilotProfile,
  delinkPilot,
  deletePilot
} from '../../services/crewService.js';
import { getUserByUid } from '../../services/userService.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mountModuleActions, setModuleTitle, setModuleSubtitle } from '../../shared/moduleHeader.js';
import { cpState } from './state.js';
import {
  q,
  escapeHtml,
  formatDate,
  showToast,
  openModal,
  closeModal,
  confirmModal,
  getProfileStatusBadgeHtml,
  getPilotRoleLabel,
  getPilotBase,
  toProfileName,
  normalizeRole,
  isActivePilot
} from './ui.js';
import { renderRoster, renderInactive, avatarHtml } from './roster.js';
import { openProfileForm, bindProfileForm } from './profileForm.js';
import { getCrewAttentionLevel, getAttentionBadgeHtml, getAttentionSummary } from '../crew/utils.js';

const PROFILE_KEY = 'vs-selected-crew-profile';

let profileUser = null;
let profileDocuments = [];
let profileTrainingRecords = [];

const TRAINING_KEYWORDS = [
  'ppc',
  'ipc',
  'opc',
  'sim',
  'simulator',
  'ground school',
  'crm',
  'dangerous goods',
  'dg',
  'security',
  'human factors',
  'emergency',
  'line check',
  'line training',
  'recurrent'
];

const QUALIFICATION_RULES = [
  { label: 'Licence', categoryTokens: ['licence', 'license'], nameTokens: ['licence', 'license'] },
  { label: 'Medical', categoryTokens: ['medical'], nameTokens: ['medical'] },
  { label: 'RTR', categoryTokens: ['rtr', 'radio'], nameTokens: ['rtr', 'radio'] },
  { label: 'Passport', categoryTokens: ['passport'], nameTokens: ['passport'] },
  { label: 'Visa', categoryTokens: ['visa'], nameTokens: ['visa'] },
  { label: 'PPC', categoryTokens: ['training'], nameTokens: ['ppc'] },
  { label: 'OPC', categoryTokens: ['training'], nameTokens: ['opc'] },
  { label: 'CRM', categoryTokens: ['training'], nameTokens: ['crm'] },
  { label: 'DG', categoryTokens: ['training'], nameTokens: ['dangerous goods', 'dg'] },
  { label: 'IR', categoryTokens: ['training'], nameTokens: ['instrument', 'ir'] }
];

const CURRENCY_THRESHOLDS = {
  document: {
    greenMinDays: 60,
    amberMinDays: 0
  },
  recency: {
    lastFlightMaxDays: { green: 30, amber: 60 },
    lastSimulatorMaxDays: { green: 90, amber: 180 },
    lastLineCheckMaxDays: { green: 180, amber: 365 },
    hoursLast30Min: { green: 20, amber: 10 },
    hoursLast90Min: { green: 60, amber: 30 }
  }
};

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatDateTime(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleString() : 'N/A';
}

function getDocumentStatus(document, warningDays = 30) {
  const expiry = toDateValue(document.expiryDate);
  if (!expiry) return 'Valid';
  const diffDays = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'Expired';
  if (diffDays < warningDays) return 'Expiring';
  return 'Valid';
}

function normalizeText(value) {
  return `${value || ''}`.trim();
}

function toLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function isTrainingDocument(document) {
  const category = toLowerText(document.documentCategory);
  const name = toLowerText(document.documentName);
  if (category === 'training') return true;
  return TRAINING_KEYWORDS.some((keyword) => name.includes(keyword));
}

function formatHourValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0';
  return `${parsed}`;
}

function formatShortValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') return 'empty';
  const text = typeof value === 'object' ? JSON.stringify(value) : `${value}`;
  return text.length > 26 ? `${text.slice(0, 23)}...` : text;
}

function getDocumentMatchTokens(document) {
  return {
    category: toLowerText(document.documentCategory),
    name: toLowerText(document.documentName)
  };
}

function matchDocumentByRule(document, rule) {
  const tokens = getDocumentMatchTokens(document);
  const matchesCategory = (rule.categoryTokens || []).some((token) => tokens.category.includes(token));
  const matchesName = (rule.nameTokens || []).some((token) => tokens.name.includes(token));
  return matchesCategory || matchesName;
}

function getDaysUntilDate(value) {
  const date = toDateValue(value);
  if (!date) return null;
  return Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function resolveDocumentToneByExpiry(document) {
  const thresholds = CURRENCY_THRESHOLDS.document;
  const days = getDaysUntilDate(document.expiryDate);

  if (days === null) {
    return { tone: 'red', label: 'RED', detail: 'Missing expiry date' };
  }

  if (days < thresholds.amberMinDays) {
    return { tone: 'red', label: 'RED', detail: `Expired ${Math.abs(days)} day(s) ago` };
  }

  if (days < thresholds.greenMinDays) {
    return { tone: 'amber', label: 'AMBER', detail: `Expires in ${days} day(s)` };
  }

  return { tone: 'green', label: 'GREEN', detail: `Valid for ${days} day(s)` };
}

function pickWorstTone(values) {
  const order = { red: 3, amber: 2, green: 1 };
  if (!values.length) return 'red';
  return values.reduce((worst, tone) => (order[tone] > order[worst] ? tone : worst), 'green');
}

function toToneLabel(tone) {
  if (tone === 'green') return 'GREEN';
  if (tone === 'amber') return 'AMBER';
  return 'RED';
}

function deriveQualificationStatus(documents) {
  if (!documents.length) {
    return {
      tone: 'red',
      label: 'RED',
      detail: 'No supporting record'
    };
  }

  const evaluations = documents.map((document) => resolveDocumentToneByExpiry(document));
  const tone = pickWorstTone(evaluations.map((item) => item.tone));
  const ranked = evaluations.sort((left, right) => {
    const order = { red: 3, amber: 2, green: 1 };
    return (order[right.tone] || 0) - (order[left.tone] || 0);
  });

  return {
    tone,
    label: toToneLabel(tone),
    detail: ranked[0]?.detail || 'No detail'
  };
}

function getNumberFromProfile(candidates = []) {
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getDateFromProfile(candidates = []) {
  for (const candidate of candidates) {
    const date = toDateValue(candidate);
    if (date) return date;
  }
  return null;
}

function evaluateDaysRecency(dateValue, threshold) {
  if (!dateValue) return { tone: 'red', label: 'RED', detail: 'No record date' };
  const daysSince = Math.floor((Date.now() - dateValue.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= threshold.green) return { tone: 'green', label: 'GREEN', detail: `${daysSince} day(s) since` };
  if (daysSince <= threshold.amber) return { tone: 'amber', label: 'AMBER', detail: `${daysSince} day(s) since` };
  return { tone: 'red', label: 'RED', detail: `${daysSince} day(s) since` };
}

function evaluateHoursRecency(value, threshold) {
  if (value === null) return { tone: 'red', label: 'RED', detail: 'No logged hours' };
  if (value >= threshold.green) return { tone: 'green', label: 'GREEN', detail: `${value}h logged` };
  if (value >= threshold.amber) return { tone: 'amber', label: 'AMBER', detail: `${value}h logged` };
  return { tone: 'red', label: 'RED', detail: `${value}h logged` };
}

function getEmbeddedEditLogs(document) {
  if (Array.isArray(document.editLogs)) return document.editLogs;
  if (Array.isArray(document.edit_logs)) return document.edit_logs;
  if (Array.isArray(document.recentAudit)) return document.recentAudit;
  if (document.lastEditLog && typeof document.lastEditLog === 'object') return [document.lastEditLog];
  return [];
}

function normalizeTrainingStatus(value) {
  const status = `${value || ''}`.trim().toUpperCase();
  if (!status) return 'PENDING';
  if (status === 'ACCEPTED') return 'COMPLETED';
  if (status === 'REJECTED') return 'DECLINED';
  return status;
}

function getTrainingRecordStatus(record) {
  const normalized = normalizeTrainingStatus(record.status);
  if (normalized === 'COMPLETED') {
    return { tone: 'green', label: 'GREEN', detail: 'Completed' };
  }
  if (normalized === 'DECLINED' || normalized === 'CANCELLED') {
    return { tone: 'red', label: 'RED', detail: normalized };
  }

  const due = toDateValue(record.dueAt || record.dueDate || record.expiryDate);
  if (!due) {
    return { tone: 'amber', label: 'AMBER', detail: normalized };
  }

  const days = Math.floor((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { tone: 'red', label: 'RED', detail: `Overdue by ${Math.abs(days)} day(s)` };
  if (days < 30) return { tone: 'amber', label: 'AMBER', detail: `Due in ${days} day(s)` };
  return { tone: 'green', label: 'GREEN', detail: `Due in ${days} day(s)` };
}

function toHistoryEventFromEditLog(document, log, index) {
  const fieldName = log.field || log.fieldName || 'unknown_field';
  const oldValue = formatShortValue(log.oldValue);
  const newValue = formatShortValue(log.newValue);
  return {
    when: log.timestamp || log.createdAt || log.when || null,
    event: `${document.documentName || 'Document'}: ${fieldName} changed (${oldValue} -> ${newValue})`,
    source: log.source || 'edit_logs',
    editedBy: log.editedBy || document.lastEditedBy || 'N/A',
    sortSeed: index
  };
}

/* ================= DETAIL VIEW ================= */

function setTab(tabName) {
  if (!cpState.view) return;
  cpState.view.querySelectorAll('.crew-tab').forEach((button) => {
    const isActive = button.getAttribute('data-tab') === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  cpState.view.querySelectorAll('.crew-tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.getAttribute('data-panel') === tabName);
  });
}

function renderHeader() {
  if (!cpState.view || !profileUser) return;

  const name = profileUser.fullName || profileUser.name || profileUser.email || profileUser.uid;
  const subtitle = [
    profileUser.email || 'No email',
    `${profileUser.role || 'PILOT'}`.toUpperCase(),
    profileUser.organizationBase || profileUser.base || 'No base'
  ].join(' | ');

  const compliance = summarizeCrewDocumentCompliance(profileDocuments || []);
  const status = compliance.expired > 0 ? 'Expired' : compliance.expiring > 0 ? 'Expiring' : 'Valid';

  const statusEl = q('#cp-detail-status');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = `vs-page-chip crew-profile-status ${status.toLowerCase()}`;
  }

  setModuleTitle(name || 'Crew Profile');
  setModuleSubtitle(subtitle);

  const editButton = q('#cp-detail-edit');
  if (editButton) {
    editButton.classList.toggle('hidden', !canPerformCrewAction(cpState.currentUser, 'edit'));
  }

  const kpiContainer = q('#crew-profile-kpis');
  if (!kpiContainer) return;
  kpiContainer.innerHTML = [
    { label: 'Documents', value: profileDocuments.length },
    { label: 'Valid', value: Math.max(profileDocuments.length - compliance.expired - compliance.expiring, 0) },
    { label: 'Expiring', value: compliance.expiring },
    { label: 'Expired', value: compliance.expired }
  ].map((item) => `<article class="vs-kpi-card"><strong class="vs-kpi-value">${item.value}</strong><span class="vs-kpi-label">${item.label}</span></article>`).join('');
}

function renderPersonalTab() {
  if (!cpState.view || !profileUser) return;

  const grid = q('#crew-profile-grid');
  if (!grid) return;

  const items = [
    ['Employee ID', profileUser.uid],
    ['Name', profileUser.fullName || profileUser.name],
    ['Role', `${profileUser.role || 'PILOT'}`.toUpperCase()],
    ['Designation', profileUser.designation || 'N/A'],
    ['Organization', profileUser.organizationName || 'N/A'],
    ['Base', profileUser.organizationBase || profileUser.base || 'N/A'],
    ['Mobile', profileUser.mobile || profileUser.companyPhone || 'N/A'],
    ['Email', profileUser.email || 'N/A'],
    ['Status', profileUser.status || 'Active'],
    ['Nationality', profileUser.nationality || 'N/A'],
    ['Blood Group', profileUser.bloodGroup || 'N/A'],
    ['Emergency Contact', profileUser.emergencyContact || 'N/A'],
    ['Address', profileUser.address || 'N/A'],
    ['Joining Date', formatDate(profileUser.joiningDate)],
    ['Resignation Date', formatDate(profileUser.resignationDate)],
    ['Linked Operator', profileUser.linkedOperator || 'N/A']
  ];

  grid.innerHTML = items
    .map(([label, value]) => `<dl class="crew-profile-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'N/A')}</dd></dl>`)
    .join('');
}

function renderDocumentsTab() {
  if (!cpState.view) return;

  const body = q('#crew-profile-doc-body');
  if (!body) return;

  if (!profileDocuments.length) {
    body.innerHTML = '<tr><td colspan="7">No documents found for this crew member.</td></tr>';
    return;
  }

  body.innerHTML = profileDocuments
    .slice()
    .sort((left, right) => {
      const leftTime = toDateValue(left.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = toDateValue(right.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .map((document) => `
      <tr>
        <td>${escapeHtml(document.documentCategory || 'GENERAL')}</td>
        <td>${escapeHtml(document.documentName || 'Untitled')}</td>
        <td>${escapeHtml(document.licenseOrCertificateNumber || 'N/A')}</td>
        <td>${escapeHtml(formatDate(document.issueDate))}</td>
        <td>${escapeHtml(formatDate(document.expiryDate))}</td>
        <td>${escapeHtml(getDocumentStatus(document))}</td>
        <td>${escapeHtml(document.lastEditedBy || 'N/A')}</td>
      </tr>
    `)
    .join('');
}

function renderTrainingTab() {
  if (!cpState.view) return;
  const body = q('#crew-profile-training-body');
  if (!body) return;

  if (profileTrainingRecords.length) {
    const sorted = profileTrainingRecords
      .slice()
      .sort((left, right) => {
        const leftTime = toDateValue(left.dueAt || left.dueDate || left.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
        const rightTime = toDateValue(right.dueAt || right.dueDate || right.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });

    body.innerHTML = sorted
      .map((record) => {
        const status = getTrainingRecordStatus(record);
        return `<tr>
          <td>${escapeHtml(record.trainingType || record.courseName || 'Training')}</td>
          <td>${escapeHtml(formatDate(record.completedAt || record.completionDate))}</td>
          <td>${escapeHtml(formatDate(record.dueAt || record.dueDate || record.expiryDate))}</td>
          <td><span class="crew-training-pill ${status.tone}">${escapeHtml(status.label)}</span></td>
          <td>${escapeHtml(record.certificateNumber || record.trainingCode || record.recordId || 'N/A')}</td>
        </tr>`;
      })
      .join('');

    renderQualificationMatrix();
    return;
  }

  const trainingDocs = profileDocuments
    .filter((document) => isTrainingDocument(document))
    .sort((left, right) => {
      const leftTime = toDateValue(left.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = toDateValue(right.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });

  if (!trainingDocs.length) {
    body.innerHTML = '<tr><td colspan="5">No training records yet. Add training certificates under documents.</td></tr>';
    renderQualificationMatrix();
    return;
  }

  body.innerHTML = trainingDocs
    .map((document) => {
      const status = getDocumentStatus(document);
      const tone = status.toLowerCase();
      return `<tr>
        <td>${escapeHtml(document.documentName || document.documentCategory || 'Training')}</td>
        <td>${escapeHtml(formatDate(document.issueDate))}</td>
        <td>${escapeHtml(formatDate(document.expiryDate))}</td>
        <td><span class="crew-training-pill ${tone}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(document.licenseOrCertificateNumber || document.firestoreId || 'N/A')}</td>
      </tr>`;
    })
    .join('');

  renderQualificationMatrix();
}

function renderQualificationMatrix() {
  if (!cpState.view) return;
  const container = q('#crew-qualification-matrix');
  if (!container) return;

  const items = QUALIFICATION_RULES.map((rule) => {
    const relatedDocs = profileDocuments.filter((document) => matchDocumentByRule(document, rule));
    const status = deriveQualificationStatus(relatedDocs);
    return `<article class="crew-matrix-item"><strong>${escapeHtml(rule.label)}</strong><span class="crew-matrix-pill ${status.tone}">${escapeHtml(status.label)}</span><small>${escapeHtml(status.detail)}</small></article>`;
  });

  container.innerHTML = items.join('');
}

function renderRecencyMatrix() {
  if (!cpState.view || !profileUser) return;
  const container = q('#crew-recency-matrix');
  if (!container) return;

  const thresholds = CURRENCY_THRESHOLDS.recency;
  const experience = profileUser.flightExperience || {};
  const hours = profileUser.flightHours || {};

  const lastFlight = getDateFromProfile([
    profileUser.lastFlightAt,
    experience.lastFlightAt,
    hours.lastFlightAt
  ]);

  const lastSimulator = getDateFromProfile([
    profileUser.lastSimulatorAt,
    profileUser.lastSimAt,
    experience.lastSimulatorAt,
    experience.lastSimAt
  ]);

  const lastLineCheck = getDateFromProfile([
    profileUser.lastLineCheckAt,
    experience.lastLineCheckAt
  ]);

  const hoursLast30 = getNumberFromProfile([
    profileUser.hoursLast30Days,
    profileUser.flightHoursLast30Days,
    experience.hoursLast30Days,
    hours.last30Days
  ]);

  const hoursLast90 = getNumberFromProfile([
    profileUser.hoursLast90Days,
    profileUser.flightHoursLast90Days,
    experience.hoursLast90Days,
    hours.last90Days
  ]);

  const items = [
    {
      label: 'Last Flight Recency',
      result: evaluateDaysRecency(lastFlight, thresholds.lastFlightMaxDays),
      thresholdText: `Green <= ${thresholds.lastFlightMaxDays.green}d, Amber <= ${thresholds.lastFlightMaxDays.amber}d, Red > ${thresholds.lastFlightMaxDays.amber}d`
    },
    {
      label: 'Simulator Recency',
      result: evaluateDaysRecency(lastSimulator, thresholds.lastSimulatorMaxDays),
      thresholdText: `Green <= ${thresholds.lastSimulatorMaxDays.green}d, Amber <= ${thresholds.lastSimulatorMaxDays.amber}d, Red > ${thresholds.lastSimulatorMaxDays.amber}d`
    },
    {
      label: 'Line Check Recency',
      result: evaluateDaysRecency(lastLineCheck, thresholds.lastLineCheckMaxDays),
      thresholdText: `Green <= ${thresholds.lastLineCheckMaxDays.green}d, Amber <= ${thresholds.lastLineCheckMaxDays.amber}d, Red > ${thresholds.lastLineCheckMaxDays.amber}d`
    },
    {
      label: 'Hours Last 30 Days',
      result: evaluateHoursRecency(hoursLast30, thresholds.hoursLast30Min),
      thresholdText: `Green >= ${thresholds.hoursLast30Min.green}h, Amber >= ${thresholds.hoursLast30Min.amber}h, Red < ${thresholds.hoursLast30Min.amber}h`
    },
    {
      label: 'Hours Last 90 Days',
      result: evaluateHoursRecency(hoursLast90, thresholds.hoursLast90Min),
      thresholdText: `Green >= ${thresholds.hoursLast90Min.green}h, Amber >= ${thresholds.hoursLast90Min.amber}h, Red < ${thresholds.hoursLast90Min.amber}h`
    }
  ];

  container.innerHTML = items
    .map((item) => `<article class="crew-matrix-item"><strong>${escapeHtml(item.label)}</strong><span class="crew-matrix-pill ${item.result.tone}">${escapeHtml(item.result.label)}</span><small>${escapeHtml(item.result.detail)} | ${escapeHtml(item.thresholdText)}</small></article>`)
    .join('');
}

function renderFlightExperienceTab() {
  if (!cpState.view || !profileUser) return;
  const grid = q('#crew-profile-experience-grid');
  if (!grid) return;

  const experience = profileUser.flightExperience || {};
  const hourSet = profileUser.flightHours || {};

  const metrics = [
    ['Total Hours', experience.totalHours ?? hourSet.totalHours ?? 0],
    ['PIC Hours', experience.picHours ?? hourSet.picHours ?? 0],
    ['SIC Hours', experience.sicHours ?? hourSet.sicHours ?? 0],
    ['Multi Engine', experience.multiEngineHours ?? hourSet.multiEngineHours ?? 0],
    ['Single Engine', experience.singleEngineHours ?? hourSet.singleEngineHours ?? 0],
    ['Night Hours', experience.nightHours ?? hourSet.nightHours ?? 0],
    ['Instrument', experience.instrumentHours ?? hourSet.instrumentHours ?? 0],
    ['Cross Country', experience.crossCountryHours ?? hourSet.crossCountryHours ?? 0],
    ['Survey Hours', experience.surveyHours ?? hourSet.surveyHours ?? 0],
    ['Instructor Hours', experience.instructorHours ?? hourSet.instructorHours ?? 0]
  ];

  grid.innerHTML = metrics
    .map(([label, value]) => `<dl class="crew-profile-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatHourValue(value))}</dd></dl>`)
    .join('');

  renderRecencyMatrix();
}

function renderNotesTab() {
  if (!cpState.view || !profileUser) return;
  const container = q('#crew-profile-notes');
  if (!container) return;

  const operationalNotes = normalizeText(profileUser.notes || profileUser.operationalNotes || profileUser.internalNotes || '');
  const reviewer = profileUser.reviewedBy || profileUser.reviewer || 'Not assigned';
  const reviewStatus = profileUser.reviewStatus || profileUser.internalReviewStatus || 'Pending';
  const reviewDate = profileUser.lastReviewedAt || profileUser.reviewedAt || null;
  const reviewRemarks = normalizeText(profileUser.reviewRemarks || profileUser.internalReviewRemarks || '');

  container.innerHTML = `
    <article class="crew-profile-note-card">
      <h4>Operational Notes</h4>
      <p>${escapeHtml(operationalNotes || 'No notes available yet.')}</p>
    </article>
    <div class="crew-profile-note-grid">
      <article class="crew-profile-note-card">
        <h4>Internal Review Status</h4>
        <p>${escapeHtml(reviewStatus)}</p>
      </article>
      <article class="crew-profile-note-card">
        <h4>Reviewer</h4>
        <p>${escapeHtml(reviewer)}</p>
      </article>
      <article class="crew-profile-note-card">
        <h4>Last Review Date</h4>
        <p>${escapeHtml(formatDateTime(reviewDate))}</p>
      </article>
      <article class="crew-profile-note-card">
        <h4>Review Remarks</h4>
        <p>${escapeHtml(reviewRemarks || 'No review remarks yet.')}</p>
      </article>
    </div>
  `;
}

function renderHistoryTab() {
  if (!cpState.view) return;
  const body = q('#crew-profile-history-body');
  if (!body) return;

  const documentEvents = profileDocuments
    .map((document) => ({
      when: document.lastModified,
      event: `${document.documentName || 'Document'} updated`,
      source: document.isDirty ? 'Queued Sync' : 'Firestore',
      editedBy: document.lastEditedBy || 'N/A'
    }));

  const editLogEvents = profileDocuments.flatMap((document) =>
    getEmbeddedEditLogs(document).map((log, index) => toHistoryEventFromEditLog(document, log, index))
  );

  const profileEvent = {
    when: profileUser?.createdAt || null,
    event: 'Crew profile created',
    source: 'users',
    editedBy: profileUser?.email || profileUser?.uid || 'N/A'
  };

  const trainingEvents = profileTrainingRecords.map((record) => ({
    when: record.lastModified || record.completedAt || record.createdAt || null,
    event: `${record.trainingType || record.courseName || 'Training'} status ${normalizeTrainingStatus(record.status).toLowerCase()}`,
    source: 'training_records',
    editedBy: record.updatedBy || record.instructor || profileUser?.email || 'N/A'
  }));

  const events = [profileEvent, ...trainingEvents, ...editLogEvents, ...documentEvents]
    .filter((event) => !!event.when)
    .sort((left, right) => {
      const leftTime = toDateValue(left.when)?.getTime() || 0;
      const rightTime = toDateValue(right.when)?.getTime() || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return (right.sortSeed || 0) - (left.sortSeed || 0);
    })
    .slice(0, 20);

  if (!events.length) {
    body.innerHTML = '<tr><td colspan="4">No activity found yet.</td></tr>';
    return;
  }

  body.innerHTML = events
    .map((event) => `
      <tr>
        <td>${escapeHtml(formatDateTime(event.when))}</td>
        <td>${escapeHtml(event.event)}</td>
        <td>${escapeHtml(event.source)}</td>
        <td>${escapeHtml(event.editedBy)}</td>
      </tr>
    `)
    .join('');
}

/* ================= ROSTER / OVERVIEW ================= */

async function loadRosterData() {
  if (!cpState.currentUser?.uid) {
    cpState.pilots = [];
    cpState.docsByUid = new Map();
    return;
  }

  if (cpState.role === 'PILOT') {
    const uid = cpState.currentUser.uid;
    const docs = await getPilotDocuments(uid).catch(() => []);
    cpState.pilots = [{ ...cpState.currentUser, uid }];
    cpState.docsByUid = new Map([[uid, docs]]);
    return;
  }

  if (!cpState.operatorUid) {
    cpState.pilots = [];
    cpState.docsByUid = new Map();
    return;
  }

  const pilots = await getCrew(cpState.operatorUid);
  cpState.pilots = pilots;
  cpState.docsByUid = await getCrewDocumentsByPilots(pilots);
}

async function refreshRoster() {
  await loadRosterData();
  renderRoster();
  renderInactive();
}

function showRoster() {
  cpState.mode = 'roster';
  cpState.detailUid = null;
  q('#cp-detail-view')?.classList.add('hidden');
  q('#cp-roster-view')?.classList.remove('hidden');
  setModuleTitle('Crew Profile');
  setModuleSubtitle('Manage all pilot profiles, add pilots and keep their records current.');
  renderRoster();
  renderInactive();
}

async function openDetail(uid) {
  if (!uid) return;
  cpState.mode = 'detail';
  cpState.detailUid = uid;

  q('#cp-roster-view')?.classList.add('hidden');
  q('#cp-detail-view')?.classList.remove('hidden');

  const backButton = q('#cp-back-to-roster');
  if (backButton) backButton.classList.toggle('hidden', cpState.role === 'PILOT');

  const cached = cpState.pilots.find((item) => item.uid === uid) || null;
  const loadedUser = await getUserByUid(uid).catch(() => null);
  profileUser = cached ? { ...(loadedUser || {}), ...cached } : loadedUser;
  if (!profileUser) {
    showToast('Crew profile not found or inaccessible.', 'error');
    showRoster();
    return;
  }

  const [documents, trainingRecords] = await Promise.all([
    getPilotDocumentsForProfile(profileUser).catch(() => getPilotDocuments(uid).catch(() => [])),
    getPilotTrainingRecords(uid).catch(() => [])
  ]);

  profileDocuments = documents;
  profileTrainingRecords = trainingRecords;

  renderHeader();
  renderPersonalTab();
  renderDocumentsTab();
  renderTrainingTab();
  renderFlightExperienceTab();
  renderNotesTab();
  renderHistoryTab();
  setTab('personal');
}

function backToRoster() {
  window.sessionStorage.removeItem(PROFILE_KEY);
  profileUser = null;
  profileDocuments = [];
  profileTrainingRecords = [];
  showRoster();
}

function openOverview(uid) {
  const pilot = cpState.pilots.find((item) => item.uid === uid);
  if (!pilot) return;
  cpState.modalUid = uid;

  const docs = cpState.docsByUid.get(uid) || [];
  const level = getCrewAttentionLevel(docs);
  const summary = getAttentionSummary(pilot, docs);
  const canEdit = canPerformCrewAction(cpState.currentUser, 'edit');
  const canDelete = canPerformCrewAction(cpState.currentUser, 'delete');
  const active = isActivePilot(pilot);

  const actions = [
    ...(canEdit ? [`<button type="button" class="cp-btn cp-btn-ghost cp-btn-md" data-cp-action="edit">Edit Profile</button>`] : []),
    ...(canEdit
      ? [`<button type="button" class="cp-btn cp-btn-ghost cp-btn-md" data-cp-action="toggle-status">${active ? 'Set Inactive' : 'Set Active'}</button>`]
      : []),
    ...(canDelete ? [`<button type="button" class="cp-btn cp-btn-danger cp-btn-md" data-cp-action="delete">Delete Account</button>`] : []),
    `<button type="button" class="cp-btn cp-btn-primary cp-btn-md" data-cp-action="view">View Full Profile</button>`
  ].join('');

  openModal(`
    <div class="cp-overview-head">
      ${avatarHtml(pilot, 'cp-avatar-lg')}
      <div class="cp-overview-identity">
        <strong>${escapeHtml(toProfileName(pilot))}</strong>
        <span>${escapeHtml(pilot.email || 'No email')}</span>
        <span class="cp-overview-badges">
          <span class="cp-badge cp-badge-muted">${escapeHtml(getPilotRoleLabel(pilot))}</span>
          ${getProfileStatusBadgeHtml(pilot.status)}
        </span>
      </div>
    </div>
    <div class="cp-overview-compliance">
      ${getAttentionBadgeHtml(level)}
      <span>${escapeHtml(summary.text)}</span>
    </div>
    <dl class="cp-kv">
      <div class="cp-kv-row"><dt>Employee ID</dt><dd>${escapeHtml(pilot.employeeId || '—')}</dd></div>
      <div class="cp-kv-row"><dt>Designation</dt><dd>${escapeHtml(pilot.designation || '—')}</dd></div>
      <div class="cp-kv-row"><dt>Phone</dt><dd>${escapeHtml(pilot.mobile || pilot.companyPhone || '—')}</dd></div>
      <div class="cp-kv-row"><dt>Base</dt><dd>${escapeHtml(getPilotBase(pilot) || '—')}</dd></div>
      <div class="cp-kv-row"><dt>Operator</dt><dd>${escapeHtml(pilot.operatorId || '—')}</dd></div>
      <div class="cp-kv-row"><dt>Documents</dt><dd>${docs.length}</dd></div>
    </dl>
    <div class="cp-overview-actions">${actions}</div>
  `, { title: 'Pilot Overview' });
}

async function toggleStatus(uid) {
  if (!canPerformCrewAction(cpState.currentUser, 'edit')) {
    showToast('You do not have permission to modify crew records.', 'error');
    return;
  }
  const pilot = cpState.pilots.find((item) => item.uid === uid);
  if (!pilot) return;
  const next = isActivePilot(pilot) ? 'Inactive' : 'Active';
  try {
    await updatePilotProfile(uid, { status: next });
    if (next !== 'Active' && cpState.detailUid === uid) backToRoster();
    await refreshRoster();
    showToast(`Status updated to ${next}.`, 'success');
  } catch (error) {
    console.error('Crew status update failed:', error);
    showToast(error.message || 'Unable to update crew status.', 'error');
  }
}

async function deleteAccount(uid) {
  if (!canPerformCrewAction(cpState.currentUser, 'delete')) {
    showToast('You do not have permission to delete crew accounts.', 'error');
    return;
  }
  const pilot = cpState.pilots.find((item) => item.uid === uid);
  if (!pilot) return;
  confirmModal({
    title: 'Delete Account',
    message: `Move "${toProfileName(pilot)}" to Inactive? They will be unlinked from the operator and can be restored or permanently deleted from Inactive Profiles.`,
    confirmLabel: 'Delete Account',
    danger: true,
    onConfirm: async () => {
      try {
        await updatePilotProfile(uid, { status: 'Deleted' });
        await delinkPilot(uid);
        if (cpState.detailUid === uid) backToRoster();
        await refreshRoster();
        showToast('Crew account moved to inactive.', 'success');
      } catch (error) {
        console.error('Crew account deletion failed:', error);
        showToast(error.message || 'Unable to delete crew account.', 'error');
      }
    }
  });
}

async function restorePilot(uid) {
  if (!canPerformCrewAction(cpState.currentUser, 'edit')) {
    showToast('You do not have permission to modify crew records.', 'error');
    return;
  }
  try {
    await updatePilotProfile(uid, { status: 'Active' });
    await refreshRoster();
    showToast('Pilot restored to active roster.', 'success');
  } catch (error) {
    console.error('Crew restore failed:', error);
    showToast(error.message || 'Unable to restore pilot.', 'error');
  }
}

async function permanentlyDeletePilot(uid) {
  if (!canPerformCrewAction(cpState.currentUser, 'delete')) {
    showToast('You do not have permission to delete crew accounts.', 'error');
    return;
  }
  const pilot = cpState.pilots.find((item) => item.uid === uid);
  if (!pilot) return;
  confirmModal({
    title: 'Permanently delete pilot',
    message: `Permanently delete "${toProfileName(pilot)}"? This removes their profile, documents, uploaded files and account link. This cannot be undone.`,
    confirmLabel: 'Delete Forever',
    danger: true,
    onConfirm: async () => {
      let failed = false;
      try {
        await deletePilot(uid);
      } catch (error) {
        failed = true;
        console.error('Permanent crew delete failed:', error);
        showToast(error.message || 'Unable to permanently delete crew member.', 'error');
      }
      await refreshRoster();
      if (!failed) showToast('Crew member permanently deleted.', 'success');
    }
  });
}

/* ================= EVENT BINDING ================= */

function bindRosterControls() {
  const roster = q('#cp-roster-view');
  roster?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest('[data-cp-add]')) {
      openProfileForm(null);
      return;
    }

    const inactiveButton = target.closest('[data-cp-inactive-action]');
    if (inactiveButton) {
      const uid = inactiveButton.getAttribute('data-cp-uid');
      if (!uid) return;
      if (inactiveButton.getAttribute('data-cp-inactive-action') === 'restore') restorePilot(uid);
      else permanentlyDeletePilot(uid);
      return;
    }

    const card = target.closest('.cp-card');
    if (card) openOverview(card.getAttribute('data-cp-uid'));
  });

  roster?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target instanceof HTMLElement ? event.target.closest('.cp-card') : null;
    if (!card) return;
    event.preventDefault();
    openOverview(card.getAttribute('data-cp-uid'));
  });

  q('#cp-search')?.addEventListener('input', (event) => {
    cpState.searchText = event.target?.value || '';
    renderRoster();
  });
}

function bindDetailControls() {
  q('#cp-back-to-roster')?.addEventListener('click', backToRoster);
  q('#cp-detail-edit')?.addEventListener('click', () => openProfileForm(cpState.detailUid));
  q('#cp-detail-view')?.addEventListener('click', (event) => {
    const tab = event.target instanceof HTMLElement ? event.target.closest('.crew-tab') : null;
    if (tab) setTab(tab.getAttribute('data-tab') || 'personal');
  });
}

function bindModalControls() {
  q('#cp-modal-close')?.addEventListener('click', closeModal);
  q('#cp-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });

  q('#cp-modal-content')?.addEventListener('click', async (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest('[data-cp-action]') : null;
    if (!button) return;
    const action = button.getAttribute('data-cp-action');
    const uid = cpState.modalUid;
    if (!uid) return;

    if (action === 'view') {
      closeModal();
      await openDetail(uid);
    } else if (action === 'edit') {
      closeModal();
      openProfileForm(uid);
    } else if (action === 'toggle-status') {
      closeModal();
      await toggleStatus(uid);
    } else if (action === 'delete') {
      closeModal();
      await deleteAccount(uid);
    }
  });
}

/* ================= INIT / DESTROY ================= */

export async function init(view, context) {
  cpState.view = view;
  cpState.currentUser = context?.currentUser || null;
  cpState.role = normalizeRole(cpState.currentUser?.role);
  cpState.operatorUid = getCurrentOrganizationContext(cpState.currentUser).organizationId || cpState.currentUser?.uid || null;
  cpState.searchText = '';
  cpState.mode = 'roster';
  cpState.detailUid = null;
  cpState.modalUid = null;
  cpState.editingUid = null;
  cpState.pilots = [];
  cpState.docsByUid = new Map();

  mountModuleActions('');

  bindRosterControls();
  bindDetailControls();
  bindModalControls();
  bindProfileForm(async () => {
    await loadRosterData();
    if (cpState.mode === 'detail' && cpState.detailUid) {
      await openDetail(cpState.detailUid);
    } else {
      renderRoster();
      renderInactive();
    }
  });

  if (!cpState.currentUser?.uid) {
    setModuleSubtitle('Crew Profile requires a signed-in user.');
    return {
      destroy() {
        cpState.view = null;
      }
    };
  }

  await loadRosterData();

  if (cpState.role === 'PILOT') {
    await openDetail(cpState.currentUser.uid);
  } else {
    const preselected = window.sessionStorage.getItem(PROFILE_KEY);
    window.sessionStorage.removeItem(PROFILE_KEY);
    if (preselected) await openDetail(preselected);
    else showRoster();
  }

  return {
    destroy() {
      cpState.view = null;
      cpState.currentUser = null;
      cpState.operatorUid = null;
      cpState.pilots = [];
      cpState.docsByUid = new Map();
      cpState.searchText = '';
      cpState.mode = 'roster';
      cpState.detailUid = null;
      cpState.modalUid = null;
      cpState.editingUid = null;
      profileUser = null;
      profileDocuments = [];
      profileTrainingRecords = [];
      clearTimeout(cpState.toastTimer);
      mountModuleActions('');
    }
  };
}
