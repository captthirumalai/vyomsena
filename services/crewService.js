import {
  doc,
  deleteDoc,
  serverTimestamp
} from './firestoreService.js';
import { findUserByEmail, linkPilotToOperator } from './userService.js';
import {
  listDocumentsByUser,
  createUserDocument,
  updateUserDocumentWithAudit,
  deleteUserDocument,
  listDocumentsByUserIds,
  groupDocumentsByUser,
  summarizeCompliance,
  watchDocumentsByUserIds
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
import { listTrainingRecordsByUser } from './crewTrainingService.js';
import {
  listCrewProfilesForOperator,
  watchCrewProfilesForOperator,
  createCrewProfile,
  updateCrewProfile
} from './crewProfileService.js';
import { createCrewLinkCode } from './crewLinkCodeService.js';

export async function getCrew(operatorUid) {
  return await listCrewProfilesForOperator(operatorUid);
}

export async function getPilotDocuments(pilotUid) {
  return await listDocumentsByUser(pilotUid);
}

export function getPilotDocumentUserIds(profile) {
  return [...new Set([profile?.uid, profile?.pilotUid].filter(Boolean))];
}

export async function getPilotDocumentsForProfile(profile) {
  return await listDocumentsByUserIds(getPilotDocumentUserIds(profile));
}

export function watchPilotDocumentsForProfile(profile, onNext, onError) {
  return watchDocumentsByUserIds(getPilotDocumentUserIds(profile), onNext, onError);
}

export async function getPilotTrainingRecords(pilotUid) {
  return await listTrainingRecordsByUser(pilotUid);
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

export async function getCrewDocumentsByPilots(pilots) {
  if (!Array.isArray(pilots) || pilots.length === 0) {
    return new Map();
  }

  const profileIds = [];
  const plainIds = [];
  pilots.forEach((item) => {
    if (item && typeof item === 'object') profileIds.push(item);
    else if (typeof item === 'string' && item) plainIds.push(item);
  });

  const userIds = [
    ...new Set([...profileIds.flatMap(getPilotDocumentUserIds), ...plainIds].filter(Boolean))
  ];
  const documents = await listDocumentsByUserIds(userIds);
  const groupedByUser = groupDocumentsByUser(documents);

  const pickDocs = (ids) => {
    const seen = new Set();
    const docs = [];
    ids.forEach((userId) => {
      (groupedByUser.get(userId) || []).forEach((item) => {
        if (seen.has(item.firestoreId)) return;
        seen.add(item.firestoreId);
        docs.push(item);
      });
    });
    return docs;
  };

  const result = new Map();
  profileIds.forEach((pilot) => result.set(pilot.uid, pickDocs(getPilotDocumentUserIds(pilot))));
  plainIds.forEach((id) => result.set(id, pickDocs([id])));
  return result;
}

export function summarizeCrewDocumentCompliance(documents, warningDays = 30) {
  return summarizeCompliance(documents, warningDays);
}

export function onCrewSnapshot(operatorUid, onNext, onError) {
  return watchCrewProfilesForOperator(operatorUid, onNext, onError);
}

export async function createPilot({ name, email, licenseNum, medicalExpiryDate, licenseExpiryDate, operatorUid }) {
  const profile = await createCrewProfile({
    name,
    email,
    operatorId: operatorUid,
    role: 'PILOT',
    status: 'Active',
    linkState: 'UNLINKED'
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
  await updateCrewProfile(pilotUid, {
    pilotUid: null,
    linkState: 'UNLINKED'
  });
}

export async function updatePilotProfile(pilotUid, updates) {
  await updateCrewProfile(pilotUid, updates);
}

export async function generateCrewProfileLinkCode({ crewProfileId, operatorId }) {
  return await createCrewLinkCode({
    crewProfileId,
    operatorId,
    validityMs: 5 * 60 * 1000
  });
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
