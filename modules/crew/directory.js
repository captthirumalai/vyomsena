import { crewState, crewListState, PAGE_SIZE, CREW_TAB_STORAGE_KEY } from './state.js';
import {
  query,
  queryAll,
  escapeHtml,
  getInitials,
  toProfileName,
  getPilotRoleLabel,
  getSortedAndFilteredPilots,
  getCompliance,
  getCompliancePercent,
  getLicenseNumber,
  getMedicalExpiry,
  getLicenceExpiry,
  formatShortDate,
  daysUntil,
  renderExpiryCell,
  renderMiniRing,
  getStatusBadgeHtml,
  getProfileStatusBadgeHtml,
  isPilotRole,
  setStatus,
  showToast,
  confirmModal
} from './utils.js';
import { getDocumentComplianceState } from '../../services/documentService.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { updatePilotProfile, delinkPilot } from '../../services/crewService.js';
import { refreshCrew } from './crew.js';
import { openProfileForm } from './profile.js';
import { issueCompanyInvite } from './linking.js';
import { renderLinkingTab } from './linking.js';
import { renderDocumentsTab } from './documents.js';
import { renderComplianceTab } from './compliance.js';
import { renderBulkTab } from './bulk.js';

export function setText(selector, text) {
  const element = query(selector);
  if (element) element.textContent = text;
}

export function updateNotifDot(pendingCount) {
  const dot = query('#cm-notif-dot');
  if (!dot) return;
  dot.hidden = pendingCount === 0;
}

export function updateKPIs() {
  if (!crewState.activeView) return;
  let valid = 0;
  let expiring = 0;
  let expired = 0;

  crewState.pilotsCache.forEach((pilot) => {
    const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
    const status = getCompliance(docs);
    if (status === 'Expired') expired += 1;
    else if (status === 'Expiring') expiring += 1;
    else valid += 1;
  });

  const pending = crewState.incomingRequestsCache.filter((req) => normalizeRequestStatus(req.status) === 'PENDING').length;

  setText('#cm-kpi-total', `${crewState.pilotsCache.length}`);
  setText('#cm-kpi-valid', `${valid}`);
  setText('#cm-kpi-expiring', `${expiring}`);
  setText('#cm-kpi-expired', `${expired}`);
  setText('#cm-kpi-pending', `${pending}`);
  updateNotifDot(pending);
}

export function normalizeRequestStatus(status) {
  const normalized = `${status || ''}`.trim().toUpperCase();
  if (normalized === 'REJECTED') return 'DECLINED';
  return normalized || 'PENDING';
}

/* ================= TABS ================= */

export function setActiveTab(tab) {
  crewState.activeTab = tab;
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

export function positionTabUnderline(tab) {
  const underline = query('#cm-tab-underline');
  const button = query(`.cm-tab[data-tab="${tab}"]`);
  if (!underline || !button || !crewState.activeView) return;
  const nav = query('#cm-tabs');
  const navRect = nav.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  underline.style.left = `${buttonRect.left - navRect.left}px`;
  underline.style.width = `${buttonRect.width}px`;
}

export function renderTabContent(tab) {
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

export function renderCrewTable() {
  if (!crewState.activeView || crewState.activeTab !== 'directory') return;

  const body = query('#cm-table-body');
  if (!body) return;

  if (!crewState.pilotsCache.length) {
    body.innerHTML = '<tr><td colspan="8" class="cm-empty">No linked pilots found for this operator.</td></tr>';
    updateKPIs();
    updateTableFooter(0, 0);
    return;
  }

  const visiblePilots = getSortedAndFilteredPilots();
  const totalPages = Math.max(1, Math.ceil(visiblePilots.length / PAGE_SIZE));
  if (crewState.currentPage > totalPages) crewState.currentPage = totalPages;
  const startIndex = (crewState.currentPage - 1) * PAGE_SIZE;
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
      const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
      const status = getCompliance(docs);
      const percent = getCompliancePercent(docs);
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
  setStatus(`Showing ${visiblePilots.length} of ${crewState.pilotsCache.length} crew profile(s).`);
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

/* ================= DRAWER ================= */

export function openDrawer(pilotUid) {
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  crewState.selectedPilotUid = pilotUid;
  const docs = crewState.docsByPilotCache.get(pilotUid) || [];

  const body = query('#cm-drawer-body');
  const backdrop = query('#cm-drawer-backdrop');
  const drawer = query('#cm-drawer');
  if (!body || !drawer) return;

  const medical = getMedicalExpiry(docs);
  const licence = getLicenceExpiry(docs);
  const percent = getCompliancePercent(docs);
  const status = getCompliance(docs);

  const canEdit = canPerformCrewAction(crewState.activeCurrentUser, 'edit');
  const canDelete = canPerformCrewAction(crewState.activeCurrentUser, 'delete');
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
      ? [`<button type="button" class="cm-drawer-action" data-drawer-action="link-code" data-pilot-uid="${escapeHtml(pilot.uid)}" title="Generate invite code">
          <svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10 14l4-4M15 9l2-2a2.83 2.83 0 0 1 4 4l-2 2M9 15l-2 2a2.83 2.83 0 0 1-4-4l2-2M7 17l4-4"/></svg>
          <span>Invite Code</span>
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
            const modified = doc.lastModified ? formatShortDate(doc.lastModified) : '—';
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
        crewState.selectedPilotUid = targetUid;
        const docSelect = query('#cm-doc-pilot');
        if (docSelect) docSelect.value = targetUid;
        setActiveTab('documents');
      } else if (action === 'link-code') {
        issueCompanyInvite(targetUid);
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
