import { crewState } from './state.js';
import { query, toDateValue, formatDateTime, setStatus, isPilotRole } from './utils.js';
import { getCrewDocumentSyncQueue, processCrewDocumentSyncQueue } from '../../services/crewDocumentSyncService.js';
import { refreshCrew } from './crew.js';

export function getLastQueueError(queue) {
  const withErrors = queue
    .filter((item) => item?.lastError)
    .sort((left, right) => {
      const leftTs = toDateValue(left.lastTriedAt || left.createdAt)?.getTime() || 0;
      const rightTs = toDateValue(right.lastTriedAt || right.createdAt)?.getTime() || 0;
      return rightTs - leftTs;
    });
  return withErrors.length ? withErrors[0].lastError : null;
}

export function renderQueueSyncState() {
  if (!crewState.activeView) return;
  const queue = getCrewDocumentSyncQueue();
  const pendingCount = queue.length;

  const countLabel = query('#cm-sync-count');
  if (countLabel) {
    countLabel.textContent = `Pending Sync: ${pendingCount}`;
    countLabel.classList.toggle('has-pending', pendingCount > 0);
  }

  const lastSyncLabel = query('#cm-last-sync');
  if (lastSyncLabel) {
    lastSyncLabel.textContent = crewState.queueSyncLastAttemptAt
      ? `Last sync: ${formatDateTime(crewState.queueSyncLastAttemptAt)}`
      : 'Last sync: —';
  }

  const retryButton = query('#cm-sync-retry');
  if (retryButton) {
    retryButton.disabled = crewState.queueSyncBusy || pendingCount === 0;
    const label = query('#cm-sync-retry-label');
    if (label) label.textContent = crewState.queueSyncBusy ? 'Syncing...' : 'Retry Sync';
  }

  const errorLabel = query('#cm-sync-error');
  if (errorLabel) {
    const message = crewState.queueSyncLastError || getLastQueueError(queue);
    if (!message) {
      errorLabel.textContent = crewState.queueSyncLastAttemptAt
        ? `No retry errors. Last sync: ${formatDateTime(crewState.queueSyncLastAttemptAt)}.`
        : 'No retry errors yet.';
      errorLabel.classList.remove('has-error');
    } else {
      errorLabel.textContent = `Last retry error: ${message}`;
      errorLabel.classList.add('has-error');
    }
  }
}

export function showQueueSyncFlash(message, tone = 'success') {
  if (!crewState.activeView) return;
  const flash = query('#cm-sync-flash');
  if (!flash) return;
  if (crewState.queueSyncFlashTimer) clearTimeout(crewState.queueSyncFlashTimer);
  flash.textContent = message;
  flash.classList.remove('hidden', 'is-success', 'is-warning', 'is-error');
  if (tone === 'error') flash.classList.add('is-error');
  else if (tone === 'warning') flash.classList.add('is-warning');
  else flash.classList.add('is-success');
  crewState.queueSyncFlashTimer = setTimeout(() => flash.classList.add('hidden'), 3000);
}

export function buildManualSyncStatusMessage(result) {
  const role = isPilotRole() ? 'pilot' : 'operations';
  if (result.remaining === 0 && result.processed > 0) {
    return `Sync complete for ${role} workspace. Synced ${result.processed} queued operation(s).`;
  }
  if (result.remaining === 0) {
    return `No queued updates for ${role} workspace. Everything is already synced.`;
  }
  return `Sync partially complete for ${role} workspace. Processed ${result.processed}; ${result.remaining} still pending.`;
}

export async function runQueueSync({ source = 'background', refreshAfter = false } = {}) {
  if (crewState.queueSyncBusy) return;
  crewState.queueSyncBusy = true;
  crewState.queueSyncLastError = null;
  renderQueueSyncState();

  try {
    const result = await processCrewDocumentSyncQueue();
    crewState.queueSyncLastAttemptAt = new Date();
    if (result.remaining === 0 && result.processed > 0) showQueueSyncFlash('Synced just now.', 'success');
    if (result.remaining > 0 && source === 'manual') showQueueSyncFlash('Some queued updates still need network retry.', 'warning');
    if (refreshAfter) await refreshCrew();
    if (source === 'manual') {
      setStatus(buildManualSyncStatusMessage(result));
      if (result.remaining === 0) showQueueSyncFlash('Synced just now.', 'success');
    }
  } catch (error) {
    crewState.queueSyncLastAttemptAt = new Date();
    crewState.queueSyncLastError = error?.message || 'Unknown queue sync error';
    showQueueSyncFlash('Sync failed. Review last retry error.', 'error');
    if (source === 'manual') setStatus(`Queue sync failed: ${crewState.queueSyncLastError}`);
  } finally {
    crewState.queueSyncBusy = false;
    renderQueueSyncState();
  }
}
