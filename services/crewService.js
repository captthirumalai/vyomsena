import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';

export async function getCrew(operatorUid) {
  const usersRef = collection('users');
  const crewQuery = query(usersRef, where('linkedOperator', '==', operatorUid), where('role', '==', 'PILOT'));
  const snapshot = await getDocs(crewQuery);
  return snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
}

export async function getPilotDocuments(pilotUid) {
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('userId', '==', pilotUid));
  const snapshot = await getDocs(docsQuery);
  return snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
}

export function onCrewSnapshot(operatorUid, onNext, onError) {
  const usersRef = collection('users');
  const crewQuery = query(usersRef, where('linkedOperator', '==', operatorUid), where('role', '==', 'PILOT'));
  return onSnapshot(crewQuery, onNext, onError);
}

export async function createPilot({ name, email, licenseNum, medicalExpiryDate, licenseExpiryDate, operatorUid }) {
  const usersRef = collection('users');
  const profile = {
    name,
    email,
    role: 'PILOT',
    linkedOperator: operatorUid,
    createdAt: serverTimestamp()
  };

  const profileRef = await addDoc(usersRef, profile);
  await updateDoc(profileRef, { uid: profileRef.id });

  const medicalDoc = {
    userId: profileRef.id,
    userName: name,
    documentName: 'Class 1 Medical',
    documentCategory: 'MEDICAL',
    licenseOrCertificateNumber: `MED-${licenseNum}`,
    issueDate: serverTimestamp(),
    expiryDate: medicalExpiryDate || null,
    reminderLeadTimeDays: 30,
    operatorId: operatorUid,
    readers: [profileRef.id, operatorUid]
  };

  const licenseDoc = {
    userId: profileRef.id,
    userName: name,
    documentName: 'Commercial Pilot License (CPL)',
    documentCategory: 'LICENCE',
    licenseOrCertificateNumber: licenseNum,
    issueDate: serverTimestamp(),
    expiryDate: licenseExpiryDate || null,
    reminderLeadTimeDays: 30,
    operatorId: operatorUid,
    readers: [profileRef.id, operatorUid]
  };

  const medicalRef = await addDoc(collection('user_documents'), medicalDoc);
  await updateDoc(medicalRef, { firestoreId: medicalRef.id });

  const licenseRef = await addDoc(collection('user_documents'), licenseDoc);
  await updateDoc(licenseRef, { firestoreId: licenseRef.id });

  return {
    uid: profileRef.id,
    profile: { uid: profileRef.id, ...profile },
    medicalDocumentId: medicalRef.id,
    licenseDocumentId: licenseRef.id
  };
}

export async function delinkPilot(pilotUid) {
  const pilotRef = doc('users', pilotUid);
  await updateDoc(pilotRef, { linkedOperator: null });
}

export async function deletePilot(pilotUid) {
  const docsRef = collection('user_documents');
  const docsQuery = query(docsRef, where('userId', '==', pilotUid));
  const snapshot = await getDocs(docsQuery);
  await Promise.all(snapshot.docs.map((item) => deleteDoc(doc('user_documents', item.id))));
  await deleteDoc(doc('users', pilotUid));
}
