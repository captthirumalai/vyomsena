# Crew Profile Module

Route: /crew-profile
Title: Crew Profile

## Current Build Snapshot
- Dedicated profile page reachable from Crew table Profile button.
- Tabbed sections: Personal, Documents, Training, Flight Experience, Connections, History.
- Pulls selected crew UID from session context.
- Displays compliance status and core profile metadata.
- Training records are derived from existing crew documents.
- Flight experience tab reads profile hour fields with safe defaults.
- History tab now combines profile/document and connection request events.

## Next Enhancements
- Add notes and internal review fields.
- Add dedicated training record data model and service.
- Expand history with document edit log details (field-level diffs).
- Add qualification matrix and currency indicators.
+