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
  getPilotDocuments,
  createPilotDocument,
  updatePilotDocumentWithAudit,
  removePilotDocument,
  getCrewDocumentsByPilots,
  summarizeCrewDocumentCompliance
} from '../../services/crewService.js';
import { watchDocumentsByUser } from '../../services/documentService.js';
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
let queueSyncBusy = false;
let queueSyncLastAttemptAt = null;
let queueSyncLastError = null;
let queueSyncFlashTimer = null;
let crewPermissions = null;
const CREW_PROFILE_SESSION_KEY = 'vs-selected-crew-profile';

const crewListState = {
  searchText: '',
  compliance: 'ALL',
  role: 'ALL',
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

function isOperationsRole() {
  return !isPilotRole();
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
    getPilotRoleLabel(pilot)
  ].join(' ').toLowerCase();
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return `${left}`.localeCompare(`${right}`);
}

function getSortedAndFilteredPilots() {
  const normalizedSearch = normalizeSearchText(crewListState.searchText);

  const filtered = pilotsCache.filter((pilot) => {
    const docs = docsByPilotCache.get(pilot.uid) || [];
    const compliance = getCompliance(docs);
    const pilotRole = getPilotRoleLabel(pilot);

    const matchesSearch = !normalizedSearch || getPilotSearchText(pilot, docs).includes(normalizedSearch);
    const matchesCompliance = crewListState.compliance === 'ALL' || compliance.toUpperCase() === crewListState.compliance;
    const matchesRole = crewListState.role === 'ALL' || pilotRole === crewListState.role;

    return matchesSearch && matchesCompliance && matchesRole;
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
    } else {
      comparison = compareValues(toProfileName(leftPilot).toLowerCase(), toProfileName(rightPilot).toLowerCase());
    }

    return crewListState.sortDirection === 'desc' ? comparison * -1 : comparison;
  });

  return sorted;
}

function setStatus(message) {
  const status = activeView?.querySelector('#crew-status');
  if (status) status.textContent = message;
}

function getRoleLabel() {
  return isPilotRole() ? 'pilot' : 'operations';
}

function showQueueSyncFlash(message, tone = 'success') {
  if (!activeView) return;
  const flash = activeView.querySelector('#crew-sync-flash');
  if (!flash) return;

  if (queueSyncFlashTimer) {
    clearTimeout(queueSyncFlashTimer);
  }

  flash.textContent = message;
  flash.classList.remove('hidden', 'is-success', 'is-warning', 'is-error');
  if (tone === 'error') {
    flash.classList.add('is-error');
  } else if (tone === 'warning') {
    flash.classList.add('is-warning');
  } else {
    flash.classList.add('is-success');
  }

  queueSyncFlashTimer = setTimeout(() => {
    flash.classList.add('hidden');
  }, 3000);
}

function buildManualSyncStatusMessage(result) {
  const role = getRoleLabel();
  if (result.remaining === 0 && result.processed > 0) {
    return `Sync complete for ${role} workspace. Synced ${result.processed} queued operation(s).`;
  }
  if (result.remaining === 0) {
    return `No queued updates for ${role} workspace. Everything is already synced.`;
  }
  return `Sync partially complete for ${role} workspace. Processed ${result.processed}; ${result.remaining} still pending.`;
}

function getLastQueueError(queue) {
  const withErrors = queue
    .filter((item) => item?.lastError)
    .sort((left, right) => {
      const leftTs = toDateValue(left.lastTriedAt || left.createdAt)?.getTime() || 0;
      const rightTs = toDateValue(right.lastTriedAt || right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    });

  if (!withErrors.length) return null;
  return withErrors[0].lastError;
}

function renderQueueSyncState() {
  if (!activeView) return;

  const queue = getCrewDocumentSyncQueue();
  const pendingCount = queue.length;

  const countLabel = activeView.querySelector('#crew-sync-count');
  const retryButton = activeView.querySelector('#crew-sync-retry');
  const errorLabel = activeView.querySelector('#crew-sync-error');

  if (countLabel) {
    countLabel.textContent = `Pending Sync: ${pendingCount}`;
    countLabel.classList.toggle('has-pending', pendingCount > 0);
  }

  if (retryButton) {
    retryButton.disabled = queueSyncBusy || pendingCount === 0;
    retryButton.textContent = queueSyncBusy ? 'Retrying...' : 'Retry Sync';
  }

  if (errorLabel) {
    const message = queueSyncLastError || getLastQueueError(queue);
    if (!message) {
      if (queueSyncLastAttemptAt) {
        errorLabel.textContent = `No retry errors. Last sync: ${formatDateTime(queueSyncLastAttemptAt)}.`;
      } else {
        errorLabel.textContent = 'No retry errors yet.';
      }
      errorLabel.classList.remove('has-error');
    } else {
      const lastTriedAt = queue
        .filter((item) => item?.lastError)
        .map((item) => toDateValue(item.lastTriedAt || item.createdAt))
        .filter(Boolean)
        .sort((left, right) => right.getTime() - left.getTime())[0];

      const when = lastTriedAt ? formatDateTime(lastTriedAt) : 'unknown time';
      errorLabel.textContent = `Last retry error (${when}): ${message}`;
      errorLabel.classList.add('has-error');
    }
  }
}

async function runQueueSync({ source = 'background', refreshAfter = false } = {}) {
  if (queueSyncBusy) return;

  queueSyncBusy = true;
  queueSyncLastError = null;
  renderQueueSyncState();

  try {
    const result = await processCrewDocumentSyncQueue();
    queueSyncLastAttemptAt = new Date();

    if (result.remaining === 0 && result.processed > 0) {
      showQueueSyncFlash('Synced just now.', 'success');
    }

    if (result.remaining > 0 && source === 'manual') {
      showQueueSyncFlash('Some queued updates still need network retry.', 'warning');
    }

    if (refreshAfter) {
      await refreshCrew();
    }

    if (source === 'manual') {
      const statusMessage = buildManualSyncStatusMessage(result);
      setStatus(statusMessage);
      if (result.remaining === 0) {
        showQueueSyncFlash('Synced just now.', 'success');
      }
    }
  } catch (error) {
    queueSyncLastAttemptAt = new Date();
    queueSyncLastError = error?.message || 'Unknown queue sync error';
    showQueueSyncFlash('Sync failed. Review last retry error.', 'error');
    if (source === 'manual') {
      setStatus(`Queue sync failed for ${getRoleLabel()} workspace: ${queueSyncLastError}`);
    }
  } finally {
    queueSyncBusy = false;
    renderQueueSyncState();
  }
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

function setVisible(selector, shouldShow) {
  const element = activeView?.querySelector(selector);
  if (!element) return;
  element.classList.toggle('hidden', !shouldShow);
}

function applyRoleLayout() {
  const pilotMode = isPilotRole();
  setVisible('#crew-add-card', !!crewPermissions?.canEdit && !pilotMode);
  setVisible('#crew-link-card', !!crewPermissions?.canManageLinkRequests && !pilotMode);
  setVisible('#crew-incoming-card', !!crewPermissions?.canRespondIncomingRequest && pilotMode);

  const uploadStatus = activeView?.querySelector('#crew-doc-upload-status');
  if (uploadStatus && pilotMode) {
    uploadStatus.textContent = 'You can upload documents to your own profile.';
  } else if (uploadStatus && !crewPermissions?.canEdit) {
    uploadStatus.textContent = 'You have view-only access for crew records.';
  }
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

function updateSummary() {
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

  activeView.querySelector('#crew-total').textContent = `${pilotsCache.length}`;
  activeView.querySelector('#crew-valid').textContent = `${valid}`;
  activeView.querySelector('#crew-expiring').textContent = `${expiring}`;
  activeView.querySelector('#crew-expired').textContent = `${expired}`;
}

function renderCrewTable() {
  if (!activeView) return;

  const body = activeView.querySelector('#crew-table-body');
  if (!body) return;

  if (!pilotsCache.length) {
    body.innerHTML = '<tr><td colspan="7">No linked pilots found for this operator.</td></tr>';
    updateSummary();
    return;
  }

  const visiblePilots = getSortedAndFilteredPilots();

  if (!visiblePilots.length) {
    body.innerHTML = '<tr><td colspan="7">No crew members match the current filters.</td></tr>';
    updateSummary();
    setStatus('No matching crew found. Adjust search, filter, or sort settings.');
    return;
  }

  body.innerHTML = visiblePilots
    .map((pilot) => {
      const docs = docsByPilotCache.get(pilot.uid) || [];
      const status = getCompliance(docs);
      const licenseNumber = getLicenseNumber(docs);
      const medicalExpiry = formatDate(getMedicalExpiry(docs));
      const isSelected = pilot.uid === selectedPilotUid;
      const actionItems = [
        `<button type="button" class="crew-btn crew-btn-secondary" data-action="profile" data-pilot-uid="${escapeHtml(pilot.uid)}">Profile</button>`
      ];

      if (canPerformCrewAction(activeCurrentUser, 'edit')) {
        actionItems.push(`<button type="button" class="crew-btn crew-btn-secondary" data-action="edit-profile" data-pilot-uid="${escapeHtml(pilot.uid)}">Edit</button>`);
        actionItems.push(`<button type="button" class="crew-btn crew-btn-secondary" data-action="toggle-status" data-pilot-uid="${escapeHtml(pilot.uid)}">${pilot.status === 'Active' || !pilot.status ? 'Set Inactive' : 'Set Active'}</button>`);
        actionItems.push(`<button type="button" class="crew-btn crew-btn-secondary" data-action="link-code" data-pilot-uid="${escapeHtml(pilot.uid)}">Generate Link Code</button>`);
        actionItems.push(`<button type="button" class="crew-btn crew-btn-secondary" data-action="delink" data-pilot-uid="${escapeHtml(pilot.uid)}">Delink</button>`);
      }

      if (canPerformCrewAction(activeCurrentUser, 'delete')) {
        actionItems.push(`<button type="button" class="crew-btn crew-btn-danger" data-action="soft-delete" data-pilot-uid="${escapeHtml(pilot.uid)}">Soft Remove</button>`);
      }

      const rowActions = `<div class="crew-action-row">${actionItems.join('')}</div>`;

      return `<tr data-pilot-uid="${escapeHtml(pilot.uid)}" class="${isSelected ? 'selected' : ''}">
        <td><strong>${escapeHtml(toProfileName(pilot))}</strong><br /><small>${escapeHtml(pilot.email || 'No email')}</small></td>
        <td>${escapeHtml(normalizeRole(pilot.role))}</td>
        <td>${escapeHtml(status)}</td>
        <td>${docs.length}</td>
        <td>${escapeHtml(licenseNumber)}</td>
        <td>${escapeHtml(medicalExpiry)}</td>
        <td>${rowActions}</td>
      </tr>`;
    })
    .join('');

  updateSummary();
  renderSelectedCrewLabel();
  setStatus(`Showing ${visiblePilots.length} of ${pilotsCache.length} crew profile(s).`);
}

function renderSelectedCrewLabel() {
  const label = activeView?.querySelector('#crew-selected-label');
  if (!label) return;
  const pilot = pilotsCache.find((item) => item.uid === selectedPilotUid);
  if (!pilot) {
    label.textContent = 'No crew selected';
    return;
  }
  label.textContent = `Selected: ${toProfileName(pilot)} (${pilot.uid})`;
}

async function editPilotProfile(pilotUid) {
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  const nextName = window.prompt('Pilot Name:', pilot.fullName || pilot.name || '');
  if (nextName === null) return;
  const nextEmail = window.prompt('Pilot Email:', pilot.email || '');
  if (nextEmail === null) return;
  const nextRole = window.prompt('Role (PILOT/AME/TRAINING/OPERATIONS):', normalizeRole(pilot.role || 'PILOT'));
  if (nextRole === null) return;
  const nextDesignation = window.prompt('Designation:', pilot.designation || '');
  if (nextDesignation === null) return;
  const nextBase = window.prompt('Base:', pilot.organizationBase || pilot.base || '');
  if (nextBase === null) return;
  const nextPhone = window.prompt('Mobile:', pilot.mobile || pilot.companyPhone || '');
  if (nextPhone === null) return;
  const nextStatus = window.prompt('Status (Active/Inactive/Suspended/On Leave):', pilot.status || 'Active');
  if (nextStatus === null) return;

  const updates = {
    fullName: nextName.trim() || pilot.fullName || pilot.name || '',
    name: nextName.trim() || pilot.name || '',
    email: nextEmail.trim().toLowerCase() || pilot.email || '',
    role: normalizeRole(nextRole.trim() || pilot.role || 'PILOT'),
    designation: nextDesignation.trim() || null,
    organizationBase: nextBase.trim() || null,
    base: nextBase.trim() || null,
    mobile: nextPhone.trim() || null,
    status: nextStatus.trim() || 'Active'
  };

  await updatePilotProfile(pilotUid, updates);
  setStatus(`Updated crew profile ${pilotUid}.`);
  await refreshCrew();
}

async function togglePilotStatus(pilotUid) {
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  const current = `${pilot.status || 'Active'}`;
  const next = current === 'Active' ? 'Inactive' : 'Active';
  await updatePilotProfile(pilotUid, { status: next });
  setStatus(`Status updated to ${next} for ${toProfileName(pilot)}.`);
  await refreshCrew();
}

async function softRemovePilot(pilotUid) {
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  const confirmed = window.confirm('Soft remove this pilot from your roster? This sets status=Deleted and unlinks from operator.');
  if (!confirmed) return;

  await updatePilotProfile(pilotUid, { status: 'Deleted' });
  await delinkPilot(pilotUid);
  setStatus(`Soft removed ${toProfileName(pilot)} from operator roster.`);
  await refreshCrew();
}

async function applyBulkStatusToVisible() {
  if (!activeView) return;
  const select = activeView.querySelector('#crew-bulk-status');
  if (!(select instanceof HTMLSelectElement)) return;

  const nextStatus = `${select.value || ''}`.trim();
  if (!nextStatus) {
    setStatus('Select a bulk status first.');
    return;
  }

  const visible = getSortedAndFilteredPilots();
  if (!visible.length) {
    setStatus('No visible crew to update.');
    return;
  }

  const confirmed = window.confirm(`Apply status ${nextStatus} to ${visible.length} visible crew record(s)?`);
  if (!confirmed) return;

  await Promise.all(visible.map((pilot) => updatePilotProfile(pilot.uid, { status: nextStatus })));
  setStatus(`Applied status ${nextStatus} to ${visible.length} crew record(s).`);
  await refreshCrew();
}

function clearSelectedCrew() {
  selectedPilotUid = null;
  const body = activeView?.querySelector('#crew-doc-table-body');
  const caption = activeView?.querySelector('#crew-doc-caption');
  if (caption) caption.textContent = 'Select a pilot row to inspect Firestore document fields.';
  if (body) body.innerHTML = '<tr><td colspan="13">No pilot selected.</td></tr>';
  renderCrewTable();
}

async function moveSelection(direction) {
  const visible = getSortedAndFilteredPilots();
  if (!visible.length) {
    setStatus('No crew available for navigation.');
    return;
  }

  const currentIndex = visible.findIndex((item) => item.uid === selectedPilotUid);
  const safeIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = direction === 'next'
    ? Math.min(safeIndex + 1, visible.length - 1)
    : Math.max(safeIndex - 1, 0);

  await selectPilot(visible[nextIndex].uid);
}

function renderPilotDocuments(documents, pilot) {
  if (!activeView) return;

  const caption = activeView.querySelector('#crew-doc-caption');
  const body = activeView.querySelector('#crew-doc-table-body');
  if (!caption || !body) return;

  caption.textContent = `Showing ${documents.length} document(s) for ${toProfileName(pilot)}.`;

  if (!documents.length) {
    body.innerHTML = '<tr><td colspan="13">No documents found for this pilot.</td></tr>';
    return;
  }

  body.innerHTML = documents
    .map((doc) => `<tr>
      <td>${escapeHtml(doc.documentCategory || 'GENERAL')}</td>
      <td>${escapeHtml(doc.documentName || 'Untitled')}</td>
      <td>${escapeHtml(doc.licenseOrCertificateNumber || 'N/A')}</td>
      <td>${escapeHtml(formatDate(doc.issueDate))}</td>
      <td>${escapeHtml(formatDate(doc.expiryDate))}</td>
      <td>${escapeHtml(doc.issuingAuthorityOrBody || 'N/A')}</td>
      <td>${escapeHtml(`${doc.reminderLeadTimeDays ?? 'N/A'} day(s)` )}</td>
      <td>${Array.isArray(doc.readers) ? doc.readers.length : 0}</td>
      <td>${escapeHtml(doc.storagePath || 'N/A')}</td>
      <td>${escapeHtml(doc.documentUri || 'N/A')}</td>
      <td>${escapeHtml(doc.lastEditedBy || 'N/A')}</td>
      <td>${escapeHtml(formatDate(doc.lastModified))}${doc.isDirty ? ' (Pending Sync)' : ''}</td>
      <td>
        <button type="button" class="crew-btn crew-btn-secondary" data-doc-action="edit" data-document-id="${escapeHtml(doc.firestoreId)}">Edit</button>
        <button type="button" class="crew-btn crew-btn-danger" data-doc-action="delete" data-document-id="${escapeHtml(doc.firestoreId)}" data-storage-path="${escapeHtml(doc.storagePath || '')}">Delete</button>
      </td>
    </tr>`)
    .join('');
}

function normalizeRequestStatus(status) {
  const normalized = `${status || ''}`.trim().toUpperCase();
  if (normalized === 'REJECTED') return 'DECLINED';
  return normalized || 'PENDING';
}

function renderOutgoingRequests() {
  if (!activeView) return;
  const body = activeView.querySelector('#crew-link-table-body');
  if (!body) return;

  if (!outgoingRequestsCache.length) {
    body.innerHTML = '<tr><td colspan="4">No outgoing requests.</td></tr>';
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

      return `<tr>
        <td>${escapeHtml(request.recipientEmail || request.recipientId || 'Unknown')}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(formatDate(request.createdAt))}</td>
        <td><span class="muted">Awaiting pilot response</span></td>
      </tr>`;
    })
    .join('');
}

function renderIncomingRequests() {
  if (!activeView) return;
  const body = activeView.querySelector('#crew-incoming-table-body');
  if (!body) return;

  if (!incomingRequestsCache.length) {
    body.innerHTML = '<tr><td colspan="5">No incoming requests.</td></tr>';
    return;
  }

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
        <td>${escapeHtml(request.requesterName || request.requesterId || 'Unknown')}</td>
        <td>${escapeHtml(request.requesterEmail || 'N/A')}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(formatDate(request.createdAt))}</td>
        <td>
          <div class="crew-action-row">
            ${canAccept ? `<button type="button" class="crew-btn crew-btn-primary" data-incoming-action="accept" data-request-id="${escapeHtml(request.requestId)}" data-operator-uid="${escapeHtml(request.requesterId)}">Accept</button>` : ''}
            ${canRespond ? `<button type="button" class="crew-btn crew-btn-danger" data-incoming-action="decline" data-request-id="${escapeHtml(request.requestId)}">Decline</button>` : ''}
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

async function selectPilot(pilotUid) {
  const pilot = pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  selectedPilotUid = pilotUid;
  renderCrewTable();

  pilotDocUnsubscribe?.();
  pilotDocUnsubscribe = null;

  const docs = await getPilotDocuments(pilotUid);
  docsByPilotCache.set(pilotUid, docs);
  renderPilotDocuments(docs, pilot);

  pilotDocUnsubscribe = watchDocumentsByUser(
    pilotUid,
    (snapshot) => {
      const nextDocs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      docsByPilotCache.set(pilotUid, nextDocs);
      renderCrewTable();
      renderPilotDocuments(nextDocs, pilot);
    },
    (error) => console.error('Crew document watch error:', error)
  );
}

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
    renderPilotDocuments(pilotDocs, pilotsCache[0]);
    renderIncomingRequests();
    setStatus(`Loaded your pilot profile and ${pilotDocs.length} document(s).`);
    return;
  }

  if (!activeOperatorUid) return;
  const [pilots, outgoingRequests] = await Promise.all([getCrew(activeOperatorUid), getOutgoingLinkRequests(activeOperatorUid)]);
  pilotsCache = pilots;
  outgoingRequestsCache = outgoingRequests;
  docsByPilotCache = await getCrewDocumentsByPilots(pilots.map((pilot) => pilot.uid));
  setStatus(`Loaded ${pilots.length} pilot profile(s) from Firestore.`);
  renderCrewTable();
  renderOutgoingRequests();

  if (selectedPilotUid && pilots.some((pilot) => pilot.uid === selectedPilotUid)) {
    await selectPilot(selectedPilotUid);
  }
}

function setAddFormBusy(isBusy) {
  const submit = activeView?.querySelector('#crew-add-submit');
  if (!submit) return;
  submit.disabled = isBusy;
  submit.textContent = isBusy ? 'Creating...' : 'Create Crew Profile';
}

async function createOperatorCrewProfile(form) {
  if (!(form instanceof HTMLFormElement)) return;
  if (!activeOperatorUid) return;

  const addStatus = activeView?.querySelector('#crew-add-status');
  const name = form.name?.value?.trim();
  const email = form.email?.value?.trim().toLowerCase();
  const license = form.license?.value?.trim();
  const medicalExpiryDate = toTimestampCandidate(form.medicalExpiry?.value || null);
  const licenseExpiryDate = toTimestampCandidate(form.licenseExpiry?.value || null);

  if (!name || !email || !license) {
    if (addStatus) addStatus.textContent = 'Name, email, and license number are required.';
    return;
  }

  try {
    setAddFormBusy(true);
    if (addStatus) addStatus.textContent = 'Creating crew profile and seed compliance records...';

    const result = await createPilot({
      name,
      email,
      licenseNum: license,
      medicalExpiryDate,
      licenseExpiryDate,
      operatorUid: activeOperatorUid
    });

    form.reset();
    if (addStatus) addStatus.textContent = `Crew profile created: ${result.uid}.`;
    await refreshCrew();
    await selectPilot(result.uid);
  } catch (error) {
    console.error('Create crew profile failed:', error);
    if (addStatus) addStatus.textContent = error.message || 'Unable to create crew profile.';
  } finally {
    setAddFormBusy(false);
  }
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
  } catch (error) {
    console.error('Generate link code failed:', error);
    setStatus(error.message || 'Unable to generate link code.');
  }
}

function upsertDocInCache(pilotUid, document) {
  const current = docsByPilotCache.get(pilotUid) || [];
  const next = current.filter((item) => item.firestoreId !== document.firestoreId);
  next.push(document);
  docsByPilotCache.set(pilotUid, next);
}

function applyDocumentTemplate(templateKey) {
  if (!activeView) return;
  if (!templateKey || templateKey === 'CUSTOM') return;

  const template = DOC_TEMPLATE_PRESETS[templateKey];
  if (!template) return;

  const nameInput = activeView.querySelector('#crew-doc-name');
  const categoryInput = activeView.querySelector('#crew-doc-category');
  const reminderInput = activeView.querySelector('#crew-doc-reminder');
  const authorityInput = activeView.querySelector('#crew-doc-authority');
  const status = activeView.querySelector('#crew-doc-upload-status');

  if (nameInput instanceof HTMLInputElement) {
    nameInput.value = template.documentName;
  }
  if (categoryInput instanceof HTMLInputElement) {
    categoryInput.value = template.documentCategory;
  }
  if (reminderInput instanceof HTMLInputElement) {
    reminderInput.value = `${template.reminderLeadTimeDays}`;
  }
  if (authorityInput instanceof HTMLInputElement && !authorityInput.value.trim()) {
    authorityInput.value = template.issuingAuthorityOrBody;
  }

  if (status) {
    status.textContent = `Applied template: ${template.documentName}`;
  }
}

function bindEvents() {
  activeView?.querySelector('#crew-refresh')?.addEventListener('click', async () => {
    setStatus('Refreshing crew data...');
    await refreshCrew();
    renderQueueSyncState();
  });

  activeView?.querySelector('#crew-sync-retry')?.addEventListener('click', async () => {
    await runQueueSync({ source: 'manual', refreshAfter: true });
  });

  activeView?.querySelector('#crew-prev')?.addEventListener('click', async () => {
    await moveSelection('prev');
  });

  activeView?.querySelector('#crew-next')?.addEventListener('click', async () => {
    await moveSelection('next');
  });

  activeView?.querySelector('#crew-clear-selection')?.addEventListener('click', () => {
    clearSelectedCrew();
  });

  activeView?.querySelector('#crew-bulk-apply')?.addEventListener('click', async () => {
    if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
    await applyBulkStatusToVisible();
  });

  activeView?.querySelector('#crew-search')?.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    crewListState.searchText = target.value || '';
    renderCrewTable();
  });

  activeView?.querySelector('#crew-filter-compliance')?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    crewListState.compliance = `${target.value || 'ALL'}`.toUpperCase();
    renderCrewTable();
  });

  activeView?.querySelector('#crew-filter-role')?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    crewListState.role = `${target.value || 'ALL'}`.toUpperCase();
    renderCrewTable();
  });

  activeView?.querySelector('#crew-sort-field')?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    crewListState.sortField = `${target.value || 'name'}`;
    renderCrewTable();
  });

  activeView?.querySelector('#crew-sort-direction')?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    crewListState.sortDirection = `${target.value || 'asc'}`;
    renderCrewTable();
  });

  activeView?.querySelector('#crew-doc-template')?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    applyDocumentTemplate(target.value || 'CUSTOM');
  });

  activeView?.querySelector('#crew-table-body')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const actionButton = target.closest('button[data-action]');
    if (actionButton) {
      const action = actionButton.getAttribute('data-action');
      const pilotUid = actionButton.getAttribute('data-pilot-uid');
      if (!action || !pilotUid) return;

      if (action === 'profile') {
        window.sessionStorage.setItem(CREW_PROFILE_SESSION_KEY, pilotUid);
        window.location.hash = '#/crew-profile';
        return;
      }

      if (action === 'edit-profile') {
        if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
        await editPilotProfile(pilotUid);
        return;
      }

      if (action === 'toggle-status') {
        if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
        await togglePilotStatus(pilotUid);
        return;
      }

      if (action === 'soft-delete') {
        if (!canPerformCrewAction(activeCurrentUser, 'delete')) return;
        await softRemovePilot(pilotUid);
        return;
      }

      if (action === 'link-code') {
        if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
        await issueCrewLinkCode(pilotUid);
        return;
      }

      if (action === 'delink') {
        if (isPilotRole()) return;
        const confirmed = window.confirm('Delink this pilot from your organization?');
        if (!confirmed) return;
        await delinkPilot(pilotUid);
        setStatus(`Pilot ${pilotUid} delinked.`);
        await refreshCrew();
        return;
      }
      return;
    }

    const pilotRow = target.closest('tr[data-pilot-uid]');
    if (!pilotRow) return;
    const pilotUid = pilotRow.getAttribute('data-pilot-uid');
    if (!pilotUid) return;
    await selectPilot(pilotUid);
  });

  activeView?.querySelector('#crew-add-form')?.addEventListener('submit', async (event) => {
    if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
    event.preventDefault();
    await createOperatorCrewProfile(event.currentTarget);
  });

  activeView?.querySelector('#crew-link-form')?.addEventListener('submit', async (event) => {
    if (!canPerformCrewAction(activeCurrentUser, 'manageLinkRequests')) return;
    event.preventDefault();
    if (!activeOperatorUid) return;

    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;

    const pilotEmail = form.pilotEmail?.value?.trim().toLowerCase();
    const linkStatus = activeView?.querySelector('#crew-link-status');
    const submit = activeView?.querySelector('#crew-link-submit');

    if (!pilotEmail) {
      if (linkStatus) linkStatus.textContent = 'Pilot email is required.';
      return;
    }

    try {
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Sending...';
      }
      if (linkStatus) linkStatus.textContent = 'Sending connection request...';

      await requestPilotLinkByEmail({
        requesterId: activeOperatorUid,
        requesterName: toProfileName(activeCurrentUser),
        requesterEmail: activeCurrentUser?.email || '',
        pilotEmail
      });

      form.reset();
      if (linkStatus) linkStatus.textContent = `Connection request sent to ${pilotEmail}.`;
      await refreshCrew();
    } catch (error) {
      console.error('Pilot link request failed:', error);
      if (linkStatus) linkStatus.textContent = error.message || 'Unable to send connection request.';
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Send Request';
      }
    }
  });

  activeView?.querySelector('#crew-incoming-table-body')?.addEventListener('click', async (event) => {
    if (!canPerformCrewAction(activeCurrentUser, 'respondIncomingRequest')) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest('button[data-incoming-action]');
    if (!button) return;

    const action = button.getAttribute('data-incoming-action');
    const requestId = button.getAttribute('data-request-id');
    const operatorUid = button.getAttribute('data-operator-uid');
    if (!action || !requestId) return;

    const statusLabel = activeView?.querySelector('#crew-status');
    const pilotUid = activeCurrentUser?.uid;
    if (!pilotUid) return;

    if (action === 'accept' && operatorUid) {
      await acceptIncomingLinkRequest({ requestId, pilotUid, operatorUid });
      if (statusLabel) {
        statusLabel.textContent = `Accepted request. You are now linked to operator ${operatorUid}.`;
      }
      activeCurrentUser = { ...activeCurrentUser, linkedOperator: operatorUid };
      await refreshCrew();
      return;
    }

    if (action === 'decline') {
      await declineConnectionRequest(requestId);
      if (statusLabel) {
        statusLabel.textContent = 'Connection request declined.';
      }
      await refreshCrew();
    }
  });

  activeView?.querySelector('#crew-doc-upload-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;

    const targetPilotUid = selectedPilotUid || activeCurrentUser?.uid;
    const status = activeView?.querySelector('#crew-doc-upload-status');
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
    const submit = activeView?.querySelector('#crew-doc-upload-submit');

    if (!documentName || !file) {
      if (status) status.textContent = 'Document name and file are required.';
      return;
    }

    const targetPilot = pilotsCache.find((pilot) => pilot.uid === targetPilotUid) || activeCurrentUser || null;
    const operatorId = isPilotRole() ? activeCurrentUser?.linkedOperator || null : activeOperatorUid;
    const readers = [targetPilotUid, operatorId].filter(Boolean);
    const firestoreId = generateId();

    try {
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Uploading...';
      }
      if (status) status.textContent = 'Uploading file to Firebase Storage...';

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
      const templateSelect = activeView?.querySelector('#crew-doc-template');
      if (templateSelect instanceof HTMLSelectElement) {
        templateSelect.value = 'CUSTOM';
      }
      if (status) status.textContent = `Uploaded to ${uploadResult.storagePath}.`;

      await selectPilot(targetPilotUid);
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
        renderPilotDocuments(docsByPilotCache.get(targetPilotUid) || [], targetPilot);
        renderQueueSyncState();
        if (status) {
          status.textContent = 'Network unavailable. Document edit queued and marked dirty.';
        }
      } else {
        if (status) status.textContent = error.message || 'Unable to upload document.';
      }
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Upload Document';
      }
    }
  });

  activeView?.querySelector('#crew-doc-table-body')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest('button[data-doc-action]');
    if (!button) return;

    const action = button.getAttribute('data-doc-action');
    const documentId = button.getAttribute('data-document-id');
    const storagePath = button.getAttribute('data-storage-path');
    if (!action || !documentId) return;

    if (action === 'edit') {
      if (!canPerformCrewAction(activeCurrentUser, 'edit')) return;
      const pilotUid = selectedPilotUid || activeCurrentUser?.uid;
      const pilotDocs = docsByPilotCache.get(pilotUid) || [];
      const targetDoc = pilotDocs.find((item) => item.firestoreId === documentId);
      if (!targetDoc) return;

      const nextIssueDateRaw = window.prompt('Issue Date (YYYY-MM-DD, blank to keep current):', formatDate(targetDoc.issueDate) === 'N/A' ? '' : toDateValue(targetDoc.issueDate)?.toISOString().slice(0, 10) || '');
      if (nextIssueDateRaw === null) return;
      const nextExpiryDateRaw = window.prompt('Expiry Date (YYYY-MM-DD, blank to keep current):', formatDate(targetDoc.expiryDate) === 'N/A' ? '' : toDateValue(targetDoc.expiryDate)?.toISOString().slice(0, 10) || '');
      if (nextExpiryDateRaw === null) return;
      const nextLicenseRaw = window.prompt('License/Certificate Number (blank to keep current):', targetDoc.licenseOrCertificateNumber || '');
      if (nextLicenseRaw === null) return;

      const updates = {
        issueDate: nextIssueDateRaw.trim() ? toTimestampCandidate(nextIssueDateRaw.trim()) : targetDoc.issueDate || null,
        expiryDate: nextExpiryDateRaw.trim() ? toTimestampCandidate(nextExpiryDateRaw.trim()) : targetDoc.expiryDate || null,
        licenseOrCertificateNumber: nextLicenseRaw.trim() || null,
        isDirty: false
      };

      const status = activeView?.querySelector('#crew-doc-upload-status');
      try {
        if (status) status.textContent = 'Saving document updates...';
        await updatePilotDocumentWithAudit(documentId, updates, activeCurrentUser?.uid || null);
        if (status) status.textContent = 'Document updated with audit log.';
        if (pilotUid) {
          await selectPilot(pilotUid);
        } else {
          await refreshCrew();
        }
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
                ? {
                    ...item,
                    ...updates,
                    isDirty: true,
                    lastEditedBy: activeCurrentUser?.uid || null,
                    lastModified: new Date()
                  }
                : item
            );
            docsByPilotCache.set(targetPilotUid, nextDocs);
            const targetPilot = pilotsCache.find((item) => item.uid === targetPilotUid) || activeCurrentUser;
            renderCrewTable();
            renderPilotDocuments(nextDocs, targetPilot);
          }

          renderQueueSyncState();

          if (status) status.textContent = 'Network unavailable. Update queued for sync.';
        } else {
          if (status) status.textContent = error.message || 'Unable to update document.';
        }
      }
      return;
    }

    if (action !== 'delete') return;
    if (!canPerformCrewAction(activeCurrentUser, 'delete')) return;

    const confirmed = window.confirm('Delete this document and its storage file?');
    if (!confirmed) return;

    const status = activeView?.querySelector('#crew-doc-upload-status');
    try {
      if (status) status.textContent = 'Deleting document metadata...';
      await removePilotDocument(documentId);

      if (storagePath) {
        try {
          await deleteUserDocumentFile(storagePath);
        } catch (storageError) {
          console.warn('Storage file delete failed:', storageError);
        }
      }

      if (status) status.textContent = 'Document deleted.';
      if (selectedPilotUid) {
        await selectPilot(selectedPilotUid);
      } else {
        await refreshCrew();
      }
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
          renderPilotDocuments(nextDocs, targetPilot);
        }

        renderQueueSyncState();

        if (status) status.textContent = 'Network unavailable. Delete queued for sync.';
      } else {
        if (status) status.textContent = error.message || 'Unable to delete document.';
      }
    }
  });
}

export async function init(view, context) {
  activeView = view;

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Crew Management';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'crew';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;
  const currentUser = context?.currentUser || null;
  const orgContext = getCurrentOrganizationContext(currentUser);
  activeOperatorUid = orgContext.organizationId || operatorUid;
  activeCurrentUser = currentUser;
  activeRole = normalizeRole(currentUser?.role);
  crewPermissions = getCrewPermissionsForUser(currentUser);

  applyRoleLayout();

  if (!currentUser?.uid) {
    setStatus('Crew module requires operator UID.');
    return {
      destroy() {}
    };
  }

  bindEvents();
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
        renderPilotDocuments(docs, { ...activeCurrentUser, uid: pilotUid });
      },
      (error) => console.error('Pilot document snapshot error:', error)
    );

    incomingRequestUnsubscribe = onIncomingLinkRequests(
      pilotUid,
      (snapshot) => {
        incomingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        renderIncomingRequests();
      },
      (error) => console.error('Incoming link requests snapshot error:', error)
    );
  } else {
    crewUnsubscribe = onCrewSnapshot(
      activeOperatorUid,
      async (profiles) => {
        pilotsCache = profiles.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
        docsByPilotCache = await getCrewDocumentsByPilots(pilotsCache.map((pilot) => pilot.uid));
        renderCrewTable();
        setStatus(`Live update: ${pilotsCache.length} pilot profile(s).`);
        if (selectedPilotUid && pilotsCache.some((pilot) => pilot.uid === selectedPilotUid)) {
          const pilot = pilotsCache.find((item) => item.uid === selectedPilotUid);
          if (pilot) {
            renderPilotDocuments(docsByPilotCache.get(selectedPilotUid) || [], pilot);
          }
        }
      },
      (error) => console.error('Crew snapshot error:', error)
    );

    outgoingRequestUnsubscribe = onOutgoingLinkRequests(
      operatorUid,
      (snapshot) => {
        outgoingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        renderOutgoingRequests();
      },
      (error) => console.error('Outgoing link requests snapshot error:', error)
    );
  }

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
      crewListState.sortField = 'name';
      crewListState.sortDirection = 'asc';
      pilotsCache = [];
      docsByPilotCache = new Map();
      selectedPilotUid = null;
      outgoingRequestsCache = [];
      incomingRequestsCache = [];
      if (queueMonitorTimer) {
        clearInterval(queueMonitorTimer);
      }
      queueMonitorTimer = null;
      queueSyncBusy = false;
      queueSyncLastAttemptAt = null;
      queueSyncLastError = null;
      if (queueSyncFlashTimer) {
        clearTimeout(queueSyncFlashTimer);
      }
      queueSyncFlashTimer = null;
    }
  };
}
