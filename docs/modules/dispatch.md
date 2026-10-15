# Dispatch Board Module

Route: /dispatch
Title: Dispatch Board

## Current Build Snapshot

Dispatch is the **central entry point for flight movements**. It writes to the shared `companies/{companyId}/flights` collection with linked pilots (P1/P2 via `crewProfileIds`), which is consumed live by the EFB module (actuals, final) and the FDTL module (compliance monitoring).

### Completed features
- **Plan Flight Movement** form (flight plan + movement/actuals sections): flight number, aircraft reg (required, from fleet), route, date, scheduled times, distance (NM), operation type, P1 (required) / P2 (from crew roster), remarks, plus actuals (chocks off/on, takeoff/landing, IR/XC minutes, auto block).
- Movement lifecycle derived from actuals: empty = `planned`, partial = `active`, all four = `completed`. New back-entries with actuals are created `completed` with a `fops` time block.
- **Edit any non-cancelled movement** (completed corrections ask for confirm; EFB `efb` block is never wiped — plan-only edits on completed flights leave times intact). Joint provenance: dispatch writes after an EFB sync keep `source: dispatch+efb`.
- **Cancel / Reactivate** (cancel-only policy, no hard delete). Completed movements cannot be cancelled; cancelled ones can be reactivated to `planned`.
- **Flight Board** with pilot filter, status filter, search, Crew (P1/P2), Block, Status, FDTL verdict, Source, and expandable **Details** rows (planned vs actual times, reconciliation incl. FOps-vs-EFB mismatches, remarks, inline **audit trail** via `listFlightAuditEntries`).
- **FDTL pre-flight projection** under the form (projected block, per-pilot FDP/rest/cumulative verdict from the company scheme + completed history) — advisory, never blocks save.
- **FDTL post-flight verdicts** on the board for completed movements (FDP base limit, 7/28-day cumulative, rest vs previous duty; worst of P1/P2).
- Live updates via `onFlightsSnapshot`; P1+P2 both accrue duty records through `flightsToDutyRecords`.

### Data flow
```
Dispatch (plan + close-out movements, corrections) → companies/{companyId}/flights
        → EFB device (records actuals as FINAL; sync upgrades source to dispatch+efb)
        → FDTL (pre-flight projection + post-flight monitoring)
        → fdtl_audit (every create/update/cancel/reactivate attributed to actor)
```

## Next Enhancements
- Daily dispatch board with crew and aircraft readiness.
- Mission legs and sector assignment.
- Dispatch checklist with document and currency validation gates.
- Push planned flights to assigned crew's EFB view.
