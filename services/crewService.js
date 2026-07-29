import {
  doc,
  deleteDoc,
  serverTimestamp
} from './firestoreService.js';
import { listPilotsForOperator, watchPilotsForOperator, unlinkPilotFromOperator, createPilotProfile } from './userService.js';
import { findUserByEmail, linkPilotToOperator } from './userService.js';
import {
  listDocumentsByUser,
  createUserDocument,
  updateUserDocumentWithAudit,
  deleteUserDocument,
  listDocumentsByUserIds,
  groupDocumentsByUser,
  summarizeCompliance
} from './documentService.js';
import {
  sendConnectionRequest,
  listIncomingRequests,
  listOutgoingRequests,
  watchIncomingRequests,
  watchOutgoingRequests,
  acceptConnectionRequest,
  rejectConnectionRequest,
  cancelConnectionRequest
} from './connectionService.js';

export async function getCrew(operatorUid) {
  return await listPilotsForOperator(operatorUid);
}

export async function getPilotDocuments(pilotUid) {
  return await listDocumentsByUser(pilotUid);
}

export async function createPilotDocument(payload) {
  return await createUserDocument(payload);
}

export async function removePilotDocument(documentId) {
  await deleteUserDocument(documentId);
}

export async function updatePilotDocumentWithAudit(documentId, updates, editedBy = null) {
  await updateUserDocumentWithAudit(documentId, updates, editedBy);
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

export async function requestPilotLinkByEmail({ requesterId, requesterName, requesterEmail, pilotEmail }) {
  const target = await findUserByEmail(pilotEmail);
  if (!target) {
    throw new Error('Pilot profile with this email was not found.');
  }

  const targetRole = `${target.role || ''}`.trim().toUpperCase();
  if (targetRole !== 'PILOT') {
    throw new Error('Target user is not registered as PILOT.');
  }

  return await sendConnectionRequest({
    requesterId,
    requesterName,
    requesterEmail,
    recipientId: target.uid,
    recipientEmail: target.email || pilotEmail
  });
}

export async function getOutgoingLinkRequests(operatorUid) {
  return await listOutgoingRequests(operatorUid);
}

export async function getIncomingLinkRequests(pilotUid) {
  return await listIncomingRequests(pilotUid);
}

export function onOutgoingLinkRequests(operatorUid, onNext, onError) {
  return watchOutgoingRequests(operatorUid, onNext, onError);
}

export function onIncomingLinkRequests(pilotUid, onNext, onError) {
  return watchIncomingRequests(pilotUid, onNext, onError);
}

export async function approveConnectionAndLink({ requestId, pilotUid, operatorUid }) {
  await acceptConnectionRequest(requestId);
  await linkPilotToOperator(pilotUid, operatorUid);
}

export async function acceptIncomingLinkRequest({ requestId, pilotUid, operatorUid }) {
  await acceptConnectionRequest(requestId);
  await linkPilotToOperator(pilotUid, operatorUid);
}

export async function declineConnectionRequest(requestId) {
  await rejectConnectionRequest(requestId);
}

export async function withdrawConnectionRequest(requestId) {
  await cancelConnectionRequest(requestId);
}
