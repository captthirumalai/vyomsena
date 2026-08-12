import { addDoc, getDocs, query, orderBy, limit, onSnapshot, serverTimestamp } from '../firestoreService.js';
import { companyModuleCollection } from '../companyService.js';

const AUDIT_COLLECTION = 'fdtl_audit';

export function buildAuditEntry({ actor, entityType, entityId, field, before, after, reason, source }) {
  return {
    actorName: actor?.name || actor?.email || actor?.uid || 'Unknown',
    actorId: actor?.uid || null,
    entityType,
    entityId,
    field,
    before: before ?? null,
    after: after ?? null,
    reason: reason || null,
    source: source || 'fdtl',
    timestamp: serverTimestamp()
  };
}

export async function writeAuditEntry(companyId, entry) {
  if (!companyId) return null;
  const ref = companyModuleCollection(companyId, AUDIT_COLLECTION);
  const created = await addDoc(ref, entry);
  return { id: created.id, ...entry };
}

export async function listAuditEntries(companyId, max = 50) {
  if (!companyId) return [];
  const ref = companyModuleCollection(companyId, AUDIT_COLLECTION);
  const snapshot = await getDocs(query(ref, orderBy('timestamp', 'desc'), limit(max)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function onAuditSnapshot(companyId, onNext, onError) {
  if (!companyId) {
    onNext?.([]);
    return () => {};
  }
  const ref = companyModuleCollection(companyId, AUDIT_COLLECTION);
  return onSnapshot(
    query(ref, orderBy('timestamp', 'desc'), limit(50)),
    (snapshot) => {
      onNext(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export function diffObject(before, after, ignoreKeys = []) {
  const beforeObj = before || {};
  const afterObj = after || {};
  const keys = new Set([
    ...Object.keys(beforeObj),
    ...Object.keys(afterObj),
    ...ignoreKeys
  ]);
  const changes = [];
  keys.forEach((key) => {
    if (ignoreKeys.includes(key)) return;
    const beforeValue = beforeObj[key] ?? null;
    const afterValue = afterObj[key] ?? null;
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({ field: key, before: beforeValue, after: afterValue });
    }
  });
  return changes;
}
