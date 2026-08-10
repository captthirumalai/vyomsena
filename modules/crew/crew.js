import {
  getCrew,
  onCrewSnapshot,
  getPilotDocuments,
  getPilotDocumentsForProfile,
  getCrewDocumentsByPilots,
  getIncomingLinkRequests,
  getOutgoingLinkRequests,
  onIncomingLinkRequests,
  onOutgoingLinkRequests,
  assignPilotByEmail,
  withdrawConnectionRequest,
  acceptIncomingLinkRequest,
  declineConnectionRequest,
  watchPilotDocumentsForProfile
} from '../../services/crewService.js';
import { watchDocumentsByUser } from '../../services/documentService.js';
import { startCrewDocumentSyncWorker } from '../../services/crewDocumentSyncService.js';
import { canPerformCrewAction, getCrewPermissionsForUser } from '../../services/permissionService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { mirrorCrewProfilesToCompany } from '../../services/companyService.js';
import { crewState, crewListState, docListState, PAGE_SIZE, CREW_LIST_VIEW_KEY } from './state.js';
import {
  query,
  queryAll,
  normalizeRole,
  getInitials,
  setStatus,
  showToast,
  closeModal,
  confirmModal,
  isPilotRole,
  getSortedAndFilteredPilots
} from './utils.js';
import {
  renderCrewScreen,
  renderPilotList,
  renderFilterSummary,
  renderPendingBanner,
  renderBulkBar,
  renderDrawerView,
  openDrawer,
  closeDrawer,
  togglePilotStatus,
  softRemovePilot,
  handleDelink
} from './directory.js';
import { openProfileForm, saveProfileForm } from './profile.js';
import { openDocumentDetail } from './documents.js';
import { issueCompanyInvite, stopLinkCodeTimer } from './linking.js';
import { applyBulkAction } from './bulk.js';
import { runQueueSync, renderQueueSyncState } from './queue.js';
import { loadCrewPolicy, openCompanyPolicyModal } from './policy.js';

/* ================= SELECTION ================= */

export async function selectPilot(pilotUid) {
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  crewState.selectedPilotUid = pilotUid;

  crewState.pilotDocUnsubscribe?.();
  crewState.pilotDocUnsubscribe = null;

  const docs = await getPilotDocumentsForProfile(pilot);
  crewState.docsByPilotCache.set(pilotUid, docs);

  crewState.pilotDocUnsubscribe = watchPilotDocumentsForProfile(
    pilot,
    (snapshot) => {
      const nextDocs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      crewState.docsByPilotCache.set(pilotUid, nextDocs);
      renderCrewScreen();
      refreshOpenDrawer();
    },
    (error) => console.error('Crew document watch error:', error)
  );

  renderCrewScreen();
  refreshOpenDrawer();
}

function refreshOpenDrawer() {
  const drawer = query('#cm-drawer');
  if (!drawer || drawer.classList.contains('hidden')) return;
  const pilot = crewState.pilotsCache.find((item) => item.uid === crewState.selectedPilotUid);
  if (pilot) renderDrawerView(pilot);
}

function handleRowCheck(pilotUid, checked) {
  if (checked) crewState.selectedRows.add(pilotUid);
  else crewState.selectedRows.delete(pilotUid);
  renderBulkBar();
}

/* ================= REFRESH ================= */

export async function refreshCrew() {
  if (isPilotRole()) {
    const pilotUid = crewState.activeCurrentUser?.uid;
    if (!pilotUid) return;

    const [pilotDocs, incomingRequests] = await Promise.all([getPilotDocuments(pilotUid), getIncomingLinkRequests(pilotUid)]);
    crewState.pilotsCache = [{ ...crewState.activeCurrentUser, uid: pilotUid }];
    crewState.docsByPilotCache = new Map([[pilotUid, pilotDocs]]);
    crewState.incomingRequestsCache = incomingRequests;
    crewState.selectedPilotUid = pilotUid;

    renderCrewScreen();
    setStatus(`Loaded your pilot profile and ${pilotDocs.length} document(s).`);
    return;
  }

  if (!crewState.activeOperatorUid) return;
  const [pilots, outgoingRequests] = await Promise.all([getCrew(crewState.activeOperatorUid), getOutgoingLinkRequests(crewState.activeOperatorUid)]);
  crewState.pilotsCache = pilots;
  crewState.outgoingRequestsCache = outgoingRequests;
  crewState.docsByPilotCache = await getCrewDocumentsByPilots(pilots);
  setStatus(`Loaded ${pilots.length} pilot profile(s) from Firestore.`);

  try {
    await mirrorCrewProfilesToCompany(crewState.activeOperatorUid, pilots);
  } catch (error) {
    console.warn('Company crew mirror skipped:', error);
  }

  renderCrewScreen();

  if (crewState.selectedPilotUid && pilots.some((pilot) => pilot.uid === crewState.selectedPilotUid)) {
    await selectPilot(crewState.selectedPilotUid);
  } else {
    crewState.selectedPilotUid = null;
  }
}

/* ================= FILTER HELPERS ================= */

function readFilterSelections() {
  const read = (selector, targetSet) => {
    targetSet.clear();
    queryAll(`${selector} input[type="checkbox"]:checked`).forEach((box) => targetSet.add(box.value));
  };
  read('#cm-filters-status', crewListState.statuses);
  read('#cm-filters-compliance', crewListState.compliances);
  read('#cm-filters-role', crewListState.roles);
  read('#cm-filters-base', crewListState.bases);
}

function closeFilterPopover() {
  const popover = query('#cm-filter-popover');
  if (popover) popover.classList.add('hidden');
  crewListState.filterOpen = false;
}

function setListView(view) {
  if (view !== 'cards' && view !== 'table') return;
  crewListState.view = view;
  try {
    window.localStorage.setItem(CREW_LIST_VIEW_KEY, view);
  } catch (_) {
    /* ignore */
  }
  const cards = query('#cm-view-cards');
  const table = query('#cm-view-table');
  if (cards) cards.classList.toggle('is-active', view === 'cards');
  if (table) table.classList.toggle('is-active', view === 'table');
  renderPilotList();
}

function applyAttentionFilter(filter) {
  crewListState.compliances.clear();
  if (filter === 'ATTENTION') {
    crewListState.compliances.add('ACTION');
    crewListState.compliances.add('NONCOMPLIANT');
  } else if (filter === 'NONCOMPLIANT') {
    crewListState.compliances.add('NONCOMPLIANT');
  }
  crewState.currentPage = 1;
  renderCrewScreen();
}

function scrollToPilots() {
  const section = query('#cm-pilots-section');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================= EVENT BINDING ================= */

function bindScreenControls() {
  query('#cm-btn-add-crew')?.addEventListener('click', () => openProfileForm(null));

  query('#cm-btn-policy')?.addEventListener('click', openCompanyPolicyModal);

  query('#cm-btn-notifications')?.addEventListener('click', () => {
    const banner = query('#cm-pending-banner');
    const list = query('#cm-pending-list');
    const head = query('#cm-pending-toggle');
    if (!banner || banner.classList.contains('hidden')) {
      showToast('No pending requests.', 'info');
      return;
    }
    const open = !!list && !list.classList.contains('hidden');
    if (list) list.classList.toggle('hidden', open);
    if (head) head.setAttribute('aria-expanded', `${!open}`);
  });

  query('#cm-pending-toggle')?.addEventListener('click', (event) => {
    const list = query('#cm-pending-list');
    if (!list) return;
    const open = list.classList.contains('hidden');
    list.classList.toggle('hidden', !open);
    event.currentTarget.setAttribute('aria-expanded', `${open}`);
  });

  query('#cm-search')?.addEventListener('input', (event) => {
    const value = event.target?.value || '';
    crewListState.searchText = value;
    crewState.currentPage = 1;
    clearTimeout(bindScreenControls.searchTimer);
    bindScreenControls.searchTimer = setTimeout(() => renderPilotList(), 180);
  });

  query('#cm-filter-toggle')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const popover = query('#cm-filter-popover');
    if (popover) popover.classList.toggle('hidden');
    crewListState.filterOpen = !crewListState.filterOpen;
  });

  document.addEventListener('click', (event) => {
    const popover = query('#cm-filter-popover');
    const toggle = query('#cm-filter-toggle');
    if (!popover || popover.classList.contains('hidden')) return;
    if (toggle && toggle.contains(event.target)) return;
    if (popover.contains(event.target)) return;
    popover.classList.add('hidden');
    crewListState.filterOpen = false;
  });

  query('#cm-filters-apply')?.addEventListener('click', () => {
    readFilterSelections();
    closeFilterPopover();
    crewState.currentPage = 1;
    renderCrewScreen();
  });

  query('#cm-filters-clear')?.addEventListener('click', () => {
    crewListState.statuses.clear();
    crewListState.compliances.clear();
    crewListState.roles.clear();
    crewListState.bases.clear();
    crewState.currentPage = 1;
    renderFilterOptions();
    renderCrewScreen();
    closeFilterPopover();
  });

  queryAll('input[name="cm-sort"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      crewListState.sortField = event.target.value;
      crewState.currentPage = 1;
      renderPilotList();
    });
  });

  query('#cm-view-cards')?.addEventListener('click', () => setListView('cards'));
  query('#cm-view-table')?.addEventListener('click', () => setListView('table'));

  query('#cm-pilot-grid')?.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('.cm-card-check')) return;
    const card = target.closest('.cm-pilot-card');
    if (card) openDrawer(card.getAttribute('data-pilot-uid'));
  });
  query('#cm-pilot-grid')?.addEventListener('change', (event) => {
    const check = event.target;
    if (check instanceof HTMLInputElement && check.matches('.cm-card-check')) {
      handleRowCheck(check.getAttribute('data-check-pilot'), check.checked);
    }
  });

  query('#cm-attention-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-open-pilot]');
    if (button) openDrawer(button.getAttribute('data-open-pilot'));
  });

  queryAll('[data-attn-filter]').forEach((stat) => {
    stat.addEventListener('click', () => applyAttentionFilter(stat.getAttribute('data-attn-filter')));
  });

  query('#cm-attention-more')?.addEventListener('click', () => {
    crewListState.compliances.clear();
    crewListState.compliances.add('ACTION');
    crewListState.compliances.add('NONCOMPLIANT');
    crewState.currentPage = 1;
    renderCrewScreen();
    scrollToPilots();
  });

  query('#cm-select-all')?.addEventListener('change', (event) => {
    const checked = !!event.target?.checked;
    const pagePilots = getSortedAndFilteredPilots().slice((crewState.currentPage - 1) * PAGE_SIZE, crewState.currentPage * PAGE_SIZE);
    pagePilots.forEach((pilot) => {
      if (checked) crewState.selectedRows.add(pilot.uid);
      else crewState.selectedRows.delete(pilot.uid);
    });
    renderCrewScreen();
  });

  query('#cm-table-body')?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.cm-col-check')) return;
    const row = target.closest('tr[data-pilot-uid]');
    if (row) openDrawer(row.getAttribute('data-pilot-uid'));
  });
  query('#cm-table-body')?.addEventListener('change', (event) => {
    const check = event.target;
    if (check instanceof HTMLInputElement && check.matches('.cm-row-check')) {
      handleRowCheck(check.getAttribute('data-check-pilot'), check.checked);
    }
  });

  query('#cm-prev')?.addEventListener('click', () => {
    if (crewState.currentPage > 1) {
      crewState.currentPage -= 1;
      renderCrewScreen();
    }
  });
  query('#cm-next')?.addEventListener('click', () => {
    const visible = getSortedAndFilteredPilots();
    if (crewState.currentPage * PAGE_SIZE < visible.length) {
      crewState.currentPage += 1;
      renderCrewScreen();
    }
  });

  queryAll('[data-bulk-action]').forEach((button) => {
    button.addEventListener('click', () => applyBulkAction(button.dataset.bulkAction));
  });
  query('#cm-bulk-clear')?.addEventListener('click', () => {
    crewState.selectedRows.clear();
    renderCrewScreen();
  });

  query('#cm-empty-add')?.addEventListener('click', () => openProfileForm(null));
  query('#cm-empty-clear')?.addEventListener('click', () => {
    crewListState.searchText = '';
    crewListState.statuses.clear();
    crewListState.compliances.clear();
    crewListState.roles.clear();
    crewListState.bases.clear();
    crewState.currentPage = 1;
    const search = query('#cm-search');
    if (search) search.value = '';
    renderCrewScreen();
  });

  query('#cm-sync-retry')?.addEventListener('click', async () => {
    await runQueueSync({ source: 'manual', refreshAfter: true });
  });
}

async function handleDrawerAction(action) {
  const pilotUid = crewState.selectedPilotUid;
  if (action === 'edit') {
    openProfileForm(pilotUid);
  } else if (action === 'link-code') {
    issueCompanyInvite(pilotUid);
  } else if (action === 'toggle-status') {
    await togglePilotStatus(pilotUid);
  } else if (action === 'delink') {
    await handleDelink(pilotUid);
  } else if (action === 'soft-delete') {
    await softRemovePilot(pilotUid);
  }
}

async function handleLinkAction(action, requestId) {
  if (action === 'resend') {
    const request = crewState.outgoingRequestsCache.find((item) => item.requestId === requestId);
    const pilotEmail = request?.recipientEmail;
    if (!pilotEmail || !crewState.activeOperatorUid) return;
    try {
      await assignPilotByEmail({ operatorUid: crewState.activeOperatorUid, pilotEmail });
      showToast('Pilot assigned and linked.', 'success');
      await refreshCrew();
    } catch (error) {
      showToast(error.message || 'Unable to assign pilot.', 'error');
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
}

function bindDrawerControls() {
  const drawer = query('#cm-drawer');
  if (!drawer) return;

  query('#cm-drawer-backdrop')?.addEventListener('click', closeDrawer);

  drawer.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const navItem = target.closest('[data-drawer-view]');
    if (navItem) {
      crewState.drawerView = navItem.getAttribute('data-drawer-view');
      renderDrawerView();
      return;
    }

    const actionButton = target.closest('[data-drawer-action]');
    if (actionButton) {
      handleDrawerAction(actionButton.getAttribute('data-drawer-action'));
      return;
    }

    const docButton = target.closest('button[data-doc-open]');
    if (docButton) {
      openDocumentDetail(docButton.getAttribute('data-doc-open'));
      return;
    }

    const linkButton = target.closest('button[data-link-action]');
    if (linkButton) {
      handleLinkAction(linkButton.getAttribute('data-link-action'), linkButton.getAttribute('data-request-id'));
    }
  });
}

function bindPendingActions() {
  query('#cm-pending-list')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-pending-action]');
    if (!button) return;
    const action = button.getAttribute('data-pending-action');
    const requestId = button.getAttribute('data-request-id');

    if (action === 'accept') {
      if (!canPerformCrewAction(crewState.activeCurrentUser, 'respondIncomingRequest')) return;
      const operatorUid = button.getAttribute('data-operator-uid');
      const pilotUid = crewState.activeCurrentUser?.uid;
      if (!pilotUid || !operatorUid) return;
      confirmModal({
        title: 'Accept request',
        message: 'Accept this request and link your profile to the operator?',
        confirmLabel: 'Accept & Link',
        onConfirm: async () => {
          await acceptIncomingLinkRequest({ requestId, pilotUid, operatorUid });
          crewState.activeCurrentUser = { ...crewState.activeCurrentUser, linkedOperator: operatorUid };
          showToast('Request accepted. You are now linked.', 'success');
          await refreshCrew();
        }
      });
      return;
    }

    if (action === 'decline') {
      if (!canPerformCrewAction(crewState.activeCurrentUser, 'respondIncomingRequest')) return;
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
      return;
    }

    if (action === 'resend') {
      await handleLinkAction('resend', requestId);
      return;
    }

    if (action === 'cancel') {
      await handleLinkAction('cancel', requestId);
    }
  });
}

function bindProfileForm() {
  query('#cm-profile-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfileForm();
  });

  query('#cm-profile-cancel')?.addEventListener('click', () => {
    crewState.profileEditUid = null;
    closeModal();
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

const bindKeyboard = { handler: null };

function bindGlobalOverlays() {
  query('#cm-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  query('#cm-modal-close')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', bindKeyboard.handler);
}

bindKeyboard.handler = function handleKeyboard(event) {
  if (event.key === 'Escape') {
    closeDrawer();
    closeModal();
  }
};

function applyRoleLayout() {
  if (isPilotRole()) {
    query('#cm-btn-add-crew')?.classList.add('hidden');
    query('#cm-btn-policy')?.classList.add('hidden');
    queryAll('[data-bulk-action]').forEach((btn) => btn.classList.add('hidden'));
    query('#cm-bulk-toolbar')?.classList.add('hidden');
  }
}

/* ================= INIT / DESTROY ================= */

export async function init(view, context) {
  crewState.activeView = view;

  const operatorUid = context?.currentUser?.uid || null;
  const currentUser = context?.currentUser || null;
  const orgContext = getCurrentOrganizationContext(currentUser);

  crewState.activeOperatorUid = orgContext.organizationId || operatorUid;
  crewState.activeCurrentUser = currentUser;
  crewState.activeRole = normalizeRole(currentUser?.role);
  crewState.crewPermissions = getCrewPermissionsForUser(currentUser);

  const userName = query('#cm-user-name');
  if (userName) userName.textContent = currentUser?.name || currentUser?.email || 'User';
  const userRole = query('#cm-user-role');
  if (userRole) userRole.textContent = crewState.activeRole;
  const userAvatar = query('#cm-user-avatar');
  if (userAvatar) userAvatar.textContent = getInitials(currentUser?.name || currentUser?.email);

  try {
    const savedView = window.localStorage.getItem(CREW_LIST_VIEW_KEY);
    crewListState.view = savedView === 'table' ? 'table' : 'cards';
  } catch (_) {
    crewListState.view = 'cards';
  }

  applyRoleLayout();

  if (!currentUser?.uid) {
    setStatus('Crew module requires operator UID.');
    return { destroy() {} };
  }

  bindScreenControls();
  bindDrawerControls();
  bindPendingActions();
  bindProfileForm();
  bindGlobalOverlays();

  startCrewDocumentSyncWorker();
  await runQueueSync({ source: 'initial' });
  renderQueueSyncState();
  crewState.queueMonitorTimer = setInterval(() => {
    renderQueueSyncState();
  }, 5000);

  setListView(crewListState.view);

  if (!isPilotRole()) {
    await loadCrewPolicy();
  }

  await refreshCrew();

  if (isPilotRole()) {
    const pilotUid = currentUser.uid;
    crewState.pilotDocUnsubscribe = watchDocumentsByUser(
      pilotUid,
      (snapshot) => {
        const docs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
        crewState.docsByPilotCache.set(pilotUid, docs);
        renderCrewScreen();
      },
      (error) => console.error('Pilot document snapshot error:', error)
    );

    crewState.incomingRequestUnsubscribe = onIncomingLinkRequests(
      pilotUid,
      (snapshot) => {
        crewState.incomingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        renderPendingBanner();
      },
      (error) => console.error('Incoming link requests snapshot error:', error)
    );
  } else {
    crewState.crewUnsubscribe = onCrewSnapshot(
      crewState.activeOperatorUid,
      async (profiles) => {
        crewState.pilotsCache = profiles.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
        crewState.docsByPilotCache = await getCrewDocumentsByPilots(crewState.pilotsCache);
        renderCrewScreen();
        setStatus(`Live update: ${crewState.pilotsCache.length} pilot profile(s).`);
      },
      (error) => console.error('Crew snapshot error:', error)
    );

    crewState.outgoingRequestUnsubscribe = onOutgoingLinkRequests(
      operatorUid,
      (snapshot) => {
        crewState.outgoingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        renderPendingBanner();
      },
      (error) => console.error('Outgoing link requests snapshot error:', error)
    );
  }

  return {
    destroy() {
      crewState.crewUnsubscribe?.();
      crewState.pilotDocUnsubscribe?.();
      crewState.outgoingRequestUnsubscribe?.();
      crewState.incomingRequestUnsubscribe?.();
      crewState.crewUnsubscribe = null;
      crewState.pilotDocUnsubscribe = null;
      crewState.outgoingRequestUnsubscribe = null;
      crewState.incomingRequestUnsubscribe = null;
      crewState.activeView = null;
      crewState.activeOperatorUid = null;
      crewState.activeCurrentUser = null;
      crewState.activeRole = 'OPERATIONS';
      crewState.crewPermissions = null;
      crewListState.searchText = '';
      crewListState.statuses.clear();
      crewListState.compliances.clear();
      crewListState.roles.clear();
      crewListState.bases.clear();
      crewListState.sortField = 'name';
      crewListState.sortDirection = 'asc';
      crewListState.filterOpen = false;
      docListState.searchText = '';
      docListState.category = 'ALL';
      docListState.status = 'ALL';
      crewState.pilotsCache = [];
      crewState.docsByPilotCache = new Map();
      crewState.selectedPilotUid = null;
      crewState.selectedRows = new Set();
      crewState.currentPage = 1;
      crewState.drawerView = 'overview';
      crewState.drawerInviteOpen = false;
      crewState.activeDocument = null;
      crewState.outgoingRequestsCache = [];
      crewState.incomingRequestsCache = [];
      crewState.profileEditUid = null;
      crewState.activeLinkCode = null;
      crewState.activeLinkCodeExpiresAt = null;
      crewState.activeLinkCodePilotUid = null;
      crewState.requiredDocumentPolicy = null;
      if (crewState.queueMonitorTimer) {
        clearInterval(crewState.queueMonitorTimer);
        crewState.queueMonitorTimer = null;
      }
      stopLinkCodeTimer();
      crewState.queueSyncBusy = false;
      crewState.queueSyncLastAttemptAt = null;
      crewState.queueSyncLastError = null;
      if (crewState.queueSyncFlashTimer) {
        clearTimeout(crewState.queueSyncFlashTimer);
        crewState.queueSyncFlashTimer = null;
      }
      document.removeEventListener('keydown', bindKeyboard.handler);
    }
  };
}
