import {
  getCrew,
  onCrewSnapshot,
  getPilotDocuments,
  getCrewDocumentsByPilots,
  getIncomingLinkRequests,
  getOutgoingLinkRequests,
  onIncomingLinkRequests,
  onOutgoingLinkRequests,
  generateCrewProfileLinkCode,
  requestPilotLinkByEmail,
  withdrawConnectionRequest,
  acceptIncomingLinkRequest,
  declineConnectionRequest
} from '../../services/crewService.js';
import { watchDocumentsByUser } from '../../services/documentService.js';
import { startCrewDocumentSyncWorker } from '../../services/crewDocumentSyncService.js';
import { canPerformCrewAction, getCrewPermissionsForUser } from '../../services/permissionService.js';
import { getCurrentOrganizationContext } from '../../services/organizationService.js';
import { crewState, crewListState, docListState, PAGE_SIZE, CREW_TAB_STORAGE_KEY } from './state.js';
import {
  query,
  queryAll,
  normalizeRole,
  getInitials,
  toProfileName,
  setStatus,
  showToast,
  closeModal,
  confirmModal,
  isPilotRole,
  getSortedAndFilteredPilots,
  toDateValue
} from './utils.js';
import {
  setActiveTab,
  positionTabUnderline,
  renderTabContent,
  renderCrewTable,
  updateKPIs,
  openDrawer,
  closeDrawer,
  handleDelink
} from './directory.js';
import { openProfileForm, saveProfileForm } from './profile.js';
import {
  renderDocumentsTab,
  renderPilotDocuments,
  bindDocumentControls
} from './documents.js';
import {
  renderOutgoingRequests,
  renderLinkedPilots,
  renderIncomingRequests,
  sendPilotLinkRequest,
  setActiveLinkCode,
  stopLinkCodeTimer
} from './linking.js';
import { renderBulkTab, applyBulkAction, exportCrewCsv } from './bulk.js';
import { runQueueSync, renderQueueSyncState } from './queue.js';

/* ================= SELECTION ================= */

export async function selectPilot(pilotUid) {
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;
  crewState.selectedPilotUid = pilotUid;

  crewState.pilotDocUnsubscribe?.();
  crewState.pilotDocUnsubscribe = null;

  const docs = await getPilotDocuments(pilotUid);
  crewState.docsByPilotCache.set(pilotUid, docs);

  crewState.pilotDocUnsubscribe = watchDocumentsByUser(
    pilotUid,
    (snapshot) => {
      const nextDocs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
      crewState.docsByPilotCache.set(pilotUid, nextDocs);
      renderCrewTable();
      if (crewState.activeTab === 'documents') renderPilotDocuments();
      updateKPIs();
    },
    (error) => console.error('Crew document watch error:', error)
  );

  if (crewState.activeTab === 'documents') renderPilotDocuments();
  renderCrewTable();
}

function handleRowCheck(pilotUid, checked) {
  if (checked) crewState.selectedRows.add(pilotUid);
  else crewState.selectedRows.delete(pilotUid);
  if (crewState.activeTab === 'bulk') renderBulkTab();
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

    renderCrewTable();
    if (crewState.activeTab === 'documents') renderPilotDocuments();
    if (crewState.activeTab === 'linking') renderIncomingRequests();
    renderTabContent(crewState.activeTab);
    setStatus(`Loaded your pilot profile and ${pilotDocs.length} document(s).`);
    updateKPIs();
    return;
  }

  if (!crewState.activeOperatorUid) return;
  const [pilots, outgoingRequests] = await Promise.all([getCrew(crewState.activeOperatorUid), getOutgoingLinkRequests(crewState.activeOperatorUid)]);
  crewState.pilotsCache = pilots;
  crewState.outgoingRequestsCache = outgoingRequests;
  crewState.docsByPilotCache = await getCrewDocumentsByPilots(pilots.map((pilot) => pilot.uid));
  setStatus(`Loaded ${pilots.length} pilot profile(s) from Firestore.`);
  renderTabContent(crewState.activeTab);
  updateKPIs();

  if (crewState.selectedPilotUid && pilots.some((pilot) => pilot.uid === crewState.selectedPilotUid)) {
    await selectPilot(crewState.selectedPilotUid);
  } else {
    crewState.selectedPilotUid = null;
  }
}

/* ================= EVENT BINDING ================= */

function bindHeaderAndTabs() {
  query('#cm-btn-add-crew')?.addEventListener('click', () => openProfileForm(null));
  query('#cm-btn-notifications')?.addEventListener('click', () => {
    setActiveTab('linking');
    showToast(`${crewState.incomingRequestsCache.length} incoming request(s).`, 'info');
  });

  query('#cm-global-search')?.addEventListener('input', (event) => {
    const value = event.target?.value || '';
    crewListState.searchText = value;
    crewState.currentPage = 1;
    const panelInput = query('#cm-search');
    if (panelInput && panelInput.value !== value) panelInput.value = value;
    if (crewState.activeTab !== 'directory') setActiveTab('directory');
    else renderCrewTable();
  });

  queryAll('.cm-tab').forEach((tabButton) => {
    tabButton.addEventListener('click', () => setActiveTab(tabButton.dataset.tab));
  });

  window.addEventListener('resize', () => positionTabUnderline(crewState.activeTab));
}

function bindDirectoryControls() {
  query('#cm-search')?.addEventListener('input', (event) => {
    const value = event.target?.value || '';
    crewListState.searchText = value;
    crewState.currentPage = 1;
    const globalInput = query('#cm-global-search');
    if (globalInput && globalInput.value !== value) globalInput.value = value;
    renderCrewTable();
  });

  query('#cm-filter-compliance')?.addEventListener('change', (event) => {
    crewListState.compliance = `${event.target?.value || 'ALL'}`.toUpperCase();
    crewState.currentPage = 1;
    renderCrewTable();
  });

  query('#cm-filter-role')?.addEventListener('change', (event) => {
    crewListState.role = `${event.target?.value || 'ALL'}`.toUpperCase();
    crewState.currentPage = 1;
    renderCrewTable();
  });

  query('#cm-filter-status')?.addEventListener('change', (event) => {
    crewListState.status = event.target?.value || 'ALL';
    crewState.currentPage = 1;
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
    if (crewState.currentPage > 1) {
      crewState.currentPage -= 1;
      renderCrewTable();
    }
  });

  query('#cm-next')?.addEventListener('click', () => {
    const visible = getSortedAndFilteredPilots();
    if (crewState.currentPage * PAGE_SIZE < visible.length) {
      crewState.currentPage += 1;
      renderCrewTable();
    }
  });

  query('#cm-select-all')?.addEventListener('change', (event) => {
    const checked = !!event.target?.checked;
    const pagePilots = getSortedAndFilteredPilots().slice((crewState.currentPage - 1) * PAGE_SIZE, crewState.currentPage * PAGE_SIZE);
    pagePilots.forEach((pilot) => {
      if (checked) crewState.selectedRows.add(pilot.uid);
      else crewState.selectedRows.delete(pilot.uid);
    });
    renderCrewTable();
    if (crewState.activeTab === 'bulk') renderBulkTab();
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
    crewState.profileEditUid = null;
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
    if (!crewState.activeOperatorUid) return;
    const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
    if (!pilot) return;
    try {
      const result = await generateCrewProfileLinkCode({
        crewProfileId: pilotUid,
        operatorId: crewState.activeOperatorUid
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
    if (!crewState.activeLinkCode) {
      showToast('No active code to copy.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(crewState.activeLinkCode);
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
      const request = crewState.outgoingRequestsCache.find((item) => item.requestId === requestId);
      const pilotEmail = request?.recipientEmail;
      if (!pilotEmail || !crewState.activeOperatorUid) return;
      try {
        await requestPilotLinkByEmail({
          requesterId: crewState.activeOperatorUid,
          requesterName: toProfileName(crewState.activeCurrentUser),
          requesterEmail: crewState.activeCurrentUser?.email || '',
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
    if (!canPerformCrewAction(crewState.activeCurrentUser, 'respondIncomingRequest')) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-incoming-action]');
    if (!button) return;
    const action = button.getAttribute('data-incoming-action');
    const requestId = button.getAttribute('data-request-id');
    const operatorUid = button.getAttribute('data-operator-uid');
    if (!action || !requestId) return;

    const pilotUid = crewState.activeCurrentUser?.uid;
    if (!pilotUid) return;

    if (action === 'accept' && operatorUid) {
      confirmModal({
        title: 'Accept request',
        message: `Accept this request and link your profile to operator ${operatorUid}?`,
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

  applyRoleLayout();

  if (!currentUser?.uid) {
    setStatus('Crew module requires operator UID.');
    return { destroy() {} };
  }

  try {
    const savedTab = window.localStorage.getItem(CREW_TAB_STORAGE_KEY);
    crewState.activeTab = ['directory', 'profile', 'linking', 'documents', 'compliance', 'bulk'].includes(savedTab) ? savedTab : 'directory';
  } catch (_) {
    crewState.activeTab = 'directory';
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
  crewState.queueMonitorTimer = setInterval(() => {
    renderQueueSyncState();
  }, 5000);

  await refreshCrew();

  if (isPilotRole()) {
    const pilotUid = currentUser.uid;
    crewState.pilotDocUnsubscribe = watchDocumentsByUser(
      pilotUid,
      (snapshot) => {
        const docs = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
        crewState.docsByPilotCache.set(pilotUid, docs);
        renderCrewTable();
        if (crewState.activeTab === 'documents') renderPilotDocuments();
        updateKPIs();
      },
      (error) => console.error('Pilot document snapshot error:', error)
    );

    crewState.incomingRequestUnsubscribe = onIncomingLinkRequests(
      pilotUid,
      (snapshot) => {
        crewState.incomingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        renderIncomingRequests();
        updateKPIs();
      },
      (error) => console.error('Incoming link requests snapshot error:', error)
    );
  } else {
    crewState.crewUnsubscribe = onCrewSnapshot(
      crewState.activeOperatorUid,
      async (profiles) => {
        crewState.pilotsCache = profiles.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
        crewState.docsByPilotCache = await getCrewDocumentsByPilots(crewState.pilotsCache.map((pilot) => pilot.uid));
        renderTabContent(crewState.activeTab);
        updateKPIs();
        setStatus(`Live update: ${crewState.pilotsCache.length} pilot profile(s).`);
      },
      (error) => console.error('Crew snapshot error:', error)
    );

    crewState.outgoingRequestUnsubscribe = onOutgoingLinkRequests(
      operatorUid,
      (snapshot) => {
        crewState.outgoingRequestsCache = snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
        if (crewState.activeTab === 'linking') renderOutgoingRequests();
        updateKPIs();
      },
      (error) => console.error('Outgoing link requests snapshot error:', error)
    );
  }

  setActiveTab(crewState.activeTab);

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
      crewListState.compliance = 'ALL';
      crewListState.role = 'ALL';
      crewListState.status = 'ALL';
      crewListState.sortField = 'name';
      crewListState.sortDirection = 'asc';
      docListState.searchText = '';
      docListState.category = 'ALL';
      docListState.status = 'ALL';
      crewState.pilotsCache = [];
      crewState.docsByPilotCache = new Map();
      crewState.selectedPilotUid = null;
      crewState.selectedRows = new Set();
      crewState.currentPage = 1;
      crewState.outgoingRequestsCache = [];
      crewState.incomingRequestsCache = [];
      crewState.profileEditUid = null;
      crewState.activeLinkCode = null;
      crewState.activeLinkCodeExpiresAt = null;
      crewState.activeLinkCodePilotUid = null;
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
