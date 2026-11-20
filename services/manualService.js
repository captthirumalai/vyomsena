/* EFB Manual Distribution service layer (Milestone 1).
   Master manual records + immutable revisions.
   Module files must call this service — never the Firebase SDK directly. */

import {
  addCompanyModuleDoc,
  updateCompanyModuleDoc,
  deleteCompanyModuleDoc,
  onCompanyModuleSnapshot,
  listCompanyModuleDocs,
  getCompanyModuleDoc,
  listCompanyAccounts
} from './companyService.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, getDoc, doc, serverTimestamp, onSnapshot } from './firestoreService.js';
import { uploadManualRevision, deleteCompanyManualFile } from './storageService.js';
import { listCrewProfilesForOperator } from './crewProfileService.js';
import { getCompanyAircraft } from './aircraftService.js';
import { listCompanyUsersViaCallable } from './companyUserService.js';
import { createAcknowledgementRequirements } from './manualAcknowledgementService.js';

export const MANUAL_STATUSES = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
};

export const REVISION_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  SUPERSEDED: 'superseded',
  WITHDRAWN: 'withdrawn'
};

export const TEMPORARY_REVISION_STATUSES = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  EXPIRED: 'expired',
  WITHDRAWN: 'withdrawn'
};

export const TEMPORARY_EFFECTIVE_STATES = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED_NOT_YET_EFFECTIVE: 'published_not_yet_effective',
  EFFECTIVE: 'effective',
  EXPIRED: 'expired',
  WITHDRAWN: 'withdrawn',
  ARCHIVED: 'archived'
};

export const MANUAL_CATEGORIES = [
  'Operations Manual',
  'Standard Operating Procedures',
  'Safety Management System',
  'Emergency Response Manual',
  'Training Manual',
  'Maintenance Manual',
  'Security Manual',
  'Aircraft Flight Manual',
  'Aircraft Maintenance Manual',
  'Checklists',
  'Other'
];

export const REGULATORY_APPROVAL_STATUSES = [
  'Not Applicable',
  'Pending',
  'Submitted',
  'Approved',
  'Rejected'
];

const VALID_MANUAL_STATUSES = new Set(Object.values(MANUAL_STATUSES));

// V0.4.13 records: 'active' means published, 'uploading' means a failed draft.
const LEGACY_STATUS_MAP = {
  active: MANUAL_STATUSES.PUBLISHED,
  uploading: MANUAL_STATUSES.DRAFT
};

function revisionsPath(companyId, manualId) {
  return `companies/${companyId}/manuals/${manualId}/revisions`;
}

function revisionRef(companyId, manualId, revisionId) {
  return doc(revisionsPath(companyId, manualId), revisionId);
}

function temporaryRevisionsPath(companyId, manualId) {
  return `companies/${companyId}/manuals/${manualId}/temporary_revisions`;
}

function temporaryRevisionRef(companyId, manualId, revisionId) {
  return doc(temporaryRevisionsPath(companyId, manualId), revisionId);
}

function isoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  return null;
}

export function evaluateEffectiveStatus(document, referenceDate = new Date().toISOString().slice(0, 10)) {
  const status = `${document?.status || ''}`.toLowerCase();
  if (status === TEMPORARY_REVISION_STATUSES.WITHDRAWN || status === REVISION_STATUSES.WITHDRAWN) {
    return TEMPORARY_EFFECTIVE_STATES.WITHDRAWN;
  }
  if (status === MANUAL_STATUSES.ARCHIVED) return TEMPORARY_EFFECTIVE_STATES.ARCHIVED;
  if (status === MANUAL_STATUSES.DRAFT || status === TEMPORARY_REVISION_STATUSES.DRAFT) {
    return TEMPORARY_EFFECTIVE_STATES.DRAFT;
  }
  if (status === MANUAL_STATUSES.IN_REVIEW || status === TEMPORARY_REVISION_STATUSES.IN_REVIEW) {
    return TEMPORARY_EFFECTIVE_STATES.IN_REVIEW;
  }
  if (status !== MANUAL_STATUSES.PUBLISHED && status !== TEMPORARY_REVISION_STATUSES.PUBLISHED && status !== 'active') {
    return status === TEMPORARY_REVISION_STATUSES.EXPIRED
      ? TEMPORARY_EFFECTIVE_STATES.EXPIRED
      : TEMPORARY_EFFECTIVE_STATES.DRAFT;
  }

  const operationalEffectiveDate =
    document.currentRevisionId && document.effectiveRevisionId && document.currentRevisionId !== document.effectiveRevisionId
      ? document.effectiveDate
      : document.currentRevisionId && !document.effectiveRevisionId
        ? document.currentRevisionEffectiveDate || document.effectiveDate
        : document.effectiveFrom || document.effectiveDate;
  if (document.currentRevisionId && !document.effectiveRevisionId && !operationalEffectiveDate) {
    return TEMPORARY_EFFECTIVE_STATES.PUBLISHED_NOT_YET_EFFECTIVE;
  }
  const effectiveFrom = isoDate(operationalEffectiveDate);
  const effectiveUntil = isoDate(document.effectiveUntil || document.expiryDate);
  if (effectiveUntil && referenceDate > effectiveUntil) return TEMPORARY_EFFECTIVE_STATES.EXPIRED;
  if (effectiveFrom && referenceDate < effectiveFrom) return TEMPORARY_EFFECTIVE_STATES.PUBLISHED_NOT_YET_EFFECTIVE;
  return TEMPORARY_EFFECTIVE_STATES.EFFECTIVE;
}

export function normalizeDistributionTargeting(value) {
  if (!value || value.version !== 1 || value.type === 'company') {
    return { version: 1, type: 'company', roles: [], departments: [], aircraftTypes: [], aircraftRegistrations: [], userIds: [] };
  }
  return {
    version: 1,
    type: ['criteria', 'users'].includes(value.type) ? value.type : 'company',
    roles: Array.isArray(value.roles) ? value.roles : [],
    departments: Array.isArray(value.departments) ? value.departments : [],
    aircraftTypes: Array.isArray(value.aircraftTypes) ? value.aircraftTypes : [],
    aircraftRegistrations: Array.isArray(value.aircraftRegistrations) ? value.aircraftRegistrations : [],
    userIds: Array.isArray(value.userIds) ? value.userIds : []
  };
}

export function distributionMatchesRecipient(distribution, recipient) {
  const target = normalizeDistributionTargeting(distribution);
  if (target.type === 'company') return true;
  if (target.type === 'users') {
    return target.userIds.some((id) => recipient?.ids?.includes(id));
  }
  const dimensions = [
    [target.roles, recipient?.roles],
    [target.departments, recipient?.departments],
    [target.aircraftTypes, recipient?.aircraftTypes],
    [target.aircraftRegistrations, recipient?.aircraftRegistrations]
  ];
  return dimensions.every(([selected, available]) =>
    !selected.length || selected.some((value) => available?.includes(value))
  );
}

function normalizeStatus(rawStatus, hasFile) {
  const status = `${rawStatus || ''}`.trim().toLowerCase();
  if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status];
  if (VALID_MANUAL_STATUSES.has(status)) return status;
  return hasFile ? MANUAL_STATUSES.PUBLISHED : MANUAL_STATUSES.DRAFT;
}

export function normalizeManual(raw, id) {
  const hasFile = Boolean(raw.documentUri || raw.storagePath);
  return {
    id,
    title: raw.title || 'Untitled manual',
    documentNumber: raw.documentNumber || null,
    category: raw.category || 'Other',
    description: raw.description || null,
    aircraftApplicability: raw.aircraftApplicability || null,
    department: raw.department || null,
    documentOwner: raw.documentOwner || null,
    issueNumber: raw.issueNumber ?? null,
    revisionNumber: raw.revisionNumber ?? null,
    issueDate: raw.issueDate || null,
    revisionDate: raw.revisionDate || null,
    effectiveDate: raw.effectiveDate || null,
    currentRevisionEffectiveDate: raw.currentRevisionEffectiveDate || null,
    nextReviewDate: raw.nextReviewDate || null,
    preparedBy: raw.preparedBy || null,
    reviewedBy: raw.reviewedBy || null,
    approvedBy: raw.approvedBy || null,
    regulatoryApprovalStatus: raw.regulatoryApprovalStatus || null,
    approvalReference: raw.approvalReference || null,
    approvalDate: raw.approvalDate || null,
    acknowledgementRequired: raw.acknowledgementRequired === true,
    distribution: normalizeDistributionTargeting(raw.distribution),
    currentDistribution: normalizeDistributionTargeting(raw.currentDistribution ?? raw.distribution),
    currentRevisionId: raw.currentRevisionId || null,
    effectiveRevisionId: raw.effectiveRevisionId || null,
    pdfChecksum: raw.pdfChecksum || null,
    checksumVerified: raw.checksumVerified ?? null,
    fileName: raw.fileName || null,
    size: raw.size ?? null,
    contentType: raw.contentType || null,
    storagePath: raw.storagePath || null,
    documentUri: raw.documentUri || null,
    status: normalizeStatus(raw.status, hasFile),
    uploadedBy: raw.uploadedBy || null,
    archivedAt: raw.archivedAt || null,
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null,
    companyId: raw.companyId || null
  };
}

export function normalizeRevision(raw, id) {
  return {
    id,
    manualId: raw.manualId || null,
    revisionNumber: raw.revisionNumber ?? null,
    issueNumber: raw.issueNumber ?? null,
    issueDate: raw.issueDate || null,
    effectiveDate: raw.effectiveDate || null,
    reason: raw.reason || null,
    affectedChapters: raw.affectedChapters || null,
    affectedPages: raw.affectedPages || null,
    preparedBy: raw.preparedBy || null,
    reviewedBy: raw.reviewedBy || null,
    approvedBy: raw.approvedBy || null,
    regulatoryApprovalStatus: raw.regulatoryApprovalStatus || null,
    approvalReference: raw.approvalReference || null,
    approvalDate: raw.approvalDate || null,
    fileName: raw.fileName || null,
    size: raw.size ?? null,
    contentType: raw.contentType || null,
    storagePath: raw.storagePath || null,
    documentUri: raw.documentUri || null,
    sha256: raw.sha256 || null,
    checksumVerified: raw.checksumVerified ?? null,
    status: raw.status || REVISION_STATUSES.DRAFT,
    distribution: normalizeDistributionTargeting(raw.distribution),
    acknowledgementRequired: raw.acknowledgementRequired === true,
    distributionVersion: Number(raw.distributionVersion) || 1,
    acknowledgementGeneration: raw.acknowledgementGeneration || null,
    createdBy: raw.createdBy || null,
    publishedAt: raw.publishedAt || null,
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null
  };
}

export function normalizeTemporaryRevision(raw, id) {
  return {
    id,
    manualId: raw.manualId || null,
    title: raw.title || '',
    referenceNumber: raw.referenceNumber || '',
    temporaryRevisionNumber: raw.temporaryRevisionNumber ?? null,
    description: raw.description || null,
    reason: raw.reason || null,
    affectedChapters: raw.affectedChapters || null,
    affectedPages: raw.affectedPages || null,
    aircraftApplicability: raw.aircraftApplicability || null,
    department: raw.department || null,
    issueDate: raw.issueDate || null,
    effectiveFrom: raw.effectiveFrom || null,
    effectiveUntil: raw.effectiveUntil || null,
    preparedBy: raw.preparedBy || null,
    reviewedBy: raw.reviewedBy || null,
    approvedBy: raw.approvedBy || null,
    approvalReference: raw.approvalReference || null,
    regulatoryApprovalStatus: raw.regulatoryApprovalStatus || 'Not Applicable',
    acknowledgementRequired: raw.acknowledgementRequired === true,
    distribution: normalizeDistributionTargeting(raw.distribution),
    distributionVersion: Number(raw.distributionVersion) || 1,
    acknowledgementGeneration: raw.acknowledgementGeneration || null,
    fileName: raw.fileName || null,
    size: raw.size ?? null,
    contentType: raw.contentType || null,
    storagePath: raw.storagePath || null,
    documentUri: raw.documentUri || null,
    attachmentRevisionId: raw.attachmentRevisionId || null,
    attachmentHistory: Array.isArray(raw.attachmentHistory) ? raw.attachmentHistory : [],
    sha256: raw.sha256 || null,
    checksumVerified: raw.checksumVerified ?? null,
    status: raw.status || TEMPORARY_REVISION_STATUSES.DRAFT,
    effectiveStatus: evaluateEffectiveStatus(raw),
    createdBy: raw.createdBy || null,
    publishedAt: raw.publishedAt || null,
    withdrawnAt: raw.withdrawnAt || null,
    createdAt: raw.createdAt || null,
    lastModified: raw.lastModified || null
  };
}

export function isEffectiveOn(effectiveDate, referenceDate = new Date().toISOString().slice(0, 10)) {
  if (!effectiveDate) return false;
  return `${effectiveDate}`.slice(0, 10) <= referenceDate;
}

export function suggestNextRevisionNumber(revisions, master = null) {
  const numbers = revisions
    .map((revision) => Number(revision.revisionNumber) || 0)
    .filter((value) => Number.isInteger(value) && value > 0);
  const parsedMasterNumber = Number(master?.revisionNumber) || 0;
  const masterNumber = Number.isInteger(parsedMasterNumber) && parsedMasterNumber > 0 ? parsedMasterNumber : 0;
  return Math.max(masterNumber, ...numbers, 0) + 1;
}

function validateRevisionNumber(value) {
  if (value == null || value === '') return null;
  const revisionNumber = Number(value);
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    throw new Error('Revision number must be a positive whole number.');
  }
  return revisionNumber;
}

export function onManualsSnapshot(companyId, onNext, onError) {
  return onCompanyModuleSnapshot(
    companyId,
    'manuals',
    (records) => onNext(records.map((record) => normalizeManual(record, record.id))),
    onError
  );
}

export async function listManuals(companyId) {
  const records = await listCompanyModuleDocs(companyId, 'manuals');
  return records.map((record) => normalizeManual(record, record.id));
}

export async function getManual(companyId, manualId) {
  const record = await getCompanyModuleDoc(companyId, 'manuals', manualId);
  return record ? normalizeManual(record, record.id) : null;
}

export async function listRevisions(companyId, manualId) {
  const snapshot = await getDocs(collection(revisionsPath(companyId, manualId)));
  return snapshot.docs
    .map((item) => normalizeRevision(item.data(), item.id))
    .sort((left, right) => (Number(right.revisionNumber) || 0) - (Number(left.revisionNumber) || 0));
}

function activeRecord(record) {
  return `${record?.status || 'ACTIVE'}`.trim().toUpperCase() === 'ACTIVE';
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => `${value}`.trim()).filter(Boolean))].sort();
}

export async function resolveCompanyRecipients(companyId, { includeCompanyUsers = true } = {}) {
  if (!companyId) throw new Error('companyId is required to resolve manual recipients.');
  const [accounts, profiles, aircraft, flights, people, companyUsers] = await Promise.all([
    listCompanyAccounts(companyId),
    listCrewProfilesForOperator(companyId),
    getCompanyAircraft(companyId),
    listCompanyModuleDocs(companyId, 'flights'),
    listCompanyModuleDocs(companyId, 'people'),
    includeCompanyUsers ? listCompanyUsersViaCallable() : Promise.resolve([])
  ]);
  const profileById = new Map();
  profiles.forEach((profile) => {
    profileById.set(profile.crewProfileId || profile.uid, profile);
    if (profile.pilotUid) profileById.set(profile.pilotUid, profile);
  });
  const personById = new Map(people.map((person) => [person.id, person]));
  const aircraftByReg = new Map(aircraft.map((item) => [item.reg, item]));
  const assignmentByProfileId = new Map();
  flights.forEach((flight) => {
    if (!flight.aircraftReg) return;
    for (const seat of [flight.p1, flight.p2]) {
      if (!seat?.crewProfileId) continue;
      const regs = assignmentByProfileId.get(seat.crewProfileId) || new Set();
      regs.add(flight.aircraftReg);
      assignmentByProfileId.set(seat.crewProfileId, regs);
    }
  });

  const recipients = new Map();
  const addRecipient = ({ id, ids = [], role, department, profile, person }) => {
    if (!id) return;
    const identityIds = unique([id, ...ids]);
    const existing = recipients.get(id) || {
      id,
      ids: [],
      name: '',
      roles: [],
      departments: [],
      aircraftTypes: [],
      aircraftRegistrations: []
    };
    existing.ids = unique([...existing.ids, ...identityIds]);
    existing.name = existing.name || profile?.fullName || profile?.name || person?.displayName || person?.name || '';
    existing.roles = unique([...existing.roles, role, profile?.role, person?.role].map((value) => `${value || ''}`.toUpperCase()));
    existing.departments = unique([...existing.departments, department, profile?.department, person?.department]);
    const profileIds = [profile?.crewProfileId, profile?.uid, profile?.pilotUid].filter(Boolean);
    const regs = profileIds.flatMap((profileId) => [...(assignmentByProfileId.get(profileId) || [])]);
    existing.aircraftRegistrations = unique([...existing.aircraftRegistrations, ...regs]);
    existing.aircraftTypes = unique([
      ...existing.aircraftTypes,
      ...regs.map((reg) => aircraftByReg.get(reg)?.type)
    ]);
    recipients.set(id, existing);
  };

  accounts
    .filter((account) => account.isMember === true && activeRecord(account))
    .forEach((account) => {
      const uid = account.uid || account.accountId;
      const profile = profileById.get(uid);
      addRecipient({
        id: uid,
        ids: [account.accountId, profile?.pilotUid, profile?.uid],
        role: account.role,
        department: account.department,
        profile
      });
    });

  profiles
    .filter((profile) => profile.pilotUid && activeRecord(profile))
    .forEach((profile) => {
      addRecipient({
        id: profile.pilotUid,
        ids: [profile.uid, profile.crewProfileId],
        role: profile.role,
        department: profile.department,
        profile
      });
    });

  companyUsers
    .filter((user) => activeRecord(user))
    .forEach((user) => {
      const profile = profileById.get(user.linkedCrewProfileId);
      const person = personById.get(user.linkedPersonId);
      addRecipient({
        id: user.companyUserId,
        ids: [user.linkedCrewProfileId, user.linkedPersonId],
        role: user.role,
        department: user.department || person?.department,
        profile,
        person
      });
    });

  return [...recipients.values()];
}

export async function resolveMatchingCompanyRecipients(companyId, distribution) {
  const target = normalizeDistributionTargeting(distribution);
  if (target.type === 'company') return [];
  const recipients = await resolveCompanyRecipients(companyId);

  if (target.type === 'users') {
    const foundIds = new Set(recipients.flatMap((recipient) => recipient.ids));
    const missingIds = target.userIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      throw new Error(`Selected user(s) are not active members of this company: ${missingIds.join(', ')}.`);
    }
  } else {
    const available = {
      roles: unique(recipients.flatMap((recipient) => recipient.roles)),
      departments: unique(recipients.flatMap((recipient) => recipient.departments)),
      aircraftTypes: unique(recipients.flatMap((recipient) => recipient.aircraftTypes)),
      aircraftRegistrations: unique(recipients.flatMap((recipient) => recipient.aircraftRegistrations))
    };
    for (const dimension of Object.keys(available)) {
      const invalid = target[dimension].filter((value) => !available[dimension].includes(value));
      if (invalid.length) {
        throw new Error(
          `Cannot resolve ${dimension} for this company: ${invalid.join(', ')}. Update company roster or aircraft assignments; recipients were not broadened.`
        );
      }
    }
    if (!Object.values(available).some((values, index) => target[Object.keys(available)[index]].length)) {
      throw new Error('Select at least one resolvable role, department, aircraft type, or aircraft registration, or choose Company-wide.');
    }
  }

  const matches = recipients.filter((recipient) => distributionMatchesRecipient(target, recipient));
  if (!matches.length) {
    throw new Error('The selected targeting criteria match no active company users.');
  }
  return matches;
}

export async function getCompanyRecipientContext(companyId, userId) {
  if (!userId) return null;
  const recipients = await resolveCompanyRecipients(companyId, { includeCompanyUsers: false });
  return recipients.find((recipient) => recipient.ids.includes(userId)) || null;
}

export async function validateDistributionTargeting(companyId, distribution) {
  const target = normalizeDistributionTargeting(distribution);
  if (target.type === 'company') {
    return { distribution: target, matchingUserCount: null, matchingRecipients: [] };
  }
  const recipients = await resolveMatchingCompanyRecipients(companyId, target);
  return {
    distribution: target,
    matchingUserCount: target.type === 'company' ? null : recipients.length,
    matchingRecipients: recipients
  };
}

export function onTemporaryRevisionsSnapshot(companyId, manualId, onNext, onError) {
  if (!companyId || !manualId) throw new Error('companyId and manualId are required to subscribe to temporary revisions.');
  return onSnapshot(
    collection(temporaryRevisionsPath(companyId, manualId)),
    (snapshot) => onNext(snapshot.docs.map((item) => normalizeTemporaryRevision(item.data(), item.id))),
    onError
  );
}

export async function listTemporaryRevisions(companyId, manualId = null) {
  const manuals = manualId ? [{ id: manualId }] : await listManuals(companyId);
  const revisions = await Promise.all(
    manuals.map(async (manual) => {
      const snapshot = await getDocs(collection(temporaryRevisionsPath(companyId, manual.id)));
      return snapshot.docs.map((item) => normalizeTemporaryRevision(item.data(), item.id));
    })
  );
  return revisions.flat().sort((left, right) =>
    `${right.effectiveFrom || right.issueDate || ''}`.localeCompare(`${left.effectiveFrom || left.issueDate || ''}`)
  );
}

function validateTemporaryRevisionInput(input, { publishing = false } = {}) {
  if (!`${input.title || ''}`.trim()) throw new Error('Temporary revision title is required.');
  if (!`${input.referenceNumber || ''}`.trim()) throw new Error('Reference number is required.');
  if (!`${input.effectiveFrom || ''}`) throw new Error('Effective-from date is required.');
  if (!`${input.effectiveUntil || ''}`) throw new Error('Effective-until date is required.');
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(`${value || ''}`)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(input.effectiveFrom) || !validDate(input.effectiveUntil)) {
    throw new Error('Effective-from and effective-until must be valid calendar dates.');
  }
  if (input.effectiveUntil <= input.effectiveFrom) {
    throw new Error('Effective-until date must be later than the effective-from date.');
  }
  const regulatoryStatus = input.regulatoryApprovalStatus || 'Not Applicable';
  if (publishing) {
    if (!`${input.approvedBy || ''}`.trim()) throw new Error('Approver is required before publication.');
    if (regulatoryStatus !== 'Not Applicable' &&
        (regulatoryStatus !== 'Approved' || !input.approvalReference || !input.approvalDate)) {
      throw new Error('Regulatory approval must be Approved with an approval reference and date before publication.');
    }
    if (input.checksumVerified !== true || !input.storagePath || !input.documentUri || input.contentType !== 'application/pdf') {
      throw new Error('A PDF attachment with a verified SHA-256 checksum is required before publication.');
    }
  }
}

function temporaryRevisionFields(companyId, manualId, input, actorUid) {
  return {
    companyId,
    manualId,
    title: `${input.title || ''}`.trim(),
    referenceNumber: `${input.referenceNumber || ''}`.trim(),
    temporaryRevisionNumber: input.temporaryRevisionNumber || null,
    description: input.description || null,
    reason: input.reason || null,
    affectedChapters: input.affectedChapters || null,
    affectedPages: input.affectedPages || null,
    aircraftApplicability: input.aircraftApplicability || null,
    department: input.department || null,
    issueDate: input.issueDate || null,
    effectiveFrom: input.effectiveFrom || null,
    effectiveUntil: input.effectiveUntil || null,
    preparedBy: input.preparedBy || null,
    reviewedBy: input.reviewedBy || null,
    approvedBy: input.approvedBy || null,
    approvalReference: input.approvalReference || null,
    regulatoryApprovalStatus: input.regulatoryApprovalStatus || 'Not Applicable',
    distribution: normalizeDistributionTargeting(input.distribution),
    createdBy: actorUid || null
  };
}

async function uploadTemporaryAttachment(companyId, manualId, revisionId, file) {
  const extension = `${file?.name || ''}`.split('.').pop()?.toLowerCase();
  if (!file || (file.type !== 'application/pdf' && extension !== 'pdf')) {
    throw new Error('Temporary revision attachments must be PDF files.');
  }
  const attachmentRevisionId = `${revisionId}-${crypto.randomUUID()}`;
  const uploaded = await uploadManualRevision({
    companyId,
    manualId,
    revisionId: attachmentRevisionId,
    file
  });
  return { ...uploaded, attachmentRevisionId };
}

export async function createTemporaryRevision(companyId, manualId, input, { file = null, action = 'draft', actorUid = null } = {}) {
  const manual = await getManual(companyId, manualId);
  if (!manual) throw new Error('Select an existing parent manual for this temporary revision.');
  if (!['draft', 'review'].includes(action)) throw new Error('Temporary revisions can only be created as draft or in review.');
  if (action === 'review' && !file) {
    throw new Error('Upload and verify a PDF attachment before submitting a temporary revision for review.');
  }
  const fields = temporaryRevisionFields(companyId, manualId, input, actorUid);
  validateTemporaryRevisionInput(fields);
  const resolved = await validateDistributionTargeting(companyId, fields.distribution);
  const ref = await addDoc(collection(temporaryRevisionsPath(companyId, manualId)), {
    ...fields,
    distribution: resolved.distribution,
    status: action === 'review' ? TEMPORARY_REVISION_STATUSES.IN_REVIEW : TEMPORARY_REVISION_STATUSES.DRAFT,
    attachmentHistory: [],
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });
  let uploaded = null;
  try {
    if (file) {
      uploaded = await uploadTemporaryAttachment(companyId, manualId, ref.id, file);
      await updateDoc(ref, {
        attachmentRevisionId: uploaded.attachmentRevisionId,
        fileName: uploaded.fileName,
        size: uploaded.size,
        contentType: uploaded.contentType,
        storagePath: uploaded.storagePath,
        documentUri: uploaded.documentUri,
        sha256: uploaded.sha256,
        checksumVerified: uploaded.checksumVerified,
        lastModified: serverTimestamp()
      });
      if (action === 'review' && uploaded.checksumVerified !== true) {
        throw new Error('The PDF attachment must pass SHA-256 verification before review.');
      }
    }
  } catch (error) {
    const cleanupErrors = [];
    if (uploaded?.storagePath) {
      try {
        await deleteCompanyManualFile(uploaded.storagePath);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await deleteDoc(ref);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length) {
      console.error('Temporary revision creation cleanup failed:', cleanupErrors);
      throw new Error(`${error.message || error} Cleanup was incomplete.`);
    }
    throw error;
  }
  return { revisionId: ref.id, uploaded, matchingUserCount: resolved.matchingUserCount };
}

export async function updateTemporaryRevision(companyId, manualId, revisionId, input, { file = null } = {}) {
  const ref = temporaryRevisionRef(companyId, manualId, revisionId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('Temporary revision not found.');
  const current = normalizeTemporaryRevision(snapshot.data(), snapshot.id);
  if (current.status !== TEMPORARY_REVISION_STATUSES.DRAFT) {
    throw new Error('Only draft temporary revisions can be edited.');
  }
  const fields = temporaryRevisionFields(companyId, manualId, { ...current, ...input }, current.createdBy);
  validateTemporaryRevisionInput(fields);
  const resolved = await validateDistributionTargeting(companyId, fields.distribution);
  let uploaded = null;
  if (file) uploaded = await uploadTemporaryAttachment(companyId, manualId, revisionId, file);
  const attachmentHistory = [...(snapshot.data().attachmentHistory || [])];
  if (uploaded && current.storagePath) {
    attachmentHistory.push({
      attachmentRevisionId: current.attachmentRevisionId,
      fileName: current.fileName,
      size: current.size,
      contentType: current.contentType,
      storagePath: current.storagePath,
      documentUri: current.documentUri,
      sha256: current.sha256,
      checksumVerified: current.checksumVerified
    });
  }
  try {
    await updateDoc(ref, {
      ...fields,
      distribution: resolved.distribution,
      ...(uploaded ? {
        attachmentRevisionId: uploaded.attachmentRevisionId,
        fileName: uploaded.fileName,
        size: uploaded.size,
        contentType: uploaded.contentType,
        storagePath: uploaded.storagePath,
        documentUri: uploaded.documentUri,
        sha256: uploaded.sha256,
        checksumVerified: uploaded.checksumVerified,
        attachmentHistory
      } : {}),
      lastModified: serverTimestamp()
    });
  } catch (error) {
    if (uploaded?.storagePath) {
      try {
        await deleteCompanyManualFile(uploaded.storagePath);
      } catch (cleanupError) {
        console.error('Replacement temporary attachment cleanup failed:', cleanupError);
        throw new Error(`${error.message || error} New attachment cleanup failed: ${cleanupError.message || cleanupError}`);
      }
    }
    throw error;
  }
  return { matchingUserCount: resolved.matchingUserCount, uploaded };
}

export async function submitTemporaryRevisionForReview(companyId, manualId, revisionId) {
  const ref = temporaryRevisionRef(companyId, manualId, revisionId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('Temporary revision not found.');
  const current = normalizeTemporaryRevision(snapshot.data(), snapshot.id);
  if (current.status !== TEMPORARY_REVISION_STATUSES.DRAFT) {
    throw new Error('Only draft temporary revisions can be submitted for review.');
  }
  validateTemporaryRevisionInput(current);
  if (current.checksumVerified !== true || !current.storagePath || current.contentType !== 'application/pdf') {
    throw new Error('Upload and verify a PDF attachment before submitting a temporary revision for review.');
  }
  await validateDistributionTargeting(companyId, current.distribution);
  await updateDoc(ref, {
    status: TEMPORARY_REVISION_STATUSES.IN_REVIEW,
    lastModified: serverTimestamp()
  });
}

export async function publishTemporaryRevision(companyId, manualId, revisionId) {
  const ref = temporaryRevisionRef(companyId, manualId, revisionId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('Temporary revision not found.');
  const current = normalizeTemporaryRevision(snapshot.data(), snapshot.id);
  if (![TEMPORARY_REVISION_STATUSES.DRAFT, TEMPORARY_REVISION_STATUSES.IN_REVIEW].includes(current.status)) {
    throw new Error('Only draft or in-review temporary revisions can be published.');
  }
  const parent = await getManual(companyId, manualId);
  if (!parent || parent.status !== MANUAL_STATUSES.PUBLISHED) {
    throw new Error('Publish the parent manual before publishing a temporary revision.');
  }
  validateTemporaryRevisionInput(current, { publishing: true });
  await validateDistributionTargeting(companyId, current.distribution);
  await updateDoc(ref, {
    status: TEMPORARY_REVISION_STATUSES.PUBLISHED,
    acknowledgementRequired: parent.acknowledgementRequired === true,
    distributionVersion: Number(current.distributionVersion) || 1,
    publishedAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });
  let acknowledgementWarning = null;
  if (parent.acknowledgementRequired) {
    try {
      await createAcknowledgementRequirements(companyId, manualId, revisionId, 'temporary');
    } catch (error) {
      acknowledgementWarning = `Temporary revision was published, but acknowledgement requirement generation did not complete: ${error.message || error}`;
    }
  } else {
    await updateDoc(ref, {
      acknowledgementGeneration: { status: 'not_required', total: 0, acknowledged: 0, pending: 0 },
      lastModified: serverTimestamp()
    });
  }
  return {
    ...normalizeTemporaryRevision({
      ...snapshot.data(),
      status: TEMPORARY_REVISION_STATUSES.PUBLISHED,
      acknowledgementRequired: parent.acknowledgementRequired === true
    }, revisionId),
    acknowledgementWarning
  };
}

export async function withdrawTemporaryRevision(companyId, manualId, revisionId, actorUid = null) {
  const ref = temporaryRevisionRef(companyId, manualId, revisionId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('Temporary revision not found.');
  const revision = normalizeTemporaryRevision(snapshot.data(), snapshot.id);
  if (![TEMPORARY_REVISION_STATUSES.PUBLISHED, TEMPORARY_REVISION_STATUSES.EXPIRED].includes(revision.status)) {
    throw new Error('Only published or expired temporary revisions can be withdrawn.');
  }
  await updateDoc(ref, {
    status: TEMPORARY_REVISION_STATUSES.WITHDRAWN,
    withdrawnAt: serverTimestamp(),
    withdrawnBy: actorUid || null,
    lastModified: serverTimestamp()
  });
}

function masterFieldsFromInput(fields) {
  return {
    title: `${fields.title || ''}`.trim(),
    documentNumber: fields.documentNumber || null,
    category: fields.category || 'Other',
    description: fields.description || null,
    aircraftApplicability: fields.aircraftApplicability || null,
    department: fields.department || null,
    documentOwner: fields.documentOwner || null,
    issueNumber: fields.issueNumber || null,
    revisionNumber: validateRevisionNumber(fields.revisionNumber),
    issueDate: fields.issueDate || null,
    revisionDate: fields.revisionDate || null,
    effectiveDate: fields.effectiveDate || null,
    nextReviewDate: fields.nextReviewDate || null,
    preparedBy: fields.preparedBy || null,
    reviewedBy: fields.reviewedBy || null,
    approvedBy: fields.approvedBy || null,
    regulatoryApprovalStatus: fields.regulatoryApprovalStatus || null,
    approvalReference: fields.approvalReference || null,
    approvalDate: fields.approvalDate || null,
    acknowledgementRequired: fields.acknowledgementRequired === true,
    distribution: normalizeDistributionTargeting(fields.distribution)
  };
}

/* Publication workflow: a published revision always becomes the current
   revision; it becomes the effective revision only when its effective date
   has been reached. Future-effective revisions stay current but not effective. */
async function applyPublicationPointers(companyId, manualId, revisionId, revisionInput) {
  const manual = await getCompanyModuleDoc(companyId, 'manuals', manualId);
  if (!manual) throw new Error('Manual record not found.');

  const updates = {
    currentRevisionId: revisionId,
    revisionNumber: revisionInput.revisionNumber ?? manual.revisionNumber ?? null,
    issueNumber: revisionInput.issueNumber ?? manual.issueNumber ?? null,
    currentRevisionEffectiveDate: revisionInput.effectiveDate || null,
    currentDistribution: normalizeDistributionTargeting(revisionInput.distribution ?? manual.distribution)
  };

  if (manual.status !== MANUAL_STATUSES.ARCHIVED) {
    updates.status = MANUAL_STATUSES.PUBLISHED;
  }

  if (isEffectiveOn(revisionInput.effectiveDate)) {
    updates.effectiveRevisionId = revisionId;
    updates.effectiveDate = revisionInput.effectiveDate || null;
    updates.distribution = normalizeDistributionTargeting(revisionInput.distribution ?? manual.distribution);
    // Denormalised pointer so Android can read the effective file from the
    // master record without an extra revision read.
    if (revisionInput.uploaded) {
      updates.documentUri = revisionInput.uploaded.documentUri;
      updates.storagePath = revisionInput.uploaded.storagePath;
      updates.fileName = revisionInput.uploaded.fileName;
      updates.size = revisionInput.uploaded.size;
      updates.contentType = revisionInput.uploaded.contentType;
      updates.pdfChecksum = revisionInput.uploaded.sha256;
      updates.checksumVerified = revisionInput.uploaded.checksumVerified;
    }
  }

  await updateCompanyModuleDoc(companyId, 'manuals', manualId, updates);
}

async function writeRevision(companyId, manualId, revisionInput, { publish, actorUid }) {
  const parentManual = await getManual(companyId, manualId);
  if (!parentManual) throw new Error('Manual record not found.');
  const revisionNumber = validateRevisionNumber(revisionInput.revisionNumber);
  const resolvedDistribution = await validateDistributionTargeting(companyId, revisionInput.distribution);
  const createdRef = await addDoc(collection(revisionsPath(companyId, manualId)), {
    manualId,
    revisionNumber,
    issueNumber: revisionInput.issueNumber ?? null,
    issueDate: revisionInput.issueDate || null,
    effectiveDate: revisionInput.effectiveDate || null,
    reason: revisionInput.reason || null,
    affectedChapters: revisionInput.affectedChapters || null,
    affectedPages: revisionInput.affectedPages || null,
    preparedBy: revisionInput.preparedBy || null,
    reviewedBy: revisionInput.reviewedBy || null,
    approvedBy: revisionInput.approvedBy || null,
    regulatoryApprovalStatus: revisionInput.regulatoryApprovalStatus || null,
    approvalReference: revisionInput.approvalReference || null,
    approvalDate: revisionInput.approvalDate || null,
    distribution: resolvedDistribution.distribution,
    distributionVersion: 1,
    acknowledgementRequired: parentManual.acknowledgementRequired === true,
    status: publish ? REVISION_STATUSES.PUBLISHED : REVISION_STATUSES.DRAFT,
    createdBy: actorUid || null,
    publishedAt: publish ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });

  let uploaded = null;
  try {
    if (revisionInput.file) {
      uploaded = await uploadManualRevision({
        companyId,
        manualId,
        revisionId: createdRef.id,
        file: revisionInput.file
      });
      await updateDoc(revisionRef(companyId, manualId, createdRef.id), {
        fileName: uploaded.fileName,
        size: uploaded.size,
        contentType: uploaded.contentType,
        storagePath: uploaded.storagePath,
        documentUri: uploaded.documentUri,
        sha256: uploaded.sha256,
        checksumVerified: uploaded.checksumVerified,
        lastModified: serverTimestamp()
      });
    } else if (!revisionInput.allowFileless) {
      throw new Error('A file is required for this revision.');
    }

    if (publish) {
      await applyPublicationPointers(companyId, manualId, createdRef.id, { ...revisionInput, uploaded });
    }
  } catch (error) {
    const cleanupErrors = [];
    if (uploaded?.storagePath) {
      try {
        await deleteCompanyManualFile(uploaded.storagePath);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await deleteDoc(revisionRef(companyId, manualId, createdRef.id));
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length) {
      console.error('Revision cleanup failed:', cleanupErrors);
      throw new Error(
        `${error.message || error} Revision cleanup was incomplete: ${cleanupErrors.map((item) => item.message || item).join('; ')}`
      );
    }
    throw error;
  }

  let acknowledgementWarning = null;
  if (publish) {
    if (parentManual.acknowledgementRequired) {
      try {
        await createAcknowledgementRequirements(companyId, manualId, createdRef.id, 'permanent');
      } catch (error) {
        acknowledgementWarning = `Revision was published, but acknowledgement requirement generation did not complete: ${error.message || error}`;
      }
    } else {
      await updateDoc(revisionRef(companyId, manualId, createdRef.id), {
        acknowledgementGeneration: { status: 'not_required', total: 0, acknowledged: 0, pending: 0 },
        lastModified: serverTimestamp()
      });
    }
  }
  return { revisionId: createdRef.id, uploaded, acknowledgementWarning };
}

/* Creates a master record. When a file is supplied it is stored as an
   immutable first revision under the revision path (never the legacy path). */
export async function createManual(companyId, fields, { file = null, action = 'draft', actorUid = null } = {}) {
  const title = `${fields.title || ''}`.trim();
  if (!title) throw new Error('Manual title is required.');
  const revisionNumber = validateRevisionNumber(fields.revisionNumber);
  const resolvedDistribution = await validateDistributionTargeting(companyId, fields.distribution);
  if (action === 'publish' && !file) {
    throw new Error('A PDF file is required to publish a new manual.');
  }

  const status =
    action === 'review'
      ? MANUAL_STATUSES.IN_REVIEW
      : action === 'publish'
        ? MANUAL_STATUSES.PUBLISHED
        : MANUAL_STATUSES.DRAFT;

  const created = await addCompanyModuleDoc(companyId, 'manuals', {
    ...masterFieldsFromInput({ ...fields, title, distribution: resolvedDistribution.distribution }),
    status,
    uploadedBy: actorUid
  });

  if (!file) return { manualId: created.id, revisionId: null };

  try {
    const { revisionId, acknowledgementWarning } = await writeRevision(
      companyId,
      created.id,
      {
        revisionNumber: revisionNumber || 1,
        issueNumber: fields.issueNumber || null,
        issueDate: fields.issueDate || null,
        effectiveDate: fields.effectiveDate || null,
        distribution: fields.distribution,
        reason: 'Initial issue',
        preparedBy: fields.preparedBy || null,
        reviewedBy: fields.reviewedBy || null,
        approvedBy: fields.approvedBy || null,
        regulatoryApprovalStatus: fields.regulatoryApprovalStatus || null,
        approvalReference: fields.approvalReference || null,
        approvalDate: fields.approvalDate || null,
        file
      },
      { publish: action === 'publish', actorUid }
    );
    return { manualId: created.id, revisionId, acknowledgementWarning };
  } catch (error) {
    try {
      await deleteCompanyModuleDoc(companyId, 'manuals', created.id);
    } catch (cleanupError) {
      console.warn('Manual cleanup failed:', cleanupError);
    }
    throw error;
  }
}

export async function uploadRevision(companyId, manualId, revisionInput, { publish = false, actorUid = null } = {}) {
  if (!revisionInput?.file) throw new Error('Choose a file to upload for this revision.');
  const nextNumber = validateRevisionNumber(revisionInput.revisionNumber) || suggestNextRevisionNumber([]);
  return writeRevision(
    companyId,
    manualId,
    { ...revisionInput, revisionNumber: nextNumber, allowFileless: false },
    { publish, actorUid }
  );
}

export async function updateManualMetadata(companyId, manualId, fields) {
  const title = `${fields.title || ''}`.trim();
  if (!title) throw new Error('Manual title is required.');
  if (fields.distribution) await validateDistributionTargeting(companyId, fields.distribution);
  const manual = await getManual(companyId, manualId);
  if (!manual) throw new Error('Manual not found.');
  const updates = masterFieldsFromInput({ ...fields, title });
  if (fields.distribution && manual.currentRevisionId) {
    updates.currentDistribution = normalizeDistributionTargeting(fields.distribution);
  }
  await updateCompanyModuleDoc(companyId, 'manuals', manualId, updates);
}

export async function updateManualDistributionTargeting(companyId, manualId, distribution) {
  const resolved = await validateDistributionTargeting(companyId, distribution);
  const manual = await getManual(companyId, manualId);
  if (!manual) throw new Error('Manual not found.');
  await updateCompanyModuleDoc(companyId, 'manuals', manualId, {
    distribution: resolved.distribution,
    ...(manual.currentRevisionId ? { currentDistribution: resolved.distribution } : {})
  });
  return resolved;
}

export async function archiveManual(companyId, manualId) {
  await updateCompanyModuleDoc(companyId, 'manuals', manualId, {
    status: MANUAL_STATUSES.ARCHIVED,
    archivedAt: serverTimestamp()
  });
}

export async function unarchiveManual(companyId, manualId) {
  await updateCompanyModuleDoc(companyId, 'manuals', manualId, {
    status: MANUAL_STATUSES.PUBLISHED,
    archivedAt: null
  });
}

/* Permanent deletion is restricted to draft manuals: every revision file and
   record is removed, then the master record. Published manuals are archived. */
export async function deleteDraftManual(companyId, manualId) {
  const manual = await getManual(companyId, manualId);
  if (!manual) throw new Error('Manual not found.');
  if (manual.status !== MANUAL_STATUSES.DRAFT) {
    throw new Error('Only draft manuals can be permanently deleted. Archive published manuals instead.');
  }

  const revisions = await listRevisions(companyId, manualId);
  const results = await Promise.allSettled(
    revisions.map(async (revision) => {
      if (revision.storagePath) await deleteCompanyManualFile(revision.storagePath);
      await deleteDoc(revisionRef(companyId, manualId, revision.id));
    })
  );
  const firstFailure = results.find((result) => result.status === 'rejected');
  if (firstFailure) {
    throw new Error(`Draft cleanup failed: ${firstFailure.reason?.message || firstFailure.reason}`);
  }

  // Legacy V0.4.13 draft files (status 'uploading') live at the flat path.
  if (manual.storagePath) {
    try {
      await deleteCompanyManualFile(manual.storagePath);
    } catch (error) {
      console.warn('Legacy draft file cleanup failed:', error);
    }
  }

  await deleteCompanyModuleDoc(companyId, 'manuals', manualId);
}

/* Resolves the document a user should see: the effective revision when one
   exists, otherwise the current revision, otherwise the legacy flat file. */
export async function resolveViewableDocument(companyId, manual, { allowFuture = false } = {}) {
  if (manual.currentRevisionId) {
    const currentRevision = await getRevision(companyId, manual.id, manual.currentRevisionId);
    if (currentRevision?.documentUri && isEffectiveOn(currentRevision.effectiveDate)) {
      return { uri: currentRevision.documentUri, revision: currentRevision };
    }
    if (allowFuture && currentRevision?.documentUri) {
      return { uri: currentRevision.documentUri, revision: currentRevision, futureEffective: true };
    }
  }
  if (manual.effectiveRevisionId) {
    const revision = await getRevision(companyId, manual.id, manual.effectiveRevisionId);
    if (revision?.documentUri) return { uri: revision.documentUri, revision };
  }
  if (manual.documentUri) return { uri: manual.documentUri, revision: null };
  return { uri: null, revision: null };
}

export async function getRevision(companyId, manualId, revisionId) {
  if (!revisionId) return null;
  const snapshot = await getDoc(revisionRef(companyId, manualId, revisionId));
  return snapshot.exists() ? normalizeRevision(snapshot.data(), snapshot.id) : null;
}

export {
  createAcknowledgementRequirements,
  getMyAcknowledgements,
  acknowledgeManualRevision,
  getManualAcknowledgementSummary,
  getRevisionAcknowledgementRecipients,
  redistributeManualRevision
} from './manualAcknowledgementService.js';
