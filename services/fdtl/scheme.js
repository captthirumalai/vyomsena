import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, serverTimestamp } from '../firestoreService.js';

const SCHEME_COLLECTION = 'fdtl_scheme';
const SCHEME_HISTORY_COLLECTION = 'fdtl_scheme_history';
const CURRENT_SCHEME_ID = 'current';
const DRAFT_SCHEME_ID = 'draft';

export const CAR_SOURCE = 'DGCA CAR Section 7, Series J, Part IV, Rev 1 (19 January 2023)';

export const DEFAULT_FDTL_SCHEME = {
  schemeName: 'Operator FDTL Scheme',
  schemeVersion: 'Rev 1',
  source: CAR_SOURCE,
  operationsType: 'private_aerial_non_turbojet_below_5700',
  guidance:
    'CAR serves as guidelines for Private/Aerial operators of non-turbojet aeroplanes below 5700 kg AUW. ' +
    'The operator prepares its own FDTL Scheme based on the type and size of operation, includes it in the ' +
    'Operations Manual, and submits it to DGCA for approval.',
  approval: {
    status: 'draft',
    approvedDate: null,
    opsManualRef: null,
    approvedBy: null
  },
  fdp: {
    twoPilot: [
      { maxFlightTimeMinutes: 480, landings: 6, maxFdpMinutes: 660 },
      { maxFlightTimeMinutes: 480, landings: 5, maxFdpMinutes: 690 },
      { maxFlightTimeMinutes: 480, landings: 4, maxFdpMinutes: 720 },
      { maxFlightTimeMinutes: 480, landings: 3, maxFdpMinutes: 750 },
      { maxFlightTimeMinutes: 600, landings: 1, maxFdpMinutes: 810 },
      { maxFlightTimeMinutes: 600, landings: 2, maxFdpMinutes: 810 }
    ],
    defaultMaxFlightTimeDayMinutes: 480,
    warningThresholdPct: 0.8
  },
  wocl: {
    startHour: 2,
    endHour: 6,
    startEncroachmentReductionPct: 1,
    endOrEncompassReductionPct: 0.5,
    maxStartReductionMinutes: 120
  },
  rest: {
    minimumMinutes: 720,
    ruleLabel: 'At least as long as the preceding duty period OR 12 hours, whichever is greater.',
    timeZoneCrossing3To7Minutes: 1080,
    timeZoneCrossingOver7Minutes: 2160,
    twoLandingProvision: {
      enabled: true,
      increaseMinutes: 360,
      note: 'Minimum rest increased by 6 hours when the preceding duty period utilized the split-duty provision with 2 landings.'
    },
    notes: [
      'CAR Note 2 (layover-station acclimatization when proceeding to farther time zones after a 3–7 zone crossing) is NOT implemented. Time-zone rest is applied from the reported crossing only.'
    ],
    weekly: {
      minimumMinutes: 2160,
      localNights: 2,
      maxSpanHours: 168,
      nightDutyTriggerCount: 3,
      extendedMinimumMinutes: 2880
    }
  },
  timeZoneCrossing: {
    zone3To7Minutes: 1080,
    over7Minutes: 2160
  },
  acclimatisation: {
    defaultIsAcclimatised: true,
    nightWindowStartHour: 2,
    nightWindowEndHour: 6,
    unacclimatisedReductionPct: 0.5
  },
  operationalAdjustments: {
    reportingTimeMinutes: 30,
    postFlightAllowanceMinutes: 60,
    localNightStartHour: 22,
    localNightEndHour: 6,
    transportationMinutes: 45
  },
  nightDuty: {
    startHour: 0,
    endHour: 5,
    maxConsecutiveNights: 2,
    exceptionOncePerHours: 168
  },
  cumulative: {
    7: { flightTimeMinutes: 2100, dutyMinutes: 3600 },
    14: { flightTimeMinutes: 3900, dutyMinutes: 6000 },
    28: { flightTimeMinutes: 6000, dutyMinutes: 11400 },
    90: { flightTimeMinutes: 18000, dutyMinutes: 36000 },
    365: { flightTimeMinutes: 60000, dutyMinutes: 108000 }
  },
  splitDuty: {
    breakLessThanMinutes: 180,
    breakGreaterThanMinutes: 600,
    extensionFactor: 0.5
  },
  standby: {
    enabled: false,
    appliesToLabel: 'Schedule / commuter operations only',
    homeCountPct: 0,
    hotelCountPct: 0.5,
    airportCountPct: 1
  },
  unforeseen: {
    maxFlightTimeExtensionMinutes: 90,
    maxFdpExtensionMinutes: 180,
    requiresPICConsent: true,
    requiresHeadOfOpsApproval: true
  },
  records: {
    retentionMonths: 18
  }
};

export function getDefaultScheme() {
  return JSON.parse(JSON.stringify(DEFAULT_FDTL_SCHEME));
}

function schemeDocRef(companyId, id = CURRENT_SCHEME_ID) {
  return doc(`companies/${companyId}/${SCHEME_COLLECTION}`, id);
}

function schemeDraftDocRef(companyId) {
  return schemeDocRef(companyId, DRAFT_SCHEME_ID);
}

function schemeHistoryCollection(companyId) {
  return collection(`companies/${companyId}/${SCHEME_HISTORY_COLLECTION}`);
}

function normalizedApprovalStatus(status, fallback = 'draft') {
  const normalized = `${status || fallback}`.trim().toLowerCase();
  return ['draft', 'approved', 'superseded'].includes(normalized) ? normalized : fallback;
}

export async function getFdtlSchemeVersionHistory(companyId) {
  if (!companyId) return [];
  const snapshot = await getDocs(query(schemeHistoryCollection(companyId), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((item) => ({ versionId: item.id, ...item.data() }));
}

export async function getFdtlScheme(companyId) {
  if (!companyId) return getDefaultScheme();

  const currentSnapshot = await getDoc(schemeDocRef(companyId));
  if (currentSnapshot.exists()) {
    return { ...getDefaultScheme(), ...currentSnapshot.data() };
  }

  const draftSnapshot = await getDoc(schemeDraftDocRef(companyId));
  if (draftSnapshot.exists()) {
    return { ...getDefaultScheme(), ...draftSnapshot.data() };
  }

  return getDefaultScheme();
}

export async function getFdtlSchemeDraft(companyId) {
  if (!companyId) return getDefaultScheme();
  const snapshot = await getDoc(schemeDraftDocRef(companyId));
  if (!snapshot.exists()) return getDefaultScheme();
  return { ...getDefaultScheme(), ...snapshot.data() };
}

export async function saveFdtlSchemeDraft(companyId, scheme, options = {}) {
  return saveFdtlScheme(companyId, scheme, { ...options, mode: 'draft' });
}

export async function approveFdtlScheme(companyId, scheme, options = {}) {
  return saveFdtlScheme(companyId, scheme, { ...options, mode: 'approve' });
}

export async function saveFdtlScheme(companyId, scheme, options = {}) {
  if (!companyId) {
    throw new Error('companyId is required to save the FDTL scheme.');
  }

  const merged = {
    ...getDefaultScheme(),
    ...(scheme || {}),
    approval: {
      ...(getDefaultScheme().approval || {}),
      ...(scheme?.approval || {})
    },
    operationalAdjustments: {
      ...(getDefaultScheme().operationalAdjustments || {}),
      ...(scheme?.operationalAdjustments || {})
    },
    updatedAt: serverTimestamp()
  };

  const requestedStatus = normalizedApprovalStatus(merged.approval?.status, 'draft');
  const mode = `${options.mode || 'draft'}`.trim().toLowerCase();
  const effectiveStatus = mode === 'approve' ? 'approved' : requestedStatus;

  const currentSnapshot = await getDoc(schemeDocRef(companyId));
  const currentScheme = currentSnapshot.exists() ? currentSnapshot.data() : null;
  const currentStatus = normalizedApprovalStatus(currentScheme?.approval?.status, 'draft');
  const hasApprovedCurrent = currentStatus === 'approved';
  const targetRef = mode === 'approve' || !hasApprovedCurrent ? schemeDocRef(companyId) : schemeDraftDocRef(companyId);
  const nextVersionName = options.versionName || merged.schemeVersion || currentScheme?.schemeVersion || 'Rev 1';

  const historyRecord = {
    ...merged,
    companyId,
    approval: {
      ...merged.approval,
      status: effectiveStatus
    },
    versionName: nextVersionName,
    versionStatus: effectiveStatus,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp(),
    reason: options.reason || null,
    editedBy: options.actor?.name || options.actor?.email || options.actor?.uid || null
  };

  if (options.trackHistory !== false) {
    await addDoc(schemeHistoryCollection(companyId), historyRecord);
  }

  const persisted = {
    ...merged,
    companyId,
    approval: {
      ...merged.approval,
      status: effectiveStatus
    },
    versionName: nextVersionName,
    versionStatus: effectiveStatus,
    lastModified: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (mode === 'approve') {
    await setDoc(schemeDocRef(companyId), persisted);
    if (currentSnapshot.exists()) {
      await setDoc(schemeDraftDocRef(companyId), {
        ...persisted,
        approval: {
          ...persisted.approval,
          status: 'draft'
        },
        versionStatus: 'draft',
        lastModified: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    return persisted;
  }

  if (hasApprovedCurrent) {
    await setDoc(schemeDraftDocRef(companyId), persisted);
    return { ...persisted, source: 'draft' };
  }

  await setDoc(schemeDocRef(companyId), persisted);
  return persisted;
}

export function onFdtlSchemeSnapshot(companyId, onNext, onError) {
  if (!companyId) {
    onNext?.(getDefaultScheme());
    return () => {};
  }

  const currentUnsubscribe = onSnapshot(
    schemeDocRef(companyId),
    async (snapshot) => {
      const approvedScheme = snapshot.exists() ? { ...getDefaultScheme(), ...snapshot.data() } : getDefaultScheme();
      const draftSnapshot = await getDoc(schemeDraftDocRef(companyId));
      const draftScheme = draftSnapshot.exists() ? { ...getDefaultScheme(), ...draftSnapshot.data() } : null;

      if (approvedScheme?.approval?.status === 'approved') {
        onNext(approvedScheme);
        return;
      }

      onNext(draftScheme || approvedScheme || getDefaultScheme());
    },
    onError
  );

  return () => currentUnsubscribe();
}
