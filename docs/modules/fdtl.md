# FDTL Monitoring Module

Route: /fdtl
Title: FDTL Monitoring

End goal: build a focused, operator-owned Flight Duty Time Limit (FDTL) compliance module that keeps the company’s approved scheme as the single source of truth, surfaces live crew risk in the dashboard, and lets operations staff review and record duty facts without cluttering the daily workflow. The scheme is configured once at the company level and then only opened when a policy change or approval action is truly required.

Repurposed from the former Fleet (Aircraft) module. This module implements Flight Duty Time Limit monitoring under **DGCA CAR Section 7, Series J, Part IV, Rev 1 (19 January 2023)**, driven by the operator's approved FDTL Scheme rather than hard-coded limits.

> The CAR serves as guidelines for Private/Aerial operators operating non-turbojet aeroplanes below 5700 kg AUW. Such operators prepare their own FDTL Scheme based on the type and size of operation, include it in the Operations Manual, and submit it to DGCA for approval. VAMS therefore treats the scheme as the single source of truth for all limits.

## End Goal

The FDTL module should become the operational control room for crew duty compliance. It must:

- keep a single company-level approved scheme as the authoritative rule set;
- show live crew status at a glance across the operator’s population;
- let operations teams monitor attention and exceedance conditions without navigating configuration screens;
- allow accurate duty-record capture, fatigue reporting, and pre-flight eligibility checks;
- keep scheme edits rare, explicit, and audit-backed, so they are accessed only when a review, approval, or policy update is required.

In short, the daily user experience is operational monitoring, while scheme administration is a deliberate exception path rather than a permanent tab in the workflow.

## Implementation Status

The module is now operating as an organisation-wide FDTL monitoring system with scheme-driven rules, crew-by-crew duty tracking, and operator-configurable operational adjustments.

### Completed features
- Scheme-driven FDTL configuration with editable operational values for reporting time, post-flight allowance, local night timings, and transportation allowance.
- Dashboard and crew roster monitoring across the operator's crew population.
- Duty-state tracking for on duty / on rest / available / off duty / sick / leave.
- Duty record capture for report time, duty period, FDP windows, flight time, and landings.
- Flight eligibility check for planned duty end, FDP, flight time, and landing limits.
- Rest, night-duty, weekly-rest, and cumulative-warning summaries for each crew member.
- Confidential fatigue report submission with audit trail.
- Approval workflow for scheme saving and approval tracking.

### Current limitation
- CAR Note 2 (layover-station acclimatisation when proceeding to farther time zones after a 3–7 zone crossing) is not implemented; time-zone rest is applied from the reported crossing only. This exclusion is recorded as a note in the default scheme document.
- The module now keeps the approved scheme as the protected live source of truth and stores draft adjustments separately until approval, so the active company rule set cannot be overwritten in place.

## UX Decision: Scheme as a rare-action control

The FDTL scheme should not live as a standard tab in the main workflow. Because the company scheme is set once and then governs all calculations, it is better presented as a top-right action button labelled `Scheme` that opens only when needed.

This keeps the main navigation focused on:

1. Dashboard
2. Crew
3. Duty Records
4. Flight Check

and treats scheme changes as a deliberate administrative action rather than a routine workstream.

## Module Areas

1. **Dashboard** — who needs attention. Counts of crew Within Limits / Attention / Exceeded and fatigue reports, plus the attention list.
2. **Crew** — current duty state per crew member (on duty / on rest / available / off duty / sick / leave), duty start, rest completion, and FDTL summary alerts. State is editable and audited.
3. **Duty Records** — capture report time, duty period, FDP start/end, flight time, landings, operation type (commercial / positioning / training / base training / familiarisation / skill test / IR / PPC), sector, note. Historical records retained for the scheme's retention period. Audit trail view included.
4. **Flight Check** — pre-flight eligibility gate: given crew (two-pilot operations only), the flight sequence, report time and planned duty end, computes base FDP limit, WOCL adjustment, applicable FDP limit, planned FDP, and verdict (Within / Attention / Exceeded) plus flight-time and landing checks. The form is streamlined: legacy single-field report time, planned duty end, flight time and landings inputs were replaced by a sequence-table flow with an optional advanced report-override block.
5. **Scheme** — noticeboard control center for the approved scheme. The full rule set is shown as at-a-glance cards (FDP table, WOCL, rest, weekly rest, night duty, split duty, standby, unforeseen, acclimatisation, cumulative limits) alongside an approval masthead and inline-editable operational conditions (reporting time, post-flight allowance, local night window, transportation allowance, records retention). Save Draft / Approve Scheme persist changes with an audit trail.

## FDTL Engine (scheme-driven)

`services/fdtl/` — the engine reads all limits from the active scheme.

- `scheme.js` — default FDTL Scheme document (CAR-derived values) + read/save `companies/{companyId}/fdtl_scheme/current`.
- `fdpEngine.js` — pure functions:
- `resolveFdpBaseLimit` — two-pilot FDP tables keyed by flight time and landings (e.g. 8h: 6 landings → 11:00, 5 → 11:30, 4 → 12:00, 3 → 12:30; 10h with 1/2 landings → 13:30). The single-pilot table is no longer modelled — the FDTL module assumes two-pilot operations only.
- `computeWoclAdjustment` — WOCL (02:00–06:00 acclimatized, local time): FDP starting in WOCL is reduced 100% of encroachment (capped per scheme); FDP ending in or fully encompassing WOCL is reduced 50%.
- `computeApplicableFdpLimit` / `checkPlannedFdp` — applicable limit and verdict.
- `computeRestStatus`, `computeNightDutyStatus`, `computeWeeklyRestStatus`, `computeCumulativeStatus`, `summarizeCrewFdtl` — organisation-wide compliance summaries across rest, night duty, weekly rest, and cumulative limits.
- `computeTwoLandingProvisionMinutes` — the 6-hour rest increase required when the preceding duty utilized the split-duty provision with 2 landings (CAR Note 1); applied in both the dashboard rest summary and the flight-sequence simulation.
- `dutyRecords.js` — duty state doc per crew (`companies/{companyId}/fdtl_duty/{crewProfileId}`) and flat duty records (`companies/{companyId}/fdtl_records/{recordId}`).
- `audit.js` — audit trail (`companies/{companyId}/fdtl_audit`): who, when, entity, field, before, after, reason, source. Every state/record change writes audit entries.
- `fatigue.js` — fatigue reports (`companies/{companyId}/fdtl_fatigue`), confidential, non-punitive.

## Data Model

- `companies/{companyId}/fdtl_scheme/current` — approved FDTL Scheme.
- `companies/{companyId}/fdtl_duty/{crewProfileId}` — current duty state.
- `companies/{companyId}/fdtl_records/{recordId}` — historical duty records.
- `companies/{companyId}/fdtl_audit/{auditId}` — audit trail.
- `companies/{companyId}/fdtl_fatigue/{fatigueId}` — fatigue reports.
- Crew roster read from existing crew profiles (no second pilot database).

## FDTL Scheme Document (default values, all minutes)

- FDP tables: two pilot (8h → 11:00/11:30/12:00/12:30 for 6/5/4/3 landings; 10h with 1–2 landings → 13:30). Single-pilot operations are not modelled.
- WOCL: 02:00–06:00 (local time); 100% reduction when starting in WOCL (capped 2h); 50% when ending in or encompassing WOCL.
- Rest: minimum = max(previous duty period, 12h); time-zone crossing 3–7 zones → 18h; >7 zones → 36h; increased by 6h when the preceding duty used the split-duty provision with 2 landings.
- Weekly rest: 36h incl. 2 local nights within 168h span; extended to 48h when more than 3 duties in the preceding 168h encroach night duty/WOCL. Enforced only once 168h of duty history (from first report time) has elapsed.
- Night duty: 00:00–05:00 (local time), max 2 consecutive nights, exception once per 168h.
- Cumulative: 7d FT 35h / Duty 60h; 14d 65h / 100h; 28d 100h / 190h; 90d 300h / 600h; 365d 1000h / 1800h.
- Split duty: break < 3h no extension; 3–10h extension = half the break; > 10h no extension.
- Standby: schedule/commuter only, configurable counting toward FDP.
- Unforeseen operational circumstance: max extension FT +1:30, FDP +3:00, with PIC consent and Head of Operations approval, audited.
- Records retention: 18 months.

## Next Enhancements

- Implement CAR Note 2 layover-station acclimatisation handling for 3–7 zone crossings.
- Extend cumulative limit rollup to explicit 7/14/28/90/365-day windows with per-crew dashboard detail.
- Add a dedicated scheme approval history log and compare view for prior versions.
- Add crew profile FDTL fields (home base, temporary home base, acclimatisation status).
- Add split duty, standby, and positioning handling in the FDP engine.
- Add unforeseen operational circumstance workflow with approval and audit record.
- Expand flight check to include policy-specific exemptions and local-night / rest gating.
