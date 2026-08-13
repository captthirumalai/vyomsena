import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from '../firestoreService.js';
import {
  companyModuleCollection,
  getCompanyModuleDoc,
  setCompanyModuleDoc,
  listCompanyModuleDocs,
  onCompanyModuleSnapshot
} from '../companyService.js';
import { buildAuditEntry, writeAuditEntry, diffObject } from './audit.js';

const DUTY_COLLECTION = 'fdtl_duty';
const RECORDS_COLLECTION = 'fdtl_records';

export const DUTY_STATES = {
  ON_DUTY: 'on_duty',
  ON_REST: 'on_rest',
  AVAILABLE: 'available',
  OFF_DUTY: 'off_duty',
  SICK: 'sick',
  LEAVE: 'leave'
};

export const DUTY_STATE_LABELS = {
  on_duty: 'On Duty',
  on_rest: 'On Rest',
  available: 'Available',
  off_duty: 'Off Duty',
  sick: 'Sick',
  leave: 'Leave'
};

export const OPERATION_TYPES = {
  COMMERCIAL: 'commercial',
  POSITIONING: 'positioning',
  TRAINING: 'training',
  BASE_TRAINING: 'base_training',
  FAMILIARISATION: 'familiarisation',
  SKILL_TEST: 'skill_test',
  INSTRUMENT_RATING: 'instrument_rating',
  PPC: 'ppc'
};

export const OPERATION_TYPE_LABELS = {
  commercial: 'Commercial',
  positioning: 'Positioning',
  training: 'Training',
  base_training: 'Base Training',
  familiarisation: 'Familiarisation',
  skill_test: 'Skill Test',
  instrument_rating: 'IR',
  ppc: 'PPC'
};

const STATE_IGNORED_KEYS = ['id', 'companyId', 'updatedAt', 'lastModified'];

function cleanState(raw) {
  if (!raw) return null;
  const data = { ...raw };
  STATE_IGNORED_KEYS.forEach((key) => delete data[key]);
  return data;
}

export async function getDutyState(companyId, crewProfileId) {
  if (!companyId || !crewProfileId) return null;
  const existing = await getCompanyModuleDoc(companyId, DUTY_COLLECTION, crewProfileId);
  return cleanState(existing);
}

export async function setDutyState(companyId, crewProfileId, state, actor, reason) {
  if (!companyId || !crewProfileId) {
    throw new Error('companyId and crewProfileId are required to set duty state.');
  }
  const before = await getDutyState(companyId, crewProfileId);
  const payload = {
    state: state.state || DUTY_STATES.AVAILABLE,
    dutyStartedAt: state.dutyStartedAt || null,
    lastDutyEndedAt: state.lastDutyEndedAt || null,
    note: state.note || null
  };
  await setCompanyModuleDoc(companyId, DUTY_COLLECTION, crewProfileId, payload);

  const changes = diffObject(before, payload, STATE_IGNORED_KEYS);
  await Promise.all(
    changes.map((change) =>
      writeAuditEntry(
        companyId,
        buildAuditEntry({
          actor,
          entityType: 'duty_state',
          entityId: crewProfileId,
          field: change.field,
          before: change.before,
          after: change.after,
          reason,
          source: 'duty_state'
        })
      )
    )
  );
  return { crewProfileId, ...payload };
}

export async function listDutyStates(companyId) {
  if (!companyId) return [];
  const docs = await listCompanyModuleDocs(companyId, DUTY_COLLECTION);
  return docs.map((item) => ({ crewProfileId: item.id, ...item }));
}

export function onDutyStatesSnapshot(companyId, onNext, onError) {
  if (!companyId) {
    onNext?.([]);
    return () => {};
  }
  return onCompanyModuleSnapshot(
    companyId,
    DUTY_COLLECTION,
    (snapshot) => {
      onNext(snapshot.map((item) => ({ crewProfileId: item.id, ...item })));
    },
    onError
  );
}

export async function listDutyRecords(companyId, crewProfileId = null) {
  if (!companyId) return [];
  const ref = companyModuleCollection(companyId, RECORDS_COLLECTION);
  const source = crewProfileId
    ? query(ref, where('crewProfileId', '==', crewProfileId), orderBy('dutyDate', 'desc'))
    : query(ref, orderBy('dutyDate', 'desc'));
  const snapshot = await getDocs(source);
  return snapshot.docs.map((item) => ({ recordId: item.id, ...item.data() }));
}

export function onDutyRecordsSnapshot(companyId, onNext, onError, crewProfileId = null) {
  if (!companyId) {
    onNext?.([]);
    return () => {};
  }
  const ref = companyModuleCollection(companyId, RECORDS_COLLECTION);
  const source = crewProfileId
    ? query(ref, where('crewProfileId', '==', crewProfileId), orderBy('dutyDate', 'desc'))
    : query(ref, orderBy('dutyDate', 'desc'));
  return onSnapshot(
    source,
    (snapshot) => {
      onNext(snapshot.docs.map((item) => ({ recordId: item.id, ...item.data() })));
    },
    onError
  );
}

export async function addDutyRecord(companyId, data, actor, reason) {
  if (!companyId || !data?.crewProfileId) {
    throw new Error('companyId and crewProfileId are required to add a duty record.');
  }
  const payload = {
    crewProfileId: data.crewProfileId,
    crewName: data.crewName || null,
    dutyDate: data.dutyDate || null,
    operationType: data.operationType || OPERATION_TYPES.COMMERCIAL,
    operationCrew: data.operationCrew || 'two',
    reportTime: data.reportTime || null,
    dutyStart: data.dutyStart || null,
    dutyEnd: data.dutyEnd || null,
    fdpStart: data.fdpStart || null,
    fdpEnd: data.fdpEnd || null,
    flightTimeMinutes: Number(data.flightTimeMinutes) || 0,
    landings: Number(data.landings) || 0,
    sector: data.sector || null,
    note: data.note || null,
    createdAt: serverTimestamp()
  };
  const created = await addDoc(companyModuleCollection(companyId, RECORDS_COLLECTION), payload);
  await writeAuditEntry(
    companyId,
    buildAuditEntry({
      actor,
      entityType: 'duty_record',
      entityId: created.id,
      field: 'create',
      after: payload,
      reason,
      source: 'duty_record'
    })
  );
  return { recordId: created.id, ...payload };
}

export async function updateDutyRecord(companyId, recordId, updates, actor, reason) {
  if (!companyId || !recordId) {
    throw new Error('companyId and recordId are required to update a duty record.');
  }
  const ref = doc(`companies/${companyId}/${RECORDS_COLLECTION}`, recordId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return null;

  const before = snapshot.data();
  const cleanBefore = { ...before };
  delete cleanBefore.createdAt;
  delete cleanBefore.lastModified;

  const changed = {};
  Object.keys(updates).forEach((key) => {
    if (key === 'crewProfileId' || key === 'createdAt' || key === 'lastModified') return;
    changed[key] = updates[key];
  });

  await updateDoc(ref, { ...changed, lastModified: serverTimestamp() });

  const changes = diffObject(cleanBefore, { ...cleanBefore, ...changed }, ['lastModified', 'companyId']);
  await Promise.all(
    changes.map((change) =>
      writeAuditEntry(
        companyId,
        buildAuditEntry({
          actor,
          entityType: 'duty_record',
          entityId: recordId,
          field: change.field,
          before: change.before,
          after: change.after,
          reason,
          source: 'duty_record'
        })
      )
    )
  );
  return { recordId, ...cleanBefore, ...changed };
}

export async function deleteDutyRecord(companyId, recordId, actor, reason) {
  if (!companyId || !recordId) {
    throw new Error('companyId and recordId are required to delete a duty record.');
  }
  const ref = doc(`companies/${companyId}/${RECORDS_COLLECTION}`, recordId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return null;
  const before = snapshot.data();
  await deleteDoc(ref);
  await writeAuditEntry(
    companyId,
    buildAuditEntry({
      actor,
      entityType: 'duty_record',
      entityId: recordId,
      field: 'delete',
      before,
      reason,
      source: 'duty_record'
    })
  );
  return before;
}
