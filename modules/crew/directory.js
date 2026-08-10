import { crewState, crewListState, PAGE_SIZE } from './state.js';
import {
  query,
  queryAll,
  escapeHtml,
  getInitials,
  toProfileName,
  getPilotRoleLabel,
  getSortedAndFilteredPilots,
  getLicenseNumber,
  getMedicalExpiry,
  getLicenceExpiry,
  formatExpiry,
  renderExpiryCell,
  getProfileStatusBadgeHtml,
  isPilotRole,
  setStatus,
  showToast,
  confirmModal,
  getCrewAttentionLevel,
  getAttentionSummary,
  getAttentionBadgeHtml,
  getAttentionTone,
  getPrimaryDocChips,
  getPilotBase
} from './utils.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { updatePilotProfile, delinkPilot } from '../../services/crewService.js';
import { refreshCrew } from './crew.js';
import { openProfileForm } from './profile.js';
import { issueCompanyInvite, renderOutgoingRequests } from './linking.js';
import { renderPilotDocuments, openDocumentUploadModal, openDocumentDetail } from './documents.js';

export function setText(selector, text) {
  const element = query(selector);
  if (element) element.textContent = text;
}

export function updateNotifDot(pendingCount) {
  const dot = query('#cm-notif-dot');
  if (!dot) return;
  dot.hidden = pendingCount === 0;
}

function renderAvatarHtml(pilot, extraClass = '') {
  const name = toProfileName(pilot);
  const initials = escapeHtml(getInitials(name));
  const photo = pilot?.photoUri || pilot?.photoUrl || null;
  if (photo) {
    return `<span class="cm-avatar cm-avatar-photo ${extraClass}"><img src="${escapeHtml(photo)}" alt="${initials}" loading="lazy" referrerpolicy="no-referrer" /></span>`;
  }
  return `<span class="cm-avatar ${extraClass}">${initials}</span>`;
}

export function normalizeRequestStatus(status) {
  const normalized = `${status || ''}`.trim().toUpperCase();
  if (normalized === 'REJECTED') return 'DECLINED';
  return normalized || 'PENDING';
}

/* ================= MASTER RENDER ================= */

export function renderCrewScreen() {
  if (!crewState.activeView) return;
  updateAttentionStrip();
  renderPendingBanner();
  renderFilterOptions();
  renderFilterSummary();
  renderPilotList();
  renderBulkBar();
}

/* ================= ATTENTION STRIP ================= */

export function updateAttentionStrip() {
  const totals = { COMPLIANT: 0, ACTION: 0, NONCOMPLIANT: 0, NODOCS: 0 };
  crewState.pilotsCache.forEach((pilot) => {
    const level = getCrewAttentionLevel(crewState.docsByPilotCache.get(pilot.uid) || []);
    totals[level] = (totals[level] || 0) + 1;
  });

  setText('#cm-stat-total', `${crewState.pilotsCache.length}`);
  setText('#cm-stat-attention', `${totals.ACTION + totals.NONCOMPLIANT}`);
  setText('#cm-stat-noncompliant', `${totals.NONCOMPLIANT}`);
}

/* ================= PENDING BANNER ================= */

export function renderPendingBanner() {
  const banner = query('#cm-pending-banner');
  const countEl = query('#cm-pending-count');
  const list = query('#cm-pending-list');
  if (!banner || !countEl || !list) return;

  const pilotMode = isPilotRole();
  const pending = (pilotMode ? crewState.incomingRequestsCache : crewState.outgoingRequestsCache).filter(
    (req) => normalizeRequestStatus(req.status) === 'PENDING'
  );

  if (!pending.length) {
    banner.classList.add('hidden');
    list.innerHTML = '';
    updateNotifDot(0);
    return;
  }

  banner.classList.remove('hidden');
  countEl.textContent = `${pending.length}`;

  const toTs = (value) => {
    const date = value?.toDate ? value.toDate() : value;
    const parsed = date ? new Date(date) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
  };

  list.innerHTML = pending
    .slice()
    .sort((a, b) => toTs(b.createdAt) - toTs(a.createdAt))
    .slice(0, 5)
    .map((req) => {
      const label = pilotMode
        ? req.requesterName || req.requesterId || 'Unknown operator'
        : req.recipientEmail || req.recipientId || 'Unknown pilot';
      const email = pilotMode ? req.requesterEmail || '' : req.recipientEmail || '';
      const actions = pilotMode
        ? `<button type="button" class="cm-pending-btn is-accept" data-pending-action="accept" data-request-id="${escapeHtml(req.requestId)}" data-operator-uid="${escapeHtml(req.requesterId || '')}">Accept</button>
           <button type="button" class="cm-pending-btn is-decline" data-pending-action="decline" data-request-id="${escapeHtml(req.requestId)}">Decline</button>`
        : `<button type="button" class="cm-pending-btn" data-pending-action="resend" data-request-id="${escapeHtml(req.requestId)}" data-recipient-email="${escapeHtml(req.recipientEmail || '')}">Resend</button>
           <button type="button" class="cm-pending-btn is-decline" data-pending-action="cancel" data-request-id="${escapeHtml(req.requestId)}">Cancel</button>`;
      return `
        <div class="cm-pending-row">
          <strong>${escapeHtml(label)}</strong>
          <span class="cm-pending-email">${escapeHtml(email)}</span>
          ${actions}
        </div>`;
    })
    .join('');

  updateNotifDot(pending.length);
}

/* ================= FILTERS ================= */

export function renderFilterOptions() {
  const statuses = new Set();
  const roles = new Set();
  const bases = new Set();
  crewState.pilotsCache.forEach((pilot) => {
    statuses.add(`${pilot.status || 'Active'}`);
    roles.add(getPilotRoleLabel(pilot));
    const base = getPilotBase(pilot);
    if (base) bases.add(base);
  });
  renderCheckboxGroup('#cm-filters-status', crewListState.statuses, [...statuses].sort());
  renderCheckboxGroup('#cm-filters-compliance', crewListState.compliances, ['COMPLIANT', 'ACTION', 'NONCOMPLIANT', 'NODOCS']);
  renderCheckboxGroup('#cm-filters-role', crewListState.roles, [...roles].sort());
  renderCheckboxGroup('#cm-filters-base', crewListState.bases, [...bases].sort());
}

function renderCheckboxGroup(containerSelector, selectedSet, options) {
  const container = query(containerSelector);
  if (!container) return;
  if (!options.length) {
    container.innerHTML = '<p class="cm-form-status">No options available.</p>';
    return;
  }
  container.innerHTML = options
    .map(
      (option) => `<label><input type="checkbox" value="${escapeHtml(option)}" ${selectedSet.has(option) ? 'checked' : ''} /> <span>${escapeHtml(option)}</span></label>`
    )
    .join('');
}

export function renderFilterSummary() {
  const activeCount = [crewListState.statuses, crewListState.compliances, crewListState.roles, crewListState.bases].filter(
    (set) => set.size > 0
  ).length;
  const badge = query('#cm-filter-count');
  if (badge) {
    badge.classList.toggle('hidden', activeCount === 0);
    badge.textContent = `${activeCount}`;
  }
}

/* ================= PILOT LIST ================= */

export function renderPilotList() {
  const grid = query('#cm-pilot-grid');
  const tableCard = query('#cm-crew-table-card');
  const tableBody = query('#cm-table-body');
  const empty = query('#cm-empty-state');
  const emptyTitle = query('#cm-empty-title');
  const emptyMessage = query('#cm-empty-message');
  const emptyAdd = query('#cm-empty-add');
  const emptyClear = query('#cm-empty-clear');
  const countEl = query('#cm-pilots-count');
  if (!grid || !empty) return;

  const visiblePilots = getSortedAndFilteredPilots();
  const totalPages = Math.max(1, Math.ceil(visiblePilots.length / PAGE_SIZE));
  if (crewState.currentPage > totalPages) crewState.currentPage = totalPages;
  const startIndex = (crewState.currentPage - 1) * PAGE_SIZE;
  const pagePilots = visiblePilots.slice(startIndex, startIndex + PAGE_SIZE);

  if (!visiblePilots.length) {
    const noCrew = crewState.pilotsCache.length === 0;
    grid.classList.add('hidden');
    if (tableCard) tableCard.classList.add('hidden');
    if (tableBody) tableBody.innerHTML = '';
    empty.classList.remove('hidden');
    emptyTitle.textContent = noCrew ? 'No pilots yet' : 'No pilots match';
    emptyMessage.textContent = noCrew
      ? 'Add your first pilot to start tracking their documents and compliance.'
      : 'Try adjusting your search or filters.';
    emptyAdd.classList.toggle('hidden', noCrew || isPilotRole());
    emptyClear.classList.toggle('hidden', !noCrew);
    if (countEl) countEl.textContent = '0 pilots';
    renderBulkBar();
    return;
  }

  empty.classList.add('hidden');

  if (crewListState.view === 'cards') {
    grid.classList.remove('hidden');
    if (tableCard) tableCard.classList.add('hidden');
    grid.innerHTML = pagePilots.map((pilot) => renderPilotCard(pilot)).join('');
  } else if (tableBody && tableCard) {
    grid.classList.add('hidden');
    tableCard.classList.remove('hidden');
    tableBody.innerHTML = pagePilots.map((pilot) => renderPilotRow(pilot)).join('');
  }

  if (countEl) countEl.textContent = `${visiblePilots.length} of ${crewState.pilotsCache.length} pilots`;
  updateTableFooter(pagePilots.length, visiblePilots.length);
  renderBulkBar();
}

function renderPilotCard(pilot) {
  const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
  const level = getCrewAttentionLevel(docs);
  const summary = getAttentionSummary(pilot, docs);
  const chips = getPrimaryDocChips(docs);
  const expiries = getExpiryFooter(docs);
  const checked = crewState.selectedRows.has(pilot.uid);
  const selected = crewState.selectedPilotUid === pilot.uid;

  return `
    <article class="cm-pilot-card ${selected ? 'is-selected' : ''}" data-pilot-uid="${escapeHtml(pilot.uid)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(toProfileName(pilot))}">
      <div class="cm-card-main">
        <input type="checkbox" class="cm-card-check" data-check-pilot="${escapeHtml(pilot.uid)}" ${checked ? 'checked' : ''} aria-label="Select ${escapeHtml(toProfileName(pilot))}" />
        ${renderAvatarHtml(pilot)}
        <div class="cm-card-identity">
          <div class="cm-card-name">${escapeHtml(toProfileName(pilot))}</div>
          <div class="cm-card-meta">
            <span>${escapeHtml(pilot.email || 'No email')}</span>
            <span>·</span>
            <span>${escapeHtml(getPilotBase(pilot))}</span>
          </div>
        </div>
        <div class="cm-card-badge">${getAttentionBadgeHtml(level)}</div>
      </div>
      <div class="cm-doc-chips">
        ${chips.length ? chips.map((chip) => `<span class="cm-doc-chip ${chip.tone}">${chip.mark} ${escapeHtml(chip.label)}</span>`).join('') : '<span class="cm-doc-chip is-warn">No documents</span>'}
      </div>
      <div class="cm-card-expiry">
        <strong>${escapeHtml(summary.text)}</strong>
        <span>${expiries.length ? expiries.map((exp) => `<span class="${exp.tone}">${escapeHtml(exp.label)}: ${escapeHtml(exp.text)}</span>`).join(' · ') : 'No expiry dates on file'}</span>
      </div>
    </article>`;
}

function renderPilotRow(pilot) {
  const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
  const level = getCrewAttentionLevel(docs);
  const licenseNumber = getLicenseNumber(docs);
  const medicalExpiry = getMedicalExpiry(docs);
  const licenceExpiry = getLicenceExpiry(docs);
  const isSelected = crewState.selectedPilotUid === pilot.uid;
  const isChecked = crewState.selectedRows.has(pilot.uid);

  return `<tr data-pilot-uid="${escapeHtml(pilot.uid)}" class="${isSelected ? 'is-selected' : ''}">
    <td data-label="Select" class="cm-col-check">
      <input type="checkbox" class="cm-row-check" data-check-pilot="${escapeHtml(pilot.uid)}" ${isChecked ? 'checked' : ''} aria-label="Select ${escapeHtml(toProfileName(pilot))}" />
    </td>
    <td data-label="Name">
      <div class="cm-cell-user">
        ${renderAvatarHtml(pilot)}
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
    <td data-label="Compliance">${getAttentionBadgeHtml(level)}</td>
    <td data-label="Status">${getProfileStatusBadgeHtml(pilot.status)}</td>
  </tr>`;
}

function getExpiryFooter(docs) {
  return (docs || [])
    .map((doc) => {
      const expiry = formatExpiry(doc.expiryDate);
      if (expiry.date === 'N/A' || doc.expiryDate == null) return null;
      const name = `${doc.documentName || 'Document'}`;
      const label = name.split(/\s+/).slice(0, 2).join(' ');
      return {
        label,
        text: `${expiry.rel ? `${expiry.rel} · ` : ''}${expiry.date}`,
        tone: expiry.days !== null && expiry.days < 0 ? 'is-danger' : expiry.days !== null && expiry.days < 30 ? 'is-warn' : '',
        days: expiry.days ?? Number.MAX_SAFE_INTEGER
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days)
    .slice(0, 2);
}

function updateTableFooter(pageCount, totalVisible) {
  const summary = query('#cm-table-summary');
  if (summary) summary.textContent = `Showing ${pageCount} of ${totalVisible} crew`;
  const prev = query('#cm-prev');
  const next = query('#cm-next');
  const pageInfo = query('#cm-page-info');
  if (prev) prev.disabled = crewState.currentPage <= 1;
  if (next) next.disabled = crewState.currentPage * PAGE_SIZE >= totalVisible;
  if (pageInfo) pageInfo.textContent = `${crewState.currentPage}`;
}

/* ================= BULK BAR ================= */

export function renderBulkBar() {
  const bar = query('#cm-bulk-toolbar');
  const count = query('#cm-bulk-count');
  if (!bar) return;
  if (isPilotRole()) {
    bar.classList.add('hidden');
    return;
  }
  const size = crewState.selectedRows.size;
  bar.classList.toggle('hidden', size === 0);
  if (count) count.textContent = `${size} selected`;
}

/* ================= DRAWER V2 ================= */

export function openDrawer(pilotUid) {
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  crewState.selectedPilotUid = pilotUid;
  crewState.drawerView = 'overview';
  crewState.drawerInviteOpen = false;
  crewState.activeDocument = null;

  const body = query('#cm-drawer-body');
  const backdrop = query('#cm-drawer-backdrop');
  const drawer = query('#cm-drawer');
  if (!body || !drawer) return;

  renderDrawerShell(pilot);
  renderDrawerView(pilot);

  backdrop.classList.remove('hidden');
  drawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    drawer.classList.add('is-open');
  });
  requestAnimationFrame(() => query('#cm-drawer-close')?.focus());
}

function renderDrawerShell(pilot) {
  const body = query('#cm-drawer-body');
  const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
  const navViews = [
    { key: 'overview', label: 'Overview' },
    { key: 'documents', label: `Documents (${docs.length})` },
    { key: 'more', label: 'More' }
  ];

  body.innerHTML = `
    <div class="cm-drawer-head">
      <h2>Pilot</h2>
      <button type="button" class="cm-icon-btn" id="cm-drawer-close" aria-label="Close panel">
        <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
      </button>
    </div>
    <div class="cm-drawer-profile">
      ${renderAvatarHtml(pilot, 'cm-avatar-lg')}
      <div class="cm-drawer-identity">
        <strong>${escapeHtml(toProfileName(pilot))}</strong>
        <span>${escapeHtml(pilot.email || 'No email')}</span>
        <span style="margin-top:0.3rem">
          <span class="cm-badge cm-badge-muted">${escapeHtml(getPilotRoleLabel(pilot))}</span>
          ${getProfileStatusBadgeHtml(pilot.status)}
        </span>
      </div>
    </div>
    <nav class="cm-drawer-nav" aria-label="Pilot details">
      ${navViews.map((v) => `<button type="button" class="cm-drawer-nav-item" data-drawer-view="${v.key}">${escapeHtml(v.label)}</button>`).join('')}
    </nav>
    <div class="cm-drawer-view" id="cm-drawer-view"></div>
  `;

  query('#cm-drawer-close')?.addEventListener('click', closeDrawer);
}

export function renderDrawerView(pilot) {
  const container = query('#cm-drawer-view');
  if (!container) return;
  const target = pilot || crewState.pilotsCache.find((item) => item.uid === crewState.selectedPilotUid);
  if (!target) return;

  queryAll('.cm-drawer-nav-item').forEach((item) => {
    const isActive = item.getAttribute('data-drawer-view') === crewState.drawerView;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-current', isActive ? 'true' : 'false');
  });

  if (crewState.drawerView === 'documents') {
    renderPilotDocuments();
  } else if (crewState.drawerView === 'more') {
    container.innerHTML = renderMoreView(target);
    renderOutgoingRequests();
  } else {
    container.innerHTML = renderOverviewView(target);
  }
}

function renderOverviewView(pilot) {
  const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
  const level = getCrewAttentionLevel(docs);
  const summary = getAttentionSummary(pilot, docs);
  const chips = getPrimaryDocChips(docs);
  const expiries = getExpiryFooter(docs);
  const canEdit = canPerformCrewAction(crewState.activeCurrentUser, 'edit');
  const canDelete = canPerformCrewAction(crewState.activeCurrentUser, 'delete');
  const pilotStatus = `${pilot.status || 'Active'}`;

  const actionButtons = [
    ...(canEdit ? [`<button type="button" class="cm-btn cm-btn-primary cm-btn-sm" data-drawer-action="edit">Edit Profile</button>`] : []),
    ...(!isPilotRole() ? [`<button type="button" class="cm-btn cm-btn-ghost cm-btn-sm" data-drawer-action="link-code">Invite Code</button>`] : []),
    ...(canEdit ? [`<button type="button" class="cm-btn cm-btn-ghost cm-btn-sm" data-drawer-action="toggle-status">${pilotStatus === 'Active' ? 'Set Inactive' : 'Set Active'}</button>`] : []),
    ...(!isPilotRole() ? [`<button type="button" class="cm-btn cm-btn-ghost cm-btn-sm" data-drawer-action="delink">Delink</button>`] : []),
    ...(canDelete ? [`<button type="button" class="cm-btn cm-btn-danger cm-btn-sm" data-drawer-action="soft-delete">Delete</button>`] : [])
  ].join('');

  return `
    <div class="cm-drawer-reason is-${getAttentionTone(level)}">
      <span>${escapeHtml(summary.text)}</span>
      ${getAttentionBadgeHtml(level)}
    </div>
    <div class="cm-doc-chips">
      ${chips.length ? chips.map((chip) => `<span class="cm-doc-chip ${chip.tone}">${chip.mark} ${escapeHtml(chip.label)}</span>`).join('') : ''}
    </div>
    <div class="cm-drawer-view-empty">
      ${expiries.length ? expiries.map((exp) => `<span class="${exp.tone}">${escapeHtml(exp.label)} — ${escapeHtml(exp.text)}</span>`).join('<br />') : 'No expiry dates on file.'}
    </div>
    <dl class="cm-drawer-kv">
      <div class="kv-row"><dt>Employee ID</dt><dd>${escapeHtml(pilot.employeeId || pilot.designation || '—')}</dd></div>
      <div class="kv-row"><dt>Phone</dt><dd>${escapeHtml(pilot.mobile || pilot.companyPhone || '—')}</dd></div>
      <div class="kv-row"><dt>Base</dt><dd>${escapeHtml(getPilotBase(pilot))}</dd></div>
      <div class="kv-row"><dt>Operator</dt><dd>${escapeHtml(pilot.operatorId || '—')}</dd></div>
    </dl>
    <div class="cm-drawer-actions">${actionButtons}</div>
  `;
}

function renderMoreView(pilot) {
  const kv = `
    <div class="kv-row"><dt>Designation</dt><dd>${escapeHtml(pilot.designation || '—')}</dd></div>
    <div class="kv-row"><dt>Employee ID</dt><dd>${escapeHtml(pilot.employeeId || '—')}</dd></div>
    <div class="kv-row"><dt>Operator</dt><dd>${escapeHtml(pilot.operatorId || '—')}</dd></div>
    <div class="kv-row"><dt>Base</dt><dd>${escapeHtml(getPilotBase(pilot))}</dd></div>
    <div class="kv-row"><dt>Link State</dt><dd>${escapeHtml(pilot.linkState || '—')}</dd></div>
  `;
  const notes = `<p class="cm-form-status" style="margin:0">${escapeHtml(pilot.notes || pilot.notesOrDetails || 'No notes added for this crew member.')}</p>`;
  const links = !isPilotRole() ? `<div class="cm-more-list" id="cm-drawer-more-links"></div>` : '';
  return `
    <div>
      <h4>Profile</h4>
      <dl class="cm-drawer-kv">${kv}</dl>
    </div>
    <div>
      <h4>Notes</h4>
      ${notes}
    </div>
    ${links ? `<div><h4>Connection Requests</h4>${links}</div>` : ''}
  `;
}

export function closeDrawer() {
  const backdrop = query('#cm-drawer-backdrop');
  const drawer = query('#cm-drawer');
  if (!backdrop || !drawer) return;
  backdrop.classList.remove('is-open');
  drawer.classList.remove('is-open');
  setTimeout(() => {
    backdrop.classList.add('hidden');
    drawer.classList.add('hidden');
  }, 200);
  crewState.activeDocument = null;
}

/* ================= CREW ACTIONS ================= */

export async function togglePilotStatus(pilotUid) {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'edit')) return;
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  const current = `${pilot.status || 'Active'}`;
  const next = current === 'Active' ? 'Inactive' : 'Active';
  await updatePilotProfile(pilotUid, { status: next });
  setStatus(`Status updated to ${next} for ${toProfileName(pilot)}.`);
  showToast(`Status updated to ${next}.`, 'success');
  await refreshCrew();
}

export async function softRemovePilot(pilotUid) {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'delete')) return;
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  confirmModal({
    title: 'Delete crew member',
    message: `Soft remove "${toProfileName(pilot)}" from your roster? This sets status=Deleted and unlinks them from the operator.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      await updatePilotProfile(pilotUid, { status: 'Deleted' });
      await delinkPilot(pilotUid);
      crewState.selectedRows.delete(pilotUid);
      setStatus(`Soft removed ${toProfileName(pilot)} from operator roster.`);
      showToast('Crew member removed.', 'success');
      await refreshCrew();
    }
  });
}

export async function handleDelink(pilotUid) {
  if (crewState.activeRole === 'PILOT') return;
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  confirmModal({
    title: 'Delink pilot',
    message: `Delink "${toProfileName(pilot)}" from your organization? Their profile and documents remain.`,
    confirmLabel: 'Delink',
    danger: true,
    onConfirm: async () => {
      await delinkPilot(pilotUid);
      crewState.selectedRows.delete(pilotUid);
      setStatus(`Pilot ${pilotUid} delinked.`);
      showToast('Pilot delinked.', 'success');
      await refreshCrew();
    }
  });
}
