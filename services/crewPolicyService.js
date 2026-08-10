import { getCompanyModuleDoc, setCompanyModuleDoc } from './companyService.js';

const POLICY_DOC_ID = 'crewPolicy';

export function normalizeCrewPolicy(raw) {
  const names = Array.isArray(raw?.requiredDocumentNames)
    ? raw.requiredDocumentNames.map((name) => `${name}`.trim()).filter(Boolean)
    : [];
  return {
    requiredDocumentNames: [...new Set(names)],
    enabled: names.length > 0,
    updatedBy: raw?.updatedBy || null,
    updatedAt: raw?.updatedAt || null,
    lastModified: raw?.lastModified || null
  };
}

export async function getCrewDocumentPolicy(operatorUid) {
  if (!operatorUid) return normalizeCrewPolicy(null);
  const raw = await getCompanyModuleDoc(operatorUid, 'settings', POLICY_DOC_ID);
  return normalizeCrewPolicy(raw);
}

export async function setCrewDocumentPolicy(operatorUid, requiredDocumentNames, updatedBy = null) {
  if (!operatorUid) {
    throw new Error('Operator UID is required to save the crew document policy.');
  }
  const names = [...new Set((requiredDocumentNames || []).map((name) => `${name}`.trim()).filter(Boolean))];
  const payload = {
    requiredDocumentNames: names,
    enabled: names.length > 0,
    updatedBy: updatedBy || null
  };
  await setCompanyModuleDoc(operatorUid, 'settings', POLICY_DOC_ID, payload);
  return normalizeCrewPolicy({ ...payload, lastModified: new Date() });
}
