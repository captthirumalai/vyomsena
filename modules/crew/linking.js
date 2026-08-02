import { crewState } from './state.js';
import {
  query,
  escapeHtml,
  toProfileName,
  getPilotRoleLabel,
  getInitials,
  normalizeSearchText,
  toDateValue,
  formatShortDate,
  setStatus,
  showToast
} from './utils.js';
import { normalizeRequestStatus } from './directory.js';
import {
  generateCrewProfileLinkCode,
  assignPilotByEmail,
  withdrawConnectionRequest,
  acceptIncomingLinkRequest,
  declineConnectionRequest
} from '../../services/crewService.js';
import { refreshCrew } from './crew.js';

export function setLinkSelectValue(pilotUid) {
  const select = query('#cm-link-pilot');
  if (!select) return;
  select.value = pilotUid || '';
}

export function setActiveLinkCode(code, expiresAt, pilotUid) {
  crewState.activeLinkCode = code;
  crewState.activeLinkCodeExpiresAt = expiresAt ? toDateValue(expiresAt) : new Date(Date.now() + 5 * 60 * 1000);
  crewState.activeLinkCodePilotUid = pilotUid;
  renderLinkCode();
  startLinkCodeTimer();
}

function startLinkCodeTimer() {
  if (crewState.linkCodeTimer) clearInterval(crewState.linkCodeTimer);
  crewState.linkCodeTimer = setInterval(renderLinkCode, 1000);
}

export function stopLinkCodeTimer() {
  if (crewState.linkCodeTimer) {
    clearInterval(crewState.linkCodeTimer);
    crewState.linkCodeTimer = null;
  }
}

function renderLinkCode() {
  if (crewState.activeTab !== 'linking') return;
  const codeEl = query('#cm-link-code');
  const timerEl = query('#cm-link-timer');
  const dotEl = query('#cm-link-timer-dot');
  if (!codeEl || !timerEl) return;

  if (!crewState.activeLinkCode || !crewState.activeLinkCodeExpiresAt) {
    codeEl.textContent = '—';
    timerEl.textContent = 'No active code';
    if (dotEl) dotEl.classList.remove('is-live', 'is-ending');
    return;
  }

  const remainingMs = crewState.activeLinkCodeExpiresAt.getTime() - Date.now();
  codeEl.textContent = crewState.activeLinkCode;

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
  select.innerHTML = crewState.pilotsCache
    .filter((pilot) => `${pilot.status || 'Active'}` !== 'Deleted')
    .map((pilot) => `<option value="${escapeHtml(pilot.uid)}">${escapeHtml(toProfileName(pilot))} (${escapeHtml(getPilotRoleLabel(pilot))})</option>`)
    .join('');
  if (crewState.activeLinkCodePilotUid) select.value = crewState.activeLinkCodePilotUid;
}

export function renderLinkingTab() {
  renderLinkPilotSelect();
  renderLinkCode();
  renderOutgoingRequests();
  renderLinkedPilots();
  renderIncomingRequests();
}

function getRequestStatusBadge(status) {
  const normalized = normalizeRequestStatus(status);
  if (normalized === 'ACCEPTED') return '<span class="cm-badge cm-badge-green">Accepted</span>';
  if (normalized === 'DECLINED') return '<span class="cm-badge cm-badge-red">Declined</span>';
  return '<span class="cm-badge cm-badge-amber">Pending</span>';
}

export function renderOutgoingRequests() {
  const body = query('#cm-link-table-body');
  if (!body) return;

  if (!crewState.outgoingRequestsCache.length) {
    body.innerHTML = '<tr><td colspan="6" class="cm-empty">No outgoing requests.</td></tr>';
    return;
  }

  body.innerHTML = crewState.outgoingRequestsCache
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

export function renderLinkedPilots() {
  const body = query('#cm-linked-table-body');
  if (!body) return;

  const search = normalizeSearchText(query('#cm-linked-search')?.value);
  const linked = crewState.pilotsCache.filter((pilot) => {
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

export function renderIncomingRequests() {
  const body = query('#cm-incoming-table-body');
  const card = query('#cm-incoming-card');
  if (!body || !card) return;

  if (!crewState.incomingRequestsCache.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  body.innerHTML = crewState.incomingRequestsCache
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

export async function sendPilotLinkRequest(form) {
  if (!(form instanceof HTMLFormElement)) return;
  if (!crewState.activeOperatorUid) return;

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
    if (statusEl) statusEl.textContent = 'Assigning pilot...';

    await assignPilotByEmail({
      operatorUid: crewState.activeOperatorUid,
      pilotEmail
    });

    form.reset();
    if (statusEl) {
      statusEl.textContent = `Pilot assigned and linked to your roster (${pilotEmail}).`;
      statusEl.classList.add('is-success');
    }
    showToast('Pilot assigned and linked.', 'success');
    await refreshCrew();
  } catch (error) {
    console.error('Pilot assignment failed:', error);
    if (statusEl) {
      statusEl.textContent = error.message || 'Unable to assign pilot.';
      statusEl.classList.add('is-error');
    }
    showToast(error.message || 'Unable to assign pilot.', 'error');
  } finally {
    if (submit) {
      submit.disabled = false;
      const spinner = submit.querySelector('.cm-btn-spinner');
      if (spinner) spinner.classList.add('hidden');
    }
  }
}

export async function issueCrewLinkCode(pilotUid) {
  if (!crewState.activeOperatorUid) return;
  const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
  if (!pilot) return;

  try {
    const result = await generateCrewProfileLinkCode({
      crewProfileId: pilot.crewProfileId || pilotUid,
      operatorId: crewState.activeOperatorUid
    });
    const expiry = toDateValue(result.expiresAt);
    const expiryText = expiry ? expiry.toLocaleTimeString() : 'in 5 minutes';
    setStatus(`Link ready for ${toProfileName(pilot)} | Profile ID: ${pilotUid} | Code: ${result.code} | Expires: ${expiryText}`);
    showToast(`Link code generated for ${toProfileName(pilot)}.`);

    setLinkSelectValue(pilotUid);
    setActiveLinkCode(result.code, result.expiresAt, pilotUid);
  } catch (error) {
    console.error('Generate link code failed:', error);
    setStatus(error.message || 'Unable to generate link code.');
    showToast(error.message || 'Unable to generate link code.', 'error');
  }
}
