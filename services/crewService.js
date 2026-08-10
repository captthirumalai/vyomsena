import {
  doc,
  deleteDoc
} from './firestoreService.js';
import {
  findUserByEmail,
  linkPilotToOperator,
  unlinkPilotFromOperator,
  listPilotsForOperator,
  watchPilotsForOperator,
  getUserByUid,
  updateUserProfile
} from './userService.js';
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
  updateCrewProfile,
  ensureCrewProfileForUser
} from './crewProfileService.js';
import { createCrewLinkCode } from './crewLinkCodeService.js';

function getProfileCoverage(profiles) {
  const byEmail = new Set();
  const byPilotUid = new Set();
  const byUid = new Set();
  profiles.forEach((profile) => {
    if (profile.email) byEmail.add(`${profile.email}`.trim().toLowerCase());
    if (profile.pilotUid) byPilotUid.add(profile.pilotUid);
    if (profile.uid) byUid.add(profile.uid);
  });
  return { byEmail, byPilotUid, byUid };
}

function isLinkedPilotCovered(coverage, user) {
  if (!user?.uid) return true;
  const userEmail = user.email ? `${user.email}`.trim().toLowerCase() : null;
  return (
    coverage.byUid.has(user.uid) ||
    coverage.byPilotUid.has(user.uid) ||
    (userEmail && coverage.byEmail.has(userEmail))
  );
}

const materializedCrewProfileKeys = new Set();

function isAcceptedRequest(request) {
  const normalized = `${request?.status || ''}`.trim().toUpperCase();
  return normalized === 'ACCEPTED';
}

async function getAcceptedRequestPilots(operatorUid) {
  const requests = await listOutgoingRequests(operatorUid);
  const accepted = requests.filter((request) => isAcceptedRequest(request) && request.recipientId && request.recipientId !== operatorUid);
  const users = await Promise.all(accepted.map((request) => getUserByUid(request.recipientId)));
  return users.filter((user) => user && `${user.role || ''}`.toUpperCase() === 'PILOT');
}

async function ensureLinkedPilotProfiles(operatorUid, profiles, linkedPilots) {
  const coverage = getProfileCoverage(profiles);
  const uncovered = (linkedPilots || []).filter((user) => !isLinkedPilotCovered(coverage, user));
  await Promise.all(
    uncovered.map(async (user) => {
      const key = `${operatorUid}:${user.uid}`;
      if (materializedCrewProfileKeys.has(key)) return;
      materializedCrewProfileKeys.add(key);
      try {
        await ensureCrewProfileForUser({ crewProfileId: user.uid, operatorId: operatorUid, user });
      } catch (error) {
        console.warn('Crew profile materialization failed:', error);
      }
    })
  );
}

async function getLinkedPilotPool(operatorUid) {
  const [linkedPilots, acceptedPilots] = await Promise.all([
    listPilotsForOperator(operatorUid),
    getAcceptedRequestPilots(operatorUid)
  ]);
  return [...(linkedPilots || []), ...(acceptedPilots || [])];
}

export async function getCrew(operatorUid) {
  const [profiles, pool] = await Promise.all([
    listCrewProfilesForOperator(operatorUid),
    getLinkedPilotPool(operatorUid)
  ]);

  const coverage = getProfileCoverage(profiles);
  if (pool.some((user) => !isLinkedPilotCovered(coverage, user))) {
    await ensureLinkedPilotProfiles(operatorUid, profiles, pool);
    return await listCrewProfilesForOperator(operatorUid);
  }

  return profiles;
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
  let profiles = null;

  const unsubProfiles = watchCrewProfilesForOperator(
    operatorUid,
    (nextProfiles) => {
      profiles = nextProfiles;
      onNext(nextProfiles);
    },
    onError
  );

  const unsubLinked = watchPilotsForOperator(
    operatorUid,
    (nextLinked) => {
      ensureLinkedPilotProfiles(operatorUid, profiles || [], nextLinked);
    },
    onError
  );

  return () => {
    unsubProfiles();
    unsubLinked();
  };
}

export async function createPilot({ name, email, operatorUid }) {
  const profile = await createCrewProfile({
    name,
    email,
    operatorId: operatorUid,
    role: 'PILOT',
    status: 'Active',
    linkState: 'UNLINKED'
  });

  return {
    uid: profile.uid,
    profile
  };
}

export async function delinkPilot(pilotUid) {
  try {
    await updateCrewProfile(pilotUid, {
      pilotUid: null,
      linkState: 'UNLINKED'
    });
  } catch (error) {
    console.warn('Crew profile delink skipped:', error);
  }

  try {
    await unlinkPilotFromOperator(pilotUid);
  } catch (error) {
    console.warn('Users doc unlink skipped:', error);
  }
}

export async function updatePilotProfile(pilotUid, updates) {
  await updateCrewProfile(pilotUid, updates);
}

export async function assignPilotByEmail({ operatorUid, pilotEmail }) {
  if (!operatorUid || !pilotEmail) {
    throw new Error('Operator and pilot email are required.');
  }

  const pilot = await findUserByEmail(pilotEmail);
  if (!pilot) {
    throw new Error('No pilot account was found with this email.');
  }

  const pilotRole = `${pilot.role || ''}`.trim().toUpperCase();
  if (pilotRole !== 'PILOT') {
    throw new Error('The account with this email is not registered as PILOT.');
  }

  const profile = await ensureCrewProfileForUser({
    crewProfileId: pilot.uid,
    operatorId: operatorUid,
    user: pilot
  });

  try {
    await linkPilotToOperator(pilot.uid, operatorUid);
    await updateUserProfile(pilot.uid, { crewProfileId: pilot.uid });
  } catch (error) {
    console.warn('assignPilotByEmail: users doc link skipped; the crew profile link is authoritative.', error);
  }

  return profile;
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
