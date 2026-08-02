import { crewState, docListState } from './state.js';
import {
  query,
  escapeHtml,
  toProfileName,
  showToast,
  setStatus,
  formatExpiry,
  formatShortDate,
  toInputDate,
  toTimestampCandidate,
  generateId,
  openModal,
  closeModal,
  confirmModal,
  normalizeSearchText,
  setFormField,
  isPilotRole
} from './utils.js';
import { getDocumentComplianceState } from '../../services/documentService.js';
import { createPilotDocument, updatePilotDocumentWithAudit, removePilotDocument } from '../../services/crewService.js';
import { uploadUserDocumentFile, deleteUserDocumentFile } from '../../services/storageService.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import {
  enqueueCrewDocumentCreate,
  enqueueCrewDocumentUpdate,
  enqueueCrewDocumentDelete,
  shouldQueueError
} from '../../services/crewDocumentSyncService.js';
import { DOCUMENT_MASTER_LIST } from './documentsConfig.js';
import { renderCrewTable, updateKPIs } from './directory.js';
import { renderQueueSyncState } from './queue.js';
import { selectPilot, refreshCrew } from './crew.js';

export function renderDocPilotSelect() {
  const select = query('#cm-doc-pilot');
  if (!select) return;
  select.innerHTML = crewState.pilotsCache
    .filter((pilot) => `${pilot.status || 'Active'}` !== 'Deleted')
    .map((pilot) => `<option value="${escapeHtml(pilot.uid)}">${escapeHtml(toProfileName(pilot))}</option>`)
    .join('');
  if (crewState.selectedPilotUid) select.value = crewState.selectedPilotUid;
}

export function renderDocumentsTab() {
  if (!crewState.selectedPilotUid && crewState.pilotsCache.length && !isPilotRole()) {
    const first = crewState.pilotsCache.find((pilot) => `${pilot.status || 'Active'}` !== 'Deleted');
    if (first) crewState.selectedPilotUid = first.uid;
  }
  renderDocPilotSelect();
  const caption = query('#cm-doc-caption');
  if (caption) caption.textContent = 'Documents';
  renderPilotDocuments();
}

export function getFilteredDocs() {
  const pilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
  const docs = crewState.docsByPilotCache.get(pilotUid) || [];
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

export function renderPilotDocuments() {
  const body = query('#cm-doc-table-body');
  const caption = query('#cm-doc-caption');
  const uploadCaption = query('#cm-doc-upload-caption');
  if (!body) return;

  const pilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid) || crewState.activeCurrentUser;
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
            ${canPerformCrewAction(crewState.activeCurrentUser, 'edit') ? `
              <button type="button" class="cm-action-btn" data-doc-action="edit" data-document-id="${escapeHtml(doc.firestoreId)}" data-tip="Edit" aria-label="Edit document">
                <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>` : ''}
            ${canPerformCrewAction(crewState.activeCurrentUser, 'delete') ? `
              <button type="button" class="cm-action-btn is-danger" data-doc-action="delete" data-document-id="${escapeHtml(doc.firestoreId)}" data-storage-path="${escapeHtml(doc.storagePath || '')}" data-tip="Delete" aria-label="Delete document">
                <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>` : ''}
          </span>
        </td>
      </tr>`;
    })
    .join('');
}

export function getDocumentCategoryKey() {
  return `${query('#cm-doc-category-input')?.value || 'LICENCE'}`.toUpperCase();
}

export function populateDocumentNames(categoryKey) {
  const select = query('#cm-doc-name');
  const customInput = query('#cm-doc-name-custom');
  if (!select || !(select instanceof HTMLSelectElement)) return;
  const key = `${categoryKey || 'LICENCE'}`.toUpperCase();
  const isCustom = key === 'CUSTOM';
  const presets = DOCUMENT_MASTER_LIST[key] || [];

  select.innerHTML = isCustom
    ? ''
    : `<option value="">Select document...</option>${presets
        .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)
        .join('')}`;

  if (customInput instanceof HTMLInputElement) {
    customInput.classList.toggle('hidden', !isCustom);
    if (!isCustom) customInput.value = '';
  }

  if (isCustom) {
    setFormField('#cm-doc-reminder', '30');
    if (customInput instanceof HTMLInputElement) customInput.focus();
  }
}

export function onDocumentCategoryChange(categoryKey) {
  populateDocumentNames(categoryKey);
  const key = `${categoryKey || ''}`.toUpperCase();
  const presets = DOCUMENT_MASTER_LIST[key] || [];
  const first = key !== 'CUSTOM' ? presets[0] : null;

  if (first) {
    setFormField('#cm-doc-authority', first.authority || '');
    setFormField('#cm-doc-reminder', `${first.reminderDays ?? 30}`);
  }

  const status = query('#cm-doc-upload-status');
  if (status) {
    status.textContent = '';
    status.classList.remove('is-success', 'is-error');
  }
}

export function onDocumentNameChange(name) {
  const presets = DOCUMENT_MASTER_LIST[getDocumentCategoryKey()] || [];
  const preset = presets.find((item) => item.name === name);
  if (!preset) return;
  setFormField('#cm-doc-authority', preset.authority || '');
  setFormField('#cm-doc-reminder', `${preset.reminderDays ?? 30}`);
}

export function toggleUploadCard(show) {
  const card = query('#cm-doc-upload-card');
  if (!card) return;
  card.classList.toggle('hidden', !show);
  if (show) {
    populateDocumentNames(getDocumentCategoryKey());
    const caption = query('#cm-doc-upload-caption');
    const pilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
    const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
    if (caption && pilot) caption.textContent = `Uploading for ${toProfileName(pilot)}.`;
  }
}

export function previewDocument(doc) {
  if (!doc?.documentUri) return;
  openModal(`
    <p>${escapeHtml(doc.documentName || 'Document')} — ${escapeHtml(doc.documentCategory || 'GENERAL')}</p>
    ${/\.pdf($|\?)/i.test(doc.documentUri)
      ? `<iframe class="cm-pdf-viewer" src="${escapeHtml(doc.documentUri)}" title="Document preview"></iframe>`
      : `<p>This file type can't be previewed inline. <a href="${escapeHtml(doc.documentUri)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a>.</p>`}
  `, { title: doc.documentName || 'Document' });
}

export async function downloadDocument(doc) {
  if (!doc?.documentUri) return;
  window.open(doc.documentUri, '_blank', 'noopener,noreferrer');
}

export function upsertDocInCache(pilotUid, document) {
  const current = crewState.docsByPilotCache.get(pilotUid) || [];
  const next = current.filter((item) => item.firestoreId !== document.firestoreId);
  next.push(document);
  crewState.docsByPilotCache.set(pilotUid, next);
}

export function getTargetPilot() {
  const pilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
  return crewState.pilotsCache.find((pilot) => pilot.uid === pilotUid) || crewState.activeCurrentUser || null;
}

export async function submitDocumentUpload(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const targetPilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
  const status = query('#cm-doc-upload-status');
  if (!targetPilotUid) {
    if (status) status.textContent = 'Select a pilot before uploading a document.';
    return;
  }

  const documentCategory = form.documentCategory?.value?.trim() || 'GENERAL';
  const isCustomCategory = `${documentCategory}`.toUpperCase() === 'CUSTOM';
  const documentName = isCustomCategory
    ? form.documentNameCustom?.value?.trim()
    : form.documentName?.value?.trim();
  const licenseOrCertificateNumber = form.licenseNumber?.value?.trim() || null;
  const issueDate = toTimestampCandidate(form.issueDate?.value || null);
  const expiryDate = toTimestampCandidate(form.expiryDate?.value || null);
  const issuingAuthorityOrBody = form.authority?.value?.trim() || null;
  const notesOrRemarks = form.notesOrRemarks?.value?.trim() || null;
  const reminderLeadTimeDays = Number.parseInt(form.reminderDays?.value || '30', 10);
  const file = form.documentFile?.files?.[0] || null;
  const submit = query('#cm-doc-upload-submit');

  if (!documentName || !file) {
    if (status) status.textContent = 'Document name and file are required.';
    return;
  }

  const targetPilot = getTargetPilot();
  const operatorId = isPilotRole() ? crewState.activeCurrentUser?.linkedOperator || null : crewState.activeOperatorUid;
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
      notesOrRemarks,
      operatorId,
      readers,
      reminderLeadTimeDays: Number.isNaN(reminderLeadTimeDays) ? 30 : reminderLeadTimeDays,
      documentUri: uploadResult.documentUri,
      storagePath: uploadResult.storagePath,
      lastEditedBy: crewState.activeCurrentUser?.uid || null
    });

    form.reset();
    populateDocumentNames(getDocumentCategoryKey());
    if (status) {
      status.textContent = `Uploaded to ${uploadResult.storagePath}.`;
      status.classList.add('is-success');
    }
    showToast('Document uploaded.', 'success');

    await selectPilot(targetPilotUid);
    if (crewState.activeTab === 'documents') renderPilotDocuments();
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
        notesOrRemarks,
        operatorId,
        readers,
        reminderLeadTimeDays: Number.isNaN(reminderLeadTimeDays) ? 30 : reminderLeadTimeDays,
        documentUri: null,
        storagePath: null,
        lastEditedBy: crewState.activeCurrentUser?.uid || null,
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
        notesOrRemarks,
        operatorId,
        readers,
        reminderLeadTimeDays: Number.isNaN(reminderLeadTimeDays) ? 30 : reminderLeadTimeDays,
        documentUri: null,
        storagePath: null,
        lastEditedBy: crewState.activeCurrentUser?.uid || null,
        lastModified: new Date(),
        isDirty: true
      });

      renderCrewTable();
      renderPilotDocuments();
      renderQueueSyncState();
      if (status) {
        status.textContent = 'Network unavailable. Document upload queued and marked dirty.';
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

export async function editDocumentWithForm(documentId) {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'edit')) return;
  const pilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
  const pilotDocs = crewState.docsByPilotCache.get(pilotUid) || [];
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
        <label class="cm-field">
          <span>Notes / Remarks</span>
          <textarea id="cm-doc-edit-notes" rows="3" placeholder="Optional remarks about this document">${escapeHtml(targetDoc.notesOrRemarks || '')}</textarea>
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
      notesOrRemarks: query('#cm-doc-edit-notes')?.value?.trim() || null,
      isDirty: false
    };

    try {
      closeModal();
      if (status) status.textContent = 'Saving document updates...';
      await updatePilotDocumentWithAudit(documentId, updates, crewState.activeCurrentUser?.uid || null);
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
          editedBy: crewState.activeCurrentUser?.uid || null
        });
        const targetPilotUid = pilotUid || crewState.activeCurrentUser?.uid;
        if (targetPilotUid) {
          const nextDocs = (crewState.docsByPilotCache.get(targetPilotUid) || []).map((item) =>
            item.firestoreId === documentId
              ? { ...item, ...updates, isDirty: true, lastEditedBy: crewState.activeCurrentUser?.uid || null, lastModified: new Date() }
              : item
          );
          crewState.docsByPilotCache.set(targetPilotUid, nextDocs);
          const targetPilot = crewState.pilotsCache.find((item) => item.uid === targetPilotUid) || crewState.activeCurrentUser;
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

export async function deleteDocument(documentId, storagePath) {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'delete')) return;
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
        if (crewState.selectedPilotUid) await selectPilot(crewState.selectedPilotUid);
        else await refreshCrew();
      } catch (error) {
        console.error('Document delete failed:', error);
        if (shouldQueueError(error)) {
          enqueueCrewDocumentDelete({
            documentId,
            storagePath: storagePath || null
          });
          const targetPilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
          if (targetPilotUid) {
            const nextDocs = (crewState.docsByPilotCache.get(targetPilotUid) || []).filter((item) => item.firestoreId !== documentId);
            crewState.docsByPilotCache.set(targetPilotUid, nextDocs);
            const targetPilot = crewState.pilotsCache.find((item) => item.uid === targetPilotUid) || crewState.activeCurrentUser;
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

export function bindDocumentControls() {
  query('#cm-doc-pilot')?.addEventListener('change', (event) => {
    const pilotUid = event.target?.value;
    if (!pilotUid) return;
    crewState.selectedPilotUid = pilotUid;
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

  query('#cm-doc-category-input')?.addEventListener('change', (event) => {
    onDocumentCategoryChange(event.target?.value || 'LICENCE');
  });

  query('#cm-doc-name')?.addEventListener('change', (event) => {
    onDocumentNameChange(event.target?.value || '');
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

    const pilotUid = crewState.selectedPilotUid || crewState.activeCurrentUser?.uid;
    const pilotDocs = crewState.docsByPilotCache.get(pilotUid) || [];
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
