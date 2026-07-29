import {
  getCrew,
  onCrewSnapshot,
  delinkPilot,
  requestPilotLinkByEmail,
  getIncomingLinkRequests,
  getOutgoingLinkRequests,
  onIncomingLinkRequests,
  onOutgoingLinkRequests,
  acceptIncomingLinkRequest,
  declineConnectionRequest,
  getPilotDocuments,
  createPilotDocument,
  removePilotDocument,
  getCrewDocumentsByPilots,
  summarizeCrewDocumentCompliance
} from '../../services/crewService.js';
import { watchDocumentsByUser } from '../../services/documentService.js';
import { uploadUserDocumentFile, deleteUserDocumentFile } from '../../services/storageService.js';

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

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatDate(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString() : 'N/A';
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

function setStatus(message) {
  const status = activeView?.querySelector('#crew-status');
  if (status) status.textContent = message;
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
  setVisible('#crew-add-card', false);
  setVisible('#crew-link-card', !pilotMode);
  setVisible('#crew-incoming-card', pilotMode);

  const uploadStatus = activeView?.querySelector('#crew-doc-upload-status');
  if (uploadStatus && pilotMode) {
    uploadStatus.textContent = 'You can upload documents to your own profile.';
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

  body.innerHTML = pilotsCache
    .map((pilot) => {
      const docs = docsByPilotCache.get(pilot.uid) || [];
      const status = getCompliance(docs);
      const licenseNumber = getLicenseNumber(docs);
      const medicalExpiry = formatDate(getMedicalExpiry(docs));
      const isSelected = pilot.uid === selectedPilotUid;
      const rowActions = isPilotRole()
        ? '<span class="muted">Self</span>'
        : `<div class="crew-action-row">
            <button type="button" class="crew-btn crew-btn-secondary" data-action="delink" data-pilot-uid="${escapeHtml(pilot.uid)}">Delink</button>
          </div>`;

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
      <td>${escapeHtml(formatDate(doc.lastModified))}</td>
      <td>
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
  submit.textContent = isBusy ? 'Adding...' : 'Add Pilot';
}

function bindEvents() {
  activeView?.querySelector('#crew-refresh')?.addEventListener('click', async () => {
    setStatus('Refreshing crew data...');
    await refreshCrew();
  });

  activeView?.querySelector('#crew-table-body')?.addEventListener('click', async (event) => {
    if (isPilotRole()) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const actionButton = target.closest('button[data-action]');
    if (actionButton) {
      const action = actionButton.getAttribute('data-action');
      const pilotUid = actionButton.getAttribute('data-pilot-uid');
      if (!action || !pilotUid) return;

      if (action === 'delink') {
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
    if (!isOperationsRole()) return;
    event.preventDefault();
    const addStatus = activeView?.querySelector('#crew-add-status');
    if (addStatus) addStatus.textContent = 'Pilot profiles must be self-created by pilots under current Firestore rules.';
  });

  activeView?.querySelector('#crew-link-form')?.addEventListener('submit', async (event) => {
    if (!isOperationsRole()) return;
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
    if (!isPilotRole()) return;

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
      if (status) status.textContent = `Uploaded to ${uploadResult.storagePath}.`;

      await selectPilot(targetPilotUid);
    } catch (error) {
      console.error('Document upload failed:', error);
      if (status) status.textContent = error.message || 'Unable to upload document.';
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
    if (action !== 'delete' || !documentId) return;

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
      if (status) status.textContent = error.message || 'Unable to delete document.';
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
  activeOperatorUid = operatorUid;
  activeCurrentUser = currentUser;
  activeRole = normalizeRole(currentUser?.role);

  applyRoleLayout();

  if (!currentUser?.uid) {
    setStatus('Crew module requires operator UID.');
    return {
      destroy() {}
    };
  }

  bindEvents();
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
      operatorUid,
      async (snapshot) => {
        pilotsCache = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
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
      pilotsCache = [];
      docsByPilotCache = new Map();
      selectedPilotUid = null;
      outgoingRequestsCache = [];
      incomingRequestsCache = [];
    }
  };
}
