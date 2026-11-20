/* EFB Manual Distribution UI (Milestone 1).
   Calls services/manualService.js only — no direct Firebase SDK imports. */

import {
  MANUAL_STATUSES,
  MANUAL_CATEGORIES,
  REGULATORY_APPROVAL_STATUSES,
  onManualsSnapshot,
  onTemporaryRevisionsSnapshot,
  listRevisions,
  getRevision,
  createManual,
  uploadRevision,
  updateManualMetadata,
  archiveManual,
  unarchiveManual,
  deleteDraftManual,
  resolveViewableManual,
  suggestNextRevisionNumber,
  TEMPORARY_REVISION_STATUSES,
  TEMPORARY_EFFECTIVE_STATES,
  evaluateEffectiveStatus,
  normalizeDistributionTargeting,
  distributionMatchesRecipient,
  resolveCompanyRecipients,
  getCompanyRecipientContext,
  validateDistributionTargeting,
  createTemporaryRevision,
  updateTemporaryRevision,
  submitTemporaryRevisionForReview,
  publishTemporaryRevision,
  withdrawTemporaryRevision,
  createAcknowledgementRequirements,
  getMyAcknowledgements,
  acknowledgeManualRevision,
  getManualAcknowledgementSummary,
  getRevisionAcknowledgementRecipients,
  redistributeManualRevision
} from '../../services/manualService.js';

const state = {
  view: null,
  companyId: null,
  userUid: null,
  userRole: null,
  canManage: false,
  manuals: [],
  temporaryRevisions: [],
  recipients: [],
  directoryLoaded: false,
  recipientContext: null,
  temporaryUnsubscribers: new Map(),
  myAcknowledgements: [],
  myAcknowledgementCursor: null,
  acknowledgementRows: [],
  acknowledgementRecipients: [],
  acknowledgementRecipientCursor: null,
  unsubscribe: null,
  filters: { search: '', category: '', status: '', sort: 'newest', aircraft: '', department: '', effectiveness: '', temporary: '' },
  onEscape: null
};

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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateValue(value) {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return `${value}`;
  return date.toISOString().slice(0, 10);
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}

function setStatus(message, tone = '') {
  const status = state.view?.querySelector('#efb-manual-status');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-error', tone === 'error');
  status.classList.toggle('is-success', tone === 'success');
}

function setModalStatus(message, tone = 'error') {
  const content = state.view?.querySelector('#efb-modal-content');
  if (!content) return;
  let status = content.querySelector('#efb-modal-feedback');
  if (!status) {
    status = document.createElement('p');
    status.id = 'efb-modal-feedback';
    status.className = 'efb-manual-status';
    status.setAttribute('aria-live', 'polite');
    content.appendChild(status);
  }
  status.textContent = message || '';
  status.classList.toggle('is-error', tone === 'error');
  status.classList.toggle('is-success', tone === 'success');
}

function statusBadge(status) {
  const map = {
    [MANUAL_STATUSES.DRAFT]: 'fdtl-badge--watch',
    [MANUAL_STATUSES.IN_REVIEW]: 'fdtl-badge--watch',
    [MANUAL_STATUSES.PUBLISHED]: 'fdtl-badge--good'
  };
  const label = {
    [MANUAL_STATUSES.DRAFT]: 'Draft',
    [MANUAL_STATUSES.IN_REVIEW]: 'In Review',
    [MANUAL_STATUSES.PUBLISHED]: 'Published',
    [MANUAL_STATUSES.ARCHIVED]: 'Archived'
  }[status] || status;
  const modifier = map[status] || '';
  return `<span class="fdtl-badge ${modifier}">${escapeHtml(label)}</span>`;
}

function revisionStatusBadge(status) {
  const map = {
    draft: 'fdtl-badge--watch',
    published: 'fdtl-badge--good',
    superseded: '',
    withdrawn: 'fdtl-badge--critical'
  };
  const label = {
    draft: 'Draft',
    published: 'Published',
    superseded: 'Superseded',
    withdrawn: 'Withdrawn'
  }[status] || status;
  return `<span class="fdtl-badge ${map[status] || ''}">${escapeHtml(label)}</span>`;
}

/* ================= MODAL ================= */

function openModal(title, html) {
  const backdrop = state.view?.querySelector('#efb-modal-backdrop');
  const content = state.view?.querySelector('#efb-modal-content');
  if (!backdrop || !content) return;
  content.innerHTML = `<h3 id="efb-modal-title">${escapeHtml(title)}</h3>${html}`;
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => content.querySelector('input, select, textarea, button')?.focus());
}

function closeModal() {
  const backdrop = state.view?.querySelector('#efb-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.add('hidden');
  backdrop.setAttribute('aria-hidden', 'true');
  const content = state.view?.querySelector('#efb-modal-content');
  if (content) content.innerHTML = '';
}

function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openModal(
      title,
      `<p>${escapeHtml(message)}</p>
      <div class="efb-modal-actions">
        <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-m-cancel">Cancel</button>
        <button type="button" class="vs-button ${danger ? 'vs-button--danger' : 'vs-button--primary'} vs-button--sm" id="efb-m-ok">${escapeHtml(confirmLabel)}</button>
      </div>`
    );
    state.view?.querySelector('#efb-m-cancel')?.addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
    state.view?.querySelector('#efb-m-ok')?.addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
  });
}

/* ================= FORM BUILDERS ================= */

function textField(id, label, { type = 'text', value = '', placeholder = '', required = false, attrs = '' } = {}) {
  return `<label class="efb-ml-field${required ? ' is-required' : ''}">
    <span>${escapeHtml(label)}</span>
    <input type="${type}" id="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${attrs} />
  </label>`;
}

function dateField(id, label, value) {
  const date = toDate(value);
  let iso = '';
  if (date && !Number.isNaN(date.getTime())) {
    iso = date.toISOString().slice(0, 10);
  } else if (typeof value === 'string' && value) {
    iso = value.slice(0, 10);
  }
  return textField(id, label, { type: 'date', value: iso });
}

function selectField(id, label, options, value = '') {
  const optionTags = options
    .map((option) => {
      const optionValue = typeof option === 'string' ? option : option.value;
      const optionLabel = typeof option === 'string' ? option : option.label;
      return `<option value="${escapeHtml(optionValue)}"${optionValue === value ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`;
    })
    .join('');
  return `<label class="efb-ml-field">
    <span>${escapeHtml(label)}</span>
    <select id="${id}">${optionTags}</select>
  </label>`;
}

function textareaField(id, label, value = '') {
  return `<label class="efb-ml-field efb-ml-field--wide">
    <span>${escapeHtml(label)}</span>
    <textarea id="${id}" rows="2">${escapeHtml(value)}</textarea>
  </label>`;
}

function checkboxField(id, label, checked) {
  return `<label class="efb-ml-field efb-ml-field--check">
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function selectedOptions(id) {
  const select = state.view?.querySelector(`#${id}`);
  return select ? [...select.selectedOptions].map((option) => option.value) : [];
}

function distributionSelectorHtml(prefix, distribution = null) {
  const target = normalizeDistributionTargeting(distribution);
  const options = (values, selected) => values
    .map((value) => `<option value="${escapeHtml(value)}"${selected.includes(value) ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
  const users = state.recipients
    .map((recipient) => `<option value="${escapeHtml(recipient.id)}"${target.userIds.includes(recipient.id) ? ' selected' : ''}>${escapeHtml(recipient.name || recipient.id)} · ${escapeHtml(recipient.roles.join(', ') || 'Member')}</option>`)
    .join('');
  const roleOptions = [...new Set(state.recipients.flatMap((recipient) => recipient.roles))].sort();
  const departmentOptions = [...new Set(state.recipients.flatMap((recipient) => recipient.departments))].sort();
  const aircraftTypeOptions = [...new Set(state.recipients.flatMap((recipient) => recipient.aircraftTypes))].sort();
  const registrationOptions = [...new Set(state.recipients.flatMap((recipient) => recipient.aircraftRegistrations))].sort();
  return `<div class="efb-ml-distribution efb-ml-field--wide" data-distribution="${prefix}">
    <label class="efb-ml-field">
      <span>Distribution target</span>
      <select id="${prefix}-type">
        <option value="company"${target.type === 'company' ? ' selected' : ''}>Entire company</option>
        <option value="criteria"${target.type === 'criteria' ? ' selected' : ''}>Selected criteria</option>
        <option value="users"${target.type === 'users' ? ' selected' : ''}>Specific company users</option>
      </select>
    </label>
    <div class="efb-ml-distribution-criteria" data-distribution-criteria="${prefix}">
      <label class="efb-ml-field"><span>Operational roles</span><select id="${prefix}-roles" multiple size="3">${options(roleOptions, target.roles)}</select></label>
      <label class="efb-ml-field"><span>Departments</span><select id="${prefix}-departments" multiple size="3">${options(departmentOptions, target.departments)}</select></label>
      <label class="efb-ml-field"><span>Aircraft types</span><select id="${prefix}-aircraft-types" multiple size="3">${options(aircraftTypeOptions, target.aircraftTypes)}</select></label>
      <label class="efb-ml-field"><span>Aircraft registrations</span><select id="${prefix}-aircraft-registrations" multiple size="3">${options(registrationOptions, target.aircraftRegistrations)}</select></label>
    </div>
    <label class="efb-ml-field efb-ml-distribution-users" data-distribution-users="${prefix}">
      <span>Specific users (stable company/user IDs)</span>
      <select id="${prefix}-users" multiple size="5">${users}</select>
    </label>
    <p class="efb-ml-distribution-summary" id="${prefix}-summary" aria-live="polite"></p>
    <p class="efb-ml-note">Multiple criteria are combined (AND); values within a criterion are combined (OR). Missing roster or aircraft assignments are never broadened.</p>
  </div>`;
}

function readDistribution(prefix) {
  const type = readValue(`${prefix}-type`) || 'company';
  return normalizeDistributionTargeting({
    version: 1,
    type,
    roles: type === 'criteria' ? selectedOptions(`${prefix}-roles`) : [],
    departments: type === 'criteria' ? selectedOptions(`${prefix}-departments`) : [],
    aircraftTypes: type === 'criteria' ? selectedOptions(`${prefix}-aircraft-types`) : [],
    aircraftRegistrations: type === 'criteria' ? selectedOptions(`${prefix}-aircraft-registrations`) : [],
    userIds: type === 'users' ? selectedOptions(`${prefix}-users`) : []
  });
}

function distributionLabel(value) {
  const target = normalizeDistributionTargeting(value);
  if (target.type === 'company') return 'Entire company';
  if (target.type === 'users') return `Specific users (${target.userIds.length})`;
  const parts = [
    ...target.roles.map((item) => `Role: ${item}`),
    ...target.departments.map((item) => `Department: ${item}`),
    ...target.aircraftTypes.map((item) => `Aircraft: ${item}`),
    ...target.aircraftRegistrations.map((item) => `Registration: ${item}`)
  ];
  return parts.join(' · ') || 'Unresolved criteria';
}

function renderDistributionSummary(prefix) {
  const type = readValue(`${prefix}-type`) || 'company';
  const criteria = state.view?.querySelector(`[data-distribution-criteria="${prefix}"]`);
  const users = state.view?.querySelector(`[data-distribution-users="${prefix}"]`);
  if (criteria) criteria.hidden = type !== 'criteria';
  if (users) users.hidden = type !== 'users';
  const summary = state.view?.querySelector(`#${prefix}-summary`);
  if (!summary) return;
  const distribution = readDistribution(prefix);
  if (type === 'company') {
    summary.textContent = 'Company-wide distribution — available to all users linked to this company. Recipient count is not exposed by the current roster.';
    summary.classList.remove('is-error');
    return;
  }
  const matches = state.recipients.filter((recipient) => distributionMatchesRecipient(distribution, recipient));
  if (!matches.length) {
    summary.textContent = 'No active company users match. Choose resolvable criteria or specific users; this will not become company-wide.';
    summary.classList.add('is-error');
    return;
  }
  summary.textContent = `${matches.length} active company user${matches.length === 1 ? '' : 's'} match: ${matches.map((recipient) => recipient.name || recipient.id).join(', ')}`;
  summary.classList.remove('is-error');
}

function bindDistributionSelector(prefix) {
  const selector = state.view?.querySelector(`[data-distribution="${prefix}"]`);
  selector?.addEventListener('change', () => renderDistributionSummary(prefix));
  renderDistributionSummary(prefix);
}

function fileField(id, label) {
  return `<label class="efb-ml-field efb-ml-field--wide">
    <span>${escapeHtml(label)}</span>
    <input type="file" id="${id}" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
  </label>`;
}

function readValue(id) {
  const element = state.view?.querySelector(`#${id}`);
  if (!element) return null;
  if (element.type === 'checkbox') return element.checked;
  const value = `${element.value || ''}`.trim();
  return value || null;
}

function readManualForm(prefix) {
  return {
    title: readValue(`${prefix}-title`) || '',
    documentNumber: readValue(`${prefix}-doc-number`),
    category: readValue(`${prefix}-category`) || 'Other',
    description: readValue(`${prefix}-description`),
    aircraftApplicability: readValue(`${prefix}-aircraft`),
    department: readValue(`${prefix}-department`),
    documentOwner: readValue(`${prefix}-owner`),
    issueNumber: readValue(`${prefix}-issue-number`),
    revisionNumber: readValue(`${prefix}-rev-number`),
    issueDate: readValue(`${prefix}-issue-date`),
    revisionDate: readValue(`${prefix}-rev-date`),
    effectiveDate: readValue(`${prefix}-effective-date`),
    nextReviewDate: readValue(`${prefix}-review-date`),
    preparedBy: readValue(`${prefix}-prepared`),
    reviewedBy: readValue(`${prefix}-reviewed`),
    approvedBy: readValue(`${prefix}-approved`),
    regulatoryApprovalStatus: readValue(`${prefix}-reg-status`),
    approvalReference: readValue(`${prefix}-approval-ref`),
    approvalDate: readValue(`${prefix}-approval-date`),
    acknowledgementRequired: readValue(`${prefix}-ack`) === true,
    distribution: readDistribution(`${prefix}-distribution`)
  };
}

function manualFormHtml(prefix, manual = null, { includeFile = true } = {}) {
  const fileSection = includeFile ? fileField(`${prefix}-file`, 'Manual PDF (required to publish)') : '';
  return `
    <div class="efb-ml-form">
      ${textField(`${prefix}-title`, 'Manual Title', { value: manual?.title || '', required: true, placeholder: 'e.g. Operations Manual' })}
      ${textField(`${prefix}-doc-number`, 'Manual Number', { value: manual?.documentNumber || '', placeholder: 'e.g. OM-001' })}
      ${selectField(`${prefix}-category`, 'Category', MANUAL_CATEGORIES, manual?.category || 'Operations Manual')}
      ${textField(`${prefix}-aircraft`, 'Aircraft Applicability', { value: manual?.aircraftApplicability || '', placeholder: 'e.g. A320, All fleet' })}
      ${textField(`${prefix}-department`, 'Department', { value: manual?.department || '', placeholder: 'e.g. Flight Operations' })}
      ${textField(`${prefix}-owner`, 'Manual Owner', { value: manual?.documentOwner || '', placeholder: 'e.g. Director of Operations' })}
      ${textField(`${prefix}-issue-number`, 'Issue Number', { value: manual?.issueNumber ?? '', placeholder: 'e.g. 3' })}
      ${textField(`${prefix}-rev-number`, 'Revision Number', { type: 'number', value: manual?.revisionNumber ?? '', placeholder: 'e.g. 1', attrs: 'min="1" step="1"' })}
      ${dateField(`${prefix}-issue-date`, 'Issue Date', manual?.issueDate)}
      ${dateField(`${prefix}-rev-date`, 'Revision Date', manual?.revisionDate)}
      ${dateField(`${prefix}-effective-date`, 'Effective Date', manual?.effectiveDate)}
      ${dateField(`${prefix}-review-date`, 'Next Review Date', manual?.nextReviewDate)}
      ${textField(`${prefix}-prepared`, 'Prepared By', { value: manual?.preparedBy || '' })}
      ${textField(`${prefix}-reviewed`, 'Reviewed By', { value: manual?.reviewedBy || '' })}
      ${textField(`${prefix}-approved`, 'Internally Approved By', { value: manual?.approvedBy || '' })}
      ${selectField(`${prefix}-reg-status`, 'Regulatory Approval Status', REGULATORY_APPROVAL_STATUSES, manual?.regulatoryApprovalStatus || 'Not Applicable')}
      ${textField(`${prefix}-approval-ref`, 'Approval Reference', { value: manual?.approvalReference || '', placeholder: 'Regulatory reference (if any)' })}
      ${dateField(`${prefix}-approval-date`, 'Approval Date', manual?.approvalDate)}
      ${textareaField(`${prefix}-description`, 'Description', manual?.description || '')}
      ${checkboxField(`${prefix}-ack`, 'Require pilot acknowledgement on publish (M3)', manual?.acknowledgementRequired === true)}
      ${distributionSelectorHtml(`${prefix}-distribution`, manual?.distribution)}
      ${fileSection}
    </div>`;
}

/* ================= STATS + TABLE ================= */

function availableManuals() {
  if (state.canManage) return state.manuals;
  const recipient = state.recipientContext || {
    ids: [state.userUid].filter(Boolean),
    roles: [state.userRole].filter(Boolean),
    departments: [],
    aircraftTypes: [],
    aircraftRegistrations: []
  };
  return state.manuals.filter(
    (manual) =>
      manual.status === MANUAL_STATUSES.PUBLISHED &&
      evaluateEffectiveStatus(manual) !== TEMPORARY_EFFECTIVE_STATES.PUBLISHED_NOT_YET_EFFECTIVE &&
      distributionMatchesRecipient(manualDeliveryDistribution(manual), recipient)
  );
}

function manualDeliveryDistribution(manual) {
  const currentRevisionEffective = manual.currentRevisionEffectiveDate &&
    evaluateEffectiveStatus({
      status: MANUAL_STATUSES.PUBLISHED,
      effectiveDate: manual.currentRevisionEffectiveDate
    }) === TEMPORARY_EFFECTIVE_STATES.EFFECTIVE;
  return currentRevisionEffective ? manual.currentDistribution : manual.distribution;
}

function computeStats(list) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    total: list.length,
    published: list.filter((item) => item.status === MANUAL_STATUSES.PUBLISHED).length,
    draft: list.filter(
      (item) => item.status === MANUAL_STATUSES.DRAFT || item.status === MANUAL_STATUSES.IN_REVIEW
    ).length,
    reviewDue: list.filter(
      (item) =>
        (item.status === MANUAL_STATUSES.PUBLISHED || item.status === MANUAL_STATUSES.IN_REVIEW) &&
        item.nextReviewDate &&
        `${item.nextReviewDate}`.slice(0, 10) <= horizon
    ).length,
    archived: list.filter((item) => item.status === MANUAL_STATUSES.ARCHIVED).length
  };
}

function filteredManuals() {
  const { search, category, status, sort, aircraft, department, effectiveness, temporary } = state.filters;
  const needle = search.trim().toLowerCase();

  let list = availableManuals().filter((manual) => {
    if (category && manual.category !== category) return false;
    if (status && manual.status !== status) return false;
    if (aircraft && `${manual.aircraftApplicability || ''}`.toLowerCase() !== aircraft.toLowerCase()) return false;
    if (department && `${manual.department || ''}`.toLowerCase() !== department.toLowerCase()) return false;
    const effectiveStatus = evaluateEffectiveStatus(manual);
    if (effectiveness && effectiveStatus !== effectiveness) return false;
    const hasTemporary = state.temporaryRevisions.some((revision) => revision.manualId === manual.id);
    if (temporary === 'has_temporary' && !hasTemporary) return false;
    if (needle) {
      const haystack = `${manual.title} ${manual.documentNumber || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const createdTime = (manual) => toDate(manual.createdAt || manual.lastModified)?.getTime() || 0;
  if (sort === 'newest') list.sort((a, b) => createdTime(b) - createdTime(a));
  if (sort === 'oldest') list.sort((a, b) => createdTime(a) - createdTime(b));
  if (sort === 'title') list.sort((a, b) => `${a.title}`.localeCompare(`${b.title}`));
  if (sort === 'effective') {
    list.sort((a, b) => `${b.effectiveDate || ''}`.localeCompare(`${a.effectiveDate || ''}`));
  }
  return list;
}

function renderStats() {
  const root = state.view?.querySelector('#efb-ml-stats');
  if (!root) return;
  const stats = computeStats(availableManuals());
  Object.entries(stats).forEach(([key, value]) => {
    const element = root.querySelector(`[data-stat="${key}"]`);
    if (element) element.textContent = String(value);
  });
}

function actionButtons(manual) {
  const isArchived = manual.status === MANUAL_STATUSES.ARCHIVED;
  const canArchive =
    manual.status === MANUAL_STATUSES.PUBLISHED || manual.status === MANUAL_STATUSES.IN_REVIEW;
  const manageParts = [];
  const temporaryCount = visibleTemporaryRevisions().filter((revision) => revision.manualId === manual.id).length;
  if (state.canManage) {
    manageParts.push('<button type="button" data-ml-action="history">History</button>');
    manageParts.push('<button type="button" data-ml-action="edit">Edit</button>');
    if (isArchived) {
      manageParts.push('<button type="button" data-ml-action="restore">Restore</button>');
    } else {
      manageParts.push('<button type="button" data-ml-action="revise">Revise</button>');
      if (canArchive) {
        manageParts.push('<button type="button" data-ml-action="archive">Archive</button>');
      }
    }
    if (manual.status === MANUAL_STATUSES.DRAFT) {
      manageParts.push('<button type="button" class="efb-manual-delete" data-ml-action="delete">Delete</button>');
    }
  }
  return `<div class="efb-manual-actions">
    <button type="button" data-ml-action="view">View</button>
    ${temporaryCount ? `<button type="button" data-ml-action="temporary">Temporary (${temporaryCount})</button>` : ''}
    ${manageParts.join('')}
  </div>`;
}

function renderTable() {
  const body = state.view?.querySelector('#efb-manuals-body');
  const hint = state.view?.querySelector('#efb-manuals-hint');
  if (!body) return;

  const list = filteredManuals();
  const visibleCount = availableManuals().length;
  if (hint) {
    hint.textContent = list.length
      ? `${list.length} manual${list.length === 1 ? '' : 's'} shown${list.length !== visibleCount ? ` of ${visibleCount}` : ''}.`
      : 'No manuals match the current filters.';
  }

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="9" class="fdtl-empty">${
      visibleCount ? 'No manuals match the current filters.' : state.canManage ? 'No manuals yet. Use Add Manual to create the first one.' : 'No published manuals are available.'
    }</td></tr>`;
    return;
  }

  body.innerHTML = list
    .map((manual) => {
      const displayedEffectiveDate = manual.effectiveRevisionId
        ? manual.effectiveDate
        : manual.currentRevisionEffectiveDate || manual.effectiveDate;
      const effective = displayedEffectiveDate ? formatDateValue(displayedEffectiveDate) : '—';
      return `<tr data-manual="${escapeHtml(manual.id)}">
        <td>${escapeHtml(manual.documentNumber || '—')}</td>
        <td><strong>${escapeHtml(manual.title)}</strong><br><span class="efb-ml-secondary">${escapeHtml(evaluateEffectiveStatus(manual).replaceAll('_', ' '))} · ${escapeHtml(distributionLabel(manualDeliveryDistribution(manual)))}</span></td>
        <td>${escapeHtml(manual.category || '—')}</td>
        <td>${escapeHtml(manual.aircraftApplicability || '—')}</td>
        <td>${escapeHtml(manual.issueNumber ?? '—')}</td>
        <td>${escapeHtml(manual.revisionNumber ?? '—')}</td>
        <td>${escapeHtml(effective)}</td>
        <td>${statusBadge(manual.status)}</td>
        <td>${actionButtons(manual)}</td>
      </tr>`;
    })
    .join('');
}

function render() {
  renderStats();
  renderTable();
  renderTemporaryRevisions();
}

/* ================= MANUAL FILE ACTIONS ================= */

async function downloadManualFile(uri, fileName) {
  if (!uri) return;
  try {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName || 'manual';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn('Manual download failed, opening in a new tab instead:', error);
    window.open(uri, '_blank', 'noopener,noreferrer');
  }
}

async function openView(manual) {
  openModal(manual.title, '<p class="muted">Loading manual…</p>');
  try {
    const { uri, revision, futureEffective } = await resolveViewableManual(state.companyId, manual, {
      allowFuture: state.canManage
    });
    const effectiveNote = futureEffective
      ? `<p class="efb-ml-note">Current revision publishes on <strong>${escapeHtml(formatDateValue(manual.currentRevisionEffectiveDate))}</strong> and is not yet the operational revision.</p>`
      : '';
    const legacyNote =
      !revision && manual.documentUri
        ? '<p class="efb-ml-note">Legacy file recorded before revision control (V0.4.13).</p>'
        : '';
    const fileSection = uri
      ? `<div class="efb-ml-preview">
           <iframe src="${escapeHtml(uri)}" title="${escapeHtml(manual.title)}" class="efb-ml-pdf-viewer"></iframe>
           <div class="efb-modal-actions">
             <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-view-download">Download</button>
           </div>
         </div>`
      : manual.currentRevisionId && !state.canManage
        ? '<p class="efb-ml-note">No revision is operational yet. The current revision is not effective.</p>'
        : '<p class="efb-ml-note">No file attached to this manual yet.</p>';

    openModal(
      manual.title,
      `<div class="efb-ml-detail-grid">
        <div><span>Manual Number</span><strong>${escapeHtml(manual.documentNumber || '—')}</strong></div>
        <div><span>Category</span><strong>${escapeHtml(manual.category)}</strong></div>
        <div><span>Aircraft</span><strong>${escapeHtml(manual.aircraftApplicability || '—')}</strong></div>
        <div><span>Issue / Revision</span><strong>${escapeHtml(manual.issueNumber ?? '—')} / ${escapeHtml(manual.revisionNumber ?? '—')}</strong></div>
        <div><span>Effective Date</span><strong>${escapeHtml(formatDateValue(manual.effectiveDate))}</strong></div>
        <div><span>Effectiveness</span><strong>${escapeHtml(evaluateEffectiveStatus(manual).replaceAll('_', ' '))}</strong></div>
        <div><span>Distribution</span><strong>${escapeHtml(distributionLabel(manualDeliveryDistribution(manual)))}</strong></div>
        ${manual.currentRevisionEffectiveDate ? `<div><span>Current Revision Effective From</span><strong>${escapeHtml(formatDateValue(manual.currentRevisionEffectiveDate))}</strong></div>` : ''}
        <div><span>Temporary Revisions</span><strong>${state.temporaryRevisions.filter((item) => item.manualId === manual.id).length}</strong></div>
        <div><span>Next Review</span><strong>${escapeHtml(formatDateValue(manual.nextReviewDate))}</strong></div>
        <div><span>Status</span><strong>${statusBadge(manual.status)}</strong></div>
        <div><span>SHA-256</span><strong>${escapeHtml(shortHash(manual.pdfChecksum))}</strong></div>
        ${revision ? `<div><span>Revision</span><strong>#${escapeHtml(revision.revisionNumber ?? '—')}</strong></div>` : ''}
        ${revision?.reason ? `<div class="efb-ml-field--wide"><span>Revision Reason</span><strong>${escapeHtml(revision.reason)}</strong></div>` : ''}
        <div class="efb-ml-field--wide"><span>Description</span><strong>${escapeHtml(manual.description || '—')}</strong></div>
        <div class="efb-ml-field--wide"><span>Manual Owner</span><strong>${escapeHtml(manual.documentOwner || '—')}</strong></div>
        <div class="efb-ml-field--wide"><span>Approval</span><strong>${escapeHtml(manual.approvedBy || '—')}${manual.approvalReference ? ` · Ref ${escapeHtml(manual.approvalReference)}` : ''} · ${escapeHtml(manual.regulatoryApprovalStatus || 'Not Applicable')}</strong></div>
      </div>
      ${effectiveNote}${legacyNote}${fileSection}`
    );

    state.view?.querySelector('#efb-view-download')?.addEventListener('click', () => {
      downloadManualFile(uri, revision?.fileName || manual.fileName || `${manual.title}.pdf`);
    });
  } catch (error) {
    console.error('Manual view failed:', error);
    openModal(manual.title, `<p class="efb-ml-note">Unable to load the manual: ${escapeHtml(error.message || error)}</p>`);
  }
}

async function openHistory(manual) {
  openModal(`Revision History — ${manual.title}`, '<p class="muted">Loading revisions…</p>');
  try {
    const revisions = await listRevisions(state.companyId, manual.id);
    if (!revisions.length) {
      openModal(
        `Revision History — ${manual.title}`,
        `<p class="efb-ml-note">No revision records yet. This manual still uses its original V0.4.13 file — uploading the first revision will start revision history.</p>`
      );
      return;
    }
    const rows = revisions
      .map(
        (revision) => `<tr>
          <td><strong>#${escapeHtml(revision.revisionNumber ?? '—')}</strong></td>
          <td>${escapeHtml(formatDateValue(revision.issueDate))}</td>
          <td>${escapeHtml(formatDateValue(revision.effectiveDate))}</td>
          <td>${revisionStatusBadge(revision.status)}<br><span class="efb-ml-secondary">${escapeHtml(evaluateEffectiveStatus(revision).replaceAll('_', ' '))}</span></td>
          <td>${escapeHtml(distributionLabel(revision.distribution))}</td>
          <td>${escapeHtml(revision.reason || '—')}</td>
          <td>${escapeHtml(shortHash(revision.sha256))}</td>
          <td>
            <div class="efb-manual-actions">
              ${
                revision.documentUri
                  ? `<button type="button" data-rev-view="${escapeHtml(revision.id)}">View</button>
                     <button type="button" data-rev-download="${escapeHtml(revision.id)}">Download</button>`
                  : '<span class="muted">No file</span>'
              }
            </div>
          </td>
        </tr>`
      )
      .join('');

    openModal(
      `Revision History — ${manual.title}`,
      `<div class="efb-table-wrap">
        <table>
          <thead>
            <tr><th>Rev</th><th>Issue Date</th><th>Effective</th><th>Status</th><th>Distribution</th><th>Reason</th><th>SHA-256</th><th>File</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="efb-ml-note">Revisions are immutable. Corrections are recorded as new revisions; history is never overwritten.</p>`
    );

    state.view?.querySelectorAll('[data-rev-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const revision = revisions.find((item) => item.id === button.getAttribute('data-rev-view'));
        if (revision?.documentUri) window.open(revision.documentUri, '_blank', 'noopener,noreferrer');
      });
    });
    state.view?.querySelectorAll('[data-rev-download]').forEach((button) => {
      button.addEventListener('click', () => {
        const revision = revisions.find((item) => item.id === button.getAttribute('data-rev-download'));
        if (revision?.documentUri) downloadManualFile(revision.documentUri, revision.fileName || 'revision');
      });
    });
  } catch (error) {
    console.error('Revision history failed:', error);
    openModal(`Revision History — ${manual.title}`, `<p class="efb-ml-note">Unable to load revisions: ${escapeHtml(error.message || error)}</p>`);
  }
}

/* ================= CREATE / EDIT / REVISE ================= */

function openAddModal() {
  openModal(
    'Add Manual',
    `${manualFormHtml('efm-new')}
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efm-new-cancel">Cancel</button>
      <button type="button" class="vs-button vs-button--ghost vs-button--sm" id="efm-new-draft">Save Draft</button>
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efm-new-review">Submit for Review</button>
      <button type="button" class="vs-button vs-button--primary vs-button--sm" id="efm-new-publish">Publish</button>
    </div>`
  );
  bindDistributionSelector('efm-new-distribution');

  const submit = async (action, confirmPublish = false) => {
    const fields = readManualForm('efm-new');
    if (!fields.title) {
      setModalStatus('Manual title is required.');
      return;
    }
    const file = state.view?.querySelector('#efm-new-file')?.files?.[0] || null;

    if (confirmPublish) {
      let targeting;
      try {
        targeting = await validateDistributionTargeting(state.companyId, fields.distribution);
      } catch (error) {
        setModalStatus(error.message || 'Distribution target could not be resolved.');
        return;
      }
      const count = targeting.matchingUserCount == null ? 'company-wide' : `${targeting.matchingUserCount} matching user(s)`;
      const confirmed = window.confirm(`"${fields.title}" will be published to ${distributionLabel(targeting.distribution)} (${count}). Publish now?`);
      if (!confirmed) return;
    }

    const buttons = ['efm-new-draft', 'efm-new-review', 'efm-new-publish', 'efm-new-cancel'].map((id) =>
      state.view?.querySelector(`#${id}`)
    );
    buttons.forEach((button) => button && (button.disabled = true));
    setStatus(action === 'publish' ? 'Publishing…' : action === 'review' ? 'Submitting for review…' : 'Saving draft…');

    try {
      const result = await createManual(state.companyId, fields, {
        file,
        action,
        actorUid: state.userUid
      });
      closeModal();
      const successMessage = action === 'publish'
        ? `"${fields.title}" published.`
        : action === 'review'
          ? `"${fields.title}" submitted for review.`
          : `"${fields.title}" saved as draft.`;
      setStatus(result?.acknowledgementWarning || successMessage, result?.acknowledgementWarning ? 'error' : 'success');
    } catch (error) {
      console.error('Create manual failed:', error);
      setModalStatus(error.message || 'Failed to create manual.');
      buttons.forEach((button) => button && (button.disabled = false));
    }
  };

  state.view?.querySelector('#efm-new-cancel')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efm-new-draft')?.addEventListener('click', () => submit('draft'));
  state.view?.querySelector('#efm-new-review')?.addEventListener('click', () => submit('review'));
  state.view?.querySelector('#efm-new-publish')?.addEventListener('click', () => submit('publish', true));
}

function openEditModal(manual) {
  openModal(
    `Edit Metadata — ${manual.title}`,
    `${manualFormHtml('efm-edit', manual, { includeFile: false })}
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efm-edit-cancel">Cancel</button>
      <button type="button" class="vs-button vs-button--primary vs-button--sm" id="efm-edit-save">Save Changes</button>
    </div>`
  );
  bindDistributionSelector('efm-edit-distribution');

  state.view?.querySelector('#efm-edit-cancel')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efm-edit-save')?.addEventListener('click', async () => {
    const fields = readManualForm('efm-edit');
    if (!fields.title) {
      setModalStatus('Manual title is required.');
      return;
    }
    try {
      const targeting = await validateDistributionTargeting(state.companyId, fields.distribution);
      const count = targeting.matchingUserCount == null ? 'company-wide' : `${targeting.matchingUserCount} matching user(s)`;
      if (!window.confirm(`Save "${fields.title}" with ${distributionLabel(targeting.distribution)} distribution (${count})? This target applies to the manual's current effective revision.`)) {
        return;
      }
      await updateManualMetadata(state.companyId, manual.id, fields);
      closeModal();
      setStatus('Manual metadata updated.', 'success');
    } catch (error) {
      console.error('Manual metadata update failed:', error);
      setModalStatus(error.message || 'Failed to update manual.');
    }
  });
}

async function openReviseModal(manual) {
  openModal(manual.title, '<p class="muted">Preparing revision form…</p>');
  let revisions = [];
  try {
    revisions = await listRevisions(state.companyId, manual.id);
  } catch (error) {
    console.error('Revision list failed:', error);
    openModal(
      `Upload Revision — ${manual.title}`,
      `<p class="efb-ml-note">Unable to load revision history: ${escapeHtml(error.message || error)}</p>`
    );
    return;
  }
  const nextNumber = suggestNextRevisionNumber(revisions, manual);

  openModal(
    `Upload Revision — ${manual.title}`,
    `<div class="efb-ml-form">
      <div class="efb-ml-readonly">
        <span>Manual</span><strong>${escapeHtml(manual.documentNumber || '—')} · ${escapeHtml(manual.title)}</strong>
      </div>
      ${textField('efm-rev-number', 'Revision Number', { type: 'number', value: String(nextNumber), required: true, attrs: 'min="1" step="1"' })}
      ${textField('efm-rev-issue-number', 'Issue Number', { value: manual.issueNumber ?? '' })}
      ${dateField('efm-rev-issue-date', 'Issue Date', new Date().toISOString().slice(0, 10))}
      ${dateField('efm-rev-effective-date', 'Effective Date', new Date().toISOString().slice(0, 10))}
      ${textField('efm-rev-prepared', 'Prepared By', { value: manual.preparedBy || '' })}
      ${textField('efm-rev-reviewed', 'Reviewed By', { value: manual.reviewedBy || '' })}
      ${textField('efm-rev-approved', 'Internally Approved By', { value: manual.approvedBy || '' })}
      ${textField('efm-rev-approval-ref', 'Approval Reference', { value: manual.approvalReference || '' })}
      ${dateField('efm-rev-approval-date', 'Approval Date', manual.approvalDate)}
      ${distributionSelectorHtml('efm-rev-distribution', manual.distribution)}
      ${textareaField('efm-rev-reason', 'Reason for Revision', '')}
      ${textField('efm-rev-chapters', 'Affected Chapters', { placeholder: 'e.g. Chapter 4, 7.2' })}
      ${textField('efm-rev-pages', 'Affected Pages', { placeholder: 'e.g. 12–18' })}
      ${fileField('efm-rev-file', 'New revision file (PDF recommended)')}
    </div>
    <p class="efb-ml-note">Uploading stores an immutable copy at a new revision path. The previous revision stays available in History.</p>
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efm-rev-cancel">Cancel</button>
      <button type="button" class="vs-button vs-button--ghost vs-button--sm" id="efm-rev-draft">Save Draft Revision</button>
      <button type="button" class="vs-button vs-button--primary vs-button--sm" id="efm-rev-publish">Upload &amp; Publish</button>
    </div>`
  );
  bindDistributionSelector('efm-rev-distribution');

  const submit = async (publish) => {
    const file = state.view?.querySelector('#efm-rev-file')?.files?.[0] || null;
    if (!file) {
      setModalStatus('Choose a file for this revision.');
      return;
    }
    const reason = readValue('efm-rev-reason');
    if (publish && !reason) {
      setModalStatus('Reason for revision is required to publish.');
      return;
    }

    if (publish) {
      let targeting;
      try {
        targeting = await validateDistributionTargeting(state.companyId, readDistribution('efm-rev-distribution'));
      } catch (error) {
        setModalStatus(error.message || 'Distribution target could not be resolved.');
        return;
      }
      const count = targeting.matchingUserCount == null ? 'company-wide' : `${targeting.matchingUserCount} matching user(s)`;
      const confirmed = window.confirm(`Publish revision #${readValue('efm-rev-number')} of "${manual.title}" to ${distributionLabel(targeting.distribution)} (${count})? Future-effective revisions only become operational on their effective date.`);
      if (!confirmed) return;
    }

    const buttons = ['efm-rev-cancel', 'efm-rev-draft', 'efm-rev-publish'].map((id) => state.view?.querySelector(`#${id}`));
    buttons.forEach((button) => button && (button.disabled = true));
    setStatus(publish ? 'Uploading and publishing revision…' : 'Saving draft revision…');

    try {
      const result = await uploadRevision(
        state.companyId,
        manual.id,
        {
          revisionNumber: readValue('efm-rev-number') || nextNumber,
          issueNumber: readValue('efm-rev-issue-number'),
          issueDate: readValue('efm-rev-issue-date'),
          effectiveDate: readValue('efm-rev-effective-date'),
          reason,
          affectedChapters: readValue('efm-rev-chapters'),
          affectedPages: readValue('efm-rev-pages'),
          preparedBy: readValue('efm-rev-prepared'),
          reviewedBy: readValue('efm-rev-reviewed'),
          approvedBy: readValue('efm-rev-approved'),
          approvalReference: readValue('efm-rev-approval-ref'),
          approvalDate: readValue('efm-rev-approval-date'),
          distribution: readDistribution('efm-rev-distribution'),
          file
        },
        { publish, actorUid: state.userUid }
      );
      closeModal();
      setStatus(
        result?.acknowledgementWarning || (publish ? 'Revision uploaded and published.' : 'Draft revision saved.'),
        result?.acknowledgementWarning ? 'error' : 'success'
      );
    } catch (error) {
      console.error('Revision upload failed:', error);
      setModalStatus(error.message || 'Failed to upload revision.');
      buttons.forEach((button) => button && (button.disabled = false));
    }
  };

  state.view?.querySelector('#efm-rev-cancel')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efm-rev-draft')?.addEventListener('click', () => submit(false));
  state.view?.querySelector('#efm-rev-publish')?.addEventListener('click', () => submit(true));
}

function temporaryStatusLabel(revision) {
  const effective = evaluateEffectiveStatus(revision);
  return effective === TEMPORARY_EFFECTIVE_STATES.EFFECTIVE ? 'Effective' :
    effective === TEMPORARY_EFFECTIVE_STATES.PUBLISHED_NOT_YET_EFFECTIVE ? 'Published · Not yet effective' :
      effective.replaceAll('_', ' ');
}

function visibleTemporaryRevisions() {
  let items = state.temporaryRevisions;
  if (!state.canManage) {
    const recipient = state.recipientContext || {
      ids: [state.userUid].filter(Boolean),
      roles: [state.userRole].filter(Boolean),
      departments: [],
      aircraftTypes: [],
      aircraftRegistrations: []
    };
    items = items.filter((revision) =>
      revision.status === TEMPORARY_REVISION_STATUSES.PUBLISHED &&
      evaluateEffectiveStatus(revision) === TEMPORARY_EFFECTIVE_STATES.EFFECTIVE &&
      distributionMatchesRecipient(revision.distribution, recipient)
    );
  }
  return items;
}

function filteredTemporaryRevisions() {
  const term = `${state.view?.querySelector('#efb-temp-search')?.value || ''}`.trim().toLowerCase();
  const status = state.view?.querySelector('#efb-temp-status-filter')?.value || '';
  const effectiveness = state.view?.querySelector('#efb-temp-effective')?.value || '';
  const aircraft = state.view?.querySelector('#efb-temp-aircraft')?.value || '';
  const department = state.view?.querySelector('#efb-temp-department')?.value || '';
  const parentManual = state.view?.querySelector('#efb-temp-parent-filter')?.value || '';
  return visibleTemporaryRevisions().filter((revision) => {
    const effectiveStatus = evaluateEffectiveStatus(revision);
    if (status === 'expired' || status === 'withdrawn') {
      if (effectiveStatus !== status) return false;
    } else if (status && revision.status !== status) return false;
    if (effectiveness && effectiveStatus !== effectiveness) return false;
    if (aircraft && `${revision.aircraftApplicability || ''}`.toLowerCase() !== aircraft.toLowerCase()) return false;
    if (department && `${revision.department || ''}`.toLowerCase() !== department.toLowerCase()) return false;
    if (parentManual && revision.manualId !== parentManual) return false;
    if (term && !`${revision.title} ${revision.referenceNumber} ${revision.description || ''}`.toLowerCase().includes(term)) return false;
    return true;
  }).sort((left, right) => `${right.effectiveFrom || ''}`.localeCompare(`${left.effectiveFrom || ''}`));
}

function renderTemporaryRevisions() {
  const body = state.view?.querySelector('#efb-temporary-body');
  const hint = state.view?.querySelector('#efb-temporary-hint');
  if (!body) return;
  const revisions = filteredTemporaryRevisions();
  body.innerHTML = revisions.length ? revisions.map((revision) => {
    const parent = (state.canManage ? state.manuals : availableManuals()).find((manual) => manual.id === revision.manualId);
    const effectiveStatus = evaluateEffectiveStatus(revision);
    const displayStatus = effectiveStatus === TEMPORARY_EFFECTIVE_STATES.EXPIRED
      ? 'expired'
      : effectiveStatus === TEMPORARY_EFFECTIVE_STATES.WITHDRAWN
        ? 'withdrawn'
        : revision.status;
    const actions = [];
    if (state.canManage) {
      if (revision.status === TEMPORARY_REVISION_STATUSES.DRAFT) actions.push('<button type="button" data-temp-action="edit">Edit</button>');
      if ([TEMPORARY_REVISION_STATUSES.DRAFT, TEMPORARY_REVISION_STATUSES.IN_REVIEW].includes(revision.status)) {
        actions.push('<button type="button" data-temp-action="publish">Publish</button>');
      }
      if ([TEMPORARY_REVISION_STATUSES.PUBLISHED, TEMPORARY_REVISION_STATUSES.EXPIRED].includes(revision.status)) {
        actions.push('<button type="button" data-temp-action="withdraw">Withdraw</button>');
      }
    }
    if (revision.documentUri && (state.canManage || effectiveStatus === TEMPORARY_EFFECTIVE_STATES.EFFECTIVE)) {
      actions.unshift('<button type="button" data-temp-action="view">View</button>');
    }
    return `<tr data-temp-revision="${escapeHtml(revision.id)}" data-manual="${escapeHtml(revision.manualId)}">
      <td>${escapeHtml(revision.referenceNumber)}</td>
      <td><strong>${escapeHtml(revision.title)}</strong><br><span class="efb-ml-secondary">${escapeHtml(distributionLabel(revision.distribution))}</span></td>
      <td>${escapeHtml(parent?.title || '—')}</td>
      <td>${escapeHtml(revision.temporaryRevisionNumber ?? '—')}</td>
      <td>${escapeHtml(formatDateValue(revision.effectiveFrom))} – ${escapeHtml(formatDateValue(revision.effectiveUntil))}</td>
      <td><span class="fdtl-badge ${effectiveStatus === TEMPORARY_EFFECTIVE_STATES.EFFECTIVE ? 'fdtl-badge--good' : ['expired', 'withdrawn'].includes(displayStatus) ? 'fdtl-badge--critical' : 'fdtl-badge--watch'}">${escapeHtml(temporaryStatusLabel(revision))}</span></td>
      <td><div class="efb-manual-actions">${actions.join('')}</div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="fdtl-empty">${state.temporaryRevisions.length ? 'No temporary revisions match the current filters.' : 'No temporary revisions yet.'}</td></tr>`;
  if (hint) hint.textContent = `${revisions.length} temporary revision${revisions.length === 1 ? '' : 's'} shown.`;
}

function temporaryRevisionFormHtml(revision = null, parentManual = null) {
  const parentOptions = state.manuals
    .filter((manual) => manual.status !== MANUAL_STATUSES.ARCHIVED)
    .map((manual) => ({ value: manual.id, label: `${manual.documentNumber || '—'} · ${manual.title}` }));
  const selectedParent = revision?.manualId || parentManual?.id || '';
  const parentPicker = parentManual || revision
    ? `<div class="efb-ml-readonly"><span>Parent manual</span><strong>${escapeHtml(parentManual?.title || state.manuals.find((item) => item.id === selectedParent)?.title || 'Manual')}</strong></div>`
    : selectField('efb-temp-manual', 'Parent Manual', [{ value: '', label: 'Select a manual…' }, ...parentOptions], selectedParent);
  return `<div class="efb-ml-form">
    ${parentPicker}
    ${textField('efb-temp-title', 'Title', { value: revision?.title || '', required: true })}
    ${textField('efb-temp-reference', 'Reference Number', { value: revision?.referenceNumber || '', required: true })}
    ${textField('efb-temp-number', 'Temporary Revision Number', { type: 'number', value: revision?.temporaryRevisionNumber ?? '', attrs: 'min="1" step="1"' })}
    ${dateField('efb-temp-issue-date', 'Issue Date', revision?.issueDate || new Date().toISOString().slice(0, 10))}
    ${dateField('efb-temp-from', 'Effective From', revision?.effectiveFrom)}
    ${dateField('efb-temp-until', 'Effective Until / Expiry', revision?.effectiveUntil)}
    ${textField('efb-temp-aircraft', 'Aircraft Applicability', { value: revision?.aircraftApplicability || '', placeholder: 'e.g. C208B or VT-IIC' })}
    ${textField('efb-temp-department', 'Department', { value: revision?.department || '' })}
    ${textField('efb-temp-prepared', 'Prepared By', { value: revision?.preparedBy || '' })}
    ${textField('efb-temp-reviewed', 'Reviewed By', { value: revision?.reviewedBy || '' })}
    ${textField('efb-temp-approved', 'Approved By', { value: revision?.approvedBy || '', required: true })}
    ${textField('efb-temp-approval-ref', 'Approval Reference', { value: revision?.approvalReference || '' })}
    ${selectField('efb-temp-reg-status', 'Regulatory Approval Status', REGULATORY_APPROVAL_STATUSES, revision?.regulatoryApprovalStatus || 'Not Applicable')}
    ${textareaField('efb-temp-description', 'Description / Reason for Issue', revision?.description || revision?.reason || '')}
    ${textField('efb-temp-chapters', 'Affected Chapters', { value: revision?.affectedChapters || '' })}
    ${textField('efb-temp-pages', 'Affected Pages', { value: revision?.affectedPages || '' })}
    ${distributionSelectorHtml('efb-temp-distribution', revision?.distribution)}
    <label class="efb-ml-field efb-ml-field--wide"><span>Attachment (PDF only)</span><input type="file" id="efb-temp-file" accept=".pdf,application/pdf" /></label>
    ${revision?.sha256 ? `<p class="efb-ml-note efb-ml-field--wide">Current attachment SHA-256: ${escapeHtml(revision.sha256)} (${revision.checksumVerified === true ? 'verified' : 'not verified'})</p>` : ''}
  </div>`;
}

function readTemporaryRevisionForm() {
  return {
    title: readValue('efb-temp-title') || '',
    referenceNumber: readValue('efb-temp-reference') || '',
    temporaryRevisionNumber: readValue('efb-temp-number'),
    description: readValue('efb-temp-description'),
    reason: readValue('efb-temp-description'),
    affectedChapters: readValue('efb-temp-chapters'),
    affectedPages: readValue('efb-temp-pages'),
    aircraftApplicability: readValue('efb-temp-aircraft'),
    department: readValue('efb-temp-department'),
    issueDate: readValue('efb-temp-issue-date'),
    effectiveFrom: readValue('efb-temp-from'),
    effectiveUntil: readValue('efb-temp-until'),
    preparedBy: readValue('efb-temp-prepared'),
    reviewedBy: readValue('efb-temp-reviewed'),
    approvedBy: readValue('efb-temp-approved'),
    approvalReference: readValue('efb-temp-approval-ref'),
    regulatoryApprovalStatus: readValue('efb-temp-reg-status'),
    distribution: readDistribution('efb-temp-distribution')
  };
}

function openTemporaryRevisionModal({ revision = null, parentManual = null } = {}) {
  const title = revision ? `Edit Temporary Revision — ${revision.title}` : 'Add Temporary Revision';
  openModal(
    title,
    `${temporaryRevisionFormHtml(revision, parentManual)}
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-temp-cancel">Cancel</button>
      <button type="button" class="vs-button vs-button--ghost vs-button--sm" id="efb-temp-draft">Save Draft</button>
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-temp-review">Submit for Review</button>
      <button type="button" class="vs-button vs-button--primary vs-button--sm" id="efb-temp-publish">Publish</button>
    </div>`
  );
  bindDistributionSelector('efb-temp-distribution');

  let workingRevisionId = revision?.id || null;
  const submit = async (action) => {
    const fields = readTemporaryRevisionForm();
    const manualId = revision?.manualId || parentManual?.id || readValue('efb-temp-manual');
    const file = state.view?.querySelector('#efb-temp-file')?.files?.[0] || null;
    if (!manualId) {
      setModalStatus('Choose an existing parent manual.');
      return;
    }
    if (action === 'publish' && !file && !revision?.checksumVerified) {
      setModalStatus('Upload and verify a PDF attachment before publishing.');
      return;
    }
    try {
      const targeting = await validateDistributionTargeting(state.companyId, fields.distribution);
      if (action === 'publish' && !window.confirm(
        `Publish "${fields.title}" for ${formatDateValue(fields.effectiveFrom)} through ${formatDateValue(fields.effectiveUntil)}?\n\n${distributionLabel(targeting.distribution)}\n${targeting.matchingUserCount == null ? 'Company-wide recipients' : `${targeting.matchingUserCount} matching user(s)`}`
      )) return;
    } catch (error) {
      setModalStatus(error.message || 'Distribution target could not be resolved.');
      return;
    }

    const buttons = ['efb-temp-cancel', 'efb-temp-draft', 'efb-temp-review', 'efb-temp-publish']
      .map((id) => state.view?.querySelector(`#${id}`));
    buttons.forEach((button) => button && (button.disabled = true));
    setStatus(action === 'publish' ? 'Publishing temporary revision…' : action === 'review' ? 'Submitting temporary revision for review…' : 'Saving temporary revision…');
    try {
      let createdAsReview = false;
      let acknowledgementWarning = null;
      if (workingRevisionId) {
        await updateTemporaryRevision(state.companyId, manualId, workingRevisionId, fields, { file });
      } else {
        const created = await createTemporaryRevision(state.companyId, manualId, fields, {
          file,
          action: action === 'review' ? 'review' : 'draft',
          actorUid: state.userUid
        });
        workingRevisionId = created.revisionId;
        createdAsReview = action === 'review';
      }
      if (action === 'review' && !createdAsReview) {
        await submitTemporaryRevisionForReview(state.companyId, manualId, workingRevisionId);
      }
      if (action === 'publish') {
        const published = await publishTemporaryRevision(state.companyId, manualId, workingRevisionId);
        acknowledgementWarning = published?.acknowledgementWarning || null;
      }
      closeModal();
      setStatus(
        acknowledgementWarning || (action === 'publish' ? 'Temporary revision published.' : action === 'review' ? 'Temporary revision submitted for review.' : 'Temporary revision saved as draft.'),
        acknowledgementWarning ? 'error' : 'success'
      );
    } catch (error) {
      console.error('Temporary revision save failed:', error);
      setModalStatus(error.message || 'Failed to save temporary revision.');
      buttons.forEach((button) => button && (button.disabled = false));
    }
  };

  state.view?.querySelector('#efb-temp-cancel')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efb-temp-draft')?.addEventListener('click', () => submit('draft'));
  state.view?.querySelector('#efb-temp-review')?.addEventListener('click', () => submit('review'));
  state.view?.querySelector('#efb-temp-publish')?.addEventListener('click', () => submit('publish'));
}

function openTemporaryRevisionView(revision) {
  const parent = (state.canManage ? state.manuals : availableManuals()).find((manual) => manual.id === revision.manualId);
  const file = revision.documentUri
    ? `<div class="efb-ml-preview"><iframe src="${escapeHtml(revision.documentUri)}" title="${escapeHtml(revision.title)}" class="efb-ml-pdf-viewer"></iframe><div class="efb-modal-actions"><button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-temp-download">Download PDF</button></div></div>`
    : '<p class="efb-ml-note">No attachment has been uploaded.</p>';
  openModal(revision.title, `<div class="efb-ml-detail-grid">
    <div><span>Reference</span><strong>${escapeHtml(revision.referenceNumber)}</strong></div>
    <div><span>Parent Manual</span><strong>${escapeHtml(parent?.title || '—')}</strong></div>
    <div><span>Effective Period</span><strong>${escapeHtml(formatDateValue(revision.effectiveFrom))} – ${escapeHtml(formatDateValue(revision.effectiveUntil))}</strong></div>
    <div><span>Effectiveness</span><strong>${escapeHtml(temporaryStatusLabel(revision))}</strong></div>
    <div><span>Distribution</span><strong>${escapeHtml(distributionLabel(revision.distribution))}</strong></div>
    <div><span>Aircraft / Department</span><strong>${escapeHtml(revision.aircraftApplicability || 'All aircraft')} · ${escapeHtml(revision.department || 'All departments')}</strong></div>
    <div><span>Approval</span><strong>${escapeHtml(revision.approvedBy || '—')} · ${escapeHtml(revision.regulatoryApprovalStatus)}</strong></div>
    <div><span>SHA-256</span><strong>${escapeHtml(revision.sha256 || '—')} · ${revision.checksumVerified === true ? 'verified' : 'not verified'}</strong></div>
    <div class="efb-ml-field--wide"><span>Description / Reason</span><strong>${escapeHtml(revision.description || '—')}</strong></div>
  </div>${file}`);
  state.view?.querySelector('#efb-temp-download')?.addEventListener('click', () => downloadManualFile(revision.documentUri, revision.fileName || `${revision.referenceNumber}.pdf`));
}

function setDistributionSection(section) {
  state.view?.querySelectorAll('.efb-ml-section:not(:disabled)').forEach((button) => {
    const active = button.dataset.esection === section;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  state.view?.querySelectorAll('[data-esection-panel]').forEach((panel) => {
    const active = panel.dataset.esectionPanel === section;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (section === 'acknowledgements') refreshAcknowledgements();
}

function replaceFilterOptions(selector, values, placeholder) {
  const select = state.view?.querySelector(selector);
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${uniqueValues(values)
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('')}`;
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map((value) => `${value}`.trim()).filter(Boolean))].sort();
}

function populateFilterOptions() {
  const aircraftValues = [
    ...state.recipients.flatMap((recipient) => [...recipient.aircraftTypes, ...recipient.aircraftRegistrations]),
    ...state.manuals.map((manual) => manual.aircraftApplicability),
    ...state.temporaryRevisions.map((revision) => revision.aircraftApplicability)
  ];
  const departmentValues = [
    ...state.recipients.flatMap((recipient) => recipient.departments),
    ...state.manuals.map((manual) => manual.department),
    ...state.temporaryRevisions.map((revision) => revision.department)
  ];
  replaceFilterOptions('#efb-ml-aircraft-filter', aircraftValues, 'All aircraft');
  replaceFilterOptions('#efb-temp-aircraft', aircraftValues, 'All aircraft');
  replaceFilterOptions('#efb-ml-department-filter', departmentValues, 'All departments');
  replaceFilterOptions('#efb-temp-department', departmentValues, 'All departments');
  const parentFilter = state.view?.querySelector('#efb-temp-parent-filter');
  if (parentFilter) {
    const selected = parentFilter.value;
    parentFilter.innerHTML = `<option value="">All parent manuals</option>${state.manuals
      .map((manual) => `<option value="${escapeHtml(manual.id)}">${escapeHtml(manual.documentNumber || '—')} · ${escapeHtml(manual.title)}</option>`)
      .join('')}`;
    if ([...parentFilter.options].some((option) => option.value === selected)) parentFilter.value = selected;
  }
}

function syncTemporarySubscriptions(manuals) {
  const ids = new Set(manuals.map((manual) => manual.id));
  for (const [manualId, unsubscribe] of state.temporaryUnsubscribers) {
    if (!ids.has(manualId)) {
      unsubscribe();
      state.temporaryUnsubscribers.delete(manualId);
      state.temporaryRevisions = state.temporaryRevisions.filter((revision) => revision.manualId !== manualId);
    }
  }
  for (const manualId of ids) {
    if (state.temporaryUnsubscribers.has(manualId)) continue;
    const unsubscribe = onTemporaryRevisionsSnapshot(
      state.companyId,
      manualId,
      (revisions) => {
        state.temporaryRevisions = [
          ...state.temporaryRevisions.filter((revision) => revision.manualId !== manualId),
          ...revisions
        ];
        populateFilterOptions();
        render();
      },
      (error) => {
        console.error('Temporary revision snapshot failed:', error);
        setStatus(`Unable to load temporary revisions for manual ${manualId}.`, 'error');
      }
    );
    state.temporaryUnsubscribers.set(manualId, unsubscribe);
  }
}

function acknowledgementStatusLabel(item) {
  if (item.status === 'acknowledged') {
    return item.lifecycleStatus && !['effective', 'published_not_yet_effective'].includes(item.lifecycleStatus)
      ? `Acknowledged · ${item.lifecycleStatus.replaceAll('_', ' ')}`
      : 'Acknowledged';
  }
  if (item.actionable) return 'Pending acknowledgement';
  if (item.status === 'pending' && item.generationStatus !== 'complete') return 'Requirements unavailable';
  if (item.status === 'pending' && ['effective', 'published_not_yet_effective'].includes(item.lifecycleStatus)) {
    return 'Pending acknowledgement';
  }
  return `${item.lifecycleStatus || 'pending'}`.replaceAll('_', ' ');
}

function acknowledgementBadge(item) {
  const label = acknowledgementStatusLabel(item);
  const modifier = item.status === 'acknowledged'
    ? 'fdtl-badge--good'
    : item.actionable
      ? 'fdtl-badge--watch'
      : ['withdrawn', 'expired', 'superseded'].includes(item.lifecycleStatus)
        ? 'fdtl-badge--critical'
        : '';
  return `<span class="fdtl-badge ${modifier}">${escapeHtml(label)}</span>`;
}

function renderMyAcknowledgements() {
  const body = state.view?.querySelector('#efb-ack-user-body');
  if (!body) return;
  const items = state.myAcknowledgements;
  body.innerHTML = items.length ? items.map((item) => {
    const revision = item.revisionNumber ?? '—';
    const typeLabel = item.revisionType === 'temporary' ? 'Temporary' : 'Permanent';
    const status = acknowledgementStatusLabel(item);
    return `<tr>
      <td>${escapeHtml(item.documentNumber || '—')}</td>
      <td><strong>${escapeHtml(item.documentTitle)}</strong><br><span class="efb-ml-secondary">${typeLabel} revision ${escapeHtml(revision)}${item.issueNumber ? ` · Issue ${escapeHtml(item.issueNumber)}` : ''}</span></td>
      <td>${typeLabel}</td>
      <td>${escapeHtml(formatDateValue(item.publishedAt))}</td>
      <td>${escapeHtml(formatDateValue(item.effectiveDate))}${item.effectiveUntil ? ` – ${escapeHtml(formatDateValue(item.effectiveUntil))}` : ''}</td>
      <td>${acknowledgementBadge(item)}</td>
      <td>${item.actionable ? `<button type="button" class="vs-button vs-button--secondary vs-button--sm" data-ack-review="${escapeHtml(item.id)}">Review</button>` : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="fdtl-empty">No acknowledgement requirements or history found.</td></tr>';
  const more = state.view?.querySelector('#efb-ack-user-more');
  if (more) more.hidden = !state.myAcknowledgementCursor;

  body.querySelectorAll('[data-ack-review]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = items.find((candidate) => candidate.id === button.dataset.ackReview);
      if (item) openAcknowledgementReview(item);
    });
  });
}

async function loadMoreMyAcknowledgements(button = null) {
  if (!state.myAcknowledgementCursor) return;
  if (button) button.disabled = true;
  try {
    const page = await getMyAcknowledgements({ cursor: state.myAcknowledgementCursor, pageSize: 50 });
    state.myAcknowledgements.push(...(page?.items || []));
    state.myAcknowledgementCursor = page?.nextCursor || null;
    renderMyAcknowledgements();
  } catch (error) {
    console.error('Additional acknowledgement history failed to load:', error);
    const status = state.view?.querySelector('#efb-ack-user-status');
    if (status) status.textContent = `Unable to load additional history: ${error.message || error}`;
  } finally {
    if (button) button.disabled = false;
  }
}

function openAcknowledgementReview(item) {
  const typeLabel = item.revisionType === 'temporary' ? 'Temporary' : 'Permanent';
  const manualFileSection = item.documentUri
    ? `<div class="efb-ml-preview">
        <iframe src="${escapeHtml(item.documentUri)}" title="${escapeHtml(item.documentTitle)} revision ${escapeHtml(item.revisionNumber ?? '')}" class="efb-ml-pdf-viewer"></iframe>
        <div class="efb-modal-actions"><button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-ack-download">Download exact revision</button></div>
      </div>`
    : '<p class="efb-ml-note">The exact revision file is not available. Contact your administrator; no acknowledgement can be submitted without reviewing the manual.</p>';
  const canAcknowledge = item.actionable && Boolean(item.documentUri);
  openModal(
    `Review Revision — ${item.documentTitle}`,
    `<div class="efb-ml-detail-grid">
      <div><span>Manual Number</span><strong>${escapeHtml(item.documentNumber || '—')}</strong></div>
      <div><span>Manual Title</span><strong>${escapeHtml(item.documentTitle)}</strong></div>
      <div><span>Revision Type</span><strong>${typeLabel}</strong></div>
      <div><span>Revision Number</span><strong>${escapeHtml(item.revisionNumber ?? '—')}</strong></div>
      <div><span>Issue Number</span><strong>${escapeHtml(item.issueNumber ?? '—')}</strong></div>
      <div><span>Published</span><strong>${escapeHtml(formatDateValue(item.publishedAt))}</strong></div>
      <div><span>Effective Period</span><strong>${escapeHtml(formatDateValue(item.effectiveDate))}${item.effectiveUntil ? ` – ${escapeHtml(formatDateValue(item.effectiveUntil))}` : ''}</strong></div>
      <div><span>Aircraft / Department</span><strong>${escapeHtml((item.aircraftApplicability || 'All aircraft'))} · ${escapeHtml(item.department || 'All departments')}</strong></div>
      <div><span>Acknowledgement Status</span><strong>${escapeHtml(acknowledgementStatusLabel(item))}</strong></div>
    </div>
    ${manualFileSection}
    <p class="efb-ack-statement">I acknowledge that I have received and reviewed this manual revision. I understand that I am responsible for familiarising myself with its applicable contents.</p>
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-ack-review-close">Close</button>
      ${canAcknowledge ? '<button type="button" class="vs-button vs-button--primary vs-button--sm" id="efb-ack-submit">I Acknowledge This Revision</button>' : ''}
    </div>`
  );
  state.view?.querySelector('#efb-ack-review-close')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efb-ack-download')?.addEventListener('click', () => {
    downloadManualFile(item.documentUri, item.fileName || `${item.documentNumber || 'manual'}-${item.revisionNumber || 'revision'}.pdf`);
  });
  state.view?.querySelector('#efb-ack-submit')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const confirmation = `I acknowledge the following exact revision:\n\n${item.documentNumber || '—'} · Revision ${item.revisionNumber ?? '—'}\n${item.documentTitle}\n\nSubmit this acknowledgement now?`;
    if (!window.confirm(confirmation)) return;
    button.disabled = true;
    try {
      await acknowledgeManualRevision({
        manualId: item.manualId,
        revisionId: item.revisionId,
        revisionType: item.revisionType
      });
      closeModal();
      await refreshAcknowledgements();
      state.view?.querySelector('#efb-ack-user-status')?.replaceChildren(document.createTextNode('Acknowledgement recorded by the server.',));
    } catch (error) {
      console.error('Manual revision acknowledgement failed:', error);
      setModalStatus(error.message || 'Unable to submit acknowledgement.');
      button.disabled = false;
    }
  });
}

function updateSelectOptions(selector, values, placeholder) {
  const select = state.view?.querySelector(selector);
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${uniqueValues(values)
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('')}`;
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function filteredAcknowledgementRows() {
  const manualId = state.view?.querySelector('#efb-ack-filter-manual')?.value || '';
  const revisionType = state.view?.querySelector('#efb-ack-filter-type')?.value || '';
  const status = state.view?.querySelector('#efb-ack-filter-status')?.value || '';
  const department = state.view?.querySelector('#efb-ack-filter-department')?.value || '';
  const aircraft = state.view?.querySelector('#efb-ack-filter-aircraft')?.value || '';
  const from = state.view?.querySelector('#efb-ack-filter-from')?.value || '';
  const to = state.view?.querySelector('#efb-ack-filter-to')?.value || '';
  return state.acknowledgementRows.filter((item) =>
    (!manualId || item.manualId === manualId) &&
    (!revisionType || item.revisionType === revisionType) &&
    (!status || (status === 'incomplete'
      ? item.generationStatus !== 'complete'
      : status === 'redistribution_incomplete'
        ? item.redistributionStatus === 'incomplete'
        : item.status === status)) &&
    (!department || item.department === department) &&
    (!aircraft || item.aircraftApplicability === aircraft) &&
    (!from || `${item.publishedAt || ''}`.slice(0, 10) >= from) &&
    (!to || `${item.publishedAt || ''}`.slice(0, 10) <= to)
  );
}

function renderAcknowledgementDashboard() {
  const body = state.view?.querySelector('#efb-ack-admin-body');
  if (!body) return;
  const total = state.acknowledgementRows.reduce((sum, item) => sum + item.total, 0);
  const acknowledged = state.acknowledgementRows.reduce((sum, item) => sum + item.acknowledged, 0);
  const pending = state.acknowledgementRows.reduce((sum, item) => sum + item.pending, 0);
  const completion = total ? Math.round((acknowledged / total) * 100) : 0;
  for (const [key, value] of Object.entries({ total, acknowledged, pending, completion: `${completion}%` })) {
    const element = state.view?.querySelector(`[data-ack-stat="${key}"]`);
    if (element) element.textContent = String(value);
  }
  const manualSelect = state.view?.querySelector('#efb-ack-filter-manual');
  if (manualSelect) {
    const selected = manualSelect.value;
    manualSelect.innerHTML = `<option value="">All manuals</option>${[...new Map(state.acknowledgementRows.map((item) => {
      const parent = state.manuals.find((manual) => manual.id === item.manualId);
      return [item.manualId, `${parent?.documentNumber || '—'} · ${parent?.title || item.documentTitle}`];
    }))].map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join('')}`;
    if ([...manualSelect.options].some((option) => option.value === selected)) manualSelect.value = selected;
  }
  updateSelectOptions('#efb-ack-filter-department', state.acknowledgementRows.map((item) => item.department), 'All departments');
  updateSelectOptions('#efb-ack-filter-aircraft', state.acknowledgementRows.flatMap((item) => item.aircraftApplicability ? [item.aircraftApplicability] : []), 'All aircraft');

  const rows = filteredAcknowledgementRows();
  body.innerHTML = rows.length ? rows.map((item) => {
    const revision = item.revisionNumber ?? '—';
    const type = item.revisionType === 'temporary' ? 'Temporary' : 'Permanent';
    const status = item.generationStatus !== 'complete'
      ? 'Generation incomplete'
      : item.redistributionStatus === 'incomplete'
        ? 'Redistribution incomplete'
        : item.redistributionStatus === 'processing'
          ? 'Redistribution in progress'
          : item.status;
    const percentage = item.total ? Math.round((item.acknowledged / item.total) * 100) : 0;
    return `<tr data-ack-row="${escapeHtml(item.revisionId)}" data-manual="${escapeHtml(item.manualId)}" data-type="${escapeHtml(item.revisionType)}">
      <td>${escapeHtml(item.documentNumber || '—')}</td>
      <td><strong>${escapeHtml(item.documentTitle)}</strong></td>
      <td>${escapeHtml(revision)}</td>
      <td>${type}</td>
      <td>${escapeHtml(formatDateValue(item.publishedAt))}</td>
      <td>v${escapeHtml(item.distributionVersion)} · ${escapeHtml(distributionLabel(item.distribution))}</td>
      <td>${item.acknowledged}</td>
      <td>${item.pending}</td>
      <td>${percentage}%</td>
      <td>${escapeHtml(status)}</td>
      <td><div class="efb-manual-actions">
        <button type="button" data-ack-action="details">Details</button>
        <button type="button" data-ack-action="pending">Pending</button>
        <button type="button" data-ack-action="acknowledged">Acknowledged</button>
        ${status === 'Generation incomplete' ? '<button type="button" data-ack-action="retry">Retry</button>' : ''}
        ${item.acknowledgementRequired ? '<button type="button" data-ack-action="redistribute">Redistribute</button>' : ''}
      </div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" class="fdtl-empty">No acknowledgement revisions match the selected filters.</td></tr>';
  const hint = state.view?.querySelector('#efb-ack-admin-hint');
  if (hint) hint.textContent = `${rows.length} revision record${rows.length === 1 ? '' : 's'} shown. Completion is calculated per revision.`;
}

async function loadAcknowledgementRecipients(item) {
  const status = state.view?.querySelector('#efb-ack-recipient-status')?.value || null;
  const department = state.view?.querySelector('#efb-ack-recipient-department')?.value || null;
  const aircraft = state.view?.querySelector('#efb-ack-recipient-aircraft')?.value || null;
  const result = await getRevisionAcknowledgementRecipients({
    companyId: state.companyId,
    manualId: item.manualId,
    revisionId: item.revisionId,
    revisionType: item.revisionType,
    status,
    department,
    aircraft,
    cursor: state.acknowledgementRecipientCursor,
    pageSize: 50
  });
  state.acknowledgementRecipients.push(...(result?.items || []));
  state.acknowledgementRecipientCursor = result?.nextCursor || null;
  renderAcknowledgementRecipients();
}

function renderAcknowledgementRecipients() {
  const body = state.view?.querySelector('#efb-ack-recipient-body');
  if (!body) return;
  body.innerHTML = state.acknowledgementRecipients.length ? state.acknowledgementRecipients.map((item) => `<tr>
    <td>${escapeHtml(item.userName)}</td>
    <td>${escapeHtml(item.userEmail)}</td>
    <td>${escapeHtml(item.departments.join(', ') || '—')}</td>
    <td>${escapeHtml(item.aircraft.join(', ') || '—')}</td>
    <td>${escapeHtml(item.status === 'acknowledged' ? 'Acknowledged' : 'Pending')}</td>
    <td>${escapeHtml(item.acknowledgedAt ? new Date(item.acknowledgedAt).toLocaleString() : '—')}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="fdtl-empty">No recipients match this view.</td></tr>';
  const more = state.view?.querySelector('#efb-ack-recipient-more');
  if (more) more.hidden = !state.acknowledgementRecipientCursor;
  const hint = state.view?.querySelector('#efb-ack-recipient-hint');
  if (hint) hint.textContent = `${state.acknowledgementRecipients.length} recipient row(s) loaded.`;
}

function csvCell(value) {
  return `"${`${value ?? ''}`.replaceAll('"', '""')}"`;
}

function exportAcknowledgementRecipients() {
  const rows = [
    ['Name', 'Email', 'Department', 'Aircraft', 'Status', 'Acknowledged At'],
    ...state.acknowledgementRecipients.map((item) => [
      item.userName,
      item.userEmail,
      item.departments.join('; '),
      item.aircraft.join('; '),
      item.status,
      item.acknowledgedAt || ''
    ])
  ];
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'manual-acknowledgements-loaded-recipients.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openAcknowledgementRecipients(item, status = null) {
  const statusLabel = status === 'pending' ? 'Pending recipients' :
    status === 'acknowledged' ? 'Acknowledged recipients' : 'Acknowledgement recipients';
  state.acknowledgementRecipients = [];
  state.acknowledgementRecipientCursor = null;
  const departmentOptions = uniqueValues(state.recipients.flatMap((recipient) => recipient.departments));
  const aircraftOptions = uniqueValues(state.recipients.flatMap((recipient) => recipient.aircraftRegistrations));
  openModal(
    `${statusLabel} — ${item.documentTitle}`,
    `<p class="efb-ml-note">${escapeHtml(item.documentNumber || '—')} · Revision ${escapeHtml(item.revisionNumber ?? '—')} · ${item.revisionType === 'temporary' ? 'Temporary' : 'Permanent'}. CSV export includes the recipient rows currently loaded.</p>
    <div class="efb-ml-toolbar">
      <select id="efb-ack-recipient-status" aria-label="Filter recipient acknowledgement status">
        <option value="">All statuses</option>
        <option value="pending"${status === 'pending' ? ' selected' : ''}>Pending</option>
        <option value="acknowledged"${status === 'acknowledged' ? ' selected' : ''}>Acknowledged</option>
      </select>
      <select id="efb-ack-recipient-department" aria-label="Filter recipients by department">
        <option value="">All departments</option>${departmentOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}
      </select>
      <select id="efb-ack-recipient-aircraft" aria-label="Filter recipients by aircraft">
        <option value="">All aircraft</option>${aircraftOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}
      </select>
    </div>
    <div class="efb-ack-recipient-list efb-table-wrap">
      <table><thead><tr><th>User</th><th>Email</th><th>Department</th><th>Aircraft</th><th>Status</th><th>Acknowledged At</th></tr></thead><tbody id="efb-ack-recipient-body"><tr><td colspan="6">Loading recipients…</td></tr></tbody></table>
    </div>
    <p class="muted efb-ml-hint" id="efb-ack-recipient-hint"></p>
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-ack-recipient-export">Export loaded CSV</button>
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-ack-recipient-more" hidden>Load more</button>
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-ack-recipient-close">Close</button>
    </div>`
  );
  const load = async () => {
    const more = state.view?.querySelector('#efb-ack-recipient-more');
    if (more) more.disabled = true;
    try {
      await loadAcknowledgementRecipients(item);
    } catch (error) {
      console.error('Acknowledgement recipient list failed:', error);
      setModalStatus(error.message || 'Unable to load acknowledgement recipients.');
    } finally {
      if (more) more.disabled = false;
    }
  };
  state.view?.querySelector('#efb-ack-recipient-more')?.addEventListener('click', load);
  ['#efb-ack-recipient-status', '#efb-ack-recipient-department', '#efb-ack-recipient-aircraft'].forEach((selector) => {
    state.view?.querySelector(selector)?.addEventListener('change', () => {
      state.acknowledgementRecipients = [];
      state.acknowledgementRecipientCursor = null;
      load();
    });
  });
  state.view?.querySelector('#efb-ack-recipient-close')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efb-ack-recipient-export')?.addEventListener('click', exportAcknowledgementRecipients);
  load();
}

function openRedistributeAcknowledgementRevision(item) {
  const target = item.distribution || null;
  openModal(
    `Redistribute Revision — ${item.documentTitle}`,
    `<p class="efb-ml-note">This explicitly adds requirements for additional matching recipients. Existing recipients and historical acknowledgements are preserved; the revision’s distribution version will be incremented.</p>
    ${distributionSelectorHtml('efb-ack-redist', target)}
    <div class="efb-modal-actions">
      <button type="button" class="vs-button vs-button--secondary vs-button--sm" id="efb-ack-redist-cancel">Cancel</button>
      <button type="button" class="vs-button vs-button--primary vs-button--sm" id="efb-ack-redist-save">Redistribute</button>
    </div>`
  );
  bindDistributionSelector('efb-ack-redist');
  state.view?.querySelector('#efb-ack-redist-cancel')?.addEventListener('click', closeModal);
  state.view?.querySelector('#efb-ack-redist-save')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const distribution = readDistribution('efb-ack-redist');
    try {
      const preview = await validateDistributionTargeting(state.companyId, distribution);
      const confirmed = await confirmAction({
        title: 'Confirm redistribution',
        message: `Redistribute "${item.documentTitle}" revision ${item.revisionNumber ?? '—'} using ${distributionLabel(preview.distribution)}? Existing acknowledgement records will not be changed.`,
        confirmLabel: 'Redistribute'
      });
      if (!confirmed) return;
      button.disabled = true;
      const result = await redistributeManualRevision({
        companyId: state.companyId,
        manualId: item.manualId,
        revisionId: item.revisionId,
        revisionType: item.revisionType,
        distribution
      });
      closeModal();
      await refreshAcknowledgements();
      state.view?.querySelector('#efb-ack-admin-status')?.replaceChildren(document.createTextNode(
        `Redistribution v${result.distributionVersion} completed; ${result.total} total recipient requirement(s) now apply.`
      ));
    } catch (error) {
      console.error('Manual revision redistribution failed:', error);
      setModalStatus(error.message || 'Unable to redistribute this revision.');
      button.disabled = false;
    }
  });
}

async function refreshAcknowledgements() {
  const userStatus = state.view?.querySelector('#efb-ack-user-status');
  if (userStatus) userStatus.textContent = 'Loading acknowledgement requirements…';
  try {
    const page = await getMyAcknowledgements({ pageSize: 50 });
    state.myAcknowledgements = page?.items || [];
    state.myAcknowledgementCursor = page?.nextCursor || null;
    renderMyAcknowledgements();
    if (userStatus) userStatus.textContent = `${state.myAcknowledgements.length} acknowledgement record(s).`;
  } catch (error) {
    console.error('User acknowledgements failed to load:', error);
    if (userStatus) userStatus.textContent = `Unable to load acknowledgement requirements: ${error.message || error}`;
  }
  if (!state.canManage) return;
  const adminStatus = state.view?.querySelector('#efb-ack-admin-status');
  if (adminStatus) adminStatus.textContent = 'Loading company acknowledgement dashboard…';
  try {
    state.acknowledgementRows = await getManualAcknowledgementSummary(state.companyId) || [];
    renderAcknowledgementDashboard();
    if (adminStatus) adminStatus.textContent = `${state.acknowledgementRows.length} revision record(s) loaded.`;
  } catch (error) {
    console.error('Acknowledgement dashboard failed to load:', error);
    if (adminStatus) adminStatus.textContent = `Unable to load acknowledgement dashboard: ${error.message || error}`;
  }
}

function handleAcknowledgementDashboardAction(event) {
  const button = event.target.closest('[data-ack-action]');
  if (!button) return;
  const row = button.closest('[data-ack-row]');
  const item = state.acknowledgementRows.find((candidate) =>
    candidate.revisionId === row?.dataset.ackRow &&
    candidate.manualId === row?.dataset.manual &&
    candidate.revisionType === row?.dataset.type
  );
  if (!item) return;
  const action = button.dataset.ackAction;
  if (action === 'details') openAcknowledgementRecipients(item);
  if (action === 'pending') openAcknowledgementRecipients(item, 'pending');
  if (action === 'acknowledged') openAcknowledgementRecipients(item, 'acknowledged');
  if (action === 'redistribute') openRedistributeAcknowledgementRevision(item);
  if (action === 'retry') {
    button.disabled = true;
    createAcknowledgementRequirements(state.companyId, item.manualId, item.revisionId, item.revisionType)
      .then(refreshAcknowledgements)
      .catch((error) => {
        console.error('Acknowledgement requirement retry failed:', error);
        const status = state.view?.querySelector('#efb-ack-admin-status');
        if (status) status.textContent = `Retry failed: ${error.message || error}`;
      });
  }
}

/* ================= LIFECYCLE ================= */

export function initManuals(view, { companyId, userUid = null, userRole = null, canManage }) {
  state.view = view;
  state.companyId = companyId;
  state.userUid = userUid;
  state.userRole = `${userRole || ''}`.toUpperCase();
  state.canManage = Boolean(canManage);
  state.manuals = [];
  state.temporaryRevisions = [];
  state.myAcknowledgements = [];
  state.myAcknowledgementCursor = null;
  state.acknowledgementRows = [];
  state.acknowledgementRecipients = [];
  state.acknowledgementRecipientCursor = null;
  state.recipients = [];
  state.directoryLoaded = !state.canManage;
  state.recipientContext = null;
  state.temporaryUnsubscribers = new Map();

  const categorySelect = view.querySelector('#efb-ml-category');
  if (categorySelect) {
    MANUAL_CATEGORIES.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categorySelect.appendChild(option);
    });
  }

  if (!state.canManage) {
    view.querySelector('#efb-ml-add')?.setAttribute('hidden', '');
    view.querySelector('#efb-temp-add')?.setAttribute('hidden', '');
  } else {
    view.querySelector('#efb-ml-add')?.setAttribute('disabled', '');
    view.querySelector('#efb-temp-add')?.setAttribute('disabled', '');
  }
  const acknowledgementAdmin = view.querySelector('#efb-ack-admin');
  if (acknowledgementAdmin) acknowledgementAdmin.hidden = !state.canManage;

  view.querySelector('#efb-ml-search')?.addEventListener('input', (event) => {
    state.filters.search = event.target.value;
    render();
  });
  view.querySelector('#efb-ml-category')?.addEventListener('change', (event) => {
    state.filters.category = event.target.value;
    render();
  });
  view.querySelector('#efb-ml-status')?.addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    render();
  });
  view.querySelector('#efb-ml-sort')?.addEventListener('change', (event) => {
    state.filters.sort = event.target.value;
    render();
  });
  [
    '#efb-ml-aircraft-filter',
    '#efb-ml-department-filter',
    '#efb-ml-effectiveness-filter',
    '#efb-ml-temporary-filter'
  ].forEach((selector) => view.querySelector(selector)?.addEventListener('change', (event) => {
    const filter = selector === '#efb-ml-aircraft-filter' ? 'aircraft' :
      selector === '#efb-ml-department-filter' ? 'department' :
        selector === '#efb-ml-effectiveness-filter' ? 'effectiveness' : 'temporary';
    state.filters[filter] = event.target.value;
    renderTable();
  }));
  view.querySelector('#efb-ml-add')?.addEventListener('click', () => {
    if (state.directoryLoaded) openAddModal();
  });
  view.querySelector('#efb-temp-add')?.addEventListener('click', () => {
    if (state.directoryLoaded) openTemporaryRevisionModal();
  });

  view.querySelectorAll('.efb-ml-section:not(:disabled)').forEach((button) => {
    button.addEventListener('click', () => setDistributionSection(button.dataset.esection));
  });
  view.querySelector('#efb-ack-refresh')?.addEventListener('click', refreshAcknowledgements);
  view.querySelector('#efb-ack-user-more')?.addEventListener('click', (event) => loadMoreMyAcknowledgements(event.currentTarget));
  view.querySelector('#efb-ack-admin-refresh')?.addEventListener('click', refreshAcknowledgements);
  view.querySelector('#efb-ack-admin-body')?.addEventListener('click', handleAcknowledgementDashboardAction);
  [
    '#efb-ack-filter-manual',
    '#efb-ack-filter-type',
    '#efb-ack-filter-status',
    '#efb-ack-filter-department',
    '#efb-ack-filter-aircraft',
    '#efb-ack-filter-from',
    '#efb-ack-filter-to'
  ].forEach((selector) => {
    view.querySelector(selector)?.addEventListener('input', renderAcknowledgementDashboard);
    view.querySelector(selector)?.addEventListener('change', renderAcknowledgementDashboard);
  });

  [
    '#efb-temp-search',
    '#efb-temp-status-filter',
    '#efb-temp-effective',
    '#efb-temp-aircraft',
    '#efb-temp-department',
    '#efb-temp-parent-filter'
  ].forEach((selector) => {
    view.querySelector(selector)?.addEventListener('input', renderTemporaryRevisions);
    view.querySelector(selector)?.addEventListener('change', renderTemporaryRevisions);
  });

  view.querySelector('#efb-manuals-body')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-ml-action]');
    if (!button) return;
    const row = button.closest('[data-manual]');
    if (!row) return;
    const manual = state.manuals.find((item) => item.id === row.dataset.manual);
    if (!manual) return;

    const action = button.getAttribute('data-ml-action');
    try {
      if (action === 'view') await openView(manual);
      if (action === 'history') await openHistory(manual);
      if (action === 'temporary') {
        const parentFilter = view.querySelector('#efb-temp-parent-filter');
        if (parentFilter) parentFilter.value = manual.id;
        setDistributionSection('temporary');
        renderTemporaryRevisions();
      }
      if (!state.canManage) return;

      if (action === 'edit') openEditModal(manual);
      if (action === 'revise') await openReviseModal(manual);

      if (action === 'archive') {
        const confirmed = await confirmAction({
          title: 'Archive manual',
          message: `"${manual.title}" will be archived and hidden from operational listings. Published files are retained — archived manuals are never deleted.`,
          confirmLabel: 'Archive',
          danger: true
        });
        if (!confirmed) return;
        await archiveManual(state.companyId, manual.id);
        setStatus(`"${manual.title}" archived.`, 'success');
      }

      if (action === 'restore') {
        await unarchiveManual(state.companyId, manual.id);
        setStatus(`"${manual.title}" restored to published.`, 'success');
      }

      if (action === 'delete') {
        const confirmed = await confirmAction({
          title: 'Delete draft manual',
          message: `Permanently delete draft "${manual.title}" and its files? This cannot be undone. Published manuals cannot be deleted.`,
          confirmLabel: 'Delete Draft',
          danger: true
        });
        if (!confirmed) return;
        await deleteDraftManual(state.companyId, manual.id);
        setStatus(`Draft "${manual.title}" deleted.`, 'success');
      }
    } catch (error) {
      console.error(`Manual action "${action}" failed:`, error);
      setStatus(error.message || 'Action failed.', 'error');
    }
  });

  view.querySelector('#efb-temporary-body')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-temp-action]');
    if (!button) return;
    const row = button.closest('[data-temp-revision]');
    const revision = state.temporaryRevisions.find((item) => item.id === row?.dataset.tempRevision);
    if (!revision) return;
    const action = button.dataset.tempAction;
    try {
      if (action === 'view') openTemporaryRevisionView(revision);
      if (!state.canManage) return;
      if (action === 'edit') openTemporaryRevisionModal({ revision });
      if (action === 'publish') {
        const targeting = await validateDistributionTargeting(state.companyId, revision.distribution);
        const confirmed = await confirmAction({
          title: 'Publish temporary revision',
          message: `"${revision.title}" will be distributed to ${distributionLabel(revision.distribution)} (${targeting.matchingUserCount == null ? 'company-wide' : `${targeting.matchingUserCount} matching user(s)`}) from ${formatDateValue(revision.effectiveFrom)} through ${formatDateValue(revision.effectiveUntil)}. Only active company users matching the saved target can view it.`,
          confirmLabel: 'Publish'
        });
        if (!confirmed) return;
        await publishTemporaryRevision(state.companyId, revision.manualId, revision.id);
        setStatus(`"${revision.title}" published.`, 'success');
      }
      if (action === 'withdraw') {
        const confirmed = await confirmAction({
          title: 'Withdraw temporary revision',
          message: `"${revision.title}" will no longer be presented as effective to recipients.`,
          confirmLabel: 'Withdraw',
          danger: true
        });
        if (!confirmed) return;
        await withdrawTemporaryRevision(state.companyId, revision.manualId, revision.id, state.userUid);
        setStatus(`"${revision.title}" withdrawn.`, 'success');
      }
    } catch (error) {
      console.error(`Temporary revision action "${action}" failed:`, error);
      setStatus(error.message || 'Temporary revision action failed.', 'error');
    }
  });

  view.querySelector('#efb-modal-close')?.addEventListener('click', closeModal);
  view.querySelector('#efb-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'efb-modal-backdrop') closeModal();
  });
  state.onEscape = (event) => {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', state.onEscape);

  state.unsubscribe = onManualsSnapshot(
    companyId,
    (manuals) => {
      state.manuals = manuals;
      syncTemporarySubscriptions(manuals);
      populateFilterOptions();
      render();
      const hint = view.querySelector('#efb-manuals-hint');
      if (hint && !manuals.length) hint.textContent = 'No manuals yet.';
    },
    (error) => {
      console.error('Manuals snapshot error:', error);
      setStatus('Unable to load manuals right now.', 'error');
      const hint = view.querySelector('#efb-manuals-hint');
      if (hint) hint.textContent = 'Unable to load manuals right now.';
    }
  );

  const loadRecipientData = state.canManage
    ? resolveCompanyRecipients(companyId)
    : getCompanyRecipientContext(companyId, userUid);
  loadRecipientData.then((result) => {
    if (state.view !== view || state.companyId !== companyId) return;
    if (state.canManage) state.recipients = result;
    else state.recipientContext = result || {
      ids: [userUid].filter(Boolean),
      roles: [state.userRole].filter(Boolean),
      departments: [],
      aircraftTypes: [],
      aircraftRegistrations: []
    };
    state.directoryLoaded = true;
    populateFilterOptions();
    render();
    view.querySelector('#efb-ml-add')?.removeAttribute('disabled');
    view.querySelector('#efb-temp-add')?.removeAttribute('disabled');
  }).catch((error) => {
    if (state.view !== view || state.companyId !== companyId) return;
    console.error('EFB distribution directory failed:', error);
    state.recipients = [];
    state.directoryLoaded = true;
    setStatus('Company recipient directory is unavailable. Company-wide distribution remains available; targeted distribution will fail validation until roster data loads.', 'error');
    populateFilterOptions();
    view.querySelector('#efb-ml-add')?.removeAttribute('disabled');
    view.querySelector('#efb-temp-add')?.removeAttribute('disabled');
  });

  render();

  return {
    destroy() {
      state.unsubscribe?.();
      state.unsubscribe = null;
      for (const unsubscribe of state.temporaryUnsubscribers.values()) unsubscribe();
      state.temporaryUnsubscribers.clear();
      if (state.onEscape) document.removeEventListener('keydown', state.onEscape);
      state.onEscape = null;
      state.manuals = [];
      state.temporaryRevisions = [];
      state.myAcknowledgements = [];
      state.myAcknowledgementCursor = null;
      state.acknowledgementRows = [];
      state.acknowledgementRecipients = [];
      state.acknowledgementRecipientCursor = null;
      state.recipients = [];
      state.recipientContext = null;
      state.directoryLoaded = false;
      state.view = null;
      state.companyId = null;
      state.userUid = null;
      state.userRole = null;
      state.canManage = false;
      state.filters = { search: '', category: '', status: '', sort: 'newest', aircraft: '', department: '', effectiveness: '', temporary: '' };
    }
  };
}
