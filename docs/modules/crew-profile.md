# Crew Profile Module

Route: /crew-profile
Title: Crew Profile

## Current Build Snapshot
- Dedicated profile page reachable from Crew table Profile button.
- Tabbed sections: Personal, Documents, Training, Flight Experience, Notes, Connections, History.
- Pulls selected crew UID from session context.
- Displays compliance status and core profile metadata.
- Training records are derived from existing crew documents.
- Flight experience tab reads profile hour fields with safe defaults.
- Qualification matrix now surfaces core compliance areas (Licence, Medical, RTR, Passport, Visa, PPC, OPC, CRM, DG, IR).
- Notes tab surfaces operational notes and internal review metadata when present.
- History tab now combines profile/document, connection request, and embedded edit-log field-change events (when available on records).

## Next Enhancements
- Add dedicated training record data model and service.
- Add explicit recency and currency indicators (green/amber/red) with threshold rules.
- Add read support for edit-log subcollection (or denormalized audit feed) to guarantee full timeline fidelity.