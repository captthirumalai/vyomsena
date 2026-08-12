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
