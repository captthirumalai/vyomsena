import {
  getCrew,
  onCrewSnapshot,
  createPilot,
  delinkPilot,
  updatePilotProfile,
  generateCrewProfileLinkCode,
  requestPilotLinkByEmail,
  getIncomingLinkRequests,
  getOutgoingLinkRequests,
  onIncomingLinkRequests,
  onOutgoingLinkRequests,
  acceptIncomingLinkRequest,
  declineConnectionRequest,
  withdrawConnectionRequest,
  getPilotDocuments,
  createPilotDocument,
  updatePilotDocumentWithAudit,
  removePilotDocument,
  getCrewDocumentsByPilots,
  summarizeCrewDocumentCompliance
} from '../../services/crewService.js';
import { watchDocumentsByUser, getDocumentComplianceState } from '../../services/documentService.js';
import { uploadUserDocumentFile, deleteUserDocumentFile } from '../../services/storageService.js';
import {
  getCrewDocumentSyncQueue,
  enqueueCrewDocumentCreate,
  enqueueCrewDocumentUpdate,
  enqueueCrewDocumentDelete,
  processCrewDocumentSyncQueue,
  startCrewDocumentSyncWorker,
  shouldQueueError
} from '../../services/crewDocumentSyncService.js';
import { canPerformCrewAction, getCrewPermissionsForUser } from '../../services/permissionService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { findUserByEmail } from '../../services/userService.js';

let crewUnsubscribe = null;
let pilotDocUnsubscribe = null;
let outgoingRequestUnsubscribe = null;
let incomingRequestUnsubscribe = null;
let activeView = null;
let activeOperatorUid = null;
let activeCurrentUser = null;
let activeRole = 'OPERATIONS';
let pilotsCache = [];
let docsByPilotCache = new Map();
let selectedPilotUid = null;
let outgoingRequestsCache = [];
let incomingRequestsCache = [];
let queueMonitorTimer = null;
let linkCodeTimer = null;
let queueSyncBusy = false;
let queueSyncLastAttemptAt = null;
let queueSyncLastError = null;
let queueSyncFlashTimer = null;
let crewPermissions = null;
let activeTab = 'directory';
let profileEditUid = null;
let selectedRows = new Set();
let currentPage = 1;
const PAGE_SIZE = 10;
let activeLinkCode = null;
let activeLinkCodeExpiresAt = null;
let activeLinkCodePilotUid = null;

const CREW_PROFILE_SESSION_KEY = 'vs-selected-crew-profile';
const CREW_TAB_STORAGE_KEY = 'vs-crew-active-tab';

const crewListState = {
  searchText: '',
  compliance: 'ALL',
  role: 'ALL',
  status: 'ALL',
  sortField: 'name',
  sortDirection: 'asc'
};

const DOC_TEMPLATE_PRESETS = {
  MEDICAL_CLASS1: {
    documentName: 'Class 1 Medical',
    documentCategory: 'MEDICAL',
    reminderLeadTimeDays: 30,
    issuingAuthorityOrBody: 'DGCA'
  },
  LICENCE_CPL: {
    documentName: 'Commercial Pilot License (CPL)',
    documentCategory: 'LICENCE',
    reminderLeadTimeDays: 60,
    issuingAuthorityOrBody: 'DGCA'
  },
  RTR: {
    documentName: 'RTR License',
    documentCategory: 'RTR',
    reminderLeadTimeDays: 45,
    issuingAuthorityOrBody: 'WPC'
  },
  PASSPORT: {
    documentName: 'Passport',
    documentCategory: 'PASSPORT',
    reminderLeadTimeDays: 120,
    issuingAuthorityOrBody: 'Government Authority'
  },
  VISA: {
    documentName: 'Visa',
    documentCategory: 'VISA',
    reminderLeadTimeDays: 90,
    issuingAuthorityOrBody: 'Immigration Authority'
  },
  PPC: {
    documentName: 'Pilot Proficiency Check (PPC)',
    documentCategory: 'TRAINING',
    reminderLeadTimeDays: 30,
    issuingAuthorityOrBody: 'Approved Training Organization'
  },
  OPC: {
    documentName: 'Operator Proficiency Check (OPC)',
    documentCategory: 'TRAINING',
    reminderLeadTimeDays: 30,
    issuingAuthorityOrBody: 'Operator Training Department'
  },
  CRM: {
    documentName: 'Crew Resource Management (CRM)',
    documentCategory: 'TRAINING',
    reminderLeadTimeDays: 30,
    issuingAuthorityOrBody: 'Training Department'
  },
  DG: {
    documentName: 'Dangerous Goods (DG) Training',
    documentCategory: 'TRAINING',
    reminderLeadTimeDays: 45,
    issuingAuthorityOrBody: 'Training Department'
  },
  LINE_CHECK: {
    documentName: 'Line Check',
    documentCategory: 'TRAINING',
    reminderLeadTimeDays: 30,
    issuingAuthorityOrBody: 'Flight Operations'
  }
};

function query(selector) {
  return activeView?.querySelector(selector);
}

function queryAll(selector) {
  return activeView ? Array.from(activeView.querySelectorAll(selector)) : [];
}

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

function formatShortDate(value) {
  const date = toDateValue(value);
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(value) {
  const date = toDateValue(value);
  if (!date) return null;
  return Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatExpiry(value) {
  const date = toDateValue(value);
  if (!date) return 'No expiry';
  const days = daysUntil(value);
  let rel = '';
  if (days === null) rel = '';
  else if (days < 0) rel = `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  else if (days === 0) rel = 'expires today';
  else rel = `in ${days} day${days === 1 ? '' : 's'}`;
  return { date: formatShortDate(value), days, rel };
}

function toTimestampCandidate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function generateId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeRole(role) {
  return `${role || 'PILOT'}`.toUpperCase();
}

function isPilotRole() {
  return activeRole === 'PILOT';
}

function normalizeSearchText(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function complianceRank(status) {
  if (status === 'Expired') return 3;
  if (status === 'Expiring') return 2;
  return 1;
}

function getPilotRoleLabel(pilot) {
  return normalizeRole(pilot?.role || 'PILOT');
}

function getPilotSearchText(pilot, docs) {
  const licenseNumber = getLicenseNumber(docs);
  return [
    toProfileName(pilot),
    pilot?.email || '',
    licenseNumber,
    pilot?.employeeId || '',
    pilot?.designation || '',
    getPilotRoleLabel(pilot)
  ].join(' ').toLowerCase();
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return `${left}`.localeCompare(`${right}`);
}

function getSortedAndFilteredPilots() {
  const normalizedSearch = normalizeSearchText(crewListState.searchText);

  const filtered = pilotsCache.filter((pilot) => {
    const docs = docsByPilotCache.get(pilot.uid) || [];
    const compliance = getCompliance(docs);
    const pilotRole = getPilotRoleLabel(pilot);
    const pilotStatus = `${pilot.status || 'Active'}`;

    const matchesSearch = !normalizedSearch || getPilotSearchText(pilot, docs).includes(normalizedSearch);
    const matchesCompliance = crewListState.compliance === 'ALL' || compliance.toUpperCase() === crewListState.compliance;
    const matchesRole = crewListState.role === 'ALL' || pilotRole === crewListState.role;
    const matchesStatus = crewListState.status === 'ALL' || pilotStatus === crewListState.status;

    return matchesSearch && matchesCompliance && matchesRole && matchesStatus;
  });

  const sorted = filtered.slice().sort((leftPilot, rightPilot) => {
    const leftDocs = docsByPilotCache.get(leftPilot.uid) || [];
    const rightDocs = docsByPilotCache.get(rightPilot.uid) || [];

    let comparison = 0;
    if (crewListState.sortField === 'compliance') {
      comparison = complianceRank(getCompliance(leftDocs)) - complianceRank(getCompliance(rightDocs));
    } else if (crewListState.sortField === 'documents') {
      comparison = leftDocs.length - rightDocs.length;
    } else if (crewListState.sortField === 'medicalExpiry') {
      const leftDate = toDateValue(getMedicalExpiry(leftDocs))?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightDate = toDateValue(getMedicalExpiry(rightDocs))?.getTime() ?? Number.MAX_SAFE_INTEGER;
      comparison = leftDate - rightDate;
    } else if (crewListState.sortField === 'licenceExpiry') {
      const leftDate = toDateValue(getLicenceExpiry(leftDocs))?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightDate = toDateValue(getLicenceExpiry(rightDocs))?.getTime() ?? Number.MAX_SAFE_INTEGER;
      comparison = leftDate - rightDate;
    } else {
      comparison = compareValues(toProfileName(leftPilot).toLowerCase(), toProfileName(rightPilot).toLowerCase());
    }

    return crewListState.sortDirection === 'desc' ? comparison * -1 : comparison;
  });

  return sorted;
}

function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toProfileName(profile) {
  return profile?.fullName || profile?.name || profile?.email || profile?.uid || 'Unknown';
}

function setStatus(message) {
  const status = query('#cm-status');
  if (status) status.textContent = message;
}

function showToast(message, tone = 'success') {
  const toast = query('#cm-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden', 'is-success', 'is-error', 'is-warning');
  toast.classList.add(tone === 'error' ? 'is-error' : tone === 'warning' ? 'is-warning' : 'is-success');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function getCompliance(docs) {
  const compliance = summarizeCrewDocumentCompliance(docs || []);
  if (compliance.expired > 0) return 'Expired';
  if (compliance.expiring > 0) return 'Expiring';
  return 'Valid';
}

function findPrimaryDoc(docs, matcher) {
  return (docs || []).find((doc) => matcher(doc)) || null;
}

function getLicenseNumber(docs) {
  const licenseDoc = findPrimaryDoc(
    docs,
    (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'LICENCE' || `${doc.documentName || ''}`.toLowerCase().includes('license')
  );
  return licenseDoc?.licenseOrCertificateNumber || 'N/A';
}

function getMedicalExpiry(docs) {
  const medicalDoc = findPrimaryDoc(
    docs,
    (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'MEDICAL' || `${doc.documentName || ''}`.toLowerCase().includes('medical')
  );
  return medicalDoc?.expiryDate || null;
}

function getLicenceExpiry(docs) {
  const licenseDoc = findPrimaryDoc(
    docs,
    (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'LICENCE' || `${doc.documentName || ''}`.toLowerCase().includes('license')
  );
  return licenseDoc?.expiryDate || null;
}

function getCompliancePercent(docs) {
  const list = docs || [];
  if (!list.length) return 0;
  const valid = list.filter((doc) => getDocumentComplianceState(doc) === 'Valid').length;
  return Math.round((valid / list.length) * 100);
}

function getStatusBadgeHtml(status) {
  if (status === 'Expired') return '<span class="cm-badge cm-badge-red">Expired</span>';
  if (status === 'Expiring') return '<span class="cm-badge cm-badge-amber">Expiring</span>';
  return '<span class="cm-badge cm-badge-green">Valid</span>';
}

function getProfileStatusBadgeHtml(status) {
  const current = `${status || 'Active'}`;
  if (current === 'Active') return '<span class="cm-badge cm-badge-green">Active</span>';
  if (current === 'Inactive') return '<span class="cm-badge cm-badge-muted">Inactive</span>';
  if (current === 'Suspended') return '<span class="cm-badge cm-badge-red">Suspended</span>';
  return '<span class="cm-badge cm-badge-amber">On Leave</span>';
}

const CIRC = (r) => 2 * Math.PI * r;

function renderMiniRing(percent, status) {
  const r = 17;
  const circumference = CIRC(r);
  const offset = circumference * (1 - percent / 100);
  const tone = status === 'Expired' ? 'is-red' : status === 'Expiring' ? 'is-amber' : '';
  return `
    <span class="cm-ring" role="img" aria-label="${percent}% compliance">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle class="cm-ring-track" cx="22" cy="22" r="${r}"></circle>
        <circle class="cm-ring-bar ${tone}" cx="22" cy="22" r="${r}" style="stroke-dasharray: ${circumference.toFixed(2)}; stroke-dashoffset: ${offset.toFixed(2)}"></circle>
      </svg>
      <strong>${percent}%</strong>
    </span>
    <span class="cm-badge ${status === 'Expired' ? 'cm-badge-red' : status === 'Expiring' ? 'cm-badge-amber' : 'cm-badge-green'}">${status}</span>
  `;
}

function getInitials(name) {
  return `${name || 'U'}`
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function renderExpiryCell(value) {
  const parsed = formatExpiry(value);
  const days = parsed.days;
  const toneClass = days !== null && days < 0 ? 'is-danger' : days !== null && days < 30 ? 'is-warn' : '';
  return `
    <span class="cm-expiry">
      <span class="cm-expiry-date">${escapeHtml(parsed.date)}</span>
      ${days !== null && days !== undefined ? `<span class="cm-expiry-in ${toneClass}">${escapeHtml(parsed.rel)}</span>` : ''}
    </span>
  `;
}

/* ================= SYNC QUEUE ================= */

function getLastQueueError(queue) {
  const withErrors = queue
    .filter((item) => item?.lastError)
    .sort((left, right) => {
      const leftTs = toDateValue(left.lastTriedAt || left.createdAt)?.getTime() || 0;
      const rightTs = toDateValue(right.lastTriedAt || right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    });
  return withErrors.length ? withErrors[0].lastError : null;
}

function renderQueueSyncState() {
  if (!activeView) return;
  const queue = getCrewDocumentSyncQueue();
  const pendingCount = queue.length;

  const countLabel = query('#cm-sync-count');
  if (countLabel) {
    countLabel.textContent = `Pending Sync: ${pendingCount}`;
    countLabel.classList.toggle('has-pending', pendingCount > 0);
  }

  const lastSyncLabel = query('#cm-last-sync');
  if (lastSyncLabel) {
    lastSyncLabel.textContent = queueSyncLastAttemptAt
      ? `Last sync: ${formatDateTime(queueSyncLastAttemptAt)}`
      : 'Last sync: —';
  }

  const retryButton = query('#cm-sync-retry');
  if (retryButton) {
    retryButton.disabled = queueSyncBusy || pendingCount === 0;
    const label = query('#cm-sync-retry-label');
    if (label) label.textContent = queueSyncBusy ? 'Syncing...' : 'Retry Sync';
  }

  const errorLabel = query('#cm-sync-error');
  if (errorLabel) {
    const message = queueSyncLastError || getLastQueueError(queue);
    if (!message) {
      errorLabel.textContent = queueSyncLastAttemptAt
        ? `No retry errors. Last sync: ${formatDateTime(queueSyncLastAttemptAt)}.`
        : 'No retry errors yet.';
      errorLabel.classList.remove('has-error');
    } else {
      errorLabel.textContent = `Last retry error: ${message}`;
      errorLabel.classList.add('has-error');
    }
  }
}

function showQueueSyncFlash(message, tone = 'success') {
  if (!activeView) return;
  const flash = query('#cm-sync-flash');
  if (!flash) return;
  if (queueSyncFlashTimer) clearTimeout(queueSyncFlashTimer);
  flash.textContent = message;
  flash.classList.remove('hidden', 'is-success', 'is-warning', 'is-error');
  if (tone === 'error') flash.classList.add('is-error');
  else if (tone === 'warning') flash.classList.add('is-warning');
  else flash.classList.add('is-success');
  queueSyncFlashTimer = setTimeout(() => flash.classList.add('hidden'), 3000);
}

function buildManualSyncStatusMessage(result) {
  const role = isPilotRole() ? 'pilot' : 'operations';
  if (result.remaining === 0 && result.processed > 0) {
    return `Sync complete for ${role} workspace. Synced ${result.processed} queued operation(s).`;
  }
  if (result.remaining === 0) {
    return `No queued updates for ${role} workspace. Everything is already synced.`;
  }
  return `Sync partially complete for ${role} workspace. Processed ${result.processed}; ${result.remaining} still pending.`;
}

async function runQueueSync({ source = 'background', refreshAfter = false } = {}) {
  if (queueSyncBusy) return;
  queueSyncBusy = true;
  queueSyncLastError = null;
  renderQueueSyncState();

  try {
    const result = await processCrewDocumentSyncQueue();
    queueSyncLastAttemptAt = new Date();
    if (result.remaining === 0 && result.processed > 0) showQueueSyncFlash('Synced just now.', 'success');
    if (result.remaining > 0 && source === 'manual') showQueueSyncFlash('Some queued updates still need network retry.', 'warning');
    if (refreshAfter) await refreshCrew();
    if (source === 'manual') {
      setStatus(buildManualSyncStatusMessage(result));
      if (result.remaining === 0) showQueueSyncFlash('Synced just now.', 'success');
    }
  } catch (error) {
    queueSyncLastAttemptAt = new Date();
    queueSyncLastError = error?.message || 'Unknown queue sync error';
    showQueueSyncFlash('Sync failed. Review last retry error.', 'error');
    if (source === 'manual') setStatus(`Queue sync failed: ${queueSyncLastError}`);
  } finally {
    queueSyncBusy = false;
    renderQueueSyncState();
  }
}

/* ================= KPI ================= */

function updateKPIs() {
  if (!activeView) return;
  let valid = 0;
  let expiring = 0;
  let expired = 0;

  pilotsCache.forEach((pilot) => {
    const docs = docsByPilotCache.get(pilot.uid) || [];
    const status = getCompliance(docs);
    if (status === 'Expired') expired += 1;
    else if (status === 'Expiring') expiring += 1;
    else valid += 1;
  });

  const pending = incomingRequestsCache.filter((req) => normalizeRequestStatus(req.status) === 'PENDING').length;

  setText('#cm-kpi-total', `${pilotsCache.length}`);
  setText('#cm-kpi-valid', `${valid}`);
  setText('#cm-kpi-expiring', `${expiring}`);
  setText('#cm-kpi-expired', `${expired}`);
  setText('#cm-kpi-pending', `${pending}`);
  updateNotifDot(pending);
}

function setText(selector, text) {
  const element = query(selector);
  if (element) element.textContent = text;
}

function updateNotifDot(pendingCount) {
  const dot = query('#cm-notif-dot');
  if (!dot) return;
  dot.hidden = pendingCount === 0;
}

/* ================= TABS ================= */

function setActiveTab(tab) {
  activeTab = tab;
  try {
    window.localStorage.setItem(CREW_TAB_STORAGE_KEY, tab);
  } catch (_) {
    /* ignore */
  }

  queryAll('.cm-tab').forEach((tabButton) => {
    const isActive = tabButton.dataset.tab === tab;
    tabButton.classList.toggle('is-active', isActive);
    tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  queryAll('.cm-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `cm-panel-${tab}`);
  });

  positionTabUnderline(tab);
  renderTabContent(tab);
}

function positionTabUnderline(tab) {
  const underline = query('#cm-tab-underline');
  const button = query(`.cm-tab[data-tab="${tab}"]`);
  if (!underline || !button || !activeView) return;
  const nav = query('#cm-tabs');
  const navRect = nav.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  underline.style.left = `${buttonRect.left - navRect.left}px`;
  underline.style.width = `${buttonRect.width}px`;
}

function renderTabContent(tab) {
  if (tab === 'directory') {
    renderCrewTable();
  } else if (tab === 'linking') {
    renderLinkingTab();
  } else if (tab === 'documents') {
    renderDocumentsTab();
  } else if (tab === 'compliance') {
    renderComplianceTab();
  } else if (tab === 'bulk') {
    renderBulkTab();
  }
}

/* ================= DIRECTORY TABLE ================= */

function renderCrewTable() {
  if (!activeView || activeTab !== 'directory') return;

  const body = query('#cm-table-body');
  if (!body) return;

  if (!pilotsCache.length) {
    body.innerHTML = '<tr><td colspan="8" class="cm-empty">No linked pilots found for this operator.</td></tr>';
    updateKPIs();
    updateTableFooter(0, 0);
    return;
  }

  const visiblePilots = getSortedAndFilteredPilots();
  const totalPages = Math.max(1, Math.ceil(visiblePilots.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pagePilots = visiblePilots.slice(startIndex, startIndex + PAGE_SIZE);

  if (!visiblePilots.length) {
    body.innerHTML = '<tr><td colspan="8" class="cm-empty">No crew members match the current filters.</td></tr>';
    updateKPIs();
    updateTableFooter(0, visiblePilots.length);
    setStatus('No matching crew found. Adjust search, filter, or sort settings.');
    return;
  }

  body.innerHTML = pagePilots
    .map((pilot) => {
      const docs = docsByPilotCache.get(pilot.uid) || [];
      const status = getCompliance(docs);
      const percent = getCompliancePercent(docs);
      const licenseNumber = getLicenseNumber(docs);
      const medicalExpiry = getMedicalExpiry(docs);
      const licenceExpiry = getLicenceExpiry(docs);
      const isSelected = selectedPilotUid === pilot.uid;
      const isChecked = selectedRows.has(pilot.uid);

      return `<tr data-pilot-uid="${escapeHtml(pilot.uid)}" class="${isSelected ? 'is-selected' : ''}">
        <td data-label="Select" class="cm-col-check">
          <input type="checkbox" class="cm-row-check" data-check-pilot="${escapeHtml(pilot.uid)}" ${isChecked ? 'checked' : ''} aria-label="Select ${escapeHtml(toProfileName(pilot))}" />
        </td>
        <td data-label="Name">
          <div class="cm-cell-user">
            <span class="cm-avatar">${escapeHtml(getInitials(toProfileName(pilot)))}</span>
            <span>
              <span class="cm-user-name">${escapeHtml(toProfileName(pilot))}</span>
              <span class="cm-user-email">${escapeHtml(pilot.email || 'No email')}</span>
            </span>
          </div>
        </td>
        <td data-label="Role"><span class="cm-badge cm-badge-muted">${escapeHtml(getPilotRoleLabel(pilot))}</span></td>
        <td data-label="Licence Number">${escapeHtml(licenseNumber)}</td>
        <td data-label="Medical Expiry">${renderExpiryCell(medicalExpiry)}</td>
        <td data-label="Licence Expiry">${renderExpiryCell(licenceExpiry)}</td>
        <td data-label="Compliance"><span class="cm-ring-wrap">${renderMiniRing(percent, status)}</span></td>
        <td data-label="Status">${getProfileStatusBadgeHtml(pilot.status)}</td>
      </tr>`;
    })
    .join('');

  updateKPIs();
  updateTableFooter(pagePilots.length, visiblePilots.length);
  setStatus(`Showing ${visiblePilots.length} of ${pilotsCache.length} crew profile(s).`);
}

function updateTableFooter(pageCount, totalVisible) {
  const summary = query('#cm-table-summary');
  if (summary) summary.textContent = `Showing ${pageCount} of ${totalVisible} crew`;
  const prev = query('#cm-prev');
  const next = query('#cm-next');
  const pageInfo = query('#cm-page-info');
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage * PAGE_SIZE >= totalVisible;
  if (pageInfo) pageInfo.textContent = `${currentPage}`;
}

/* ================= DRAWER ================= */

function openDrawer(pilotUid) {
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  selectedPilotUid = pilotUid;
  const docs = docsByPilotCache.get(pilotUid) || [];

  const body = query('#cm-drawer-body');
  const backdrop = query('#cm-drawer-backdrop');
  const drawer = query('#cm-drawer');
  if (!body || !drawer) return;

  const medical = getMedicalExpiry(docs);
  const licence = getLicenceExpiry(docs);
  const percent = getCompliancePercent(docs);
  const status = getCompliance(docs);

  const canEdit = canPerformCrewAction(activeCurrentUser, 'edit');
  const canDelete = canPerformCrewAction(activeCurrentUser, 'delete');
  const pilotStatus = `${pilot.status || 'Active'}`;

  const drawerActions = [
    ...(canEdit
      ? [`<button type="button" class="cm-drawer-action" data-drawer-action="edit" data-pilot-uid="${escapeHtml(pilot.uid)}" title="Edit profile">
          <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          <span>Edit Profile</span>
        </button>`]
      : []),
    `<button type="button" class="cm-drawer-action" data-drawer-action="documents" data-pilot-uid="${escapeHtml(pilot.uid)}" title="View documents">
      <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6"/></svg>
      <span>Documents</span>
    </button>`,
    ...(!isPilotRole()
      ? [`<button type="button" class="cm-drawer-action" data-drawer-action="link-code" data-pilot-uid="${escapeHtml(pilot.uid)}" title="Generate link code">
          <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10 14l4-4M15 9l2-2a2.83 2.83 0 0 1 4 4l-2 2M9 15l-2 2a2.83 2.83 0 0 1-4-4l2-2M7 17l4-4"/></svg>
          <span>Link Code</span>
        </button>`]
      : []),
    ...(canEdit
      ? [`<button type="button" class="cm-drawer-action" data-drawer-action="toggle-status" data-pilot-uid="${escapeHtml(pilot.uid)}" title="${pilotStatus === 'Active' ? 'Set Inactive' : 'Set Active'}">
          <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
          <span>${pilotStatus === 'Active' ? 'Set Inactive' : 'Set Active'}</span>
        </button>`]
      : []),
    ...(!isPilotRole()
      ? [`<button type="button" class="cm-drawer-action" data-drawer-action="delink" data-pilot-uid="${escapeHtml(pilot.uid)}" title="Delink pilot">
          <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 6L6 18M6 6l12 12"/></svg>
          <span>Delink</span>
        </button>`]
      : []),
    ...(canDelete
      ? [`<button type="button" class="cm-drawer-action is-danger" data-drawer-action="soft-delete" data-pilot-uid="${escapeHtml(pilot.uid)}" title="Delete crew member">
          <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          <span>Delete</span>
        </button>`]
      : [])
  ].join('');

  body.innerHTML = `
    <div class="cm-drawer-head">
      <h2>Crew Quick View</h2>
      <button type="button" class="cm-icon-btn" id="cm-drawer-close" aria-label="Close panel">
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
      </button>
    </div>

    <div class="cm-drawer-profile">
      <span class="cm-avatar">${escapeHtml(getInitials(toProfileName(pilot)))}</span>
      <div class="cm-drawer-identity">
        <strong>${escapeHtml(toProfileName(pilot))}</strong>
        <span>${escapeHtml(pilot.email || 'No email')}</span>
        <span style="margin-top:0.3rem">
          <span class="cm-badge cm-badge-muted">${escapeHtml(getPilotRoleLabel(pilot))}</span>
          ${getProfileStatusBadgeHtml(pilot.status)}
        </span>
      </div>
    </div>

    <div class="cm-drawer-summary">
      <div class="cm-drawer-summary-item"><span>Licence</span><strong>${escapeHtml(getLicenseNumber(docs))}</strong></div>
      <div class="cm-drawer-summary-item"><span>Medical</span><strong>${escapeHtml(formatShortDate(medical))}</strong></div>
      <div class="cm-drawer-summary-item"><span>Compliance</span><strong>${percent}%</strong></div>
    </div>

    <div class="cm-drawer-actions">${drawerActions}</div>

    <div class="cm-drawer-section is-open" data-section>
      <button type="button" class="cm-drawer-section-head" aria-expanded="true">Personal Details
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="cm-drawer-section-body">
        <dl class="cm-drawer-kv">
          <div class="kv-row"><dt>Employee ID</dt><dd>${escapeHtml(pilot.employeeId || pilot.designation || '—')}</dd></div>
          <div class="kv-row"><dt>Phone</dt><dd>${escapeHtml(pilot.mobile || pilot.companyPhone || '—')}</dd></div>
          <div class="kv-row"><dt>Base</dt><dd>${escapeHtml(pilot.organizationBase || pilot.base || '—')}</dd></div>
          <div class="kv-row"><dt>Operator</dt><dd>${escapeHtml(pilot.operatorId || '—')}</dd></div>
          <div class="kv-row"><dt>Link State</dt><dd>${escapeHtml(pilot.linkState || '—')}</dd></div>
          <div class="kv-row"><dt>Status</dt><dd>${escapeHtml(pilot.status || 'Active')}</dd></div>
        </dl>
      </div>
    </div>

    <div class="cm-drawer-section" data-section>
      <button type="button" class="cm-drawer-section-head" aria-expanded="false">Licence Information
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="cm-drawer-section-body">
        <dl class="cm-drawer-kv">
          <div class="kv-row"><dt>Licence #</dt><dd>${escapeHtml(getLicenseNumber(docs))}</dd></div>
          <div class="kv-row"><dt>Expiry</dt><dd>${escapeHtml(formatShortDate(licence))}</dd></div>
          <div class="kv-row"><dt>Days left</dt><dd>${daysUntil(licence) === null ? '—' : `${daysUntil(licence)} days`}</dd></div>
        </dl>
      </div>
    </div>

    <div class="cm-drawer-section" data-section>
      <button type="button" class="cm-drawer-section-head" aria-expanded="false">Medical Information
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="cm-drawer-section-body">
        <dl class="cm-drawer-kv">
          <div class="kv-row"><dt>Medical expiry</dt><dd>${escapeHtml(formatShortDate(medical))}</dd></div>
          <div class="kv-row"><dt>Days left</dt><dd>${daysUntil(medical) === null ? '—' : `${daysUntil(medical)} days`}</dd></div>
        </dl>
      </div>
    </div>

    <div class="cm-drawer-section" data-section>
      <button type="button" class="cm-drawer-section-head" aria-expanded="false">Documents (${docs.length})
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="cm-drawer-section-body">
        ${docs.length
          ? `<dl class="cm-drawer-kv">${docs.slice(0, 8).map((doc) => `
              <div class="kv-row"><dt>${escapeHtml(doc.documentName || 'Untitled')}</dt><dd>${getStatusBadgeHtml(getDocumentComplianceState(doc))}</dd></div>
            `).join('')}</dl>
            ${docs.length > 8 ? `<p class="cm-form-status">+${docs.length - 8} more in Documents tab</p>` : ''}`
          : '<p class="cm-form-status">No documents yet.</p>'}
      </div>
    </div>

    <div class="cm-drawer-section" data-section>
      <button type="button" class="cm-drawer-section-head" aria-expanded="false">Compliance History
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="cm-drawer-section-body">
        <dl class="cm-drawer-kv">
          <div class="kv-row"><dt>Overall status</dt><dd>${getStatusBadgeHtml(status)}</dd></div>
          <div class="kv-row"><dt>Compliance %</dt><dd>${percent}%</dd></div>
          ${docs.slice(0, 6).map((doc) => {
            const edited = doc.lastEditedBy || '—';
            const modified = doc.lastModified ? formatDate(doc.lastModified) : '—';
            return `<div class="kv-row"><dt>${escapeHtml(doc.documentName || 'Untitled')}</dt><dd>${escapeHtml(modified)} · ${escapeHtml(edited)}</dd></div>`;
          }).join('')}
        </dl>
      </div>
    </div>

    <div class="cm-drawer-section" data-section>
      <button type="button" class="cm-drawer-section-head" aria-expanded="false">Notes
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="cm-drawer-section-body">
        <p class="cm-form-status" style="margin:0">${escapeHtml(pilot.notes || pilot.notesOrDetails || 'No notes added for this crew member.')}</p>
      </div>
    </div>
  `;

  backdrop.classList.remove('hidden');
  drawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    drawer.classList.add('is-open');
  });

  requestAnimationFrame(() => query('#cm-drawer-close')?.focus());

  query('#cm-drawer-close')?.addEventListener('click', closeDrawer);
  queryAll('[data-section]').forEach((section) => {
    section.querySelector('.cm-drawer-section-head')?.addEventListener('click', () => {
      const willOpen = !section.classList.contains('is-open');
      section.classList.toggle('is-open', willOpen);
      section.querySelector('.cm-drawer-section-head')?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  });

  queryAll('.cm-drawer-action').forEach((actionButton) => {
    actionButton.addEventListener('click', () => {
      const action = actionButton.getAttribute('data-drawer-action');
      const targetUid = actionButton.getAttribute('data-pilot-uid') || pilotUid;
      closeDrawer();
      if (action === 'edit') {
        openProfileForm(targetUid);
      } else if (action === 'documents') {
        selectedPilotUid = targetUid;
        const docSelect = query('#cm-doc-pilot');
        if (docSelect) docSelect.value = targetUid;
        setActiveTab('documents');
      } else if (action === 'link-code') {
        issueCrewLinkCode(targetUid);
      } else if (action === 'toggle-status') {
        togglePilotStatus(targetUid);
      } else if (action === 'delink') {
        handleDelink(targetUid);
      } else if (action === 'soft-delete') {
        softRemovePilot(targetUid);
      }
    });
  });

  renderCrewTable();
}

function closeDrawer() {
  const backdrop = query('#cm-drawer-backdrop');
  const drawer = query('#cm-drawer');
  if (!backdrop || !drawer) return;
  backdrop.classList.remove('is-open');
  drawer.classList.remove('is-open');
  setTimeout(() => {
    backdrop.classList.add('hidden');
    drawer.classList.add('hidden');
  }, 200);
}

/* ================= MODAL ================= */

function openModal(contentHtml, { title = '', subtitle = '' } = {}) {
  const backdrop = query('#cm-modal-backdrop');
  const content = query('#cm-modal-content');
  if (!backdrop || !content) return;
  content.innerHTML = `
    ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    ${contentHtml}
  `;
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => query('#cm-modal-close')?.focus());
}

function closeModal() {
  const backdrop = query('#cm-modal-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
}

function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  openModal(`
    <p>${escapeHtml(message)}</p>
    <div class="cm-modal-actions">
      <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-modal-cancel">Cancel</button>
      <button type="button" class="cm-btn ${danger ? 'cm-btn-danger' : 'cm-btn-primary'} cm-btn-md" id="cm-modal-confirm">${escapeHtml(confirmLabel)}</button>
    </div>
  `, { title });
  query('#cm-modal-cancel')?.addEventListener('click', closeModal);
  query('#cm-modal-confirm')?.addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

/* ================= CREW PROFILE FORM ================= */

function openProfileForm(pilotUid) {
  setActiveTab('profile');
  profileEditUid = pilotUid || null;

  const heading = query('#cm-profile-heading');
  const sub = query('#cm-profile-sub');
  const mode = query('#cm-profile-mode');
  const saveLabel = query('#cm-profile-save-label');
  const form = query('#cm-profile-form');

  if (pilotUid) {
    const pilot = pilotsCache.find((item) => item.uid === pilotUid);
    const docs = docsByPilotCache.get(pilotUid) || [];
    if (pilot) {
      if (heading) heading.textContent = 'Edit Crew Profile';
      if (sub) sub.textContent = 'Update this crew member\'s operator-level record.';
      if (mode) mode.textContent = 'EDIT';
      if (saveLabel) saveLabel.textContent = 'Save Changes';
      setFormField('#cm-field-name', pilot.fullName || pilot.name || '');
      setFormField('#cm-field-email', pilot.email || '');
      setFormField('#cm-field-phone', pilot.mobile || pilot.companyPhone || '');
      setFormField('#cm-field-employeeId', pilot.employeeId || '');
      setFormValue('#cm-field-role', normalizeRole(pilot.role || 'PILOT'));
      setFormField('#cm-field-license', getLicenseNumber(docs) === 'N/A' ? '' : getLicenseNumber(docs));
      setFormField('#cm-field-medicalExpiry', toInputDate(getMedicalExpiry(docs)));
      setFormField('#cm-field-licenseExpiry', toInputDate(getLicenceExpiry(docs)));
      setFormField('#cm-field-operator', activeOperatorUid || '');
      setFormValue('#cm-field-status', pilot.status || 'Active');
    }
  } else {
    if (heading) heading.textContent = 'Create Crew Profile';
    if (sub) sub.textContent = 'Add a new crew member or update their operator-level record.';
    if (mode) mode.textContent = 'NEW';
    if (saveLabel) saveLabel.textContent = 'Create Crew';
    form?.reset();
    setFormField('#cm-field-operator', activeOperatorUid || '');
  }

  clearFormErrors();
  if (form) form.dataset.mode = pilotUid ? 'edit' : 'create';
}

function setFormField(selector, value) {
  const input = query(selector);
  if (input) input.value = value ?? '';
}

function setFormValue(selector, value) {
  const input = query(selector);
  if (input) input.value = value ?? '';
}

function toInputDate(value) {
  const date = toDateValue(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function clearFormErrors() {
  queryAll('.cm-error').forEach((el) => (el.textContent = ''));
  const status = query('#cm-profile-status');
  if (status) {
    status.textContent = '';
    status.classList.remove('is-success', 'is-error');
  }
}

function setFieldError(fieldName, message) {
  const error = query(`#cm-error-${fieldName}`);
  if (error) error.textContent = message;
}

async function saveProfileForm() {
  if (!canPerformCrewAction(activeCurrentUser, 'edit')) {
    showToast('You do not have permission to edit crew records.', 'error');
    return;
  }

  clearFormErrors();
  const form = query('#cm-profile-form');
  if (!form) return;

  const name = form.name?.value?.trim();
  const email = form.email?.value?.trim().toLowerCase();
  const phone = form.phone?.value?.trim();
  const employeeId = form.employeeId?.value?.trim();
  const role = form.role?.value?.trim();
  const license = form.license?.value?.trim();
  const medicalExpiryDate = toTimestampCandidate(form.medicalExpiry?.value || null);
  const licenseExpiryDate = toTimestampCandidate(form.licenseExpiry?.value || null);
  const statusValue = form.status?.value?.trim() || 'Active';

  let hasError = false;
  if (!name) {
    setFieldError('name', 'Name is required.');
    hasError = true;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError('email', 'A valid email is required.');
    hasError = true;
  }
  if (form.dataset.mode === 'create' && !license) {
    setFieldError('license', 'Licence number is required for a new crew member.');
    hasError = true;
  }
  if (hasError) {
    setStatus('Please fix the highlighted fields.');
    return;
  }

  const submit = query('#cm-profile-save');
  const spinner = submit?.querySelector('.cm-btn-spinner');
  const label = query('#cm-profile-save-label');
  const statusEl = query('#cm-profile-status');

  try {
    if (submit) submit.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (label) label.textContent = 'Saving...';

    const profileUpdates = {
      fullName: name,
      name,
      email,
      mobile: phone || null,
      employeeId: employeeId || null,
      role: normalizeRole(role || 'PILOT'),
      status: statusValue
    };

    if (profileEditUid) {
      await updatePilotProfile(profileEditUid, profileUpdates);

      const docs = docsByPilotCache.get(profileEditUid) || [];
      const licenceDoc = findPrimaryDoc(
        docs,
        (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'LICENCE' || `${doc.documentName || ''}`.toLowerCase().includes('license')
      );
      const medicalDoc = findPrimaryDoc(
        docs,
        (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'MEDICAL' || `${doc.documentName || ''}`.toLowerCase().includes('medical')
      );

      const pendingUpdates = [];
      if (licenceDoc) {
        const next = {
          licenseOrCertificateNumber: license ? license : licenceDoc.licenseOrCertificateNumber || null,
          ...(licenseExpiryDate ? { expiryDate: licenseExpiryDate } : {})
        };
        await updatePilotDocumentWithAudit(licenceDoc.firestoreId, next, activeCurrentUser?.uid || null);
        pendingUpdates.push(licenceDoc.firestoreId);
      }
      if (medicalDoc && medicalExpiryDate) {
        await updatePilotDocumentWithAudit(medicalDoc.firestoreId, { expiryDate: medicalExpiryDate }, activeCurrentUser?.uid || null);
        pendingUpdates.push(medicalDoc.firestoreId);
      }

      await refreshCrew();
      if (statusEl) {
        statusEl.textContent = `Profile updated for ${name}.`;
        statusEl.classList.add('is-success');
      }
      showToast('Crew profile updated.', 'success');
    } else {
      if (!activeOperatorUid) throw new Error('Operator context missing.');
      await createPilot({
        name,
        email,
        licenseNum: license,
        medicalExpiryDate,
        licenseExpiryDate,
        operatorUid: activeOperatorUid
      });
      await refreshCrew();
      if (statusEl) {
        statusEl.textContent = `Crew profile created for ${name}.`;
        statusEl.classList.add('is-success');
      }
      showToast('Crew profile created.', 'success');
      form.reset();
      setFormField('#cm-field-operator', activeOperatorUid || '');
      setActiveTab('directory');
    }
  } catch (error) {
    console.error('Save crew profile failed:', error);
    if (statusEl) {
      statusEl.textContent = error.message || 'Unable to save crew profile.';
      statusEl.classList.add('is-error');
    }
    showToast(error.message || 'Unable to save crew profile.', 'error');
  } finally {
    if (submit) submit.disabled = false;
    if (spinner) spinner.classList.add('hidden');
    if (label) label.textContent = profileEditUid ? 'Save Changes' : 'Create Crew';
  }
}

/* ================= CREW ACTIONS ================= */

async function togglePilotStatus(pilotUid) {
  if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  const current = `${pilot.status || 'Active'}`;
  const next = current === 'Active' ? 'Inactive' : 'Active';
  await updatePilotProfile(pilotUid, { status: next });
  setStatus(`Status updated to ${next} for ${toProfileName(pilot)}.`);
  showToast(`Status updated to ${next}.`, 'success');
  await refreshCrew();
}

async function softRemovePilot(pilotUid) {
  if (!canPerformCrewAction(activeCurrentUser, 'delete')) return;
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  confirmModal({
    title: 'Delete crew member',
    message: `Soft remove "${toProfileName(pilot)}" from your roster? This sets status=Deleted and unlinks them from the operator.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      await updatePilotProfile(pilotUid, { status: 'Deleted' });
      await delinkPilot(pilotUid);
      selectedRows.delete(pilotUid);
      setStatus(`Soft removed ${toProfileName(pilot)} from operator roster.`);
      showToast('Crew member removed.', 'success');
      await refreshCrew();
    }
  });
}

async function handleDelink(pilotUid) {
  if (isPilotRole()) return;
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  confirmModal({
    title: 'Delink pilot',
    message: `Delink "${toProfileName(pilot)}" from your organization? Their profile and documents remain.`,
    confirmLabel: 'Delink',
    danger: true,
    onConfirm: async () => {
      await delinkPilot(pilotUid);
      selectedRows.delete(pilotUid);
      setStatus(`Pilot ${pilotUid} delinked.`);
      showToast('Pilot delinked.', 'success');
      await refreshCrew();
    }
  });
}

async function issueCrewLinkCode(pilotUid) {
  if (!activeOperatorUid) return;
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  try {
    const result = await generateCrewProfileLinkCode({
      crewProfileId: pilotUid,
      operatorId: activeOperatorUid
    });
    const expiry = toDateValue(result.expiresAt);
    const expiryText = expiry ? expiry.toLocaleTimeString() : 'in 5 minutes';
    setStatus(`Link ready for ${toProfileName(pilot)} | Profile ID: ${pilotUid} | Code: ${result.code} | Expires: ${expiryText}`);
    showToast(`Link code generated for ${toProfileName(pilot)}.`);

    setActiveTab('linking');
    setLinkSelectValue(pilotUid);
    setActiveLinkCode(result.code, result.expiresAt, pilotUid);
  } catch (error) {
    console.error('Generate link code failed:', error);
    setStatus(error.message || 'Unable to generate link code.');
    showToast(error.message || 'Unable to generate link code.', 'error');
  }
}

/* ================= PILOT LINKING ================= */

function setLinkSelectValue(pilotUid) {
  const select = query('#cm-link-pilot');
  if (!select) return;
  select.value = pilotUid || '';
}

function setActiveLinkCode(code, expiresAt, pilotUid) {
  activeLinkCode = code;
  activeLinkCodeExpiresAt = expiresAt ? toDateValue(expiresAt) : new Date(Date.now() + 5 * 60 * 1000);
  activeLinkCodePilotUid = pilotUid;
  renderLinkCode();
  startLinkCodeTimer();
}

function startLinkCodeTimer() {
  if (linkCodeTimer) clearInterval(linkCodeTimer);
  linkCodeTimer = setInterval(renderLinkCode, 1000);
}

function stopLinkCodeTimer() {
  if (linkCodeTimer) {
    clearInterval(linkCodeTimer);
    linkCodeTimer = null;
  }
}

function renderLinkCode() {
  if (activeTab !== 'linking') return;
  const codeEl = query('#cm-link-code');
  const timerEl = query('#cm-link-timer');
  const dotEl = query('#cm-link-timer-dot');
  if (!codeEl || !timerEl) return;

  if (!activeLinkCode || !activeLinkCodeExpiresAt) {
    codeEl.textContent = '—';
    timerEl.textContent = 'No active code';
    if (dotEl) dotEl.classList.remove('is-live', 'is-ending');
    return;
  }

  const remainingMs = activeLinkCodeExpiresAt.getTime() - Date.now();
  codeEl.textContent = activeLinkCode;

  if (remainingMs <= 0) {
    timerEl.textContent = 'Code expired. Generate a new one.';
    if (dotEl) {
      dotEl.classList.remove('is-live');
      dotEl.classList.add('is-ending');
    }
    stopLinkCodeTimer();
    return;
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  timerEl.textContent = `Expires in ${minutes}m ${String(seconds).padStart(2, '0')}s`;
  if (dotEl) {
    dotEl.classList.add('is-live');
    dotEl.classList.toggle('is-ending', remainingMs < 30000);
  }
}

function renderLinkPilotSelect() {
  const select = query('#cm-link-pilot');
  if (!select) return;
  select.innerHTML = pilotsCache
    .filter((pilot) => `${pilot.status || 'Active'}` !== 'Deleted')
    .map((pilot) => `<option value="${escapeHtml(pilot.uid)}">${escapeHtml(toProfileName(pilot))} (${escapeHtml(getPilotRoleLabel(pilot))})</option>`)
    .join('');
  if (activeLinkCodePilotUid) select.value = activeLinkCodePilotUid;
}

function renderLinkingTab() {
  renderLinkPilotSelect();
  renderLinkCode();
  renderOutgoingRequests();
  renderLinkedPilots();
  renderIncomingRequests();
}

function normalizeRequestStatus(status) {
  const normalized = `${status || ''}`.trim().toUpperCase();
  if (normalized === 'REJECTED') return 'DECLINED';
  return normalized || 'PENDING';
}

function getRequestStatusBadge(status) {
  const normalized = normalizeRequestStatus(status);
  if (normalized === 'ACCEPTED') return '<span class="cm-badge cm-badge-green">Accepted</span>';
  if (normalized === 'DECLINED') return '<span class="cm-badge cm-badge-red">Declined</span>';
  return '<span class="cm-badge cm-badge-amber">Pending</span>';
}

function renderOutgoingRequests() {
  const body = query('#cm-link-table-body');
  if (!body) return;

  if (!outgoingRequestsCache.length) {
    body.innerHTML = '<tr><td colspan="6" class="cm-empty">No outgoing requests.</td></tr>';
    return;
  }

  body.innerHTML = outgoingRequestsCache
    .slice()
    .sort((left, right) => {
      const leftTs = toDateValue(left.createdAt)?.getTime() || 0;
      const rightTs = toDateValue(right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    })
    .map((request) => {
      const status = normalizeRequestStatus(request.status);
      const created = formatShortDate(request.createdAt);
      const acceptedAt = request.acceptedAt ? formatShortDate(request.acceptedAt) : '—';
      const expiredAt = request.expiredAt ? formatShortDate(request.expiredAt) : '—';

      const actionButtons = [];
      if (status === 'PENDING') {
        actionButtons.push(
          `<button type="button" class="cm-action-btn" data-link-action="resend" data-request-id="${escapeHtml(request.requestId)}" data-tip="Resend" aria-label="Resend request">
            <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          </button>`,
          `<button type="button" class="cm-action-btn is-danger" data-link-action="cancel" data-request-id="${escapeHtml(request.requestId)}" data-tip="Cancel" aria-label="Cancel request">
            <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>`
        );
      }

      return `<tr>
        <td data-label="Pilot">${escapeHtml(request.recipientEmail || request.recipientId || 'Unknown')}</td>
        <td data-label="Status">${getRequestStatusBadge(status)}</td>
        <td data-label="Created">${escapeHtml(created)}</td>
        <td data-label="Accepted">${escapeHtml(acceptedAt)}</td>
        <td data-label="Expired">${escapeHtml(expiredAt)}</td>
        <td data-label="Actions" class="cm-col-actions"><span class="cm-action-row">${actionButtons.join('')}</span></td>
      </tr>`;
    })
    .join('');
}

function renderLinkedPilots() {
  const body = query('#cm-linked-table-body');
  if (!body) return;

  const search = normalizeSearchText(query('#cm-linked-search')?.value);
  const linked = pilotsCache.filter((pilot) => {
    const isLinked = pilot.linkState === 'LINKED' || pilot.pilotUid === pilot.uid || pilot.status === 'Active';
    const matches = !search || toProfileName(pilot).toLowerCase().includes(search) || `${pilot.email || ''}`.toLowerCase().includes(search);
    return isLinked && matches;
  });

  if (!linked.length) {
    body.innerHTML = '<tr><td colspan="4" class="cm-empty">No linked pilots.</td></tr>';
    return;
  }

  body.innerHTML = linked
    .map((pilot) => `<tr>
      <td data-label="Pilot">
        <div class="cm-cell-user">
          <span class="cm-avatar">${escapeHtml(getInitials(toProfileName(pilot)))}</span>
          <span class="cm-user-name">${escapeHtml(toProfileName(pilot))}</span>
        </div>
      </td>
      <td data-label="Email">${escapeHtml(pilot.email || '—')}</td>
      <td data-label="Link State">${escapeHtml(pilot.linkState || 'LINKED')}</td>
      <td data-label="Actions" class="cm-col-actions">
        <span class="cm-action-row">
          <button type="button" class="cm-action-btn" data-linked-action="view" data-pilot-uid="${escapeHtml(pilot.uid)}" data-tip="View" aria-label="View pilot">
            <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
          </button>
          <button type="button" class="cm-action-btn is-danger" data-linked-action="delink" data-pilot-uid="${escapeHtml(pilot.uid)}" data-tip="Delink" aria-label="Delink pilot">
            <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </span>
      </td>
    </tr>`)
    .join('');
}

function renderIncomingRequests() {
  const body = query('#cm-incoming-table-body');
  const card = query('#cm-incoming-card');
  if (!body || !card) return;

  if (!incomingRequestsCache.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  body.innerHTML = incomingRequestsCache
    .slice()
    .sort((left, right) => {
      const leftTs = toDateValue(left.createdAt)?.getTime() || 0;
      const rightTs = toDateValue(right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    })
    .map((request) => {
      const status = normalizeRequestStatus(request.status);
      const canRespond = status === 'PENDING';
      const canAccept = canRespond && !!request.requesterId;
      return `<tr>
        <td data-label="Operator">${escapeHtml(request.requesterName || request.requesterId || 'Unknown')}</td>
        <td data-label="Email">${escapeHtml(request.requesterEmail || 'N/A')}</td>
        <td data-label="Status">${getRequestStatusBadge(status)}</td>
        <td data-label="Created">${escapeHtml(formatShortDate(request.createdAt))}</td>
        <td data-label="Actions" class="cm-col-actions">
          <span class="cm-action-row">
            ${canAccept ? `<button type="button" class="cm-action-btn" data-incoming-action="accept" data-request-id="${escapeHtml(request.requestId)}" data-operator-uid="${escapeHtml(request.requesterId)}" data-tip="Accept" aria-label="Accept request">
              <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M20 6L9 17l-5-5"/></svg>
            </button>` : ''}
            ${canRespond ? `<button type="button" class="cm-action-btn is-danger" data-incoming-action="decline" data-request-id="${escapeHtml(request.requestId)}" data-tip="Decline" aria-label="Decline request">
              <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
            </button>` : ''}
          </span>
        </td>
      </tr>`;
    })
    .join('');
}

async function sendPilotLinkRequest(form) {
  if (!(form instanceof HTMLFormElement)) return;
  if (!activeOperatorUid) return;

  const pilotEmail = form.pilotEmail?.value?.trim().toLowerCase();
  const errorEl = query('#cm-error-link-email');
  const statusEl = query('#cm-link-send-status');
  const submit = query('#cm-link-send');

  if (!pilotEmail) {
    if (errorEl) errorEl.textContent = 'Pilot email is required.';
    return;
  }
  if (errorEl) errorEl.textContent = '';
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.classList.remove('is-success', 'is-error');
  }

  try {
    if (submit) {
      submit.disabled = true;
      const spinner = submit.querySelector('.cm-btn-spinner');
      if (spinner) spinner.classList.remove('hidden');
    }
    if (statusEl) statusEl.textContent = 'Sending connection request...';

    await requestPilotLinkByEmail({
      requesterId: activeOperatorUid,
      requesterName: toProfileName(activeCurrentUser),
      requesterEmail: activeCurrentUser?.email || '',
      pilotEmail
    });

    form.reset();
    if (statusEl) {
      statusEl.textContent = `Connection request sent to ${pilotEmail}.`;
      statusEl.classList.add('is-success');
    }
    showToast('Connection request sent.', 'success');
    await refreshCrew();
  } catch (error) {
    console.error('Pilot link request failed:', error);
    if (statusEl) {
      statusEl.textContent = error.message || 'Unable to send connection request.';
      statusEl.classList.add('is-error');
    }
    showToast(error.message || 'Unable to send connection request.', 'error');
  } finally {
    if (submit) {
      submit.disabled = false;
      const spinner = submit.querySelector('.cm-btn-spinner');
      if (spinner) spinner.classList.add('hidden');
    }
  }
}

/* ================= DOCUMENTS ================= */

let docListState = {
  searchText: '',
  category: 'ALL',
  status: 'ALL'
};

function renderDocPilotSelect() {
  const select = query('#cm-doc-pilot');
  if (!select) return;
  select.innerHTML = pilotsCache
    .filter((pilot) => `${pilot.status || 'Active'}` !== 'Deleted')
    .map((pilot) => `<option value="${escapeHtml(pilot.uid)}">${escapeHtml(toProfileName(pilot))}</option>`)
    .join('');
  if (selectedPilotUid) select.value = selectedPilotUid;
}

function renderDocumentsTab() {
  if (!selectedPilotUid && pilotsCache.length && !isPilotRole()) {
    const first = pilotsCache.find((pilot) => `${pilot.status || 'Active'}` !== 'Deleted');
    if (first) selectedPilotUid = first.uid;
  }
  renderDocPilotSelect();
  const caption = query('#cm-doc-caption');
  if (caption) caption.textContent = 'Documents';
  renderPilotDocuments();
}

function getFilteredDocs() {
  const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
  const docs = docsByPilotCache.get(pilotUid) || [];
  const normalizedSearch = normalizeSearchText(docListState.searchText);

  return docs.filter((doc) => {
    const category = `${doc.documentCategory || 'GENERAL'}`.toUpperCase();
    const status = getDocumentComplianceState(doc);
    const matchesSearch = !normalizedSearch || `${doc.documentName || ''} ${doc.licenseOrCertificateNumber || ''} ${doc.issuingAuthorityOrBody || ''}`.toLowerCase().includes(normalizedSearch);
    const matchesCategory = docListState.category === 'ALL' || category === docListState.category;
    const matchesStatus = docListState.status === 'ALL' || status.toUpperCase() === docListState.status;
    return matchesSearch && matchesCategory && matchesStatus;
  });
}

function renderPilotDocuments() {
  const body = query('#cm-doc-table-body');
  const caption = query('#cm-doc-caption');
  const uploadCaption = query('#cm-doc-upload-caption');
  if (!body) return;

  const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
  const pilot = pilotsCache.find((item) => item.uid === pilotUid) || activeCurrentUser;
  const filtered = getFilteredDocs();
  const pilotName = toProfileName(pilot);

  if (caption) caption.textContent = pilotUid ? `Documents — ${pilotName}` : 'Documents';
  if (uploadCaption) {
    uploadCaption.textContent = pilotUid ? `Uploading for ${pilotName}.` : 'Select a pilot, then fill the document details.';
  }

  if (!pilotUid) {
    body.innerHTML = '<tr><td colspan="8" class="cm-empty">No pilot selected.</td></tr>';
    return;
  }

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="8" class="cm-empty">No documents match the current filters.</td></tr>';
    return;
  }

  body.innerHTML = filtered
    .map((doc) => {
      const status = getDocumentComplianceState(doc);
      const expiry = formatExpiry(doc.expiryDate);
      return `<tr>
        <td data-label="Document"><strong>${escapeHtml(doc.documentName || 'Untitled')}</strong></td>
        <td data-label="Category"><span class="cm-badge cm-badge-muted">${escapeHtml((doc.documentCategory || 'GENERAL').toUpperCase())}</span></td>
        <td data-label="Number">${escapeHtml(doc.licenseOrCertificateNumber || 'N/A')}</td>
        <td data-label="Authority">${escapeHtml(doc.issuingAuthorityOrBody || 'N/A')}</td>
        <td data-label="Issue Date">${escapeHtml(formatShortDate(doc.issueDate))}</td>
        <td data-label="Expiry">
          <span class="cm-expiry">
            <span class="cm-expiry-date">${escapeHtml(expiry.date)}</span>
            ${expiry.rel ? `<span class="cm-expiry-in ${status === 'Expired' ? 'is-danger' : status === 'Expiring' ? 'is-warn' : ''}">${escapeHtml(expiry.rel)}</span>` : ''}
            <span class="cm-badge ${status === 'Expired' ? 'cm-badge-red' : status === 'Expiring' ? 'cm-badge-amber' : 'cm-badge-green'}">${status}</span>
          </span>
        </td>
        <td data-label="Reminder">${escapeHtml(`${doc.reminderLeadTimeDays ?? 'N/A'} day(s)`)}</td>
        <td data-label="Actions" class="cm-col-actions">
          <span class="cm-action-row">
            ${doc.documentUri ? `
              <button type="button" class="cm-action-btn" data-doc-action="download" data-document-id="${escapeHtml(doc.firestoreId)}" data-tip="Download" aria-label="Download document">
                <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
              </button>
              <button type="button" class="cm-action-btn" data-doc-action="preview" data-document-id="${escapeHtml(doc.firestoreId)}" data-tip="Preview" aria-label="Preview document">
                <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
              </button>` : ''}
            ${canPerformCrewAction(activeCurrentUser, 'edit') ? `
              <button type="button" class="cm-action-btn" data-doc-action="edit" data-document-id="${escapeHtml(doc.firestoreId)}" data-tip="Edit" aria-label="Edit document">
                <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>` : ''}
            ${canPerformCrewAction(activeCurrentUser, 'delete') ? `
              <button type="button" class="cm-action-btn is-danger" data-doc-action="delete" data-document-id="${escapeHtml(doc.firestoreId)}" data-storage-path="${escapeHtml(doc.storagePath || '')}" data-tip="Delete" aria-label="Delete document">
                <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>` : ''}
          </span>
        </td>
      </tr>`;
    })
    .join('');
}

function applyDocumentTemplate(templateKey) {
  if (!templateKey || templateKey === 'CUSTOM') return;
  const template = DOC_TEMPLATE_PRESETS[templateKey];
  if (!template) return;

  setFormField('#cm-doc-name', template.documentName);
  setFormField('#cm-doc-category-input', template.documentCategory);
  setFormField('#cm-doc-reminder', `${template.reminderLeadTimeDays}`);
  if (!query('#cm-doc-authority')?.value.trim()) {
    setFormField('#cm-doc-authority', template.issuingAuthorityOrBody);
  }

  const status = query('#cm-doc-upload-status');
  if (status) {
    status.textContent = `Applied template: ${template.documentName}`;
    status.classList.remove('is-success', 'is-error');
  }
}

function toggleUploadCard(show) {
  const card = query('#cm-doc-upload-card');
  if (!card) return;
  card.classList.toggle('hidden', !show);
  if (show) {
    const caption = query('#cm-doc-upload-caption');
    const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
    const pilot = pilotsCache.find((item) => item.uid === pilotUid);
    if (caption && pilot) caption.textContent = `Uploading for ${toProfileName(pilot)}.`;
  }
}

function previewDocument(doc) {
  if (!doc?.documentUri) return;
  openModal(`
    <p>${escapeHtml(doc.documentName || 'Document')} — ${escapeHtml(doc.documentCategory || 'GENERAL')}</p>
    ${/\.pdf($|\?)/i.test(doc.documentUri)
      ? `<iframe class="cm-pdf-viewer" src="${escapeHtml(doc.documentUri)}" title="Document preview"></iframe>`
      : `<p>This file type can't be previewed inline. <a href="${escapeHtml(doc.documentUri)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a>.</p>`}
  `, { title: doc.documentName || 'Document' });
}

async function downloadDocument(doc) {
  if (!doc?.documentUri) return;
  window.open(doc.documentUri, '_blank', 'noopener,noreferrer');
}

/* ================= DOCUMENT CRUD ================= */

function upsertDocInCache(pilotUid, document) {
  const current = docsByPilotCache.get(pilotUid) || [];
  const next = current.filter((item) => item.firestoreId !== document.firestoreId);
  next.push(document);
  docsByPilotCache.set(pilotUid, next);
}

function getTargetPilot() {
  const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
  return pilotsCache.find((pilot) => pilot.uid === pilotUid) || activeCurrentUser || null;
}

async function submitDocumentUpload(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const targetPilotUid = selectedPilotUid || activeCurrentUser?.uid;
  const status = query('#cm-doc-upload-status');
  if (!targetPilotUid) {
    if (status) status.textContent = 'Select a pilot before uploading a document.';
    return;
  }

  const documentName = form.documentName?.value?.trim();
  const documentCategory = form.documentCategory?.value?.trim() || 'GENERAL';
  const licenseOrCertificateNumber = form.licenseNumber?.value?.trim() || null;
  const issueDate = toTimestampCandidate(form.issueDate?.value || null);
  const expiryDate = toTimestampCandidate(form.expiryDate?.value || null);
  const issuingAuthorityOrBody = form.authority?.value?.trim() || null;
  const reminderLeadTimeDays = Number.parseInt(form.reminderDays?.value || '30', 10);
  const file = form.documentFile?.files?.[0] || null;
  const submit = query('#cm-doc-upload-submit');

  if (!documentName || !file) {
    if (status) status.textContent = 'Document name and file are required.';
    return;
  }

  const targetPilot = getTargetPilot();
  const operatorId = isPilotRole() ? activeCurrentUser?.linkedOperator || null : activeOperatorUid;
  const readers = [targetPilotUid, operatorId].filter(Boolean);
  const firestoreId = generateId();

  try {
    if (submit) {
      submit.disabled = true;
      const spinner = submit.querySelector('.cm-btn-spinner');
      if (spinner) spinner.classList.remove('hidden');
    }
    if (status) {
      status.textContent = 'Uploading file to Firebase Storage...';
      status.classList.remove('is-success', 'is-error');
    }

    const uploadResult = await uploadUserDocumentFile({
      userId: targetPilotUid,
      documentId: firestoreId,
      file
    });

    if (status) status.textContent = 'Saving metadata to Firestore...';

    await createPilotDocument({
      firestoreId,
      userId: targetPilotUid,
      userName: toProfileName(targetPilot),
      documentName,
      documentCategory,
      issueDate,
      expiryDate,
      issuingAuthorityOrBody,
      licenseOrCertificateNumber,
      operatorId,
      readers,
      reminderLeadTimeDays: Number.isNaN(reminderLeadTimeDays) ? 30 : reminderLeadTimeDays,
      documentUri: uploadResult.documentUri,
      storagePath: uploadResult.storagePath,
      lastEditedBy: activeCurrentUser?.uid || null
    });

    form.reset();
    const templateSelect = query('#cm-doc-template');
    if (templateSelect instanceof HTMLSelectElement) templateSelect.value = 'CUSTOM';
    if (status) {
      status.textContent = `Uploaded to ${uploadResult.storagePath}.`;
      status.classList.add('is-success');
    }
    showToast('Document uploaded.', 'success');

    await selectPilot(targetPilotUid);
    if (activeTab === 'documents') renderPilotDocuments();
  } catch (error) {
    console.error('Document upload failed:', error);

    if (shouldQueueError(error)) {
      enqueueCrewDocumentCreate({
        firestoreId,
        userId: targetPilotUid,
        userName: toProfileName(targetPilot),
        documentName,
        documentCategory,
        issueDate,
        expiryDate,
        issuingAuthorityOrBody,
        licenseOrCertificateNumber,
        operatorId,
        readers,
        reminderLeadTimeDays: Number.isNaN(reminderLeadTimeDays) ? 30 : reminderLeadTimeDays,
        documentUri: null,
        storagePath: null,
        lastEditedBy: activeCurrentUser?.uid || null,
        isDirty: true
      });

      upsertDocInCache(targetPilotUid, {
        firestoreId,
        userId: targetPilotUid,
        userName: toProfileName(targetPilot),
        documentName,
        documentCategory,
        issueDate,
        expiryDate,
        issuingAuthorityOrBody,
        licenseOrCertificateNumber,
        operatorId,
        readers,
        reminderLeadTimeDays: Number.isNaN(reminderLeadTimeDays) ? 30 : reminderLeadTimeDays,
        documentUri: null,
        storagePath: null,
        lastEditedBy: activeCurrentUser?.uid || null,
        lastModified: new Date(),
        isDirty: true
      });

      renderCrewTable();
      renderPilotDocuments();
      renderQueueSyncState();
      if (status) {
        status.textContent = 'Network unavailable. Document edit queued and marked dirty.';
        status.classList.add('is-warning');
      }
      showToast('Network unavailable. Upload queued.', 'warning');
    } else {
      if (status) {
        status.textContent = error.message || 'Unable to upload document.';
        status.classList.add('is-error');
      }
      showToast(error.message || 'Unable to upload document.', 'error');
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      const spinner = submit.querySelector('.cm-btn-spinner');
      if (spinner) spinner.classList.add('hidden');
    }
  }
}

async function editDocumentWithForm(documentId) {
  if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
  const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
  const pilotDocs = docsByPilotCache.get(pilotUid) || [];
  const targetDoc = pilotDocs.find((item) => item.firestoreId === documentId);
  if (!targetDoc) return;

  openModal(`
    <form id="cm-doc-edit-form" novalidate>
      <div class="cm-form-grid" style="grid-template-columns:1fr">
        <label class="cm-field">
          <span>Issue date</span>
          <input type="date" id="cm-doc-edit-issue" value="${escapeHtml(toInputDate(targetDoc.issueDate))}" />
        </label>
        <label class="cm-field">
          <span>Expiry date</span>
          <input type="date" id="cm-doc-edit-expiry" value="${escapeHtml(toInputDate(targetDoc.expiryDate))}" />
        </label>
        <label class="cm-field">
          <span>Certificate / License number</span>
          <input type="text" id="cm-doc-edit-number" value="${escapeHtml(targetDoc.licenseOrCertificateNumber || '')}" placeholder="Optional" />
        </label>
        <label class="cm-field">
          <span>Issuing authority</span>
          <input type="text" id="cm-doc-edit-authority" value="${escapeHtml(targetDoc.issuingAuthorityOrBody || '')}" placeholder="DGCA / Organization" />
        </label>
      </div>
      <div class="cm-modal-actions">
        <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-doc-edit-cancel">Cancel</button>
        <button type="submit" class="cm-btn cm-btn-primary cm-btn-md" id="cm-doc-edit-save">Save Changes</button>
      </div>
    </form>
  `, { title: `Edit ${targetDoc.documentName || 'document'}` });

  const formEl = query('#cm-doc-edit-form');
  const status = query('#cm-doc-upload-status');

  formEl?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const updates = {
      issueDate: toTimestampCandidate(query('#cm-doc-edit-issue')?.value) || targetDoc.issueDate || null,
      expiryDate: toTimestampCandidate(query('#cm-doc-edit-expiry')?.value) || targetDoc.expiryDate || null,
      licenseOrCertificateNumber: query('#cm-doc-edit-number')?.value?.trim() || null,
      issuingAuthorityOrBody: query('#cm-doc-edit-authority')?.value?.trim() || null,
      isDirty: false
    };

    try {
      closeModal();
      if (status) status.textContent = 'Saving document updates...';
      await updatePilotDocumentWithAudit(documentId, updates, activeCurrentUser?.uid || null);
      if (status) {
        status.textContent = 'Document updated with audit log.';
        status.classList.add('is-success');
      }
      showToast('Document updated.', 'success');
      if (pilotUid) await selectPilot(pilotUid);
      else await refreshCrew();
    } catch (error) {
      console.error('Document edit failed:', error);
      if (shouldQueueError(error)) {
        enqueueCrewDocumentUpdate({
          documentId,
          updates,
          editedBy: activeCurrentUser?.uid || null
        });
        const targetPilotUid = pilotUid || activeCurrentUser?.uid;
        if (targetPilotUid) {
          const nextDocs = (docsByPilotCache.get(targetPilotUid) || []).map((item) =>
            item.firestoreId === documentId
              ? { ...item, ...updates, isDirty: true, lastEditedBy: activeCurrentUser?.uid || null, lastModified: new Date() }
              : item
          );
          docsByPilotCache.set(targetPilotUid, nextDocs);
          const targetPilot = pilotsCache.find((item) => item.uid === targetPilotUid) || activeCurrentUser;
          renderCrewTable();
          renderPilotDocuments();
        }
        renderQueueSyncState();
        if (status) {
          status.textContent = 'Network unavailable. Update queued for sync.';
          status.classList.add('is-warning');
        }
        showToast('Network unavailable. Update queued.', 'warning');
      } else {
        if (status) {
          status.textContent = error.message || 'Unable to update document.';
          status.classList.add('is-error');
        }
        showToast(error.message || 'Unable to update document.', 'error');
      }
    }
  });

  query('#cm-doc-edit-cancel')?.addEventListener('click', closeModal);
}

async function deleteDocument(documentId, storagePath) {
  if (!canPerformCrewAction(activeCurrentUser, 'delete')) return;
  const status = query('#cm-doc-upload-status');

  confirmModal({
    title: 'Delete document',
    message: 'Delete this document and its storage file? This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      try {
        if (status) {
          status.textContent = 'Deleting document metadata...';
          status.classList.remove('is-success', 'is-error');
        }
        await removePilotDocument(documentId);
        if (storagePath) {
          try {
            await deleteUserDocumentFile(storagePath);
          } catch (storageError) {
            console.warn('Storage file delete failed:', storageError);
          }
        }
        if (status) {
          status.textContent = 'Document deleted.';
          status.classList.add('is-success');
        }
        showToast('Document deleted.', 'success');
        if (selectedPilotUid) await selectPilot(selectedPilotUid);
        else await refreshCrew();
      } catch (error) {
        console.error('Document delete failed:', error);
        if (shouldQueueError(error)) {
          enqueueCrewDocumentDelete({
            documentId,
            storagePath: storagePath || null
          });
          const targetPilotUid = selectedPilotUid || activeCurrentUser?.uid;
          if (targetPilotUid) {
            const nextDocs = (docsByPilotCache.get(targetPilotUid) || []).filter((item) => item.firestoreId !== documentId);
            docsByPilotCache.set(targetPilotUid, nextDocs);
            const targetPilot = pilotsCache.find((item) => item.uid === targetPilotUid) || activeCurrentUser;
            renderCrewTable();
            renderPilotDocuments();
          }
          renderQueueSyncState();
          if (status) {
            status.textContent = 'Network unavailable. Delete queued for sync.';
            status.classList.add('is-warning');
          }
          showToast('Network unavailable. Delete queued.', 'warning');
        } else {
          if (status) {
            status.textContent = error.message || 'Unable to delete document.';
            status.classList.add('is-error');
          }
          showToast(error.message || 'Unable to delete document.', 'error');
        }
      }
    }
  });
}

/* ================= COMPLIANCE ================= */

function renderComplianceTab() {
  const categories = {
    LICENCE: { label: 'Licence', total: 0, valid: 0 },
    MEDICAL: { label: 'Medical', total: 0, valid: 0 },
    TRAINING: { label: 'Training', total: 0, valid: 0 },
    DOCUMENT: { label: 'Documents', total: 0, valid: 0 }
  };

  let expiring30 = 0;
  let expiring60 = 0;
  let expiredCount = 0;
  const alerts = [];

  pilotsCache.forEach((pilot) => {
    const docs = docsByPilotCache.get(pilot.uid) || [];
    docs.forEach((doc) => {
      const category = `${doc.documentCategory || 'GENERAL'}`.toUpperCase();
      const group = categories[category] ? category : 'DOCUMENT';
      categories[group].total += 1;
      const state = getDocumentComplianceState(doc);
      if (state === 'Valid') categories[group].valid += 1;

      const days = daysUntil(doc.expiryDate);
      if (days === null) return;
      if (days < 0) {
        expiredCount += 1;
        alerts.push({ pilot: pilot, doc, days, state: 'Expired' });
      } else if (days < 30) {
        expiring30 += 1;
        alerts.push({ pilot: pilot, doc, days, state: 'Expiring' });
      } else if (days < 60) {
        expiring60 += 1;
      }
    });
  });

  queryAll('.cm-comp-card').forEach((card) => {
    const compType = card.dataset.compType;
    const group = categories[compType] || { total: 0, valid: 0 };
    const percent = group.total ? Math.round((group.valid / group.total) * 100) : 0;
    const bar = card.querySelector('.cm-ring-bar');
    const strong = card.querySelector('strong');
    const detail = card.querySelector(`#cm-comp-${compType.toLowerCase()}-detail`);

    if (bar) {
      const circumference = CIRC(52);
      bar.style.strokeDasharray = `${circumference.toFixed(2)}`;
      bar.style.strokeDashoffset = `${(circumference * (1 - percent / 100)).toFixed(2)}`;
      bar.classList.toggle('is-amber', percent < 100 && percent >= 60);
      bar.classList.toggle('is-red', percent < 60);
    }
    if (strong) strong.textContent = `${percent}%`;
    if (detail) detail.textContent = `${group.valid} of ${group.total} valid`;
  });

  const totalDocs = Object.values(categories).reduce((sum, group) => sum + group.total, 0);
  setText('#cm-comp-window-30', `${expiring30}`);
  setText('#cm-comp-window-60', `${expiring60}`);
  setText('#cm-comp-window-expired', `${expiredCount}`);
  if (totalDocs) {
    const bar30 = query('#cm-comp-bar-30');
    const bar60 = query('#cm-comp-bar-60');
    const barExp = query('#cm-comp-bar-expired');
    if (bar30) bar30.style.width = `${Math.min(100, (expiring30 / totalDocs) * 100)}%`;
    if (bar60) bar60.style.width = `${Math.min(100, (expiring60 / totalDocs) * 100)}%`;
    if (barExp) barExp.style.width = `${Math.min(100, (expiredCount / totalDocs) * 100)}%`;
  }

  const alertsEl = query('#cm-comp-alerts');
  if (alertsEl) {
    if (!alerts.length) {
      alertsEl.innerHTML = '<li class="cm-form-status" style="margin:0">No compliance alerts. All documents are in good standing.</li>';
    } else {
      alertsEl.innerHTML = alerts
        .sort((a, b) => a.days - b.days)
        .slice(0, 8)
        .map((alert) => {
          const isExpired = alert.state === 'Expired';
          return `<li class="cm-alert-item">
            <span class="cm-alert-dot ${isExpired ? 'is-red' : 'is-amber'}"></span>
            <span class="cm-alert-text">
              <strong>${escapeHtml(toProfileName(alert.pilot))} — ${escapeHtml(alert.doc.documentName || 'Document')}</strong>
              <span>${isExpired ? 'Expired' : 'Expiring'} ${escapeHtml(alert.doc.expiryDate ? formatExpiry(alert.doc.expiryDate).rel : '')}</span>
            </span>
          </li>`;
        })
        .join('');
    }
  }
}

/* ================= BULK ================= */

function renderBulkTab() {
  const count = query('#cm-bulk-count');
  if (count) count.textContent = `${selectedRows.size} selected`;
  setText('#cm-bulk-status', '');
}

function getSelectedPilots() {
  return pilotsCache.filter((pilot) => selectedRows.has(pilot.uid));
}

async function applyBulkAction(action) {
  if (!canPerformCrewAction(activeCurrentUser, 'edit')) {
    showToast('You do not have permission to modify crew records.', 'error');
    return;
  }

  const selected = getSelectedPilots();
  const statusEl = query('#cm-bulk-status');

  if (!selected.length) {
    if (statusEl) {
      statusEl.textContent = 'Select crew members in the directory first (use the checkboxes).';
      statusEl.classList.add('is-error');
    }
    showToast('No crew members selected.', 'warning');
    return;
  }

  const names = selected.slice(0, 3).map((pilot) => toProfileName(pilot)).join(', ') + (selected.length > 3 ? ` +${selected.length - 3} more` : '');

  if (action === 'active' || action === 'inactive') {
    const next = action === 'active' ? 'Active' : 'Inactive';
    confirmModal({
      title: `Set ${next}`,
      message: `Set status to "${next}" for ${selected.length} selected crew member(s)? (${names})`,
      confirmLabel: `Set ${next}`,
      onConfirm: async () => {
        await Promise.all(selected.map((pilot) => updatePilotProfile(pilot.uid, { status: next })));
        if (statusEl) {
          statusEl.textContent = `Applied status ${next} to ${selected.length} crew record(s).`;
          statusEl.classList.add('is-success');
        }
        showToast(`Status set to ${next} for ${selected.length} crew.`, 'success');
        await refreshCrew();
      }
    });
  } else if (action === 'assign-operator') {
    openModal(`
      <label class="cm-field">
        <span>Operator UID or email</span>
        <input type="text" id="cm-assign-operator-input" placeholder="Operator UID or registered operator email" />
      </label>
      <div class="cm-modal-actions">
        <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-assign-cancel">Cancel</button>
        <button type="button" class="cm-btn cm-btn-primary cm-btn-md" id="cm-assign-confirm">Assign Operator</button>
      </div>
    `, { title: 'Assign Operator', subtitle: `Assign ${selected.length} selected crew member(s) to an operator.` });

    query('#cm-assign-cancel')?.addEventListener('click', closeModal);
    query('#cm-assign-confirm')?.addEventListener('click', async () => {
      const input = query('#cm-assign-operator-input')?.value?.trim();
      if (!input) return;
      closeModal();
      try {
        const isEmail = input.includes('@');
        let targetOperator = input;
        if (isEmail) {
          const found = await findUserByEmail(input);
          if (!found) throw new Error('No registered user with that email was found.');
          targetOperator = found.uid;
        }
        await Promise.all(selected.map((pilot) => updatePilotProfile(pilot.uid, { operatorId: targetOperator })));
        if (statusEl) {
          statusEl.textContent = `Assigned ${selected.length} crew record(s) to operator ${targetOperator}.`;
          statusEl.classList.add('is-success');
        }
        showToast(`Assigned ${selected.length} crew to operator.`, 'success');
        await refreshCrew();
      } catch (error) {
        console.error('Assign operator failed:', error);
        if (statusEl) {
          statusEl.textContent = error.message || 'Unable to assign operator.';
          statusEl.classList.add('is-error');
        }
        showToast(error.message || 'Unable to assign operator.', 'error');
      }
    });
  } else if (action === 'reminder') {
    const reminders = selected.flatMap((pilot) => {
      const docs = docsByPilotCache.get(pilot.uid) || [];
      return docs
        .filter((doc) => getDocumentComplianceState(doc) !== 'Valid')
        .map((doc) => ({ pilot, doc, days: daysUntil(doc.expiryDate) }));
    }).sort((a, b) => a.days - b.days);

    openModal(
      reminders.length
        ? `<ul class="cm-alerts">${reminders.slice(0, 10).map((item) => `
            <li class="cm-alert-item">
              <span class="cm-alert-dot ${item.days < 0 ? 'is-red' : 'is-amber'}"></span>
              <span class="cm-alert-text">
                <strong>${escapeHtml(toProfileName(item.pilot))} — ${escapeHtml(item.doc.documentName || 'Document')}</strong>
                <span>${escapeHtml(item.doc.expiryDate ? formatExpiry(item.doc.expiryDate).rel : '')}</span>
              </span>
            </li>`).join('')}</ul>
          ${reminders.length > 10 ? `<p class="cm-form-status">+${reminders.length - 10} more reminders</p>` : ''}`
        : '<p>All selected crew members are compliant. No reminders needed.</p>',
      { title: 'Reminder Preview', subtitle: `${reminders.length} document(s) need attention across ${selected.length} selected crew member(s).` }
    );
  } else if (action === 'reports') {
    const total = selected.length;
    const withIssues = selected.filter((pilot) => getCompliance(docsByPilotCache.get(pilot.uid) || []) !== 'Valid').length;
    const active = selected.filter((pilot) => `${pilot.status || 'Active'}` === 'Active').length;
    const inactive = total - active;
    openModal(`
      <div class="cm-comp-windows" style="grid-template-columns:repeat(3,1fr);gap:0.6rem">
        <div class="cm-comp-window"><strong>${total}</strong><span>Selected</span></div>
        <div class="cm-comp-window"><strong>${withIssues}</strong><span>Needs action</span></div>
        <div class="cm-comp-window"><strong>${active}</strong><span>Active</span></div>
      </div>
    `, { title: 'Crew Report', subtitle: `Summary for ${total} selected crew member(s). Use Export CSV for a full extract.` });
  } else if (action === 'export') {
    exportCrewCsv(selected);
  } else if (action === 'delete') {
    confirmModal({
      title: 'Delete crew members',
      message: `Soft delete ${selected.length} selected crew member(s)? (${names}) This unlinks them and sets status=Deleted.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await Promise.all(
          selected.map(async (pilot) => {
            await updatePilotProfile(pilot.uid, { status: 'Deleted' });
            await delinkPilot(pilot.uid);
            selectedRows.delete(pilot.uid);
          })
        );
        if (statusEl) {
          statusEl.textContent = `Soft deleted ${selected.length} crew record(s).`;
          statusEl.classList.add('is-success');
        }
        showToast(`${selected.length} crew members removed.`, 'success');
        await refreshCrew();
      }
    });
  }
}

function exportCrewCsv(crewList) {
  const rows = [['Name', 'Email', 'Role', 'Employee ID', 'Status', 'Licence Number', 'Medical Expiry', 'Licence Expiry', 'Compliance', 'Documents']];
  crewList.forEach((pilot) => {
    const docs = docsByPilotCache.get(pilot.uid) || [];
    rows.push([
      toProfileName(pilot),
      pilot.email || '',
      getPilotRoleLabel(pilot),
      pilot.employeeId || '',
      pilot.status || 'Active',
      getLicenseNumber(docs),
      formatShortDate(getMedicalExpiry(docs)),
      formatShortDate(getLicenceExpiry(docs)),
      getCompliance(docs),
      `${docs.length}`
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${`${cell ?? ''}`.replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crew-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`Exported ${crewList.length} crew records.`, 'success');
}

/* ================= SELECTION ================= */

async function selectPilot(pilotUid) {
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  selectedPilotUid = pilotUid;

  pilotDocUnsubscribe?.();
  pilotDocUnsubscribe = null;

  const docs = await getPilotDocuments(pilotUid);
  docsByPilotCache.set(pilotUid, docs);

  pilotDocUnsubscribe = watchDocumentsByUser(
    pilotUid,
    (snapshot) => {
      const nextDocs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      docsByPilotCache.set(pilotUid, nextDocs);
      renderCrewTable();
      if (activeTab === 'documents') renderPilotDocuments();
      updateKPIs();
    },
    (error) => console.error('Crew document watch error:', error)
  );

  if (activeTab === 'documents') renderPilotDocuments();
  renderCrewTable();
}

function handleRowCheck(pilotUid, checked) {
  if (checked) selectedRows.add(pilotUid);
  else selectedRows.delete(pilotUid);
  if (activeTab === 'bulk') renderBulkTab();
}

/* ================= REFRESH ================= */

async function refreshCrew() {
  if (isPilotRole()) {
    const pilotUid = activeCurrentUser?.uid;
    if (!pilotUid) return;

    const [pilotDocs, incomingRequests] = await Promise.all([getPilotDocuments(pilotUid), getIncomingLinkRequests(pilotUid)]);
    pilotsCache = [{ ...activeCurrentUser, uid: pilotUid }];
    docsByPilotCache = new Map([[pilotUid, pilotDocs]]);
    incomingRequestsCache = incomingRequests;
    selectedPilotUid = pilotUid;

    renderCrewTable();
    if (activeTab === 'documents') renderPilotDocuments();
    if (activeTab === 'linking') renderIncomingRequests();
    renderTabContent(activeTab);
    setStatus(`Loaded your pilot profile and ${pilotDocs.length} document(s).`);
    updateKPIs();
    return;
  }

  if (!activeOperatorUid) return;
  const [pilots, outgoingRequests] = await Promise.all([getCrew(activeOperatorUid), getOutgoingLinkRequests(activeOperatorUid)]);
  pilotsCache = pilots;
  outgoingRequestsCache = outgoingRequests;
  docsByPilotCache = await getCrewDocumentsByPilots(pilots.map((pilot) => pilot.uid));
  setStatus(`Loaded ${pilots.length} pilot profile(s) from Firestore.`);
  renderTabContent(activeTab);
  updateKPIs();

  if (selectedPilotUid && pilots.some((pilot) => pilot.uid === selectedPilotUid)) {
    await selectPilot(selectedPilotUid);
  } else {
    selectedPilotUid = null;
  }
}

/* ================= EVENT BINDING ================= */

function bindHeaderAndTabs() {
  query('#cm-btn-add-crew')?.addEventListener('click', () => openProfileForm(null));
  query('#cm-btn-notifications')?.addEventListener('click', () => {
    setActiveTab('linking');
    showToast(`${incomingRequestsCache.length} incoming request(s).`, 'info');
  });

  query('#cm-global-search')?.addEventListener('input', (event) => {
    const value = event.target?.value || '';
    crewListState.searchText = value;
    currentPage = 1;
    const panelInput = query('#cm-search');
    if (panelInput && panelInput.value !== value) panelInput.value = value;
    if (activeTab !== 'directory') setActiveTab('directory');
    else renderCrewTable();
  });

  queryAll('.cm-tab').forEach((tabButton) => {
    tabButton.addEventListener('click', () => setActiveTab(tabButton.dataset.tab));
  });

  window.addEventListener('resize', () => positionTabUnderline(activeTab));
}

function bindDirectoryControls() {
  query('#cm-search')?.addEventListener('input', (event) => {
    const value = event.target?.value || '';
    crewListState.searchText = value;
    currentPage = 1;
    const globalInput = query('#cm-global-search');
    if (globalInput && globalInput.value !== value) globalInput.value = value;
    renderCrewTable();
  });

  query('#cm-filter-compliance')?.addEventListener('change', (event) => {
    crewListState.compliance = `${event.target?.value || 'ALL'}`.toUpperCase();
    currentPage = 1;
    renderCrewTable();
  });

  query('#cm-filter-role')?.addEventListener('change', (event) => {
    crewListState.role = `${event.target?.value || 'ALL'}`.toUpperCase();
    currentPage = 1;
    renderCrewTable();
  });

  query('#cm-filter-status')?.addEventListener('change', (event) => {
    crewListState.status = event.target?.value || 'ALL';
    currentPage = 1;
    renderCrewTable();
  });

  query('#cm-sort-field')?.addEventListener('change', (event) => {
    crewListState.sortField = `${event.target?.value || 'name'}`;
    renderCrewTable();
  });

  query('#cm-refresh')?.addEventListener('click', async () => {
    setStatus('Refreshing crew data...');
    await refreshCrew();
    renderQueueSyncState();
  });

  query('#cm-sync-retry')?.addEventListener('click', async () => {
    await runQueueSync({ source: 'manual', refreshAfter: true });
  });

  query('#cm-export')?.addEventListener('click', () => {
    const visible = getSortedAndFilteredPilots();
    if (!visible.length) {
      showToast('No crew to export.', 'warning');
      return;
    }
    exportCrewCsv(visible);
  });

  query('#cm-prev')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderCrewTable();
    }
  });

  query('#cm-next')?.addEventListener('click', () => {
    const visible = getSortedAndFilteredPilots();
    if (currentPage * PAGE_SIZE < visible.length) {
      currentPage += 1;
      renderCrewTable();
    }
  });

  query('#cm-select-all')?.addEventListener('change', (event) => {
    const checked = !!event.target?.checked;
    const pagePilots = getSortedAndFilteredPilots().slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    pagePilots.forEach((pilot) => {
      if (checked) selectedRows.add(pilot.uid);
      else selectedRows.delete(pilot.uid);
    });
    renderCrewTable();
    if (activeTab === 'bulk') renderBulkTab();
  });

  query('#cm-table-body')?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.cm-col-check')) return;

    const row = target.closest('tr[data-pilot-uid]');
    if (row) {
      const pilotUid = row.getAttribute('data-pilot-uid');
      if (!pilotUid) return;
      openDrawer(pilotUid);
    }
  });

  query('#cm-table-body')?.addEventListener('change', (event) => {
    const check = event.target;
    if (check instanceof HTMLInputElement && check.matches('.cm-row-check')) {
      handleRowCheck(check.getAttribute('data-check-pilot'), check.checked);
    }
  });
}

function bindProfileForm() {
  query('#cm-profile-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfileForm();
  });

  query('#cm-profile-cancel')?.addEventListener('click', () => {
    profileEditUid = null;
    setActiveTab('directory');
  });

  query('#cm-field-photo')?.addEventListener('change', (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = query('#cm-profile-photo-preview');
      if (preview && typeof ev.target?.result === 'string') {
        preview.style.backgroundImage = `url(${ev.target.result})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.textContent = '';
      }
    };
    reader.readAsDataURL(file);
  });
}

function bindLinkingControls() {
  query('#cm-link-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendPilotLinkRequest(event.currentTarget);
  });

  query('#cm-link-generate')?.addEventListener('click', async () => {
    const pilotUid = query('#cm-link-pilot')?.value;
    if (!pilotUid) {
      showToast('Select a crew member first.', 'warning');
      return;
    }
    if (!activeOperatorUid) return;
    const pilot = pilotsCache.find((item) => item.uid === pilotUid);
    if (!pilot) return;
    try {
      const result = await generateCrewProfileLinkCode({
        crewProfileId: pilotUid,
        operatorId: activeOperatorUid
      });
      setActiveLinkCode(result.code, result.expiresAt, pilotUid);
      const expiry = toDateValue(result.expiresAt);
      setStatus(`Link ready for ${toProfileName(pilot)} | Profile ID: ${pilotUid} | Code: ${result.code} | Expires: ${expiry ? expiry.toLocaleTimeString() : 'in 5 minutes'}`);
      showToast(`Link code generated for ${toProfileName(pilot)}.`);
    } catch (error) {
      console.error('Generate link code failed:', error);
      setStatus(error.message || 'Unable to generate link code.');
      showToast(error.message || 'Unable to generate link code.', 'error');
    }
  });

  query('#cm-link-copy')?.addEventListener('click', async () => {
    if (!activeLinkCode) {
      showToast('No active code to copy.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(activeLinkCode);
      showToast('Link code copied to clipboard.', 'success');
    } catch (error) {
      console.error('Clipboard copy failed:', error);
      showToast('Unable to copy code.', 'error');
    }
  });

  query('#cm-linked-search')?.addEventListener('input', renderLinkedPilots);

  query('#cm-link-table-body')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-link-action]');
    if (!button) return;
    const action = button.getAttribute('data-link-action');
    const requestId = button.getAttribute('data-request-id');
    if (!action || !requestId) return;

    if (action === 'resend') {
      const request = outgoingRequestsCache.find((item) => item.requestId === requestId);
      const pilotEmail = request?.recipientEmail;
      if (!pilotEmail || !activeOperatorUid) return;
      try {
        await requestPilotLinkByEmail({
          requesterId: activeOperatorUid,
          requesterName: toProfileName(activeCurrentUser),
          requesterEmail: activeCurrentUser?.email || '',
          pilotEmail
        });
        showToast('Invitation resent.', 'success');
        await refreshCrew();
      } catch (error) {
        showToast(error.message || 'Unable to resend invitation.', 'error');
      }
      return;
    }

    if (action === 'cancel') {
      confirmModal({
        title: 'Cancel request',
        message: 'Cancel this connection request?',
        confirmLabel: 'Cancel Request',
        danger: true,
        onConfirm: async () => {
          await withdrawConnectionRequest(requestId);
          showToast('Request cancelled.', 'success');
          await refreshCrew();
        }
      });
    }
  });

  query('#cm-linked-table-body')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-linked-action]');
    if (!button) return;
    const action = button.getAttribute('data-linked-action');
    const pilotUid = button.getAttribute('data-pilot-uid');
    if (!action || !pilotUid) return;

    if (action === 'view') {
      openDrawer(pilotUid);
      return;
    }
    if (action === 'delink') {
      await handleDelink(pilotUid);
    }
  });

  query('#cm-incoming-table-body')?.addEventListener('click', async (event) => {
    if (!canPerformCrewAction(activeCurrentUser, 'respondIncomingRequest')) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-incoming-action]');
    if (!button) return;
    const action = button.getAttribute('data-incoming-action');
    const requestId = button.getAttribute('data-request-id');
    const operatorUid = button.getAttribute('data-operator-uid');
    if (!action || !requestId) return;

    const pilotUid = activeCurrentUser?.uid;
    if (!pilotUid) return;

    if (action === 'accept' && operatorUid) {
      confirmModal({
        title: 'Accept request',
        message: `Accept this request and link your profile to operator ${operatorUid}?`,
        confirmLabel: 'Accept & Link',
        onConfirm: async () => {
          await acceptIncomingLinkRequest({ requestId, pilotUid, operatorUid });
          activeCurrentUser = { ...activeCurrentUser, linkedOperator: operatorUid };
          showToast('Request accepted. You are now linked.', 'success');
          await refreshCrew();
        }
      });
      return;
    }

    if (action === 'decline') {
      confirmModal({
        title: 'Decline request',
        message: 'Decline this connection request?',
        confirmLabel: 'Decline',
        danger: true,
        onConfirm: async () => {
          await declineConnectionRequest(requestId);
          showToast('Connection request declined.', 'success');
          await refreshCrew();
        }
      });
    }
  });
}

function bindDocumentControls() {
  query('#cm-doc-pilot')?.addEventListener('change', (event) => {
    const pilotUid = event.target?.value;
    if (!pilotUid) return;
    selectedPilotUid = pilotUid;
    docListState.searchText = '';
    const search = query('#cm-doc-search');
    if (search) search.value = '';
    selectPilot(pilotUid);
  });

  query('#cm-doc-search')?.addEventListener('input', (event) => {
    docListState.searchText = event.target?.value || '';
    renderPilotDocuments();
  });

  query('#cm-doc-category')?.addEventListener('change', (event) => {
    docListState.category = `${event.target?.value || 'ALL'}`.toUpperCase();
    renderPilotDocuments();
  });

  query('#cm-doc-status')?.addEventListener('change', (event) => {
    docListState.status = `${event.target?.value || 'ALL'}`.toUpperCase();
    renderPilotDocuments();
  });

  query('#cm-doc-upload-toggle')?.addEventListener('click', () => {
    const card = query('#cm-doc-upload-card');
    if (!card) return;
    toggleUploadCard(card.classList.contains('hidden'));
  });

  query('#cm-doc-template')?.addEventListener('change', (event) => {
    applyDocumentTemplate(event.target?.value || 'CUSTOM');
  });

  query('#cm-doc-upload-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitDocumentUpload(event.currentTarget);
  });

  query('#cm-doc-table-body')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-doc-action]');
    if (!button) return;
    const action = button.getAttribute('data-doc-action');
    const documentId = button.getAttribute('data-document-id');
    const storagePath = button.getAttribute('data-storage-path') || '';
    if (!action || !documentId) return;

    const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
    const pilotDocs = docsByPilotCache.get(pilotUid) || [];
    const targetDoc = pilotDocs.find((item) => item.firestoreId === documentId);

    if (action === 'download') {
      await downloadDocument(targetDoc);
      return;
    }
    if (action === 'preview') {
      previewDocument(targetDoc);
      return;
    }
    if (action === 'edit') {
      await editDocumentWithForm(documentId);
      return;
    }
    if (action === 'delete') {
      await deleteDocument(documentId, storagePath);
    }
  });
}

function bindBulkControls() {
  queryAll('[data-bulk-action]').forEach((button) => {
    button.addEventListener('click', () => applyBulkAction(button.dataset.bulkAction));
  });
}

function bindGlobalOverlays() {
  query('#cm-drawer-backdrop')?.addEventListener('click', closeDrawer);
  query('#cm-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  query('#cm-modal-close')?.addEventListener('click', closeModal);
}

function bindKeyboard() {
  document.addEventListener('keydown', bindKeyboard.handler);
}

bindKeyboard.handler = function handleKeyboard(event) {
  if (event.key === 'Escape') {
    closeDrawer();
    closeModal();
  }
};

function applyRoleLayout() {
  const pilotMode = isPilotRole();
  if (pilotMode) {
    query('#cm-btn-add-crew')?.classList.add('hidden');
    queryAll('[data-bulk-action]').forEach((btn) => btn.classList.add('hidden'));
    const bulkTab = query('#cm-tab-bulk');
    if (bulkTab) bulkTab.classList.add('hidden');
  }
}

/* ================= INIT / DESTROY ================= */

export async function init(view, context) {
  activeView = view;

  const operatorUid = context?.currentUser?.uid || null;
  const currentUser = context?.currentUser || null;
  const orgContext = getCurrentOrganizationContext(currentUser);

  activeOperatorUid = orgContext.organizationId || operatorUid;
  activeCurrentUser = currentUser;
  activeRole = normalizeRole(currentUser?.role);
  crewPermissions = getCrewPermissionsForUser(currentUser);

  const userName = query('#cm-user-name');
  if (userName) userName.textContent = currentUser?.name || currentUser?.email || 'User';
  const userRole = query('#cm-user-role');
  if (userRole) userRole.textContent = activeRole;
  const userAvatar = query('#cm-user-avatar');
  if (userAvatar) userAvatar.textContent = getInitials(currentUser?.name || currentUser?.email);

  applyRoleLayout();

  if (!currentUser?.uid) {
    setStatus('Crew module requires operator UID.');
    return { destroy() {} };
  }

  try {
    const savedTab = window.localStorage.getItem(CREW_TAB_STORAGE_KEY);
    activeTab = ['directory', 'profile', 'linking', 'documents', 'compliance', 'bulk'].includes(savedTab) ? savedTab : 'directory';
  } catch (_) {
    activeTab = 'directory';
  }

  bindHeaderAndTabs();
  bindDirectoryControls();
  bindProfileForm();
  bindLinkingControls();
  bindDocumentControls();
  bindBulkControls();
  bindGlobalOverlays();
  bindKeyboard();

  startCrewDocumentSyncWorker();
  await runQueueSync({ source: 'initial' });
  renderQueueSyncState();
  queueMonitorTimer = setInterval(() => {
    renderQueueSyncState();
  }, 5000);

  await refreshCrew();

  if (isPilotRole()) {
    const pilotUid = currentUser.uid;
    pilotDocUnsubscribe = watchDocumentsByUser(
      pilotUid,
      (snapshot) => {
        const docs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
        docsByPilotCache.set(pilotUid, docs);
        renderCrewTable();
        if (activeTab === 'documents') renderPilotDocuments();
        updateKPIs();
      },
      (error) => console.error('Pilot document snapshot error:', error)
    );

    incomingRequestUnsubscribe = onIncomingLinkRequests(
      pilotUid,
      (snapshot) => {
        incomingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        renderIncomingRequests();
        updateKPIs();
      },
      (error) => console.error('Incoming link requests snapshot error:', error)
    );
  } else {
    crewUnsubscribe = onCrewSnapshot(
      activeOperatorUid,
      async (profiles) => {
        pilotsCache = profiles.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
        docsByPilotCache = await getCrewDocumentsByPilots(pilotsCache.map((pilot) => pilot.uid));
        renderTabContent(activeTab);
        updateKPIs();
        setStatus(`Live update: ${pilotsCache.length} pilot profile(s).`);
      },
      (error) => console.error('Crew snapshot error:', error)
    );

    outgoingRequestUnsubscribe = onOutgoingLinkRequests(
      operatorUid,
      (snapshot) => {
        outgoingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        if (activeTab === 'linking') renderOutgoingRequests();
        updateKPIs();
      },
      (error) => console.error('Outgoing link requests snapshot error:', error)
    );
  }

  setActiveTab(activeTab);

  return {
    destroy() {
      crewUnsubscribe?.();
      pilotDocUnsubscribe?.();
      outgoingRequestUnsubscribe?.();
      incomingRequestUnsubscribe?.();
      crewUnsubscribe = null;
      pilotDocUnsubscribe = null;
      outgoingRequestUnsubscribe = null;
      incomingRequestUnsubscribe = null;
      activeView = null;
      activeOperatorUid = null;
      activeCurrentUser = null;
      activeRole = 'OPERATIONS';
      crewPermissions = null;
      crewListState.searchText = '';
      crewListState.compliance = 'ALL';
      crewListState.role = 'ALL';
      crewListState.status = 'ALL';
      crewListState.sortField = 'name';
      crewListState.sortDirection = 'asc';
      docListState.searchText = '';
      docListState.category = 'ALL';
      docListState.status = 'ALL';
      pilotsCache = [];
      docsByPilotCache = new Map();
      selectedPilotUid = null;
      selectedRows = new Set();
      currentPage = 1;
      outgoingRequestsCache = [];
      incomingRequestsCache = [];
      profileEditUid = null;
      activeLinkCode = null;
      activeLinkCodeExpiresAt = null;
      activeLinkCodePilotUid = null;
      if (queueMonitorTimer) {
        clearInterval(queueMonitorTimer);
        queueMonitorTimer = null;
      }
      if (linkCodeTimer) {
        clearInterval(linkCodeTimer);
        linkCodeTimer = null;
      }
      queueSyncBusy = false;
      queueSyncLastAttemptAt = null;
      queueSyncLastError = null;
      if (queueSyncFlashTimer) {
        clearTimeout(queueSyncFlashTimer);
        queueSyncFlashTimer = null;
      }
      document.removeEventListener('keydown', bindKeyboard.handler);
    }
  };
}
