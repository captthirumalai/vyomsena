import {
  getPilotDocuments,
  getPilotTrainingRecords,
  getIncomingLinkRequests,
  getOutgoingLinkRequests,
  summarizeCrewDocumentCompliance
} from '../../services/crewService.js';
import { getUserByUid } from '../../services/userService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';

const PROFILE_KEY = 'vs-selected-crew-profile';

let activeView = null;
let profileUid = null;
let profileUser = null;
let profileDocuments = [];
let profileTrainingRecords = [];
let connectionContext = {
  incoming: [],
  outgoing: []
};

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

function formatDate(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString() : 'N/A';
}

function formatDateTime(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleString() : 'N/A';
}

function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function setTab(tabName) {
  if (!activeView) return;
  activeView.querySelectorAll('.crew-tab').forEach((button) => {
    const isActive = button.getAttribute('data-tab') === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  activeView.querySelectorAll('.crew-tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.getAttribute('data-panel') === tabName);
  });
}

function renderHeader() {
  if (!activeView || !profileUser) return;

  const name = profileUser.fullName || profileUser.name || profileUser.email || profileUser.uid;
  const subtitle = [
    profileUser.email || 'No email',
    `${profileUser.role || 'PILOT'}`.toUpperCase(),
    profileUser.organizationBase || profileUser.base || 'No base'
  ].join(' | ');

  const compliance = summarizeCrewDocumentCompliance(profileDocuments || []);
  const status = compliance.expired > 0 ? 'Expired' : compliance.expiring > 0 ? 'Expiring' : 'Valid';

  const statusEl = activeView.querySelector('#crew-profile-status');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = `vs-page-chip crew-profile-status ${status.toLowerCase()}`;
  }

  const titleEl = activeView.querySelector('#crew-profile-name');
  const subtitleEl = activeView.querySelector('#crew-profile-subtitle');
  if (titleEl) titleEl.textContent = name;
  if (subtitleEl) subtitleEl.textContent = subtitle;

  const kpiContainer = activeView.querySelector('#crew-profile-kpis');
  if (!kpiContainer) return;
  kpiContainer.innerHTML = [
    { label: 'Documents', value: profileDocuments.length },
    { label: 'Valid', value: Math.max(profileDocuments.length - compliance.expired - compliance.expiring, 0) },
    { label: 'Expiring', value: compliance.expiring },
    { label: 'Expired', value: compliance.expired }
  ].map((item) => `<article class="vs-kpi-card"><strong class="vs-kpi-value">${item.value}</strong><span class="vs-kpi-label">${item.label}</span></article>`).join('');
}

function renderPersonalTab() {
  if (!activeView || !profileUser) return;

  const grid = activeView.querySelector('#crew-profile-grid');
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
  if (!activeView) return;

  const body = activeView.querySelector('#crew-profile-doc-body');
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
  if (!activeView) return;
  const body = activeView.querySelector('#crew-profile-training-body');
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
  if (!activeView) return;
  const container = activeView.querySelector('#crew-qualification-matrix');
  if (!container) return;

  const items = QUALIFICATION_RULES.map((rule) => {
    const relatedDocs = profileDocuments.filter((document) => matchDocumentByRule(document, rule));
    const status = deriveQualificationStatus(relatedDocs);
    return `<article class="crew-matrix-item"><strong>${escapeHtml(rule.label)}</strong><span class="crew-matrix-pill ${status.tone}">${escapeHtml(status.label)}</span><small>${escapeHtml(status.detail)}</small></article>`;
  });

  container.innerHTML = items.join('');
}

function renderRecencyMatrix() {
  if (!activeView || !profileUser) return;
  const container = activeView.querySelector('#crew-recency-matrix');
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
  if (!activeView || !profileUser) return;
  const grid = activeView.querySelector('#crew-profile-experience-grid');
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
  if (!activeView || !profileUser) return;
  const container = activeView.querySelector('#crew-profile-notes');
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

async function renderConnectionsTab(currentUser) {
  if (!activeView) return;
  const target = activeView.querySelector('#crew-profile-connections');
  if (!target || !profileUser) return;

  const orgContext = getCurrentOrganizationContext(currentUser);
  const operatorUid = orgContext.organizationId;

  connectionContext = {
    incoming: [],
    outgoing: []
  };

  const cards = [];
  cards.push(`<article class="crew-profile-connection-card"><strong>Linked Operator:</strong> ${escapeHtml(profileUser.linkedOperator || 'None')}</article>`);

  if (operatorUid) {
    const outgoing = await getOutgoingLinkRequests(operatorUid);
    connectionContext.outgoing = outgoing;
    const related = outgoing.filter((item) => item.recipientId === profileUser.uid || item.recipientEmail === profileUser.email);
    cards.push(`<article class="crew-profile-connection-card"><strong>Outgoing Requests:</strong> ${related.length}</article>`);
  }

  if (currentUser?.uid === profileUser.uid) {
    const incoming = await getIncomingLinkRequests(profileUser.uid);
    connectionContext.incoming = incoming;
    cards.push(`<article class="crew-profile-connection-card"><strong>Incoming Requests:</strong> ${incoming.length}</article>`);
  }

  target.innerHTML = cards.join('');
}

function renderHistoryTab() {
  if (!activeView) return;
  const body = activeView.querySelector('#crew-profile-history-body');
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

  const outgoingEvents = (connectionContext.outgoing || [])
    .filter((item) => item.recipientId === profileUser?.uid || item.recipientEmail === profileUser?.email)
    .map((item) => ({
      when: item.createdAt,
      event: `Connection request sent (${(item.status || 'PENDING').toUpperCase()})`,
      source: 'connection_requests',
      editedBy: item.requesterEmail || item.requesterId || 'N/A'
    }));

  const incomingEvents = (connectionContext.incoming || [])
    .map((item) => ({
      when: item.createdAt,
      event: `Connection request received (${(item.status || 'PENDING').toUpperCase()})`,
      source: 'connection_requests',
      editedBy: item.requesterEmail || item.requesterId || 'N/A'
    }));

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

  const events = [profileEvent, ...trainingEvents, ...editLogEvents, ...documentEvents, ...outgoingEvents, ...incomingEvents]
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

function bindEvents() {
  if (!activeView) return;
  activeView.querySelectorAll('.crew-tab').forEach((button) => {
    button.addEventListener('click', () => {
      setTab(button.getAttribute('data-tab') || 'personal');
    });
  });
}

function resolveProfileUid(currentUser) {
  const fromSession = window.sessionStorage.getItem(PROFILE_KEY);
  if (fromSession) return fromSession;
  if (`${currentUser?.role || ''}`.toUpperCase() === 'PILOT') return currentUser?.uid || null;
  return null;
}

export async function init(view, context) {
  activeView = view;
  profileUid = resolveProfileUid(context?.currentUser);

  if (!profileUid) {
    const subtitle = activeView.querySelector('#crew-profile-subtitle');
    if (subtitle) subtitle.textContent = 'No crew member selected. Open Crew Management and choose Profile from a crew row.';
    return {
      destroy() {
        activeView = null;
      }
    };
  }

  profileUser = await getUserByUid(profileUid);
  if (!profileUser) {
    const subtitle = activeView.querySelector('#crew-profile-subtitle');
    if (subtitle) subtitle.textContent = 'Crew profile not found or inaccessible.';
    return {
      destroy() {
        activeView = null;
      }
    };
  }

  const [documents, trainingRecords] = await Promise.all([
    getPilotDocuments(profileUid),
    getPilotTrainingRecords(profileUid).catch(() => [])
  ]);

  profileDocuments = documents;
  profileTrainingRecords = trainingRecords;

  renderHeader();
  renderPersonalTab();
  renderDocumentsTab();
  renderTrainingTab();
  renderFlightExperienceTab();
  renderNotesTab();
  await renderConnectionsTab(context?.currentUser);
  renderHistoryTab();
  bindEvents();
  setTab('personal');

  return {
    destroy() {
      activeView = null;
      profileUid = null;
      profileUser = null;
      profileDocuments = [];
      profileTrainingRecords = [];
      connectionContext = { incoming: [], outgoing: [] };
    }
  };
}
