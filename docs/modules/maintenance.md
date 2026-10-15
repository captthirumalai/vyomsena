# Maintenance Hub Module

Route: /maintenance
Title: Maintenance Hub

## Current Build Snapshot

- **Fleet manager**: add/edit/remove company aircraft registrations (`companies/{companyId}/aircraft`, document ID = registration). Fields: registration (uppercase, immutable on edit), type, status (Operational / Maintenance / Grounded), next inspection date. Live table via `onCompanyAircraftSnapshot`.
- Fleet is the **single source of aircraft registrations** for operations: Dispatch reads the same collection live for its aircraft dropdown and readiness KPIs (only `Operational` counts as ready; anything else raises a dispatch constraint). Removing an aircraft never rewrites past flight history (movements keep the registration string).

## Next Enhancements
- Aircraft maintenance events and due schedule.
- Defect logging with severity and closure workflow.
- Technical release workflow.
