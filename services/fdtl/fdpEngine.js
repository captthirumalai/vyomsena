export const OPERATION_CREW = {
  SINGLE: 'single',
  TWO: 'two'
};

export const VERDICTS = {
  WITHIN: 'within',
  ATTENTION: 'attention',
  EXCEEDED: 'exceeded'
};

export const VERDICT_LABELS = {
  within: 'Within Limits',
  attention: 'Attention',
  exceeded: 'Exceeded'
};

export function formatDurationMinutes(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

function pickTable(scheme, operationCrew) {
  const fdp = scheme.fdp || {};
  return operationCrew === OPERATION_CREW.SINGLE ? fdp.singlePilot : fdp.twoPilot;
}

export function resolveFdpBaseLimit(scheme, { operationCrew, flightTimeMinutes, landings }) {
  const table = pickTable(scheme, operationCrew);
  if (!Array.isArray(table) || table.length === 0) return null;

  const plannedFlightTime = Number(flightTimeMinutes) || 0;
  const plannedLandings = Number(landings) || 0;

  const covering = table.filter((row) => row.maxFlightTimeMinutes >= plannedFlightTime);
  if (covering.length === 0) return null;

  const minCoveringFlightTime = Math.min(...covering.map((row) => row.maxFlightTimeMinutes));
  const tier = covering.filter((row) => row.maxFlightTimeMinutes === minCoveringFlightTime);

  const landingLimit = (row) => row.landings ?? row.maxLandings;
  const exact = tier.find((row) => landingLimit(row) === plannedLandings);
  if (exact) return exact.maxFdpMinutes;

  const sufficient = tier.filter((row) => landingLimit(row) >= plannedLandings);
  if (sufficient.length === 0) return null;

  return sufficient.reduce(
    (minimum, row) => Math.min(minimum, row.maxFdpMinutes),
    Number.POSITIVE_INFINITY
  );
}

export function resolveMaxLandings(scheme, { operationCrew, flightTimeMinutes }) {
  const table = pickTable(scheme, operationCrew);
  if (!Array.isArray(table) || table.length === 0) return null;
  const plannedFlightTime = Number(flightTimeMinutes) || 0;
  const covering = table.filter((row) => row.maxFlightTimeMinutes >= plannedFlightTime);
  if (covering.length === 0) return null;
  const minCoveringFlightTime = Math.min(...covering.map((row) => row.maxFlightTimeMinutes));
  const tier = covering.filter((row) => row.maxFlightTimeMinutes === minCoveringFlightTime);
  return Math.max(...tier.map((row) => row.landings ?? row.maxLandings ?? 0));
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const converted = value.toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffMinutes(start, end) {
  if (!start || !end) return 0;
  const diff = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diff / 60000));
}

function isWithinNightWindow(date, startHour, endHour) {
  const parsed = parseDate(date);
  if (!parsed) return false;
  const hour = parsed.getHours();
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

function asYmd(date) {
  const parsed = parseDate(date);
  if (!parsed) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRecordInterval(record) {
  const start = parseDate(record?.dutyStart || record?.fdpStart || record?.reportTime);
  const end = parseDate(record?.dutyEnd || record?.fdpEnd || record?.reportTime);
  if (!start || !end) return null;
  return { start, end };
}

function getNightWindowForDate(date, startHour, endHour) {
  const base = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  const start = new Date(base);
  start.setUTCHours(startHour, 0, 0, 0);

  const end = new Date(base);
  end.setUTCHours(endHour, 0, 0, 0);

  if (startHour <= endHour) {
    return { start, end };
  }

  const nextDay = new Date(base);
  nextDay.setUTCDate(base.getUTCDate() + 1);
  return { start, end: new Date(nextDay.getTime() + endHour * 60 * 60 * 1000) };
}

function intervalOverlapMinutes(startA, endA, startB, endB) {
  const overlapStart = new Date(Math.max(startA.getTime(), startB.getTime()));
  const overlapEnd = new Date(Math.min(endA.getTime(), endB.getTime()));
  if (overlapEnd <= overlapStart) return 0;
  return Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000));
}

function countLocalNightsInRange(startTime, endTime, localNightStartHour, localNightEndHour) {
  const rangeStart = parseDate(startTime) || new Date();
  const rangeEnd = parseDate(endTime) || new Date();
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) return 0;

  const startDate = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate()));
  const endDate = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate()));
  let count = 0;

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const window = getNightWindowForDate(cursor, localNightStartHour, localNightEndHour);
    const overlapStart = new Date(Math.max(rangeStart.getTime(), window.start.getTime()));
    const overlapEnd = new Date(Math.min(rangeEnd.getTime(), window.end.getTime()));
    if (overlapEnd > overlapStart) count += 1;
  }

  return count;
}

function collectNightDutyDates(record, localNightStartHour, localNightEndHour, regulatedStartHour, regulatedEndHour) {
  const interval = getRecordInterval(record);
  if (!interval) return [];

  const dates = new Set();
  const startDate = new Date(Date.UTC(interval.start.getUTCFullYear(), interval.start.getUTCMonth(), interval.start.getUTCDate()));
  const endDate = new Date(Date.UTC(interval.end.getUTCFullYear(), interval.end.getUTCMonth(), interval.end.getUTCDate()));

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const localWindow = getNightWindowForDate(cursor, localNightStartHour, localNightEndHour);
    const regulatedWindow = getNightWindowForDate(cursor, regulatedStartHour, regulatedEndHour);
    const localOverlap = intervalOverlapMinutes(interval.start, interval.end, localWindow.start, localWindow.end);
    const regulatedOverlap = intervalOverlapMinutes(interval.start, interval.end, regulatedWindow.start, regulatedWindow.end);
    if (localOverlap > 0 || regulatedOverlap > 0) {
      dates.add(asYmd(cursor));
    }
  }

  return [...dates].filter(Boolean);
}

function getTimeZoneCrossingRequirementMinutes(scheme, record) {
  if (!record) return 0;
  const zoneChange = Number(
    record.timeZoneCrossingHours ??
    record.timeZoneDifferenceHours ??
    record.zoneChangeHours ??
    record.timezoneCrossingHours ??
    0
  );

  const standard3To7 = Number(scheme.rest?.timeZoneCrossing3To7Minutes ?? scheme.timeZoneCrossing?.zone3To7Minutes ?? 1080);
  const standardOver7 = Number(scheme.rest?.timeZoneCrossingOver7Minutes ?? scheme.timeZoneCrossing?.over7Minutes ?? 1440);

  if (zoneChange > 7) {
    return standardOver7;
  }

  if (zoneChange >= 3) {
    return standard3To7;
  }

  return 0;
}

export function computeRestStatus(scheme, { state, records, now = new Date() }) {
  const minimumMinutes = scheme.rest?.minimumMinutes ?? 720;
  const ordered = [...(records || [])].sort((a, b) => {
    const left = parseDate(a.fdpEnd || a.dutyEnd || a.reportTime)?.getTime() ?? 0;
    const right = parseDate(b.fdpEnd || b.dutyEnd || b.reportTime)?.getTime() ?? 0;
    return right - left;
  });

  const latest = ordered[0] || null;
  const lastDutyEndedAt = parseDate(latest?.fdpEnd || latest?.dutyEnd || state?.lastDutyEndedAt);
  const previousDutyPeriodMinutes = latest
    ? Math.max(
        Number(latest.flightTimeMinutes) || 0,
        diffMinutes(parseDate(latest.fdpStart || latest.dutyStart || latest.reportTime), lastDutyEndedAt || parseDate(latest.fdpStart || latest.reportTime))
      )
    : 0;

  const timezoneMinimumMinutes = getTimeZoneCrossingRequirementMinutes(scheme, latest);
  const requiredRestMinutes = Math.max(minimumMinutes, previousDutyPeriodMinutes, timezoneMinimumMinutes);
  const actualRestMinutes = lastDutyEndedAt ? diffMinutes(lastDutyEndedAt, now) : 0;
  const restUntil = lastDutyEndedAt ? new Date(lastDutyEndedAt.getTime() + requiredRestMinutes * 60000) : null;

  return {
    minimumMinutes,
    previousDutyPeriodMinutes,
    timezoneMinimumMinutes,
    requiredRestMinutes,
    actualRestMinutes,
    restUntil,
    ok: !lastDutyEndedAt || actualRestMinutes >= requiredRestMinutes,
    alert: lastDutyEndedAt && actualRestMinutes < requiredRestMinutes
      ? `Rest shortfall ${Math.max(0, requiredRestMinutes - actualRestMinutes)} min`
      : 'Rest within scheme'
  };
}

export function computeNightDutyStatus(scheme, { records = [], now = new Date() }) {
  const startHour = scheme.nightDuty?.startHour ?? 0;
  const endHour = scheme.nightDuty?.endHour ?? 5;
  const localStart = scheme.operationalAdjustments?.localNightStartHour ?? 22;
  const localEnd = scheme.operationalAdjustments?.localNightEndHour ?? 6;

  const uniqueDates = new Set();
  for (const record of records || []) {
    const nightDates = collectNightDutyDates(record, localStart, localEnd, startHour, endHour);
    nightDates.forEach((date) => uniqueDates.add(date));
  }

  const orderedDates = [...uniqueDates].sort();
  let consecutiveNights = 0;
  for (let index = orderedDates.length - 1; index >= 0; index -= 1) {
    const current = new Date(`${orderedDates[index]}T00:00:00`);
    const previous = index === orderedDates.length - 1 ? null : new Date(`${orderedDates[index + 1]}T00:00:00`);
    if (!previous) {
      consecutiveNights += 1;
      continue;
    }
    const diffDays = Math.round((current.getTime() - previous.getTime()) / 86400000);
    if (diffDays === 1) {
      consecutiveNights += 1;
    } else {
      break;
    }
  }

  return {
    localNightCount: orderedDates.length,
    consecutiveNights,
    maxConsecutiveNights: scheme.nightDuty?.maxConsecutiveNights ?? 2,
    ok: consecutiveNights <= (scheme.nightDuty?.maxConsecutiveNights ?? 2),
    alert: consecutiveNights > (scheme.nightDuty?.maxConsecutiveNights ?? 2)
      ? `Night duty exceeds ${scheme.nightDuty?.maxConsecutiveNights ?? 2} consecutive nights`
      : 'Night duty within lane'
  };
}

export function computeCumulativeStatus(scheme, { records = [], now = new Date() }) {
  const periods = Object.entries(scheme.cumulative || {}).map(([days, limit]) => {
    const periodDays = Number(days) || 0;
    const cutoff = now.getTime() - periodDays * 24 * 60 * 60 * 1000;
    const windowRecords = (records || []).filter((record) => {
      const end = parseDate(record.fdpEnd || record.dutyEnd || record.reportTime);
      return end && end.getTime() >= cutoff && end.getTime() <= now.getTime();
    });

    const total = windowRecords.reduce(
      (acc, record) => {
        acc.flightTimeMinutes += Number(record.flightTimeMinutes) || 0;
        const interval = getRecordInterval(record);
        if (interval) {
          acc.dutyMinutes += diffMinutes(interval.start, interval.end);
        }
        return acc;
      },
      { flightTimeMinutes: 0, dutyMinutes: 0 }
    );

    const flightLimit = Number(limit?.flightTimeMinutes) || 0;
    const dutyLimit = Number(limit?.dutyMinutes) || 0;
    const flightExceeded = total.flightTimeMinutes > flightLimit;
    const dutyExceeded = total.dutyMinutes > dutyLimit;

    return {
      days: periodDays,
      flightLimit,
      dutyLimit,
      flightUsed: total.flightTimeMinutes,
      dutyUsed: total.dutyMinutes,
      flightExceeded,
      dutyExceeded,
      ok: !flightExceeded && !dutyExceeded
    };
  });

  return {
    totals: {
      flightTimeMinutes: periods.reduce((sum, item) => sum + item.flightUsed, 0),
      dutyMinutes: periods.reduce((sum, item) => sum + item.dutyUsed, 0)
    },
    periods,
    ok: periods.every((period) => period.ok),
    alert: periods.some((period) => !period.ok)
      ? 'Cumulative limits exceeded in rolling window view'
      : 'Cumulative limits within scheme'
  };
}

export function computeWeeklyRestStatus(scheme, { records = [], now = new Date() }) {
  const weekly = scheme.rest?.weekly || {};
  const localNightStart = Number(scheme.operationalAdjustments?.localNightStartHour ?? 22);
  const localNightEnd = Number(scheme.operationalAdjustments?.localNightEndHour ?? 6);
  const localNightsRequired = Number(weekly.localNights) || 2;
  const maxSpanHours = Number(weekly.maxSpanHours) || 168;
  const minMinutes = Number(weekly.minimumMinutes) || 2160;
  const extendedMinMinutes = Number(weekly.extendedMinimumMinutes) || 2880;
  const windowMs = maxSpanHours * 60 * 60 * 1000;

  const recent = (records || []).filter((record) => {
    const end = parseDate(record.fdpEnd || record.dutyEnd || record.reportTime);
    return end && now.getTime() - end.getTime() <= windowMs;
  }).sort((a, b) => {
    const left = parseDate(a.fdpEnd || a.dutyEnd || a.reportTime)?.getTime() ?? 0;
    const right = parseDate(b.fdpEnd || b.dutyEnd || b.reportTime)?.getTime() ?? 0;
    return right - left;
  });

  const latest = recent[0] || null;
  const latestEnd = latest ? parseDate(latest.fdpEnd || latest.dutyEnd || latest.reportTime) : null;
  const totalRestMinutes = latestEnd ? diffMinutes(latestEnd, now) : 0;

  const localNightDates = new Set();
  for (const record of recent) {
    const interval = getRecordInterval(record);
    if (!interval) continue;
    const startDate = new Date(Date.UTC(interval.start.getUTCFullYear(), interval.start.getUTCMonth(), interval.start.getUTCDate()));
    const endDate = new Date(Date.UTC(interval.end.getUTCFullYear(), interval.end.getUTCMonth(), interval.end.getUTCDate()));
    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const window = getNightWindowForDate(cursor, localNightStart, localNightEnd);
      const overlap = intervalOverlapMinutes(interval.start, interval.end, window.start, window.end);
      if (overlap > 0) {
        localNightDates.add(asYmd(cursor));
      }
    }
  }

  const localNightCount = localNightDates.size;
  const timezoneMinimumMinutes = recent.length
    ? Math.max(...recent.map((record) => getTimeZoneCrossingRequirementMinutes(scheme, record)))
    : 0;
  const triggerCount = Number(weekly.nightDutyTriggerCount) || 3;
  const requiredMinutes = Math.max(
    localNightCount >= triggerCount ? extendedMinMinutes : minMinutes,
    timezoneMinimumMinutes,
    minMinutes
  );
  const ok = totalRestMinutes >= requiredMinutes;

  return {
    localNightCount,
    localNightsRequired,
    timezoneMinimumMinutes,
    requiredMinutes,
    totalRestMinutes,
    ok,
    alert: !ok ? `Weekly rest below ${formatDurationMinutes(requiredMinutes)} in ${maxSpanHours}h window` : 'Weekly rest within scheme'
  };
}

export function summarizeCrewFdtl(scheme, { crewProfileId, state, records = [], now = new Date() }) {
  const rest = computeRestStatus(scheme, { state, records, now });
  const night = computeNightDutyStatus(scheme, { records, now });
  const weekly = computeWeeklyRestStatus(scheme, { records, now });
  const cumulative = computeCumulativeStatus(scheme, { records, now });

  const issues = [];
  if (!rest.ok) issues.push(rest.alert);
  if (!night.ok) issues.push(night.alert);
  if (!weekly.ok) issues.push(weekly.alert);
  if (!cumulative.ok) issues.push(cumulative.alert);

  let tone = 'within';
  if (issues.length > 0) {
    tone = 'attention';
    if (cumulative.periods.some((period) => period.flightExceeded || period.dutyExceeded)) {
      tone = 'exceeded';
    }
  }

  return {
    crewProfileId,
    tone,
    issues,
    alertText: issues.length ? issues.join(' · ') : 'Within scheme limits',
    rest,
    night,
    weekly,
    cumulative
  };
}

export function computeSplitDutyAdjustment(scheme, { breakMinutes = 0 } = {}) {
  const splitDuty = scheme.splitDuty || {};
  const breakLength = Number(breakMinutes) || 0;
  const minBreak = Number(splitDuty.breakLessThanMinutes ?? 180);
  const maxBreak = Number(splitDuty.breakGreaterThanMinutes ?? 600);
  const extensionFactor = Number(splitDuty.extensionFactor ?? 0.5);

  if (breakLength <= 0) {
    return { breakMinutes: 0, extensionMinutes: 0, applies: false, rule: 'none' };
  }

  if (breakLength < minBreak) {
    return { breakMinutes: breakLength, extensionMinutes: 0, applies: false, rule: 'short_break' };
  }

  if (breakLength > maxBreak) {
    return { breakMinutes: breakLength, extensionMinutes: 0, applies: false, rule: 'long_break' };
  }

  const extensionMinutes = Math.round(breakLength * extensionFactor);
  return {
    breakMinutes: breakLength,
    extensionMinutes,
    applies: extensionMinutes > 0,
    rule: 'split_duty'
  };
}

export function computeStandbyAdjustment(scheme, { standbyMinutes = 0, standbyType = 'home' } = {}) {
  const standby = scheme.standby || {};
  const totalStandbyMinutes = Number(standbyMinutes) || 0;
  if (!standby.enabled || totalStandbyMinutes <= 0) {
    return { standbyMinutes: 0, adjustmentMinutes: 0, applies: false };
  }

  const factorMap = {
    home: Number(standby.homeCountPct ?? 0),
    hotel: Number(standby.hotelCountPct ?? 0.5),
    airport: Number(standby.airportCountPct ?? 1)
  };

  const factor = factorMap[standbyType] ?? Number(standby.homeCountPct ?? 0);
  const adjustmentMinutes = Math.round(totalStandbyMinutes * factor);

  return {
    standbyMinutes: totalStandbyMinutes,
    adjustmentMinutes,
    applies: adjustmentMinutes > 0,
    standbyType,
    factor
  };
}

export function computeWoclAdjustment(scheme, { fdpStart, fdpEnd, isAcclimatised }) {
  if (!fdpStart || !fdpEnd) {
    return { reductionMinutes: 0, overlapMinutes: 0, startsInWocl: false, endsInWocl: false, encompassesWocl: false };
  }
  const wocl = scheme.wocl || {};
  const acclimatisation = scheme.acclimatisation || {};
  const startHour = wocl.startHour ?? acclimatisation.nightWindowStartHour ?? 2;
  const endHour = wocl.endHour ?? acclimatisation.nightWindowEndHour ?? 6;
  const startReductionPct = wocl.startEncroachmentReductionPct ?? 1;
  const endReductionPct = wocl.endOrEncompassReductionPct ?? 0.5;
  const maxStartReduction = wocl.maxStartReductionMinutes ?? 120;
  const acclimatised = isAcclimatised ?? acclimatisation.defaultIsAcclimatised ?? true;
  const reductionFactor = acclimatised ? 1 : Number(acclimatisation.unacclimatisedReductionPct ?? 0.5);

  const startAbs = fdpStart.getTime();
  const endAbs = fdpEnd.getTime();
  if (endAbs <= startAbs) {
    return { reductionMinutes: 0, overlapMinutes: 0, startsInWocl: false, endsInWocl: false, encompassesWocl: false };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const startDay = new Date(fdpStart.getFullYear(), fdpStart.getMonth(), fdpStart.getDate());
  const endDay = new Date(fdpEnd.getFullYear(), fdpEnd.getMonth(), fdpEnd.getDate());
  const woclWindows = [];
  for (let day = startDay.getTime(); day <= endDay.getTime(); day += dayMs) {
    woclWindows.push({ start: day + startHour * 3600000, end: day + endHour * 3600000 });
  }

  let overlapMinutes = 0;
  let startsInWocl = false;
  let endsInWocl = false;
  let encompassesWocl = false;

  woclWindows.forEach((win) => {
    overlapMinutes += Math.max(0, Math.min(endAbs, win.end) - Math.max(startAbs, win.start)) / 60000;
    if (startAbs >= win.start && startAbs < win.end) startsInWocl = true;
    if (endAbs > win.start && endAbs <= win.end) endsInWocl = true;
    if (startAbs < win.start && endAbs > win.end) encompassesWocl = true;
  });

  if (overlapMinutes <= 0) {
    return { reductionMinutes: 0, overlapMinutes: 0, startsInWocl: false, endsInWocl: false, encompassesWocl: false };
  }

  let reductionMinutes;
  if (startsInWocl) {
    reductionMinutes = Math.min(overlapMinutes, maxStartReduction) * startReductionPct;
  } else if (endsInWocl || encompassesWocl) {
    reductionMinutes = overlapMinutes * endReductionPct;
  } else {
    reductionMinutes = 0;
  }

  reductionMinutes *= reductionFactor;

  return {
    reductionMinutes: Math.round(reductionMinutes),
    overlapMinutes: Math.round(overlapMinutes),
    startsInWocl,
    endsInWocl,
    encompassesWocl,
    acclimatised
  };
}

export function computeApplicableFdpLimit(scheme, plan) {
  const baseLimitMinutes = resolveFdpBaseLimit(scheme, plan);
  if (baseLimitMinutes == null) {
    return { ok: false, reason: 'exceeds_scheme_max' };
  }

  const wocl = plan.fdpStart && plan.fdpEnd ? computeWoclAdjustment(scheme, {
    fdpStart: plan.fdpStart,
    fdpEnd: plan.fdpEnd,
    isAcclimatised: plan.isAcclimatised ?? plan.acclimatised
  }) : null;
  const splitDuty = computeSplitDutyAdjustment(scheme, { breakMinutes: Number(plan.breakMinutes ?? 0) });
  const standby = computeStandbyAdjustment(scheme, {
    standbyMinutes: Number(plan.standbyMinutes ?? 0),
    standbyType: plan.standbyType ?? 'home'
  });

  const reductionMinutes = wocl?.reductionMinutes || 0;
  const extensionMinutes = splitDuty.extensionMinutes || 0;
  const standbyAdjustmentMinutes = standby.adjustmentMinutes || 0;
  const applicableLimitMinutes = Math.max(0, baseLimitMinutes - reductionMinutes + extensionMinutes + standbyAdjustmentMinutes);

  return {
    ok: true,
    baseLimitMinutes,
    woclReductionMinutes: reductionMinutes,
    splitDuty,
    standby,
    applicableLimitMinutes,
    wocl: wocl || null
  };
}

function buildFlightComplianceRecord({
  flight,
  dutyIndex,
  runningFdpMinutes,
  applicableLimitMinutes,
  fdpThreshold,
  runningFlightTime,
  dayMaxFlightTime,
  maxLandings,
  flightOffset
}) {
  const issueTexts = [];
  const ruleRefs = [];

  if (runningFdpMinutes > applicableLimitMinutes) {
    issueTexts.push(`FDP ${formatDurationMinutes(runningFdpMinutes)} exceeds applicable ${formatDurationMinutes(applicableLimitMinutes)}`);
    ruleRefs.push('CAR §7.2 – FDP limit');
  } else if (runningFdpMinutes >= fdpThreshold) {
    issueTexts.push(`FDP ${formatDurationMinutes(runningFdpMinutes)} is approaching the applicable limit of ${formatDurationMinutes(applicableLimitMinutes)}`);
    ruleRefs.push('CAR §7.2 – FDP watch threshold');
  } else {
    issueTexts.push(`FDP ${formatDurationMinutes(runningFdpMinutes)} remains within the applicable limit of ${formatDurationMinutes(applicableLimitMinutes)}`);
    ruleRefs.push('CAR §7.2 – FDP within limit');
  }

  if (runningFlightTime > dayMaxFlightTime) {
    issueTexts.push(`Flight time ${formatDurationMinutes(runningFlightTime)} exceeds daily maximum ${formatDurationMinutes(dayMaxFlightTime)}`);
    ruleRefs.push('CAR §7.3 – Daily flight-time limit');
  } else {
    issueTexts.push(`Flight time ${formatDurationMinutes(runningFlightTime)} remains within daily maximum ${formatDurationMinutes(dayMaxFlightTime)}`);
    ruleRefs.push('CAR §7.3 – Daily flight-time within limit');
  }

  if (maxLandings != null && flightOffset + 1 > maxLandings) {
    issueTexts.push(`Landings ${flightOffset + 1} exceed the table maximum of ${maxLandings}`);
    ruleRefs.push('CAR §7.4 – Landing count');
  } else if (maxLandings != null) {
    issueTexts.push(`Landings ${flightOffset + 1} remain within the table maximum of ${maxLandings}`);
    ruleRefs.push('CAR §7.4 – Landing count within limit');
  }

  const violationFlags = [
    runningFdpMinutes > applicableLimitMinutes,
    runningFlightTime > dayMaxFlightTime,
    maxLandings != null && flightOffset + 1 > maxLandings
  ].filter(Boolean).length;

  const verdict = violationFlags > 0 ? VERDICTS.EXCEEDED : runningFdpMinutes >= fdpThreshold ? VERDICTS.ATTENTION : VERDICTS.WITHIN;
  const uniqueRuleRefs = [...new Set(ruleRefs)];
  const reason = issueTexts.join(' · ');

  return {
    flightNumber: flight.flightNumber,
    date: flight.departure ? asYmd(flight.departure) : flight.date || null,
    dutyIndex,
    verdict,
    ruleRefs: uniqueRuleRefs,
    reason,
    complianceText: verdict === VERDICTS.EXCEEDED
      ? `Violation: ${reason}`
      : verdict === VERDICTS.ATTENTION
        ? `Attention: ${reason}`
        : `Complied: ${reason}`,
    applicableLimitMinutes,
    usedFdpMinutes: runningFdpMinutes,
    usedFlightTimeMinutes: runningFlightTime,
    maxLandings,
    landingCount: flightOffset + 1,
    departure: flight.departure,
    landing: flight.landing
  };
}

export function simulateFlightSequence(scheme, {
  flights = [],
  operationCrew = OPERATION_CREW.TWO,
  crewName = null,
  historicalRecords = [],
  reportOverrides = {}
} = {}) {
  const normalizedFlights = (flights || [])
    .map((entry, index) => {
      const departure = parseDate(entry.departure || entry.departureTime || entry.start);
      const landing = parseDate(entry.landing || entry.landingTime || entry.end);
      const flightMinutes = Number(entry.flightMinutes ?? 0) || (departure && landing ? diffMinutes(departure, landing) : 0);
      return {
        ...entry,
        id: entry.id ?? `${index + 1}`,
        flightNumber: Number(entry.flightNumber ?? index + 1),
        departure,
        landing,
        flightMinutes,
        newDuty: Boolean(entry.newDuty)
      };
    })
    .filter((entry) => entry.departure && entry.landing)
    .sort((left, right) => left.departure.getTime() - right.departure.getTime());

  if (!normalizedFlights.length) {
    return {
      verdict: VERDICTS.WITHIN,
      summary: 'No flights entered.',
      flights: [],
      duties: [],
      firstViolation: null
    };
  }

  const reportingMinutes = Number(scheme.operationalAdjustments?.reportingTimeMinutes ?? 0);
  const postFlightAllowanceMinutes = Number(scheme.operationalAdjustments?.postFlightAllowanceMinutes ?? 0);
  const dutyBreakMinutes = Math.max(360, reportingMinutes + 180);
  const minimumRestMinutes = Number(scheme.rest?.minimumMinutes ?? 720);
  const dayMaxFlightTime = Number(scheme.fdp?.defaultMaxFlightTimeDayMinutes ?? 480);
  const warningThresholdPct = Number(scheme.fdp?.warningThresholdPct ?? 0.8);
  const weeklyWindowMs = (Number(scheme.rest?.weekly?.maxSpanHours) || 168) * 60 * 60 * 1000;
  const weeklyMinMinutes = Number(scheme.rest?.weekly?.minimumMinutes) || 2160;
  const weeklyExtendedMinutes = Number(scheme.rest?.weekly?.extendedMinimumMinutes) || 2880;
  const nightDutyTriggerCount = Number(scheme.rest?.weekly?.nightDutyTriggerCount) || 3;
  const localNightStart = Number(scheme.operationalAdjustments?.localNightStartHour ?? 22);
  const localNightEnd = Number(scheme.operationalAdjustments?.localNightEndHour ?? 6);
  const nightStart = Number(scheme.nightDuty?.startHour ?? 0);
  const nightEnd = Number(scheme.nightDuty?.endHour ?? 5);

  const dutiesRaw = [];
  let currentDuty = [];
  normalizedFlights.forEach((flight) => {
    if (flight.newDuty || !currentDuty.length) {
      if (currentDuty.length) dutiesRaw.push(currentDuty);
      currentDuty = [flight];
      return;
    }
    const lastFlight = currentDuty[currentDuty.length - 1];
    const gapMinutes = diffMinutes(lastFlight.landing, flight.departure);
    if (gapMinutes > dutyBreakMinutes) {
      dutiesRaw.push(currentDuty);
      currentDuty = [flight];
    } else {
      currentDuty.push(flight);
    }
  });
  if (currentDuty.length) dutiesRaw.push(currentDuty);

  const toSimRecord = (duty) => ({
    flightTimeMinutes: duty.flightTimeMinutes,
    reportTime: duty.reportTime,
    dutyStart: duty.reportTime,
    dutyEnd: duty.dutyEnd,
    fdpStart: duty.reportTime,
    fdpEnd: duty.finalLanding,
    timeZoneCrossingHours: duty.timeZoneCrossingHours || 0
  });

  const baselineRecords = (historicalRecords || [])
    .map((record) => ({
      flightTimeMinutes: Number(record.flightTimeMinutes) || 0,
      reportTime: parseDate(record.reportTime),
      dutyStart: parseDate(record.dutyStart || record.fdpStart || record.reportTime),
      dutyEnd: parseDate(record.dutyEnd || record.fdpEnd || record.reportTime),
      fdpStart: parseDate(record.fdpStart || record.dutyStart || record.reportTime),
      fdpEnd: parseDate(record.fdpEnd || record.dutyEnd || record.reportTime),
      timeZoneCrossingHours: Number(record.timeZoneCrossingHours ?? record.timeZoneDifferenceHours ?? 0)
    }))
    .filter((record) => record.dutyStart && record.dutyEnd);

  const completedDuties = [];
  const duties = [];
  const weeklyRestGaps = [];

  dutiesRaw.forEach((dutyFlights, dutyIndex) => {
    const firstFlight = dutyFlights[0];
    const lastFlight = dutyFlights[dutyFlights.length - 1];
    const reportOverride = reportOverrides[firstFlight.departure.toISOString()] ?? reportOverrides[dutyIndex];
    const reportTime = reportOverride
      ? parseDate(reportOverride)
      : new Date(firstFlight.departure.getTime() - reportingMinutes * 60000);
    const finalLanding = lastFlight.landing;
    const dutyEnd = new Date(finalLanding.getTime() + postFlightAllowanceMinutes * 60000);
    const flightTimeMinutes = dutyFlights.reduce((sum, flight) => sum + flight.flightMinutes, 0);
    const landings = dutyFlights.length;

    const plannedFdpMinutes = Math.max(0, diffMinutes(reportTime, finalLanding));
    const fdpResult = checkPlannedFdp(scheme, {
      operationCrew,
      flightTimeMinutes,
      landings,
      fdpStart: reportTime,
      fdpEnd: finalLanding,
      plannedFdpMinutes,
      isAcclimatised: true
    });
    const applicableLimitMinutes = fdpResult.applicableLimitMinutes;
    const fdpThreshold = Math.round(applicableLimitMinutes * warningThresholdPct);

    const previousDuty = completedDuties[completedDuties.length - 1] || null;
    let restRequiredMinutes = null;
    let restAvailableMinutes = null;
    let restOk = true;
    let restReason = null;
    if (previousDuty) {
      const previousDutyPeriodMinutes = diffMinutes(previousDuty.reportTime, previousDuty.dutyEnd);
      const timezoneMinimum = getTimeZoneCrossingRequirementMinutes(scheme, toSimRecord(previousDuty));
      restRequiredMinutes = Math.max(minimumRestMinutes, previousDutyPeriodMinutes, timezoneMinimum);
      restAvailableMinutes = diffMinutes(previousDuty.dutyEnd, reportTime);
      restOk = restAvailableMinutes >= restRequiredMinutes;
      if (!restOk) {
        restReason = `Rest shortfall ${formatDurationMinutes(restRequiredMinutes - restAvailableMinutes)} (required ${formatDurationMinutes(restRequiredMinutes)}, available ${formatDurationMinutes(restAvailableMinutes)})`;
      }
    }

    const duty = {
      dutyIndex: dutyIndex + 1,
      reportTime,
      finalLanding,
      dutyEnd,
      plannedFdpMinutes,
      flightTimeMinutes,
      landings,
      applicableLimitMinutes,
      fdpRemainingMinutes: fdpResult.remainingMinutes,
      timeZoneCrossingHours: firstFlight.timeZoneCrossingHours || lastFlight.timeZoneCrossingHours || 0
    };

    const simRecordsWithDuty = [...baselineRecords, ...completedDuties.map(toSimRecord), toSimRecord(duty)];
    const cumulative = computeCumulativeStatus(scheme, { records: simRecordsWithDuty, now: dutyEnd });

    if (previousDuty) {
      weeklyRestGaps.push({ start: previousDuty.dutyEnd.getTime(), end: reportTime.getTime() });
    }
    const weeklyWindowStart = reportTime.getTime() - weeklyWindowMs;
    const activeGaps = weeklyRestGaps.filter((gap) => gap.end >= weeklyWindowStart);
    const weeklyNightCount = completedDuties.reduce(
      (count, completed) =>
        count + collectNightDutyDates(toSimRecord(completed), localNightStart, localNightEnd, nightStart, nightEnd).length,
      0
    );
    const weeklyRequiredMinutes = weeklyNightCount >= nightDutyTriggerCount ? weeklyExtendedMinutes : weeklyMinMinutes;
    const qualifyingWeeklyRest = activeGaps.find((gap) => gap.end - gap.start >= weeklyRequiredMinutes * 60000) || null;
    const weeklyOk = completedDuties.length === 0 || Boolean(qualifyingWeeklyRest);
    const weeklyRestMinutes = activeGaps.reduce((sum, gap) => sum + Math.round((gap.end - gap.start) / 60000), 0);
    const weekly = {
      ok: weeklyOk,
      requiredMinutes: weeklyRequiredMinutes,
      totalRestMinutes: qualifyingWeeklyRest ? Math.round((qualifyingWeeklyRest.end - qualifyingWeeklyRest.start) / 60000) : weeklyRestMinutes,
      maxSpanHours: Math.round(weeklyWindowMs / 3600000),
      nightCount: weeklyNightCount,
      alert: weeklyOk ? 'Weekly rest within scheme' : `No qualifying rest of ${formatDurationMinutes(weeklyRequiredMinutes)} in ${Math.round(weeklyWindowMs / 3600000)}h window`
    };

    const priorProposedRecords = completedDuties.map(toSimRecord);
    const night = computeNightDutyStatus(scheme, { records: priorProposedRecords, now: reportTime });

    let dutyVerdict = fdpResult.verdict;
    const reasons = [];
    const dutyRuleRefs = [];
    if (fdpResult.verdict === VERDICTS.EXCEEDED) {
      reasons.push(`FDP ${formatDurationMinutes(plannedFdpMinutes)} exceeds applicable ${formatDurationMinutes(applicableLimitMinutes)}`);
      dutyRuleRefs.push('CAR §7.2 – FDP limit');
    }
    const exceededPeriod = cumulative.periods.find((period) => period.flightExceeded || period.dutyExceeded);
    if (exceededPeriod) {
      dutyVerdict = VERDICTS.EXCEEDED;
      reasons.push(`Cumulative ${exceededPeriod.days}-day limit exceeded (flight ${formatDurationMinutes(exceededPeriod.flightUsed)}/${formatDurationMinutes(exceededPeriod.flightLimit)}, duty ${formatDurationMinutes(exceededPeriod.dutyUsed)}/${formatDurationMinutes(exceededPeriod.dutyLimit)})`);
      dutyRuleRefs.push(`CAR §15.4 – ${exceededPeriod.days}-day cumulative ${exceededPeriod.flightExceeded ? 'flight-time' : 'duty'} limit`);
    }
    if (!weeklyOk) {
      dutyVerdict = VERDICTS.EXCEEDED;
      reasons.push(weekly.alert);
      dutyRuleRefs.push('CAR §11.2 – Weekly rest');
    }
    if (!night.ok && dutyVerdict !== VERDICTS.EXCEEDED) {
      dutyVerdict = VERDICTS.ATTENTION;
      reasons.push(night.alert);
      dutyRuleRefs.push('CAR §10.1 – Night duty');
    }
    if (!restOk) {
      dutyVerdict = VERDICTS.EXCEEDED;
      reasons.push(restReason);
      dutyRuleRefs.push('CAR §8.2 – Minimum rest between duties');
    }

    duty.flights = dutyFlights.map((flight, flightOffset) => {
      const runningFlightTime = dutyFlights.slice(0, flightOffset + 1).reduce((sum, item) => sum + item.flightMinutes, 0);
      const runningFdpMinutes = Math.max(0, diffMinutes(reportTime, flight.landing));
      const maxLandings = resolveMaxLandings(scheme, { operationCrew, flightTimeMinutes: runningFlightTime });
      const flightCompliance = buildFlightComplianceRecord({
        flight,
        dutyIndex: dutyIndex + 1,
        runningFdpMinutes,
        applicableLimitMinutes,
        fdpThreshold,
        runningFlightTime,
        dayMaxFlightTime,
        maxLandings,
        flightOffset
      });

      const mergedVerdict = flightCompliance.verdict === VERDICTS.EXCEEDED || dutyVerdict === VERDICTS.EXCEEDED
        ? VERDICTS.EXCEEDED
        : flightCompliance.verdict === VERDICTS.ATTENTION || dutyVerdict === VERDICTS.ATTENTION
          ? VERDICTS.ATTENTION
          : VERDICTS.WITHIN;
      const mergedRuleRefs = [...new Set([...(flightCompliance.ruleRefs || []), ...dutyRuleRefs])];
      const mergedReason = [flightCompliance.reason, ...reasons].filter(Boolean).join(' · ');

      return {
        ...flight,
        flightMinutes: flight.flightMinutes,
        departure: flight.departure,
        landing: flight.landing,
        runningFdpMinutes,
        runningFlightTime,
        verdict: mergedVerdict,
        reasons: mergedReason ? [mergedReason] : [],
        ruleRefs: mergedRuleRefs,
        reason: mergedReason,
        complianceText: mergedVerdict === VERDICTS.EXCEEDED
          ? `Violation: ${mergedReason}`
          : mergedVerdict === VERDICTS.ATTENTION
            ? `Attention: ${mergedReason}`
            : `Complied: ${mergedReason}`,
        applicableLimitMinutes: flightCompliance.applicableLimitMinutes,
        usedFdpMinutes: flightCompliance.usedFdpMinutes,
        usedFlightTimeMinutes: flightCompliance.usedFlightTimeMinutes,
        maxLandings: flightCompliance.maxLandings,
        landingCount: flightCompliance.landingCount,
        dutyRuleRefs
      };
    });

    completedDuties.push(duty);

    duties.push({
      ...duty,
      verdict: dutyVerdict,
      reasons,
      dutyRuleRefs,
      restRequiredMinutes,
      restAvailableMinutes,
      restOk,
      restReason,
      cumulative,
      weekly,
      night,
      notEvaluated: false
    });
  });

  const firstViolation = duties.find((duty) => duty.verdict === VERDICTS.EXCEEDED) || null;
  const verdict = duties.some((duty) => duty.verdict === VERDICTS.EXCEEDED)
    ? VERDICTS.EXCEEDED
    : duties.some((duty) => duty.verdict === VERDICTS.ATTENTION)
      ? VERDICTS.ATTENTION
      : VERDICTS.WITHIN;

  const exceedCount = duties.flatMap((duty) => duty.flights).filter((flight) => flight.verdict === VERDICTS.EXCEEDED).length;
  const attentionCount = duties.flatMap((duty) => duty.flights).filter((flight) => flight.verdict === VERDICTS.ATTENTION).length;
  const withinCount = duties.flatMap((duty) => duty.flights).filter((flight) => flight.verdict === VERDICTS.WITHIN).length;

  const summary = firstViolation
    ? `${crewName ? `${crewName} - ` : ''}Sequence evaluated across ${duties.length} duty period${duties.length === 1 ? '' : 's'}; first violation detected in Duty ${firstViolation.dutyIndex}. ${exceedCount} flight${exceedCount === 1 ? '' : 's'} exceeded, ${attentionCount} attention, ${withinCount} compliant.`
    : `Sequence evaluated with ${duties.length} duty period${duties.length === 1 ? '' : 's'}; ${withinCount} compliant, ${attentionCount} attention, ${exceedCount} exceeded.`;

  return {
    verdict,
    summary,
    flights: normalizedFlights,
    duties,
    firstViolation
  };
}

export function checkPlannedFdp(scheme, plan) {
  const limit = computeApplicableFdpLimit(scheme, plan);
  const plannedFdpMinutes = Number(plan.plannedFdpMinutes) || 0;

  if (!limit.ok) {
    return {
      ...limit,
      verdict: VERDICTS.EXCEEDED,
      plannedFdpMinutes,
      remainingMinutes: 0
    };
  }

  const warningThresholdPct = scheme.fdp?.warningThresholdPct ?? 0.8;
  const threshold = Math.round(limit.applicableLimitMinutes * warningThresholdPct);
  let verdict;
  if (plannedFdpMinutes > limit.applicableLimitMinutes) {
    verdict = VERDICTS.EXCEEDED;
  } else if (plannedFdpMinutes >= threshold) {
    verdict = VERDICTS.ATTENTION;
  } else {
    verdict = VERDICTS.WITHIN;
  }

  return {
    ...limit,
    verdict,
    plannedFdpMinutes,
    remainingMinutes: Math.max(0, limit.applicableLimitMinutes - plannedFdpMinutes)
  };
}
