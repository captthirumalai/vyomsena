import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';
import {
  companyModuleCollection,
  listCompanyModuleDocs,
  setCompanyModuleDoc,
  updateCompanyModuleDoc,
  deleteCompanyModuleDoc
} from './companyService.js';

export async function getAircraft() {
  const aircraftRef = collection('aircraft');
  const snapshot = await getDocs(aircraftRef);
  return snapshot.docs.map((item) => ({ reg: item.id, ...item.data() }));
}

export function onAircraftSnapshot(onNext, onError) {
  const aircraftRef = collection('aircraft');
  return onSnapshot(aircraftRef, onNext, onError);
}

export async function addAircraft({ reg, type, status = 'Operational', nextInspection = null, operatorId = null }) {
  const aircraftRef = doc('aircraft', reg);
  const payload = {
    type,
    status,
    nextInspection,
    operatorId,
    createdAt: serverTimestamp()
  };
  await setDoc(aircraftRef, payload);
  return { reg, ...payload };
}

export async function updateAircraft(reg, updates) {
  const aircraftRef = doc('aircraft', reg);
  await updateDoc(aircraftRef, { ...updates, updatedAt: serverTimestamp() });
}

export async function deleteAircraft(reg) {
  await deleteDoc(doc('aircraft', reg));
}

export async function getCompanyAircraft(companyId) {
  if (!companyId) return [];
  const docs = await listCompanyModuleDocs(companyId, 'aircraft');
  return docs.map((item) => ({ reg: item.id, ...item }));
}

export function onCompanyAircraftSnapshot(companyId, onNext, onError) {
  if (!companyId) {
    onNext?.([]);
    return () => {};
  }
  const aircraftRef = companyModuleCollection(companyId, 'aircraft');
  return onSnapshot(
    aircraftRef,
    (snapshot) => {
      onNext(
        snapshot.docs.map((item) => ({
          reg: item.id,
          ...item.data()
        }))
      );
    },
    onError
  );
}

export async function addCompanyAircraft(companyId, { reg, type, status = 'Operational', nextInspection = null }) {
  if (!companyId || !reg) {
    throw new Error('companyId and reg are required to add company aircraft.');
  }
  const payload = { type, status, nextInspection };
  await setCompanyModuleDoc(companyId, 'aircraft', reg, payload);
  return { reg, ...payload, companyId };
}

export async function updateCompanyAircraft(companyId, reg, updates) {
  await updateCompanyModuleDoc(companyId, 'aircraft', reg, updates);
}

export async function deleteCompanyAircraft(companyId, reg) {
  await deleteCompanyModuleDoc(companyId, 'aircraft', reg);
}
