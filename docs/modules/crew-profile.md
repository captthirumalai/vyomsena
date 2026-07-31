# Crew Profile Module

Route: /crew-profile
Title: Crew Profile

## Current Build Snapshot
- Dedicated profile page reachable from Crew table Profile button.
- Tabbed sections: Personal, Documents, Training, Flight Experience, Notes, Connections, History.
- Pulls selected crew UID from session context.
- Displays compliance status and core profile metadata.
- Training records are derived from existing crew documents.
- Dedicated training records are now read from training bookings by user and shown in Training tab, with document-derived fallback.
- Flight experience tab reads profile hour fields with safe defaults.
- Qualification matrix now surfaces core compliance areas (Licence, Medical, RTR, Passport, Visa, PPC, OPC, CRM, DG, IR).
- Currency and recency indicators now use explicit green/amber/red threshold rules.
- Notes tab surfaces operational notes and internal review metadata when present.
- History tab now combines profile/document, connection request, and embedded edit-log field-change events (when available on records).
- History now also includes training record activity and reads denormalized document audit entries (`recentAudit`) for rule-safe visibility.

## Next Enhancements
- Add create/update workflows for training records from web UI.
- Add role/fleet-specific threshold policy controls and centralized settings.
- Add role/fleet-specific threshold policy controls and centralized settings.