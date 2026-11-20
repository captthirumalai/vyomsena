const crypto = require('crypto');
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

function activeStatus(value) {
  return `${value || 'ACTIVE'}`.trim().toUpperCase() === 'ACTIVE';
}

function normalizeDistribution(value) {
  if (!value) {
    return {
      version: 1,
      type: 'company',
      roles: [],
      departments: [],
      aircraftTypes: [],
      aircraftRegistrations: [],
      userIds: []
    };
  }
  if (value.version !== 1 || !['company', 'criteria', 'users'].includes(value.type)) {
    throw new HttpsError('failed-precondition', 'The saved distribution target is invalid; acknowledgement requirements were not broadened.');
  }
  const dimensions = ['roles', 'departments', 'aircraftTypes', 'aircraftRegistrations', 'userIds'];
  const target = { version: 1, type: value.type };
  for (const dimension of dimensions) {
    if (value[dimension] != null && !Array.isArray(value[dimension])) {
      throw new HttpsError('failed-precondition', `The saved ${dimension} distribution criteria are invalid.`);
    }
    target[dimension] = [...new Set((value[dimension] || []).map((item) => `${item}`.trim()).filter(Boolean))];
  }
  if (target.type === 'criteria' &&
      !target.roles.length && !target.departments.length && !target.aircraftTypes.length && !target.aircraftRegistrations.length) {
    throw new HttpsError('failed-precondition', 'The saved distribution has no resolvable criteria.');
  }
  if (target.type === 'users' && !target.userIds.length) {
    throw new HttpsError('failed-precondition', 'The saved distribution has no selected users.');
  }
  return target;
}

function matchesTarget(target, recipient) {
  if (target.type === 'company') return true;
  if (target.type === 'users') return target.userIds.some((id) => recipient.ids.includes(id));
  return [
    [target.roles, recipient.roles],
    [target.departments, recipient.departments],
    [target.aircraftTypes, recipient.aircraftTypes],
    [target.aircraftRegistrations, recipient.aircraftRegistrations]
  ].every(([selected, available]) => !selected.length || selected.some((value) => available.includes(value)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => `${value}`.trim()).filter(Boolean))].sort();
}

async function resolveRecipients(db, companyId, distribution) {
  const target = normalizeDistribution(distribution);
  const [accountsSnap, usersSnap, membersSnap, adminsSnap, profilesSnap, aircraftSnap, flightsSnap, peopleSnap] = await Promise.all([
    db.collection('company_accounts').where('companyId', '==', companyId).get(),
    db.collection('company_users').where('companyId', '==', companyId).get(),
    db.collection('company_members').where('companyId', '==', companyId).get(),
    db.collection('admin_users').where('companyId', '==', companyId).get(),
    db.collection('crew_profiles').where('operatorId', '==', companyId).get(),
    db.collection(`companies/${companyId}/aircraft`).get(),
    db.collection(`companies/${companyId}/flights`).get(),
    db.collection(`companies/${companyId}/people`).get()
  ]);
  const profiles = profilesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const people = peopleSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const aircraftByReg = new Map(aircraftSnap.docs.map((item) => [item.id, item.data() || {}]));
  const profileById = new Map();
  for (const profile of profiles) {
    profileById.set(profile.id, profile);
    profileById.set(profile.crewProfileId || profile.id, profile);
    if (profile.uid) profileById.set(profile.uid, profile);
    if (profile.pilotUid) profileById.set(profile.pilotUid, profile);
  }
  const personById = new Map(people.map((person) => [person.id, person]));
  const aircraftByProfile = new Map();
  for (const flightDoc of flightsSnap.docs) {
    const flight = flightDoc.data() || {};
    if (!flight.aircraftReg) continue;
    for (const seat of [flight.p1, flight.p2]) {
      if (!seat?.crewProfileId) continue;
      const registrations = aircraftByProfile.get(seat.crewProfileId) || new Set();
      registrations.add(flight.aircraftReg);
      aircraftByProfile.set(seat.crewProfileId, registrations);
    }
  }

  const recipients = new Map();
  function addRecipient(uid, { ids = [], role, department, profile, person, email } = {}) {
    if (!uid) return;
    const recipient = recipients.get(uid) || {
      id: uid,
      ids: [],
      name: '',
      email: null,
      roles: [],
      departments: [],
      aircraftTypes: [],
      aircraftRegistrations: []
    };
    recipient.ids = unique([...recipient.ids, uid, ...ids]);
    recipient.name = recipient.name || profile?.fullName || profile?.name || person?.displayName || person?.name || '';
    recipient.email = recipient.email || email || profile?.email || person?.email || null;
    recipient.roles = unique([...recipient.roles, `${role || ''}`.toUpperCase(), `${profile?.role || ''}`.toUpperCase(), `${person?.role || ''}`.toUpperCase()]);
    recipient.departments = unique([...recipient.departments, department, profile?.department, person?.department]);
    const profileIds = unique([profile?.crewProfileId, profile?.uid, profile?.pilotUid, profile?.id]);
    const registrations = profileIds.flatMap((id) => [...(aircraftByProfile.get(id) || [])]);
    recipient.aircraftRegistrations = unique([...recipient.aircraftRegistrations, ...registrations]);
    recipient.aircraftTypes = unique([
      ...recipient.aircraftTypes,
      ...registrations.map((registration) => aircraftByReg.get(registration)?.type)
    ]);
    recipients.set(uid, recipient);
  }

  for (const item of accountsSnap.docs) {
    const account = item.data() || {};
    if (account.isMember !== true || !activeStatus(account.status)) continue;
    const uid = account.uid || item.id;
    addRecipient(uid, {
      ids: [item.id],
      role: account.role,
      department: account.department,
      profile: profileById.get(uid),
      email: account.email
    });
  }
  for (const item of usersSnap.docs) {
    const user = item.data() || {};
    if (!activeStatus(user.status)) continue;
    const profile = profileById.get(user.linkedCrewProfileId);
    const person = personById.get(user.linkedPersonId);
    const uid = user.uid || item.id;
    addRecipient(uid, {
      ids: [item.id, user.companyUserId, user.linkedCrewProfileId, user.linkedPersonId],
      role: user.role,
      department: user.department || person?.department,
      profile,
      person,
      email: user.email
    });
  }
  for (const item of membersSnap.docs) {
    const member = item.data() || {};
    if (!activeStatus(member.status)) continue;
    const uid = member.uid || item.id;
    addRecipient(uid, { role: member.role, department: member.department, profile: profileById.get(uid), email: member.email });
  }
  for (const item of adminsSnap.docs) {
    const user = item.data() || {};
    if (!activeStatus(user.status)) continue;
    addRecipient(item.id, {
      role: user.role,
      profile: profileById.get(item.id),
      email: user.email
    });
  }
  for (const profile of profiles) {
    if (!profile.pilotUid || !activeStatus(profile.status)) continue;
    addRecipient(profile.pilotUid, {
      ids: [profile.uid, profile.crewProfileId, profile.id],
      role: profile.role,
      department: profile.department,
      profile
    });
  }

  const activeRecipients = [...recipients.values()];
  if (target.type === 'criteria') {
    const available = {
      roles: unique(activeRecipients.flatMap((recipient) => recipient.roles)),
      departments: unique(activeRecipients.flatMap((recipient) => recipient.departments)),
      aircraftTypes: unique(activeRecipients.flatMap((recipient) => recipient.aircraftTypes)),
      aircraftRegistrations: unique(activeRecipients.flatMap((recipient) => recipient.aircraftRegistrations))
    };
    for (const dimension of Object.keys(available)) {
      const unresolved = target[dimension].filter((value) => !available[dimension].includes(value));
      if (unresolved.length) {
        throw new HttpsError('failed-precondition', `Cannot resolve ${dimension}: ${unresolved.join(', ')}. Recipients were not broadened.`);
      }
    }
  }
  if (target.type === 'users') {
    const known = new Set(activeRecipients.flatMap((recipient) => recipient.ids));
    const missing = target.userIds.filter((id) => !known.has(id));
    if (missing.length) {
      throw new HttpsError('failed-precondition', `Selected user(s) are not active members of this company: ${missing.join(', ')}.`);
    }
  }
  const matched = activeRecipients.filter((recipient) => matchesTarget(target, recipient));
  if (!matched.length) throw new HttpsError('failed-precondition', 'The distribution target matches no active company users.');
  return { target, recipients: matched };
}

function acknowledgementId({ companyId, manualId, revisionId, revisionType, userId }) {
  return `v1-${crypto.createHash('sha256')
    .update([companyId, manualId, revisionType, revisionId, userId].join('\u001f'))
    .digest('hex')}`;
}

function revisionCollection(db, companyId, manualId, revisionType) {
  const name = revisionType === 'temporary' ? 'temporary_revisions' : 'revisions';
  return db.collection(`companies/${companyId}/manuals/${manualId}/${name}`);
}

function asIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return `${value}`;
}

function dateState(revision, revisionType, today = new Date().toISOString().slice(0, 10)) {
  if (revision.status === 'withdrawn') return 'withdrawn';
  if (revision.status !== 'published') return `${revision.status || 'draft'}`;
  if (revisionType === 'temporary') {
    if (revision.effectiveUntil && today > `${revision.effectiveUntil}`.slice(0, 10)) return 'expired';
    if (revision.effectiveFrom && today < `${revision.effectiveFrom}`.slice(0, 10)) return 'published_not_yet_effective';
  }
  return 'effective';
}

function buildAcknowledgementRecord({ companyId, manualId, revisionId, revisionType, manual, revision, recipient, distributionVersion }) {
  const documentTitle = revisionType === 'temporary' ? revision.title : manual.title;
  return {
    companyId,
    manualId,
    revisionId,
    revisionType,
    documentNumber: revisionType === 'temporary' ? (revision.referenceNumber || manual.documentNumber || null) : manual.documentNumber || null,
    documentTitle: documentTitle || 'Untitled manual',
    issueNumber: revision.issueNumber ?? manual.issueNumber ?? null,
    revisionNumber: revisionType === 'temporary'
      ? revision.temporaryRevisionNumber ?? null
      : revision.revisionNumber ?? null,
    userId: recipient.id,
    userNameSnapshot: recipient.name || null,
    userEmailSnapshot: recipient.email || null,
    departmentSnapshot: recipient.departments,
    aircraftSnapshot: recipient.aircraftRegistrations,
    distributionVersion,
    acknowledgementRequired: true,
    status: 'pending',
    publishedAt: revision.publishedAt || admin.firestore.FieldValue.serverTimestamp(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastModified: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function assertAdmin(db, uid, companyId) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage acknowledgements.');
  const snapshot = await db.doc(`admin_users/${uid}`).get();
  const adminUser = snapshot.exists ? snapshot.data() || {} : {};
  if (!snapshot.exists || adminUser.companyId !== companyId ||
      !['ADMIN', 'OWNER'].includes(`${adminUser.role || ''}`.toUpperCase()) ||
      !activeStatus(adminUser.status)) {
    throw new HttpsError('permission-denied', 'Only an active company admin or owner can manage acknowledgements.');
  }
  return { uid, companyId };
}

async function callerCompany(db, request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view or acknowledge documents.');
  const token = request.auth.token || {};
  if (token.home === 'company') {
    const companyId = token.companyId;
    const snapshot = await db.doc(`company_users/${uid}`).get();
    const user = snapshot.exists ? snapshot.data() || {} : {};
    if (!companyId || user.companyId !== companyId || !activeStatus(user.status)) {
      throw new HttpsError('permission-denied', 'An active company membership is required.');
    }
    return { uid, companyId, email: token.email || null, name: token.name || user.displayName || null };
  }
  const [accountSnap, memberSnap, adminSnap] = await Promise.all([
    db.doc(`company_accounts/${uid}`).get(),
    db.doc(`company_members/${uid}`).get(),
    db.doc(`admin_users/${uid}`).get()
  ]);
  const account = accountSnap.exists ? accountSnap.data() || {} : {};
  const member = memberSnap.exists ? memberSnap.data() || {} : {};
  const adminUser = adminSnap.exists ? adminSnap.data() || {} : {};
  const companyId = account.isMember === true && activeStatus(account.status)
    ? account.companyId
    : activeStatus(member.status)
      ? member.companyId
      : activeStatus(adminUser.status)
        ? adminUser.companyId
        : null;
  if (!companyId) throw new HttpsError('permission-denied', 'An active company membership is required.');
  return {
    uid,
    companyId,
    email: request.auth.token.email || account.email || null,
    name: request.auth.token.name || account.displayName || null
  };
}

async function loadRevision(db, companyId, manualId, revisionId, revisionType) {
  if (!['permanent', 'temporary'].includes(revisionType)) {
    throw new HttpsError('invalid-argument', 'revisionType must be permanent or temporary.');
  }
  const manualRef = db.doc(`companies/${companyId}/manuals/${manualId}`);
  const revisionRef = revisionCollection(db, companyId, manualId, revisionType).doc(revisionId);
  const [manualSnap, revisionSnap] = await Promise.all([manualRef.get(), revisionRef.get()]);
  if (!manualSnap.exists || !revisionSnap.exists) throw new HttpsError('not-found', 'Manual revision was not found.');
  return { manualRef, revisionRef, manual: manualSnap.data() || {}, revision: revisionSnap.data() || {} };
}

async function acquireGenerationLock(db, revisionRef, { allowComplete = false } = {}) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(revisionRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Manual revision was not found.');
    const data = snapshot.data() || {};
    if (data.status !== 'published') {
      throw new HttpsError('failed-precondition', 'Only a published revision can have acknowledgement requirements.');
    }
    const generation = data.acknowledgementGeneration || {};
    const lockActive = generation.status === 'processing' || generation.redistributionStatus === 'processing';
    if (lockActive && Date.now() - (generation.lockedAtMs || 0) < 360000) {
      throw new HttpsError('aborted', 'Acknowledgement requirements are already being generated. Try again shortly.');
    }
    if (!allowComplete && generation.status === 'complete') return { acquired: false, data };
    transaction.update(revisionRef, {
      acknowledgementGeneration: {
        ...generation,
        ...(allowComplete && generation.status === 'complete'
          ? { redistributionStatus: 'processing' }
          : { status: 'processing' }),
        lockedAtMs: Date.now(),
        lastError: null
      },
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    });
    return { acquired: true, data };
  });
}

async function writeRequirements(db, { companyId, manualId, revisionId, revisionType, manual, revision, recipients, distributionVersion }) {
  const collectionRef = db.collection(`companies/${companyId}/manuals/${manualId}/acknowledgements`);
  const writer = db.bulkWriter();
  writer.onWriteError((error) => {
    if (error.code === 6 || error.code === 'already-exists') return false;
    return error.failedAttempts < 3;
  });
  const writes = recipients.map((recipient) => {
    const ref = collectionRef.doc(acknowledgementId({ companyId, manualId, revisionId, revisionType, userId: recipient.id }));
    return writer.create(ref, buildAcknowledgementRecord({
      companyId,
      manualId,
      revisionId,
      revisionType,
      manual,
      revision,
      recipient,
      distributionVersion
    })).catch((error) => {
      if (error.code === 6 || error.code === 'already-exists') return false;
      throw error;
    });
  });
  const outcomes = await Promise.allSettled(writes);
  await writer.close();
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  return outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value !== false).length;
}

async function removeUncommittedRequirements(db, companyId, manualId, revisionId, committedVersion) {
  const snapshot = await db.collection(`companies/${companyId}/manuals/${manualId}/acknowledgements`)
    .where('revisionId', '==', revisionId)
    .get();
  const stale = snapshot.docs.filter((item) => Number(item.get('distributionVersion')) > committedVersion);
  if (!stale.length) return;
  const writer = db.bulkWriter();
  const outcomes = await Promise.allSettled(stale.map((item) => writer.delete(item.ref)));
  await writer.close();
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
}

async function getCounts(db, companyId, manualId, revisionId, distributionVersion) {
  const refs = db.collection(`companies/${companyId}/manuals/${manualId}/acknowledgements`);
  const snapshot = await refs.where('revisionId', '==', revisionId).get();
  const records = snapshot.docs.filter((item) =>
    Number(item.get('distributionVersion')) <= distributionVersion);
  const total = records.length;
  const acknowledged = records.filter((item) => item.get('status') === 'acknowledged').length;
  return { total, acknowledged, pending: total - acknowledged };
}

async function createRequirements(db, args, { distribution = null, distributionVersion = null, redistribution = false } = {}) {
  const { companyId, manualId, revisionId, revisionType } = args;
  const { manualRef, revisionRef, manual, revision } = await loadRevision(db, companyId, manualId, revisionId, revisionType);
  if (revision.status !== 'published') throw new HttpsError('failed-precondition', 'Only a published revision can have acknowledgement requirements.');
  const acknowledgementRequired = revision.acknowledgementRequired === true;
  if (!acknowledgementRequired) {
    await revisionRef.update({
      acknowledgementGeneration: { status: 'not_required', total: 0, acknowledged: 0, pending: 0 },
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    });
    return { status: 'not_required', total: 0, acknowledged: 0, pending: 0 };
  }

  const locked = await acquireGenerationLock(db, revisionRef, { allowComplete: redistribution });
  if (!locked.acquired) return locked.data.acknowledgementGeneration;
  const generationBefore = locked.data.acknowledgementGeneration || {};
  const target = distribution || revision.distribution || manual.distribution;
  const version = redistribution
    ? (Number(locked.data.distributionVersion) || 1) + 1
    : distributionVersion || (Number(revision.distributionVersion) || 1);
  try {
    if (redistribution) {
      await removeUncommittedRequirements(
        db,
        companyId,
        manualId,
        revisionId,
        Number(revision.distributionVersion) || 1
      );
    }
    const resolved = await resolveRecipients(db, companyId, target);
    const added = await writeRequirements(db, {
      companyId,
      manualId,
      revisionId,
      revisionType,
      manual,
      revision,
      recipients: resolved.recipients,
      distributionVersion: version
    });
    const counts = redistribution
      ? null
      : await getCounts(db, companyId, manualId, revisionId, version);
    const revisionUpdates = redistribution ? {
      distribution: resolved.target,
      distributionVersion: version,
      distributionHistory: admin.firestore.FieldValue.arrayUnion({
        version,
        distribution: resolved.target,
        redistributedBy: args.actorUid,
        redistributedAt: new Date().toISOString()
      }),
      'acknowledgementGeneration.status': 'complete',
      'acknowledgementGeneration.total': admin.firestore.FieldValue.increment(added),
      'acknowledgementGeneration.pending': admin.firestore.FieldValue.increment(added),
      'acknowledgementGeneration.distributionVersion': version,
      'acknowledgementGeneration.redistributionStatus': 'complete',
      'acknowledgementGeneration.completedAt': admin.firestore.FieldValue.serverTimestamp(),
      'acknowledgementGeneration.lastError': null,
      'acknowledgementGeneration.redistributionError': null,
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    } : {
      acknowledgementGeneration: {
        status: 'complete',
        ...counts,
        distributionVersion: version,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: null
      },
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    };
    const batch = db.batch();
    batch.update(revisionRef, revisionUpdates);
    if (redistribution && revisionType === 'permanent') {
      const manualUpdates = {};
      if (manual.currentRevisionId === revisionId) manualUpdates.currentDistribution = resolved.target;
      if (manual.effectiveRevisionId === revisionId) manualUpdates.distribution = resolved.target;
      if (Object.keys(manualUpdates).length) {
        manualUpdates.lastModified = admin.firestore.FieldValue.serverTimestamp();
        batch.update(manualRef, manualUpdates);
      }
    }
    await batch.commit();
    if (redistribution) {
      const completed = (await revisionRef.get()).data()?.acknowledgementGeneration || {};
      return {
        status: 'complete',
        total: Number(completed.total) || 0,
        acknowledged: Number(completed.acknowledged) || 0,
        pending: Number(completed.pending) || 0,
        distributionVersion: version,
        matchedRecipients: resolved.recipients.length
      };
    }
    return { status: 'complete', ...counts, distributionVersion: version, matchedRecipients: resolved.recipients.length };
  } catch (error) {
    let cleanupError = null;
    if (redistribution) {
      try {
        await removeUncommittedRequirements(
          db,
          companyId,
          manualId,
          revisionId,
          Number(revision.distributionVersion) || 1
        );
      } catch (failure) {
        cleanupError = failure;
      }
    }
    const failureMessage = cleanupError
      ? `${error.message || 'Redistribution failed.'}; cleanup also failed: ${cleanupError.message || cleanupError}`
      : `${error.message || (redistribution ? 'Redistribution failed.' : 'Recipient generation failed.')}`;
    await revisionRef.update({
      acknowledgementGeneration: redistribution && generationBefore.status === 'complete'
        ? {
            ...generationBefore,
            status: 'complete',
            redistributionStatus: 'incomplete',
            redistributionError: failureMessage.slice(0, 300),
            lastModified: admin.firestore.FieldValue.serverTimestamp()
          }
        : {
            ...generationBefore,
            status: 'incomplete',
            distributionVersion: version,
            lastError: failureMessage.slice(0, 300),
            lastModified: admin.firestore.FieldValue.serverTimestamp()
          },
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    });
    if (cleanupError) {
      throw new HttpsError('internal', failureMessage.slice(0, 300));
    }
    throw error;
  }
}

function revisionLifecycle(manual, revision, revisionType) {
  if (revision.status === 'withdrawn') return 'withdrawn';
  if (manual.status === 'archived') return 'withdrawn';
  if (revisionType === 'temporary') return dateState(revision, revisionType);
  if (manual.currentRevisionId && manual.currentRevisionId !== revision.id) {
    const effectiveDate = `${manual.currentRevisionEffectiveDate || ''}`.slice(0, 10);
    if (effectiveDate && new Date().toISOString().slice(0, 10) >= effectiveDate) return 'superseded';
  }
  return dateState(revision, revisionType);
}

function serializeAcknowledgement(record, lifecycleStatus, revision, manual) {
  return {
    ...record,
    publishedAt: asIso(record.publishedAt),
    acknowledgedAt: asIso(record.acknowledgedAt),
    createdAt: asIso(record.createdAt),
    lastModified: asIso(record.lastModified),
    effectiveDate: revision.effectiveDate || revision.effectiveFrom || null,
    effectiveUntil: revision.effectiveUntil || null,
    aircraftApplicability: revision.aircraftApplicability || manual.aircraftApplicability || null,
    department: revision.department || manual.department || null,
    documentUri: revision.documentUri || null,
    fileName: revision.fileName || null,
    sha256: revision.sha256 || null,
    lifecycleStatus,
    generationStatus: revision.acknowledgementGeneration?.status || 'not_generated',
    actionable: record.status === 'pending' &&
      revision.acknowledgementGeneration?.status === 'complete' &&
      ['effective', 'published_not_yet_effective'].includes(lifecycleStatus)
  };
}

async function getOwnAcknowledgements(db, caller, { cursor = null, pageSize = 50 } = {}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 50);
  let query = db.collectionGroup('acknowledgements')
    .where('userId', '==', caller.uid)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(safePageSize + 1);
  if (cursor) {
    if (typeof cursor !== 'string' || !cursor.includes('/acknowledgements/')) {
      throw new HttpsError('invalid-argument', 'The acknowledgement history cursor is invalid.');
    }
    const cursorSnapshot = await db.doc(cursor).get();
    if (!cursorSnapshot.exists || cursorSnapshot.get('userId') !== caller.uid) {
      throw new HttpsError('invalid-argument', 'The acknowledgement history cursor is invalid.');
    }
    query = query.startAfter(cursorSnapshot);
  }
  const snapshot = await query.get();
  const pageDocs = snapshot.docs.slice(0, safePageSize);
  const records = pageDocs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((record) => record.companyId === caller.companyId);
  const result = await Promise.all(records.map(async (record) => {
    const { manual, revision } = await loadRevision(db, record.companyId, record.manualId, record.revisionId, record.revisionType);
    if (revision.acknowledgementGeneration?.status !== 'complete' ||
        Number(record.distributionVersion) > (Number(revision.distributionVersion) || 1)) return null;
    return serializeAcknowledgement(
      record,
      revisionLifecycle(manual, { ...revision, id: record.revisionId }, record.revisionType),
      revision,
      manual
    );
  }));
  return {
    items: result.filter(Boolean).sort((left, right) => `${right.publishedAt || ''}`.localeCompare(`${left.publishedAt || ''}`)),
    nextCursor: snapshot.docs.length > safePageSize ? pageDocs[pageDocs.length - 1].ref.path : null
  };
}

async function getSummary(db, companyId) {
  const manualsSnap = await db.collection(`companies/${companyId}/manuals`).get();
  const rows = [];
  for (const manualDoc of manualsSnap.docs) {
    const manual = manualDoc.data() || {};
    const manualId = manualDoc.id;
    const [permanentSnap, temporarySnap] = await Promise.all([
      db.collection(`companies/${companyId}/manuals/${manualId}/revisions`).get(),
      db.collection(`companies/${companyId}/manuals/${manualId}/temporary_revisions`).get()
    ]);
    for (const [revisionType, snapshot] of [['permanent', permanentSnap], ['temporary', temporarySnap]]) {
      for (const revisionDoc of snapshot.docs) {
        const revision = revisionDoc.data() || {};
        const requiresAcknowledgement = revision.acknowledgementRequired === true;
        if (!requiresAcknowledgement && !revision.acknowledgementGeneration) continue;
        if (revision.status !== 'published' && !revision.acknowledgementGeneration) continue;
        const generation = revision.acknowledgementGeneration || {};
        if (generation.status === 'not_required') continue;
        const counts = {
          total: Number(generation.total) || 0,
          acknowledged: Number(generation.acknowledged) || 0,
          pending: Number(generation.pending) || 0
        };
        rows.push({
          manualId,
          revisionId: revisionDoc.id,
          revisionType,
          documentNumber: revisionType === 'temporary' ? revision.referenceNumber || manual.documentNumber || null : manual.documentNumber || null,
          documentTitle: revisionType === 'temporary' ? revision.title || manual.title || '' : manual.title || '',
          issueNumber: revision.issueNumber ?? manual.issueNumber ?? null,
          revisionNumber: revisionType === 'temporary' ? revision.temporaryRevisionNumber ?? null : revision.revisionNumber ?? null,
          publishedAt: asIso(revision.publishedAt),
          effectiveDate: revision.effectiveDate || revision.effectiveFrom || null,
          effectiveUntil: revision.effectiveUntil || null,
          aircraftApplicability: revision.aircraftApplicability || manual.aircraftApplicability || null,
          department: revision.department || manual.department || null,
          distribution: revision.distribution || manual.distribution || null,
          distributionVersion: Number(revision.distributionVersion) || 1,
          status: revisionLifecycle(manual, { ...revision, id: revisionDoc.id }, revisionType),
          acknowledgementRequired: requiresAcknowledgement,
          generationStatus: generation.status || 'not_generated',
          redistributionStatus: generation.redistributionStatus || null,
          ...counts,
          completionPercentage: counts.total ? Math.round((counts.acknowledged / counts.total) * 100) : 0
        });
      }
    }
  }
  rows.sort((a, b) => `${b.publishedAt || ''}`.localeCompare(`${a.publishedAt || ''}`));
  return rows;
}

async function getRecipientsPage(db, { companyId, manualId, revisionId, revisionType = 'permanent', status = null, department = null, aircraft = null, cursor = null, pageSize = 50 }) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 100);
  const { revision } = await loadRevision(db, companyId, manualId, revisionId, revisionType);
  let query = db.collection(`companies/${companyId}/manuals/${manualId}/acknowledgements`)
    .where('revisionId', '==', revisionId)
    .orderBy('userId')
    .limit(safePageSize + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, safePageSize);
  const items = docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => Number(item.distributionVersion) <= (Number(revision.distributionVersion) || 1) &&
      (!status || item.status === status) &&
      (!department || item.departmentSnapshot?.includes(department)) &&
      (!aircraft || item.aircraftSnapshot?.includes(aircraft)))
    .map((item) => ({
      userId: item.userId,
      userName: item.userNameSnapshot || '—',
      userEmail: item.userEmailSnapshot || '—',
      departments: item.departmentSnapshot || [],
      aircraft: item.aircraftSnapshot || [],
      status: item.status,
      acknowledgedAt: asIso(item.acknowledgedAt),
      distributionVersion: item.distributionVersion
    }));
  return {
    items,
    nextCursor: snapshot.docs.length > safePageSize ? docs[docs.length - 1].get('userId') : null
  };
}

async function acknowledge(db, request) {
  const caller = await callerCompany(db, request);
  const { manualId, revisionId, revisionType } = request.data || {};
  if (!manualId || !revisionId) throw new HttpsError('invalid-argument', 'manualId and revisionId are required.');
  const { manualRef, revisionRef, manual, revision } = await loadRevision(db, caller.companyId, manualId, revisionId, revisionType);
  const ackRef = db.doc(`companies/${caller.companyId}/manuals/${manualId}/acknowledgements/${acknowledgementId({
    companyId: caller.companyId, manualId, revisionId, revisionType, userId: caller.uid
  })}`);
  await db.runTransaction(async (transaction) => {
    const [ackSnap, revisionSnap, manualSnap] = await Promise.all([
      transaction.get(ackRef),
      transaction.get(revisionRef),
      transaction.get(manualRef)
    ]);
    if (!ackSnap.exists) throw new HttpsError('permission-denied', 'You are not a recipient of this revision.');
    const ack = ackSnap.data() || {};
    const freshRevision = revisionSnap.data() || {};
    const freshManual = manualSnap.data() || {};
    if (ack.userId !== caller.uid || ack.companyId !== caller.companyId || ack.manualId !== manualId ||
        ack.revisionId !== revisionId || ack.revisionType !== revisionType) {
      throw new HttpsError('permission-denied', 'This acknowledgement requirement belongs to another user or document.');
    }
    if (ack.status === 'acknowledged') return;
    if (freshRevision.status !== 'published' || freshRevision.acknowledgementGeneration?.status !== 'complete' ||
        Number(ack.distributionVersion) > (Number(freshRevision.distributionVersion) || 1) ||
        freshRevision.acknowledgementRequired !== true) {
      throw new HttpsError('failed-precondition', 'This revision is not currently accepting acknowledgements.');
    }
    const lifecycle = revisionLifecycle(freshManual, { ...freshRevision, id: revisionId }, revisionType);
    if (!['effective', 'published_not_yet_effective'].includes(lifecycle)) {
      throw new HttpsError('failed-precondition', 'This revision is withdrawn, expired, archived, or superseded.');
    }
    transaction.update(ackRef, {
      status: 'acknowledged',
      acknowledgedAt: admin.firestore.FieldValue.serverTimestamp(),
      acknowledgedBy: caller.uid,
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.update(revisionRef, {
      'acknowledgementGeneration.acknowledged': admin.firestore.FieldValue.increment(1),
      'acknowledgementGeneration.pending': admin.firestore.FieldValue.increment(-1),
      lastModified: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  return { acknowledged: true, revisionId, revisionType };
}

module.exports = {
  assertAdmin,
  callerCompany,
  createRequirements,
  getOwnAcknowledgements,
  getSummary,
  getRecipientsPage,
  acknowledge,
  loadRevision,
  resolveRecipients,
  normalizeDistribution
};
