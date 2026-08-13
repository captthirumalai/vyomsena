import {
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from './firestoreService.js';
import {
  companyModuleCollection,
  listCompanyModuleDocs,
  getCompanyModuleDoc,
  setCompanyModuleDoc,
  updateCompanyModuleDoc,
  deleteCompanyModuleDoc
} from './companyService.js';
import { buildAuditEntry, writeAuditEntry } from './fdtl/audit.js';
import { parseDate, diffMinutes } from './fdtl/timeUtils.js';

const FLIGHTS_COLLECTION = 'flights';

export const FLIGHT_STATUSES = {
  PLANNED: 'planned',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const FLIGHT_SOURCES = {
  DISPATCH: 'dispatch',
  EFB: 'efb',
  MANUAL: 'manual',
  DISPATCH_EFB: 'dispatch+efb'
};

export const RECONCILIATION_STATUSES = {
  CONSISTENT: 'consistent',
  MISMATCH: 'mismatch',
  NO_DATA: 'no_data'
};

const RECONCILABLE_FIELDS = ['chocksOff', 'chocksOn', 'takeoff', 'landing'];

const RECONCILIATION_TOLERANCE_MINUTES = 5;

function toMillis(value) {
  const date = parseDate(value);
  return date ? date.getTime() : null;
}

export function reconcileFlight(flight) {
  const fops = flight?.fops || {};
  const efb = flight?.efb || {};
  const source = flight?.source || null;

  const mismatches = RECONCILABLE_FIELDS.filter((field) => {
    const fopsMillis = toMillis(fops[field]);
    const efbMillis = toMillis(efb[field]);
    if (fopsMillis == null || efbMillis == null) return false;
    return Math.abs(fopsMillis - efbMillis) / 60000 > RECONCILIATION_TOLERANCE_MINUTES;
  }).map((field) => ({
    field,
    fops: fops[field] || null,
    efb: efb[field] || null
  }));

  const hasFopsData = RECONCILABLE_FIELDS.some((field) => toMillis(fops[field]) != null);
  const hasEfbData = RECONCILABLE_FIELDS.some((field) => toMillis(efb[field]) != null);

  let status = RECONCILIATION_STATUSES.NO_DATA;
  if (mismatches.length > 0) {
    status = RECONCILIATION_STATUSES.MISMATCH;
  } else if (hasFopsData || hasEfbData) {
    status = RECONCILIATION_STATUSES.CONSISTENT;
  }

  return {
    status,
    mismatches,
    source,
    fops,
    efb,
    reconciledAt: new Date().toISOString()
  };
}

export function resolveActualTimes(flight) {
  const fops = flight?.fops || {};
  const efb = flight?.efb || {};
  const reconciliation = reconcileFlight(flight);

  const pick = (field) => {
    const efbValue = efb[field];
    const fopsValue = fops[field];
    if (efbValue) return efbValue;
    if (fopsValue) return fopsValue;
    return flight?.[field] || null;
  };

  return {
    chocksOff: pick('chocksOff'),
    chocksOn: pick('chocksOn'),
    takeoff: pick('takeoff'),
    landing: pick('landing'),
    reconciliation
  };
}

export function computeBlockTimeMinutes(flight) {
  const { chocksOff, chocksOn } = resolveActualTimes(flight);
  const start = parseDate(chocksOff);
  const end = parseDate(chocksOn);
  if (!start || !end) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export async function listFlights(companyId, { status = null, crewProfileId = null } = {}) {
  if (!companyId) return [];
  const ref = companyModuleCollection(companyId, FLIGHTS_COLLECTION);
  const constraints = [];
  if (status) constraints.push(where('status', '==', status));
  if (crewProfileId) constraints.push(where('crewProfileIds', 'array-contains', crewProfileId));
  const source = query(ref, ...constraints, orderBy('flightDate', 'desc'));
  const snapshot = await getDocs(source);
  return snapshot.docs.map((item) => ({ flightId: item.id, ...item.data() }));
}

export function onFlightsSnapshot(companyId, onNext, onError) {
  if (!companyId) {
    onNext?.([]);
    return () => {};
  }
  const ref = companyModuleCollection(companyId, FLIGHTS_COLLECTION);
  const source = query(ref, orderBy('flightDate', 'desc'));
  return onSnapshot(
    source,
    (snapshot) => {
      onNext(snapshot.docs.map((item) => ({ flightId: item.id, ...item.data() })));
    },
    onError
  );
}

export async function getFlight(companyId, flightId) {
  if (!companyId || !flightId) return null;
  const existing = await getCompanyModuleDoc(companyId, FLIGHTS_COLLECTION, flightId);
  return existing ? { flightId: existing.id, ...existing } : null;
}

export function normalizeFlightInput(data, actor) {
  const p1 = data.p1 || {};
  const p2 = data.p2 || {};
  const crewProfileIds = [p1.crewProfileId, p2.crewProfileId].filter(Boolean);

  const payload = {
    flightNumber: data.flightNumber || null,
    aircraftReg: data.aircraftReg || data.registration || null,
    departure: data.departure || null,
    destination: data.destination || null,
    route: data.route || null,
    flightDate: data.flightDate || null,
    status: data.status || FLIGHT_STATUSES.PLANNED,
    source: data.source || FLIGHT_SOURCES.DISPATCH,
    p1: p1.crewProfileId ? { crewProfileId: p1.crewProfileId, name: p1.name || null } : null,
    p2: p2.crewProfileId ? { crewProfileId: p2.crewProfileId, name: p2.name || null } : null,
    crewProfileIds,
    plannedDeparture: data.plannedDeparture || null,
    plannedArrival: data.plannedArrival || null,
    chocksOff: data.chocksOff || null,
    chocksOn: data.chocksOn || null,
    takeoff: data.takeoff || null,
    landing: data.landing || null,
    irTimeMinutes: Number(data.irTimeMinutes) || 0,
    xcTimeMinutes: Number(data.xcTimeMinutes) || 0,
    distanceNM: Number(data.distanceNM) || 0,
    operationType: data.operationType || 'commercial',
    remarks: data.remarks || null,
    fops: data.fops || null,
    efb: data.efb || null,
    createdBy: actor?.name || actor?.email || actor?.uid || 'Unknown',
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  payload.reconciliation = reconcileFlight(payload);
  return payload;
}

export async function addFlight(companyId, data, actor, reason = 'Flight record added') {
  if (!companyId) {
    throw new Error('companyId is required to add a flight.');
  }
  const payload = normalizeFlightInput(data, actor);
  const created = await addDoc(companyModuleCollection(companyId, FLIGHTS_COLLECTION), payload);
  await writeAuditEntry(
    companyId,
    buildAuditEntry({
      actor,
      entityType: 'flight',
      entityId: created.id,
      field: 'create',
      after: payload,
      reason,
      source: 'flight'
    })
  );
  return { flightId: created.id, ...payload };
}

export async function updateFlight(companyId, flightId, updates, actor, reason = 'Flight record updated') {
  if (!companyId || !flightId) {
    throw new Error('companyId and flightId are required to update a flight.');
  }
  const ref = doc(`companies/${companyId}/${FLIGHTS_COLLECTION}`, flightId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return null;

  const before = snapshot.data();
  const changed = { ...updates };

  if (updates.fops || updates.efb || updates.source || updates.chocksOff || updates.chocksOn || updates.takeoff || updates.landing) {
    const merged = {
      ...before,
      ...changed,
      fops: changed.fops || before.fops,
      efb: changed.efb || before.efb
    };
    changed.reconciliation = reconcileFlight(merged);
  }

  if (updates.p1 || updates.p2) {
    const nextP1 = updates.p1 || before.p1 || {};
    const nextP2 = updates.p2 || before.p2 || {};
    changed.crewProfileIds = [nextP1.crewProfileId, nextP2.crewProfileId].filter(Boolean);
  }

  await updateDoc(ref, { ...changed, lastModified: serverTimestamp() });

  const changedKeys = Object.keys(changed);
  const diffEntries = changedKeys
    .filter((key) => key !== 'lastModified' && key !== 'reconciliation')
    .map((key) => ({
      field: key,
      before: before[key] ?? null,
      after: changed[key] ?? null
    }));

  await Promise.all(
    diffEntries.map((entry) =>
      writeAuditEntry(
        companyId,
        buildAuditEntry({
          actor,
          entityType: 'flight',
          entityId: flightId,
          field: entry.field,
          before: entry.before,
          after: entry.after,
          reason,
          source: 'flight'
        })
      )
    )
  );

  return { flightId, ...before, ...changed };
}

export async function recordEfbActuals(companyId, flightId, actuals, actor, reason = 'EFB actuals recorded') {
  if (!companyId || !flightId) {
    throw new Error('companyId and flightId are required to record EFB actuals.');
  }
  const efbPayload = {
    chocksOff: actuals.chocksOff || null,
    chocksOn: actuals.chocksOn || null,
    takeoff: actuals.takeoff || null,
    landing: actuals.landing || null
  };
  return updateFlight(
    companyId,
    flightId,
    {
      efb: efbPayload,
      chocksOff: actuals.chocksOff || undefined,
      chocksOn: actuals.chocksOn || undefined,
      takeoff: actuals.takeoff || undefined,
      landing: actuals.landing || undefined,
      irTimeMinutes: Number(actuals.irTimeMinutes) || 0,
      xcTimeMinutes: Number(actuals.xcTimeMinutes) || 0,
      status: FLIGHT_STATUSES.COMPLETED,
      source: actuals.source || FLIGHT_SOURCES.EFB
    },
    actor,
    reason
  );
}

export async function deleteFlight(companyId, flightId, actor, reason = 'Flight record deleted') {
  if (!companyId || !flightId) {
    throw new Error('companyId and flightId are required to delete a flight.');
  }
  const ref = doc(`companies/${companyId}/${FLIGHTS_COLLECTION}`, flightId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return null;
  const before = snapshot.data();
  await deleteDoc(ref);
  await writeAuditEntry(
    companyId,
    buildAuditEntry({
      actor,
      entityType: 'flight',
      entityId: flightId,
      field: 'delete',
      before,
      reason,
      source: 'flight'
    })
  );
  return { flightId, ...before };
}

export function flightsToDutyRecords(scheme, flights) {
  const reportingMinutes = Number(scheme.operationalAdjustments?.reportingTimeMinutes ?? 0);
  const postFlightAllowanceMinutes = Number(scheme.operationalAdjustments?.postFlightAllowanceMinutes ?? 0);

  const completed = (flights || [])
    .filter((flight) => flight.status === FLIGHT_STATUSES.COMPLETED)
    .filter((flight) => flight.p1?.crewProfileId);

  const byCrew = new Map();
  completed.forEach((flight) => {
    const crewId = flight.p1.crewProfileId;
    if (!byCrew.has(crewId)) byCrew.set(crewId, []);
    byCrew.get(crewId).push(flight);
  });

  const records = [];
  byCrew.forEach((crewFlights, crewId) => {
    const sorted = crewFlights.slice().sort((left, right) => {
      const leftDate = parseDate(left.flightDate)?.getTime() ?? 0;
      const rightDate = parseDate(right.flightDate)?.getTime() ?? 0;
      return leftDate - rightDate;
    });

    sorted.forEach((flight) => {
      const { takeoff, landing, chocksOff, chocksOn } = resolveActualTimes(flight);
      const blockTime = computeBlockTimeMinutes(flight);
      const fdpStart = parseDate(takeoff);
      const fdpEnd = parseDate(landing);
      const chocksOnDate = parseDate(chocksOn);
      const reportDate = parseDate(chocksOff);

      records.push({
        crewProfileId: crewId,
        crewName: flight.p1?.name || null,
        operationType: flight.operationType || 'commercial',
        operationCrew: 'two',
        dutyDate: flight.flightDate,
        reportTime: reportDate ? reportDate.toISOString() : null,
        dutyStart: reportDate ? reportDate.toISOString() : null,
        dutyEnd: chocksOnDate
          ? new Date(chocksOnDate.getTime() + postFlightAllowanceMinutes * 60000).toISOString()
          : null,
        fdpStart: fdpStart ? fdpStart.toISOString() : null,
        fdpEnd: fdpEnd ? fdpEnd.toISOString() : null,
        flightTimeMinutes: blockTime ?? flight.flightTimeMinutes ?? 0,
        landings: 1,
        sector: flight.route || `${flight.departure || ''}-${flight.destination || ''}`,
        flightId: flight.flightId,
        source: 'flight',
        flightNumber: flight.flightNumber || null
      });
    });
  });

  return records;
}

export async function listCompanyFlights(companyId) {
  if (!companyId) return [];
  const docs = await listCompanyModuleDocs(companyId, FLIGHTS_COLLECTION);
  return docs.map((item) => ({ flightId: item.id, ...item }));
}

export function onCompanyFlightsSnapshot(companyId, onNext, onError) {
  return onFlightsSnapshot(companyId, onNext, onError);
}

export async function getCompanyFlight(companyId, flightId) {
  return getFlight(companyId, flightId);
}
