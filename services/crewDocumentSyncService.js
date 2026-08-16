import {
  createUserDocument,
  updateUserDocumentWithAudit,
  deleteUserDocument,
  getUserDocumentById,
  mergeConflictingDocuments
} from './documentService.js';
import { deleteUserDocumentFile } from './storageService.js';

const QUEUE_KEY = 'vams.crewDocumentSyncQueue.v1';
const RETRY_INTERVAL_MS = 30000;
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000;

let memoryQueue = [];
let workerStarted = false;
let retryTimer = null;
let processing = false;
let consecutiveFailures = 0;
let onlineHandler = null;

function nowIso() {
  return new Date().toISOString();
}

function generateOperationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function canUseStorage() {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readQueue() {
  if (!canUseStorage()) return [...memoryQueue];

  try {
    const raw = globalThis.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  if (!canUseStorage()) {
    memoryQueue = [...queue];
    return;
  }

  globalThis.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function patchQueueItem(operationId, patch) {
  const queue = readQueue();
  const nextQueue = queue.map((item) => (item.operationId === operationId ? { ...item, ...patch } : item));
  writeQueue(nextQueue);
}

function removeQueueItem(operationId) {
  const queue = readQueue();
  writeQueue(queue.filter((item) => item.operationId !== operationId));
}

function shouldQueueError(error) {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    message.includes('unavailable') ||
    message.includes('network') ||
    message.includes('offline') ||
    message.includes('failed to fetch')
  );
}

function normalizeComparableValue(value) {
  if (value === undefined) return null;
  if (value?.toDate) {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === 'string' || typeof value === 'number' || value === null || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function getOperationDocumentId(item) {
  if (!item?.payload) return null;
  if (item.type === 'CREATE_DOCUMENT') {
    return item.payload.firestoreId || item.payload.documentId || null;
  }
  if (item.type === 'UPDATE_DOCUMENT' || item.type === 'DELETE_DOCUMENT') {
    return item.payload.documentId || null;
  }
  return null;
}

function compactQueue(queue) {
  const result = [];
  const latestIndexByDoc = new Map();

  queue.forEach((item) => {
    const documentId = getOperationDocumentId(item);
    if (!documentId) {
      result.push(item);
      return;
    }

    const existingIndex = latestIndexByDoc.get(documentId);
    const existing = typeof existingIndex === 'number' ? result[existingIndex] : null;

    if (item.type === 'UPDATE_DOCUMENT') {
      if (existing?.type === 'CREATE_DOCUMENT') {
        result[existingIndex] = {
          ...existing,
          payload: {
            ...existing.payload,
            ...item.payload.updates,
            isDirty: true,
            lastEditedBy: item.payload.editedBy || existing.payload.lastEditedBy || null
          }
        };
        return;
      }

      if (existing?.type === 'UPDATE_DOCUMENT') {
        result[existingIndex] = {
          ...existing,
          clientModifiedAt: item.clientModifiedAt || existing.clientModifiedAt,
          retryCount: 0,
          lastError: null,
          payload: {
            ...existing.payload,
            updates: {
              ...existing.payload.updates,
              ...item.payload.updates
            },
            editedBy: item.payload.editedBy || existing.payload.editedBy || null
          }
        };
        return;
      }
    }

    if (item.type === 'DELETE_DOCUMENT') {
      if (existing?.type === 'CREATE_DOCUMENT') {
        result[existingIndex] = null;
        latestIndexByDoc.delete(documentId);
        return;
      }

      if (existing?.type === 'UPDATE_DOCUMENT') {
        result[existingIndex] = {
          ...item,
          retryCount: 0,
          lastError: null
        };
        latestIndexByDoc.set(documentId, existingIndex);
        return;
      }
    }

    const nextIndex = result.push(item) - 1;
    latestIndexByDoc.set(documentId, nextIndex);
  });

  return result.filter(Boolean);
}

function buildPatchAgainstRemote(remoteDoc, updates) {
  if (!remoteDoc) return { ...updates };
  const patch = {};

  Object.entries(updates || {}).forEach(([key, value]) => {
    const remoteValue = remoteDoc[key];
    if (normalizeComparableValue(remoteValue) !== normalizeComparableValue(value)) {
      patch[key] = value;
    }
  });

  return patch;
}

function writeCompactedQueue(queue) {
  writeQueue(compactQueue(queue));
}

function buildQueuedUpdateUpdates(item, remoteDoc) {
  const baseRemote = remoteDoc || {};
  const proposed = {
    ...baseRemote,
    ...item.payload.updates,
    lastModified: item.clientModifiedAt || nowIso()
  };

  const merged = mergeConflictingDocuments(proposed, baseRemote);
  const keys = Object.keys(item.payload.updates || {});
  const updates = {};

  keys.forEach((key) => {
    if (key in merged) {
      updates[key] = merged[key];
    }
  });

  return updates;
}

async function processCreate(item) {
  await createUserDocument({
    ...item.payload,
    isDirty: false
  });
}

async function processUpdate(item) {
  const remoteDoc = await getUserDocumentById(item.payload.documentId);
  if (!remoteDoc) {
    throw new Error(`Remote document ${item.payload.documentId} was not found.`);
  }

  const mergedUpdates = buildQueuedUpdateUpdates(item, remoteDoc);
  const patch = buildPatchAgainstRemote(remoteDoc, mergedUpdates);

  if (Object.keys(patch).length === 0 && remoteDoc.isDirty === false) {
    return;
  }

  await updateUserDocumentWithAudit(
    item.payload.documentId,
    {
      ...patch,
      isDirty: false
    },
    item.payload.editedBy || null
  );
}

async function processDelete(item) {
  await deleteUserDocument(item.payload.documentId);
  if (item.payload.storagePath) {
    try {
      await deleteUserDocumentFile(item.payload.storagePath);
    } catch (error) {
      console.warn('Queued storage delete failed:', error);
    }
  }
}

async function processQueueItem(item) {
  if (item.type === 'CREATE_DOCUMENT') {
    await processCreate(item);
    return;
  }

  if (item.type === 'UPDATE_DOCUMENT') {
    await processUpdate(item);
    return;
  }

  if (item.type === 'DELETE_DOCUMENT') {
    await processDelete(item);
    return;
  }

  throw new Error(`Unknown queue operation type: ${item.type}`);
}

export function getCrewDocumentSyncQueue() {
  return readQueue();
}

export function enqueueCrewDocumentCreate(payload) {
  const operation = {
    operationId: generateOperationId(),
    type: 'CREATE_DOCUMENT',
    createdAt: nowIso(),
    retryCount: 0,
    lastError: null,
    payload
  };

  const queue = readQueue();
  queue.push(operation);
  writeCompactedQueue(queue);
  kickWorkQueue(RETRY_INTERVAL_MS);
  return operation;
}

export function enqueueCrewDocumentUpdate({ documentId, updates, editedBy }) {
  const operation = {
    operationId: generateOperationId(),
    type: 'UPDATE_DOCUMENT',
    createdAt: nowIso(),
    clientModifiedAt: nowIso(),
    retryCount: 0,
    lastError: null,
    payload: {
      documentId,
      updates: {
        ...updates,
        isDirty: true
      },
      editedBy: editedBy || null
    }
  };

  const queue = readQueue();
  queue.push(operation);
  writeCompactedQueue(queue);
  kickWorkQueue(RETRY_INTERVAL_MS);
  return operation;
}

export function enqueueCrewDocumentDelete({ documentId, storagePath = null }) {
  const operation = {
    operationId: generateOperationId(),
    type: 'DELETE_DOCUMENT',
    createdAt: nowIso(),
    retryCount: 0,
    lastError: null,
    payload: {
      documentId,
      storagePath
    }
  };

  const queue = readQueue();
  queue.push(operation);
  writeCompactedQueue(queue);
  return operation;
}

export async function processCrewDocumentSyncQueue() {
  if (processing) return { processed: 0, remaining: readQueue().length, busy: true };
  processing = true;

  try {
    const queue = compactQueue(readQueue());
    writeQueue(queue);
    let processed = 0;

    for (const item of queue) {
      try {
        await processQueueItem(item);
        removeQueueItem(item.operationId);
        processed += 1;
      } catch (error) {
        const retryCount = (item.retryCount || 0) + 1;
        patchQueueItem(item.operationId, {
          retryCount,
          lastError: error?.message || 'Unknown queue processing error',
          lastTriedAt: nowIso()
        });

        if (shouldQueueError(error)) {
          break;
        }
      }
    }

    return {
      processed,
      remaining: readQueue().length,
      busy: false
    };
  } finally {
    processing = false;
  }
}

export function startCrewDocumentSyncWorker() {
  if (workerStarted) return;
  workerStarted = true;
  consecutiveFailures = 0;

  if (typeof window !== 'undefined') {
    onlineHandler = () => kickWorkQueue();
    window.addEventListener('online', onlineHandler);
  }

  kickWorkQueue(0);
}

export function stopCrewDocumentSyncWorker() {
  workerStarted = false;
  consecutiveFailures = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
}

function retryDelayMs() {
  const exponential = RETRY_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFailures - 1, 6));
  const jitter = Math.random() * RETRY_INTERVAL_MS;
  return Math.round(Math.min(exponential + jitter, MAX_RETRY_BACKOFF_MS));
}

function kickWorkQueue(delayMs = 0) {
  if (!workerStarted) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    runWorkQueueOnce().catch(() => {});
  }, Math.max(0, delayMs));
}

async function runWorkQueueOnce() {
  if (!workerStarted) return;
  if (readQueue().length === 0) {
    consecutiveFailures = 0;
    return;
  }

  let result;
  try {
    result = await processCrewDocumentSyncQueue();
  } catch (error) {
    console.warn('Crew document queue periodic sync failed:', error);
    consecutiveFailures += 1;
    kickWorkQueue(retryDelayMs());
    return;
  }

  if (result.busy) {
    kickWorkQueue(RETRY_INTERVAL_MS);
    return;
  }

  if (result.remaining > 0) {
    consecutiveFailures += 1;
    kickWorkQueue(retryDelayMs());
  } else {
    consecutiveFailures = 0;
  }
}

export { shouldQueueError };
