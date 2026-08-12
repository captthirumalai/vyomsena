import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from '../firestoreService.js';

const SCHEME_COLLECTION = 'fdtl_scheme';
const CURRENT_SCHEME_ID = 'current';

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
    singlePilot: [
      { maxFlightTimeMinutes: 420, maxFdpMinutes: 510, maxLandings: 8 },
      { maxFlightTimeMinutes: 480, landings: 6, maxFdpMinutes: 570 },
      { maxFlightTimeMinutes: 480, landings: 4, maxFdpMinutes: 660 }
    ],
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
    weekly: {
      minimumMinutes: 2160,
      localNights: 2,
      maxSpanHours: 168,
      nightDutyTriggerCount: 3,
      extendedMinimumMinutes: 2880
    }
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

function schemeDocRef(companyId) {
  return doc(`companies/${companyId}/${SCHEME_COLLECTION}`, CURRENT_SCHEME_ID);
}

export async function getFdtlScheme(companyId) {
  if (!companyId) return getDefaultScheme();
  const snapshot = await getDoc(schemeDocRef(companyId));
  if (!snapshot.exists()) return getDefaultScheme();
  return { ...getDefaultScheme(), ...snapshot.data() };
}

export async function saveFdtlScheme(companyId, scheme) {
  if (!companyId) {
    throw new Error('companyId is required to save the FDTL scheme.');
  }
  const merged = {
    ...getDefaultScheme(),
    ...(scheme || {}),
    updatedAt: serverTimestamp()
  };
  await setDoc(schemeDocRef(companyId), {
    ...merged,
    companyId,
    lastModified: serverTimestamp()
  });
  return merged;
}

export function onFdtlSchemeSnapshot(companyId, onNext, onError) {
  if (!companyId) {
    onNext?.(getDefaultScheme());
    return () => {};
  }
  return onSnapshot(
    schemeDocRef(companyId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onNext(getDefaultScheme());
        return;
      }
      onNext({ ...getDefaultScheme(), ...snapshot.data() });
    },
    onError
  );
}
