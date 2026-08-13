# EFB Module

Route: /efb
Title: Electronic Flight Bag

## Current Build Snapshot

The EFB module lets crew or operations record **actual flight details** against flights planned by Dispatch. Actuals are written to the shared `companies/{companyId}/flights` collection via `recordEfbActuals`, then evaluated by the FDTL module for compliance.

### Completed features
- **Flight Assignments** table: live list of planned flights (date, flight number, route, P1, status, EFB actuals state) via `onFlightsSnapshot`.
- **Record Actuals** form: chocks off/on, takeoff/landing (times), IR and XC time (minutes), with auto-computed block time.
- Saving actuals sets the EFB source block, transitions status to `completed`, and triggers reconciliation against the Flight Ops planned times in FDTL.
- Selecting a row pre-fills the form with any previously recorded actuals.

### Data flow
```
Dispatch (planned flight) → EFB (record actuals) → companies/{companyId}/flights
        → FDTL (compliance evaluation + mismatch reconciliation)
```

## Next Enhancements
- Controlled operational document distribution.
- Read acknowledgement tracking by pilot.
- Versioned briefing packs with expiry windows.
- Push planned flight assignments to the crew member's EFB session.
