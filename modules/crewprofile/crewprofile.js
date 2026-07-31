import {
  getPilotDocuments,
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
    statusEl.className = `crew-profile-status ${status.toLowerCase()}`;
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
  ].map((item) => `<article class="crew-profile-kpi"><strong>${item.value}</strong><span>${item.label}</span></article>`).join('');
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

  const trainingDocs = profileDocuments
    .filter((document) => isTrainingDocument(document))
    .sort((left, right) => {
      const leftTime = toDateValue(left.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = toDateValue(right.expiryDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });

  if (!trainingDocs.length) {
    body.innerHTML = '<tr><td colspan="5">No training records yet. Add training certificates under documents.</td></tr>';
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

  const events = [profileEvent, ...documentEvents, ...outgoingEvents, ...incomingEvents]
    .filter((event) => !!event.when)
    .sort((left, right) => {
      const leftTime = toDateValue(left.when)?.getTime() || 0;
      const rightTime = toDateValue(right.when)?.getTime() || 0;
      return rightTime - leftTime;
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

  profileDocuments = await getPilotDocuments(profileUid);

  renderHeader();
  renderPersonalTab();
  renderDocumentsTab();
  renderTrainingTab();
  renderFlightExperienceTab();
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
      connectionContext = { incoming: [], outgoing: [] };
    }
  };
}
