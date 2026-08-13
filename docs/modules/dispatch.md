# Dispatch Board Module

Route: /dispatch
Title: Dispatch Board

## Current Build Snapshot

Dispatch is the **flight creation / planning** front door for operations. It writes planned flights to the shared `companies/{companyId}/flights` collection, which is consumed live by the EFB module (actuals) and the FDTL module (compliance monitoring).

### Completed features
- **Create Planned Flight** form: flight number, aircraft (from fleet), route (departure/destination), date, scheduled times, distance (NM), operation type, P1/P2 (from crew roster), and remarks.
- Writes planned flights via `addFlight` with `source: dispatch` and `status: planned`.
- **Flight Board** table of all shared flights with status and source badges, updated live via `onFlightsSnapshot`.

### Data flow
```
Dispatch (create planned flight) → companies/{companyId}/flights
        → EFB (records actuals) → FDTL (monitors compliance)
```

## Next Enhancements
- Daily dispatch board with crew and aircraft readiness.
- Mission legs and sector assignment.
- Dispatch checklist with document and currency validation gates.
- Push planned flights to assigned crew's EFB view.
