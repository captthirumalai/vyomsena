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
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

  const requiredRestMinutes = Math.max(minimumMinutes, previousDutyPeriodMinutes);
  const actualRestMinutes = lastDutyEndedAt ? diffMinutes(lastDutyEndedAt, now) : 0;
  const restUntil = lastDutyEndedAt ? new Date(lastDutyEndedAt.getTime() + requiredRestMinutes * 60000) : null;

  return {
    minimumMinutes,
    previousDutyPeriodMinutes,
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
  const allNightDuty = (records || []).filter((record) => {
    const start = parseDate(record.fdpStart || record.dutyStart || record.reportTime);
    if (!start) return false;
    const inNightDuty = isWithinNightWindow(start, startHour, endHour);
    const inLocalNight = isWithinNightWindow(start, localStart, localEnd);
    return inNightDuty || inLocalNight;
  });

  const uniqueDates = [...new Set(allNightDuty.map((record) => asYmd(record.fdpStart || record.dutyStart || record.reportTime)).filter(Boolean))].sort();
  let consecutiveNights = 0;
  for (let index = uniqueDates.length - 1; index >= 0; index -= 1) {
    const current = new Date(`${uniqueDates[index]}T00:00:00`);
    const previous = index === uniqueDates.length - 1 ? null : new Date(`${uniqueDates[index + 1]}T00:00:00`);
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
    localNightCount: uniqueDates.length,
    consecutiveNights,
    maxConsecutiveNights: scheme.nightDuty?.maxConsecutiveNights ?? 2,
    ok: consecutiveNights <= (scheme.nightDuty?.maxConsecutiveNights ?? 2),
    alert: consecutiveNights > (scheme.nightDuty?.maxConsecutiveNights ?? 2)
      ? `Night duty exceeds ${scheme.nightDuty?.maxConsecutiveNights ?? 2} consecutive nights`
      : 'Night duty within lane'
  };
}

export function computeCumulativeStatus(scheme, { records = [], now = new Date() }) {
  const cutoff = now.getTime() - 365 * 24 * 60 * 60 * 1000;
  const recent = (records || []).filter((record) => {
    const end = parseDate(record.fdpEnd || record.dutyEnd || record.reportTime);
    return end && end.getTime() >= cutoff;
  });

  const totals = recent.reduce(
    (acc, record) => {
      acc.flightTimeMinutes += Number(record.flightTimeMinutes) || 0;
      const dutyStart = parseDate(record.dutyStart || record.fdpStart || record.reportTime);
      const dutyEnd = parseDate(record.dutyEnd || record.fdpEnd || record.reportTime);
      if (dutyStart && dutyEnd) {
        acc.dutyMinutes += diffMinutes(dutyStart, dutyEnd);
      }
      return acc;
    },
    { flightTimeMinutes: 0, dutyMinutes: 0 }
  );

  const periods = Object.entries(scheme.cumulative || {}).map(([days, limit]) => {
    const periodDays = Number(days) || 0;
    const flightLimit = Number(limit?.flightTimeMinutes) || 0;
    const dutyLimit = Number(limit?.dutyMinutes) || 0;
    const flightExceeded = totals.flightTimeMinutes > flightLimit;
    const dutyExceeded = totals.dutyMinutes > dutyLimit;
    return {
      days: periodDays,
      flightLimit,
      dutyLimit,
      flightUsed: totals.flightTimeMinutes,
      dutyUsed: totals.dutyMinutes,
      flightExceeded,
      dutyExceeded,
      ok: !flightExceeded && !dutyExceeded
    };
  });

  return {
    totals,
    periods,
    ok: periods.every((period) => period.ok),
    alert: periods.some((period) => !period.ok)
      ? 'Cumulative limits exceeded in 365-day view'
      : 'Cumulative limits within scheme'
  };
}

export function computeWeeklyRestStatus(scheme, { records = [], now = new Date() }) {
  const weekly = scheme.rest?.weekly || {};
  const localNightsRequired = Number(weekly.localNights) || 2;
  const maxSpanHours = Number(weekly.maxSpanHours) || 168;
  const minMinutes = Number(weekly.minimumMinutes) || 2160;
  const extendedMinMinutes = Number(weekly.extendedMinimumMinutes) || 2880;
  const windowMs = maxSpanHours * 60 * 60 * 1000;

  const recent = (records || []).filter((record) => {
    const end = parseDate(record.fdpEnd || record.dutyEnd || record.reportTime);
    return end && now.getTime() - end.getTime() <= windowMs;
  });

  const sorted = [...recent].sort((a, b) => {
    const left = parseDate(a.fdpEnd || a.dutyEnd || a.reportTime)?.getTime() ?? 0;
    const right = parseDate(b.fdpEnd || b.dutyEnd || b.reportTime)?.getTime() ?? 0;
    return right - left;
  });

  const latest = sorted[0] || null;
  let localNightCount = 0;
  let totalRestMinutes = 0;

  if (latest) {
    const end = parseDate(latest.fdpEnd || latest.dutyEnd || latest.reportTime);
    if (end) {
      totalRestMinutes = diffMinutes(end, now);
    }
  }

  for (const record of sorted) {
    const start = parseDate(record.fdpStart || record.dutyStart || record.reportTime);
    if (!start) continue;
    const localNightStart = Number(scheme.operationalAdjustments?.localNightStartHour ?? 22);
    const localNightEnd = Number(scheme.operationalAdjustments?.localNightEndHour ?? 6);
    if (isWithinNightWindow(start, localNightStart, localNightEnd)) {
      localNightCount += 1;
    }
  }

  const requiredMinutes = localNightCount > (Number(weekly.nightDutyTriggerCount) || 3) ? extendedMinMinutes : minMinutes;
  const ok = totalRestMinutes >= requiredMinutes;

  return {
    localNightCount,
    localNightsRequired,
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

export function computeWoclAdjustment(scheme, { fdpStart, fdpEnd }) {
  if (!fdpStart || !fdpEnd) {
    return { reductionMinutes: 0, overlapMinutes: 0, startsInWocl: false, endsInWocl: false, encompassesWocl: false };
  }
  const wocl = scheme.wocl || {};
  const startHour = wocl.startHour ?? 2;
  const endHour = wocl.endHour ?? 6;
  const startReductionPct = wocl.startEncroachmentReductionPct ?? 1;
  const endReductionPct = wocl.endOrEncompassReductionPct ?? 0.5;
  const maxStartReduction = wocl.maxStartReductionMinutes ?? 120;

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

  return {
    reductionMinutes: Math.round(reductionMinutes),
    overlapMinutes: Math.round(overlapMinutes),
    startsInWocl,
    endsInWocl,
    encompassesWocl
  };
}

export function computeApplicableFdpLimit(scheme, plan) {
  const baseLimitMinutes = resolveFdpBaseLimit(scheme, plan);
  if (baseLimitMinutes == null) {
    return { ok: false, reason: 'exceeds_scheme_max' };
  }

  const wocl = plan.fdpStart && plan.fdpEnd ? computeWoclAdjustment(scheme, { fdpStart: plan.fdpStart, fdpEnd: plan.fdpEnd }) : null;
  const reductionMinutes = wocl?.reductionMinutes || 0;
  const applicableLimitMinutes = Math.max(0, baseLimitMinutes - reductionMinutes);

  return {
    ok: true,
    baseLimitMinutes,
    woclReductionMinutes: reductionMinutes,
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
