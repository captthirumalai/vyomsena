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
