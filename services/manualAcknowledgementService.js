import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

async function callAcknowledgementFunction(name, payload) {
  const callable = httpsCallable(getFunctions(), name);
  const result = await callable(payload);
  return result?.data ?? null;
}

export async function createAcknowledgementRequirements(companyId, manualId, revisionId, revisionType = 'permanent') {
  return callAcknowledgementFunction('createManualAcknowledgementRequirements', {
    companyId,
    manualId,
    revisionId,
    revisionType
  });
}

export async function getMyAcknowledgements({ cursor = null, pageSize = 50 } = {}) {
  return callAcknowledgementFunction('getMyManualAcknowledgements', { cursor, pageSize });
}

export async function acknowledgeManualRevision({ manualId, revisionId, revisionType = 'permanent' }) {
  return callAcknowledgementFunction('acknowledgeManualRevision', { manualId, revisionId, revisionType });
}

export async function getManualAcknowledgementSummary(companyId) {
  return callAcknowledgementFunction('getManualAcknowledgementSummary', { companyId });
}

export async function getRevisionAcknowledgementRecipients({
  companyId,
  manualId,
  revisionId,
  revisionType = 'permanent',
  status = null,
  department = null,
  aircraft = null,
  cursor = null,
  pageSize = 50
}) {
  return callAcknowledgementFunction('getManualAcknowledgementRecipients', {
    companyId,
    manualId,
    revisionId,
    revisionType,
    status,
    department,
    aircraft,
    cursor,
    pageSize
  });
}

export async function redistributeManualRevision({
  companyId,
  manualId,
  revisionId,
  revisionType = 'permanent',
  distribution
}) {
  return callAcknowledgementFunction('redistributeManualRevision', {
    companyId,
    manualId,
    revisionId,
    revisionType,
    distribution
  });
}
