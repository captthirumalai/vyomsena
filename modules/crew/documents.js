import { crewState } from './state.js';
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
  getStatusBadgeHtml,
  daysUntil,
  setFormField,
  isPilotRole
} from './utils.js';
import { getDocumentComplianceState } from '../../services/documentService.js';
import { createPilotDocument, updatePilotDocumentWithAudit, removePilotDocument } from '../../services/crewService.js';
import { uploadUserDocumentFile, deleteUserDocumentFile } from '../../services/storageService.js';
import { validateDocumentFile, DOCUMENT_MAX_SIZE_BYTES } from '../../services/uploadLimits.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import {
  enqueueCrewDocumentCreate,
  enqueueCrewDocumentUpdate,
  enqueueCrewDocumentDelete,
  shouldQueueError
} from '../../services/crewDocumentSyncService.js';
import { DOCUMENT_MASTER_LIST, DOCUMENT_CATEGORIES } from './documentsConfig.js';
import { renderCrewScreen, renderDrawerView } from './directory.js';
import { renderQueueSyncState } from './queue.js';
import { selectPilot, refreshCrew } from './crew.js';

/* ================= DRAWER DOCUMENTS VIEW ================= */

export function renderPilotDocuments() {
  const container = query('#cm-drawer-view');
  if (!container) return;
  const pilotUid = crewState.selectedPilotUid;
  const docs = (crewState.docsByPilotCache.get(pilotUid) || [])
    .slice()
    .sort((a, b) => (daysUntil(a.expiryDate) ?? Number.MAX_SAFE_INTEGER) - (daysUntil(b.expiryDate) ?? Number.MAX_SAFE_INTEGER));

  const rows = docs
    .map((doc) => {
      const state = getDocumentComplianceState(doc);
      const expiry = formatExpiry(doc.expiryDate);
      const mark = state === 'Expired' ? '✕' : state === 'Expiring' ? '⚠' : '✓';
      return `
      <button type="button" class="cm-doc-row" data-doc-open="${escapeHtml(doc.firestoreId)}">
        <span class="cm-doc-row-status ${state === 'Expired' ? 'is-danger' : state === 'Expiring' ? 'is-warn' : 'is-valid'}">${mark}</span>
        <span class="cm-doc-row-main">
          <strong>${escapeHtml(doc.documentName || 'Untitled')}</strong>
          <span class="cm-doc-row-meta">${escapeHtml((doc.documentCategory || 'GENERAL').toUpperCase())}${doc.licenseOrCertificateNumber ? ` · ${escapeHtml(doc.licenseOrCertificateNumber)}` : ''}</span>
        </span>
        <span class="cm-doc-row-status">${expiry.date !== 'N/A' ? `${escapeHtml(expiry.date)}${expiry.rel ? `<br />${escapeHtml(expiry.rel)}` : ''}` : 'No expiry'}</span>
        <span class="cm-doc-row-status">${getStatusBadgeHtml(state)}</span>
      </button>`;
    })
    .join('');

  const canEdit = canPerformCrewAction(crewState.activeCurrentUser, 'edit');
  container.innerHTML = `
    <div>
      <div class="cm-drawer-docs-head">
        <h4>Documents (${docs.length})</h4>
        ${canEdit ? `<button type="button" class="cm-btn cm-btn-primary cm-btn-sm" id="cm-doc-upload-toggle">+ Add Document</button>` : ''}
      </div>
      ${docs.length ? `<div class="cm-more-list">${rows}</div>` : '<div class="cm-drawer-view-empty">No documents uploaded yet.</div>'}
    </div>`;
  query('#cm-doc-upload-toggle')?.addEventListener('click', openDocumentUploadModal);
}

export function openDocumentUploadModal() {
  const pilotUid = crewState.selectedPilotUid;
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid) || crewState.activeCurrentUser;
  if (!pilotUid) {
    showToast('Select a pilot first.', 'warning');
    return;
  }
  openModal(
    `
    <form id="cm-doc-upload-form" novalidate>
      <div class="cm-form-grid">
        <label class="cm-field">
          <span>Category</span>
          <select id="cm-doc-category-input" name="documentCategory">
            ${DOCUMENT_CATEGORIES.map((cat) => `<option value="${escapeHtml(cat.key)}">${escapeHtml(cat.label)}</option>`).join('')}
          </select>
        </label>
        <label class="cm-field">
          <span>Document name</span>
          <select id="cm-doc-name" name="documentName"><option value="">Select document...</option></select>
          <input type="text" id="cm-doc-name-custom" name="documentNameCustom" class="hidden" placeholder="Custom document name" />
        </label>
        <label class="cm-field"><span>License / Certificate number</span><input type="text" name="licenseNumber" placeholder="Optional" /></label>
        <label class="cm-field"><span>Issue date</span><input type="date" name="issueDate" /></label>
        <label class="cm-field"><span>Expiry date</span><input type="date" name="expiryDate" /></label>
        <label class="cm-field"><span>Issuing authority</span><input type="text" name="authority" id="cm-doc-authority" placeholder="DGCA / Organization" /></label>
        <label class="cm-field"><span>Reminder lead (days)</span><input type="number" name="reminderDays" id="cm-doc-reminder" value="30" min="0" /></label>
        <label class="cm-field"><span>Notes / Remarks</span><textarea name="notesOrRemarks" rows="2" placeholder="Optional"></textarea></label>
        <label class="cm-field"><span>File (PDF or image)</span><input type="file" name="documentFile" id="cm-doc-file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf" required /><small class="cm-field-hint">PDF, JPG, PNG or WebP · max 10 MB (images are auto-compressed)</small></label>
      </div>
      <p class="cm-form-status" id="cm-doc-upload-status"></p>
      <div class="cm-modal-actions">
        <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-doc-upload-cancel">Cancel</button>
        <button type="submit" class="cm-btn cm-btn-primary cm-btn-md" id="cm-doc-upload-submit">Upload Document</button>
      </div>
    </form>
  `,
    { title: 'Add Document', subtitle: `Uploading for ${toProfileName(pilot)}.` }
  );

  populateDocumentNames(getDocumentCategoryKey());
  query('#cm-doc-category-input')?.addEventListener('change', (event) => onDocumentCategoryChange(event.target?.value || 'LICENCE'));
  query('#cm-doc-name')?.addEventListener('change', (event) => onDocumentNameChange(event.target?.value || ''));
  query('#cm-doc-file')?.addEventListener('change', (event) => {
    const file = event.target?.files?.[0];
    const status = query('#cm-doc-upload-status');
    if (!status) return;
    status.classList.remove('is-success');
    if (!file) {
      status.textContent = '';
      return;
    }
    const check = validateDocumentFile(file);
    if (!check.ok) {
      status.textContent = check.error;
      status.classList.add('is-error');
      event.target.value = '';
    } else {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      status.textContent = `${file.name} · ${mb} MB (max ${DOCUMENT_MAX_SIZE_BYTES / (1024 * 1024)} MB)`;
      status.classList.remove('is-error');
    }
  });
  query('#cm-doc-upload-cancel')?.addEventListener('click', closeModal);
  query('#cm-doc-upload-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitDocumentUpload(event.currentTarget);
  });
}

export function openDocumentDetail(documentId) {
  const pilotUid = crewState.selectedPilotUid;
  const docs = crewState.docsByPilotCache.get(pilotUid) || [];
  const doc = docs.find((item) => item.firestoreId === documentId);
  if (!doc) return;
  crewState.activeDocument = doc;
  const state = getDocumentComplianceState(doc);
  const expiry = formatExpiry(doc.expiryDate);
  const canEdit = canPerformCrewAction(crewState.activeCurrentUser, 'edit');
  const canDelete = canPerformCrewAction(crewState.activeCurrentUser, 'delete');

  openModal(
    `
    <dl class="cm-drawer-kv">
      <div class="kv-row"><dt>Category</dt><dd>${escapeHtml((doc.documentCategory || 'GENERAL').toUpperCase())}</dd></div>
      <div class="kv-row"><dt>Status</dt><dd>${getStatusBadgeHtml(state)}</dd></div>
      <div class="kv-row"><dt>Number</dt><dd>${escapeHtml(doc.licenseOrCertificateNumber || 'N/A')}</dd></div>
      <div class="kv-row"><dt>Authority</dt><dd>${escapeHtml(doc.issuingAuthorityOrBody || 'N/A')}</dd></div>
      <div class="kv-row"><dt>Issue date</dt><dd>${escapeHtml(formatShortDate(doc.issueDate))}</dd></div>
      <div class="kv-row"><dt>Expiry</dt><dd>${escapeHtml(expiry.date)}${expiry.rel ? ` — ${escapeHtml(expiry.rel)}` : ''}</dd></div>
      <div class="kv-row"><dt>Reminder</dt><dd>${escapeHtml(`${doc.reminderLeadTimeDays ?? 'N/A'} day(s)`)}</dd></div>
      ${doc.notesOrRemarks ? `<div class="kv-row"><dt>Notes</dt><dd>${escapeHtml(doc.notesOrRemarks)}</dd></div>` : ''}
    </dl>
    <div class="cm-modal-actions">
      ${doc.documentUri ? `<button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-doc-detail-preview">Preview / Open</button>` : ''}
      ${canEdit ? `<button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-doc-detail-edit">Edit</button>` : ''}
      ${canDelete ? `<button type="button" class="cm-btn cm-btn-danger cm-btn-md" id="cm-doc-detail-delete">Delete</button>` : ''}
    </div>
  `,
    { title: doc.documentName || 'Document' }
  );

  query('#cm-doc-detail-preview')?.addEventListener('click', () => previewDocument(doc));
  query('#cm-doc-detail-edit')?.addEventListener('click', () => editDocumentWithForm(documentId));
  query('#cm-doc-detail-delete')?.addEventListener('click', () => deleteDocument(documentId, doc.storagePath || ''));
}

/* ================= DOCUMENT CATEGORY / NAME HELPERS ================= */

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

  query('#cm-doc-name')?.closest('.cm-field')?.classList.remove('is-invalid');
  query('#cm-doc-name-custom')?.closest('.cm-field')?.classList.remove('is-invalid');

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

/* ================= PREVIEW / DOWNLOAD ================= */

export function previewDocument(doc) {
  if (!doc?.documentUri) return;
  openModal(
    `
    <p>${escapeHtml(doc.documentName || 'Document')} — ${escapeHtml(doc.documentCategory || 'GENERAL')}</p>
    ${/\.pdf($|\?)/i.test(doc.documentUri)
      ? `<iframe class="cm-pdf-viewer" src="${escapeHtml(doc.documentUri)}" title="Document preview"></iframe>`
      : `<p>This file type can't be previewed inline. <a href="${escapeHtml(doc.documentUri)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a>.</p>`}
  `,
    { title: doc.documentName || 'Document' }
  );
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

/* ================= UPLOAD / EDIT / DELETE ================= */

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
  const documentName = isCustomCategory ? form.documentNameCustom?.value?.trim() : form.documentName?.value?.trim();
  const licenseOrCertificateNumber = form.licenseNumber?.value?.trim() || null;
  const issueDate = toTimestampCandidate(form.issueDate?.value || null);
  const expiryDate = toTimestampCandidate(form.expiryDate?.value || null);
  const issuingAuthorityOrBody = form.authority?.value?.trim() || null;
  const notesOrRemarks = form.notesOrRemarks?.value?.trim() || null;
  const reminderLeadTimeDays = Number.parseInt(form.reminderDays?.value || '30', 10);
  const file = form.documentFile?.files?.[0] || null;
  const submit = query('#cm-doc-upload-submit');

  const requiredFields = [
    { input: isCustomCategory ? form.documentNameCustom : form.documentName, valid: Boolean(documentName) },
    { input: form.documentFile, valid: Boolean(file) }
  ];
  requiredFields.forEach(({ input }) => input?.closest('.cm-field')?.classList.remove('is-invalid'));

  const invalidFields = requiredFields.filter(({ valid }) => !valid);
  if (invalidFields.length) {
    invalidFields.forEach(({ input }) => input?.closest('.cm-field')?.classList.add('is-invalid'));
    if (status) {
      status.textContent = 'Document name and file are required.';
      status.classList.add('is-error');
    }
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
    closeModal();
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

      renderCrewScreen();
      renderDrawerView();
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

  openModal(
    `
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
  `,
    { title: `Edit ${targetDoc.documentName || 'document'}` }
  );

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
          renderCrewScreen();
          renderDrawerView();
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
            renderCrewScreen();
            renderDrawerView();
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
