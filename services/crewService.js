import {
  doc,
  deleteDoc,
  serverTimestamp
} from './firestoreService.js';
import { listPilotsForOperator, watchPilotsForOperator, unlinkPilotFromOperator, createPilotProfile } from './userService.js';
import {
  listDocumentsByUser,
  createUserDocument,
  deleteUserDocument,
  listDocumentsByUserIds,
  groupDocumentsByUser,
  summarizeCompliance
} from './documentService.js';

export async function getCrew(operatorUid) {
  return await listPilotsForOperator(operatorUid);
}

export async function getPilotDocuments(pilotUid) {
  return await listDocumentsByUser(pilotUid);
}

export async function getCrewDocumentsByPilots(pilotUids) {
  const documents = await listDocumentsByUserIds(pilotUids);
  return groupDocumentsByUser(documents);
}

export function summarizeCrewDocumentCompliance(documents, warningDays = 30) {
  return summarizeCompliance(documents, warningDays);
}

export function onCrewSnapshot(operatorUid, onNext, onError) {
  return watchPilotsForOperator(operatorUid, onNext, onError);
}

export async function createPilot({ name, email, licenseNum, medicalExpiryDate, licenseExpiryDate, operatorUid }) {
  const profile = await createPilotProfile({
    name,
    email,
    linkedOperator: operatorUid,
    createdAt: serverTimestamp()
  });

  const medicalDocument = await createUserDocument({
    userId: profile.uid,
    userName: name,
    documentName: 'Class 1 Medical',
    documentCategory: 'MEDICAL',
    licenseOrCertificateNumber: `MED-${licenseNum}`,
    issueDate: serverTimestamp(),
    expiryDate: medicalExpiryDate || null,
    reminderLeadTimeDays: 30,
    operatorId: operatorUid,
    readers: [profile.uid, operatorUid]
  });

  const licenseDocument = await createUserDocument({
    userId: profile.uid,
    userName: name,
    documentName: 'Commercial Pilot License (CPL)',
    documentCategory: 'LICENCE',
    licenseOrCertificateNumber: licenseNum,
    issueDate: serverTimestamp(),
    expiryDate: licenseExpiryDate || null,
    reminderLeadTimeDays: 30,
    operatorId: operatorUid,
    readers: [profile.uid, operatorUid]
  });

  return {
    uid: profile.uid,
    profile,
    medicalDocumentId: medicalDocument.firestoreId,
    licenseDocumentId: licenseDocument.firestoreId
  };
}

export async function delinkPilot(pilotUid) {
  await unlinkPilotFromOperator(pilotUid);
}

export async function deletePilot(pilotUid) {
  const documents = await listDocumentsByUser(pilotUid);
  await Promise.all(documents.map((item) => deleteUserDocument(item.firestoreId)));
  await deleteDoc(doc('users', pilotUid));
}
