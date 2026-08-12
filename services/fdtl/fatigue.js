import { getDocs, query, orderBy, limit, addDoc, onSnapshot, serverTimestamp } from '../firestoreService.js';
import { companyModuleCollection } from '../companyService.js';
import { buildAuditEntry, writeAuditEntry } from './audit.js';

const FATIGUE_COLLECTION = 'fdtl_fatigue';

export async function listFatigueReports(companyId, max = 100) {
  if (!companyId) return [];
  const ref = companyModuleCollection(companyId, FATIGUE_COLLECTION);
  const snapshot = await getDocs(query(ref, orderBy('reportedOn', 'desc'), limit(max)));
  return snapshot.docs.map((item) => ({ reportId: item.id, ...item.data() }));
}

export function onFatigueSnapshot(companyId, onNext, onError, max = 100) {
  if (!companyId) {
    onNext?.([]);
    return () => {};
  }
  const ref = companyModuleCollection(companyId, FATIGUE_COLLECTION);
  return onSnapshot(
    query(ref, orderBy('reportedOn', 'desc'), limit(max)),
    (snapshot) => {
      onNext(snapshot.docs.map((item) => ({ reportId: item.id, ...item.data() })));
    },
    onError
  );
}

export async function submitFatigueReport(companyId, data, actor) {
  if (!companyId || !data?.crewProfileId) {
    throw new Error('companyId and crewProfileId are required to submit a fatigue report.');
  }
  const payload = {
    crewProfileId: data.crewProfileId,
    crewName: data.crewName || null,
    reportedOn: data.reportedOn || new Date().toISOString(),
    description: data.description || null,
    actionTaken: data.actionTaken || null,
    status: 'open',
    confidential: true,
    createdAt: serverTimestamp()
  };
  const created = await addDoc(companyModuleCollection(companyId, FATIGUE_COLLECTION), payload);
  await writeAuditEntry(
    companyId,
    buildAuditEntry({
      actor,
      entityType: 'fatigue_report',
      entityId: created.id,
      field: 'create',
      after: payload,
      reason: 'Crew submitted a fatigue report.',
      source: 'fatigue_report'
    })
  );
  return { reportId: created.id, ...payload };
}
