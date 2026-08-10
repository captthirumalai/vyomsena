# Crew Management Module

Route: /crew
Title: Crew Management

> **Crew V2 (single-screen UX) is implemented. See [`crew-v2-ux.md`](crew-v2-ux.md).**
> V1 remains feature-complete but UX-overloaded and is frozen. No new features are added to V1.

## Current Build Snapshot
- Live crew roster with real-time Firestore sync.
- Operator-owned `crew_profiles` roster with pre-link profile creation.
- 5-minute crew link code generation workflow for pilot app linking.
- Search, filter, and sort controls in roster list.
- One-crew navigation controls (prev/next/clear) and selected-crew context.
- Operator actions for linked crew: profile edit, status toggle, soft remove, and delink.
- Bulk status update action for all visible crew after filters.
- Connection request workflows (operator to pilot and pilot response).
- Document upload, edit, delete with offline queue retry.
- Compliance summary counters (valid, expiring, expired).
- Action permissions moved to permission service.
- Organization scoping moved to organization service.

## Why This Module Is Strategic
Crew data drives documents, training, currency, and operations planning. This is the first production-grade domain for cross-platform Android and web parity.

## Product Blueprint (10 Sections)

### 1. Crew Dashboard
Target:
- Total Crew
- Pilots
- AMEs
- Operations Staff
- Training Staff
- Active
- Suspended
- Documents Expiring
- Medical Expiring
- Licence Expiring

Target visuals:
- Crew by Role
- Crew by Base
- Documents by Status
- Training Due
- Currency Status

Current: Partially covered via summary counters.
Next: Add role and base breakdown cards plus compact chart row.

### 2. Crew Directory
Target columns:
- Photo
- Employee ID
- Name
- Role
- Designation
- Base
- Organization
- Mobile
- Email
- Status

Target functions:
- Search
- Filter
- Sort
- Export Excel
- Export PDF
- Bulk actions

Current: Search/filter/sort implemented for core fields.
Next: Add profile fields and export actions.

### 3. Crew Profile
Target:
- Personal details
- Documents
- Training
- Flight Experience
- Flight Hours
- Notes
- History
- Connections

Current: Dedicated Crew Profile route/page now includes Personal, Documents, Training, Flight Experience, Notes, Connections, and History tabs.
Next: Add deeper review workflows and full audit read path for timeline completeness.

### 4. Qualifications and Documents
Target:
- Licence, Medical, RTR, Passport, Visa, Endorsements, Ratings, authorizations, custom docs.
- Issue/expiry/status/reminders/attachments/history/editor metadata.

Current: Strong baseline with audit/sync queue, profile-level qualification matrix, and upload template presets for common doc/training types.
Next: Add workflow-driven qualification mapping and approval actions.

### 5. Training Management
Target:
- PPC, IPC, OPC, Simulator, Ground, CRM, DG, Security, HF, Emergency, Line Check, Recurrent.
- Due/completed/instructor/result/certificate fields.

Current: Dedicated training record service integrated (training bookings by user) with Crew Profile Training tab fallback to document-derived records.
Next: Add web create/update workflows, reminders, and instructor/result capture forms.

### 6. Flight Experience
Target:
- Total/PIC/SIC/night/instrument/cross-country/survey/instructor hours.
- Aircraft type-wise experience blocks.

Current: Flight Experience tab added in Crew Profile with profile hour metrics.
Next: Add aircraft-wise experience ledger and update workflows.

### 7. Crew Availability
Target statuses:
- Available, Flying, Standby, Leave, Sick, Training, Duty Travel, Rest, Off Duty.

Current: Not yet implemented.
Next: Add status calendar in Phase 3.

### 8. Crew Currency
Target indicators:
- Medical
- Licence
- IR
- PPC
- Recency
- DG
- CRM

Current: Currency and recency indicators now use explicit green/amber/red threshold logic in Crew Profile.
Next: Tune thresholds by role/fleet policy and add dashboard-level currency overview.

### 9. Crew Connections
Target:
- Operator connected pilot graph.
- Connection lifecycle and actions.

Current: Implemented and operational with live status.
Next: Add disconnect history and connection timeline.

### 10. Activity Timeline
Target:
- Chronological crew activity stream based on document and training events.

Current: Timeline now surfaces profile/document/request/training events and reads denormalized field-level document audits via `recentAudit`.
Next: Optionally expose immutable subcollection audit feed behind an elevated/admin path if rules change.

## Phase Plan

### Phase 1 - Crew Records and Compliance
In scope:
- Crew Dashboard baseline
- Crew Directory baseline
- Crew Profile baseline
- Documents
- Expiry alerts
- Connection requests
- Notifications

Status: In progress, major foundations complete.

### Phase 2 - Training and Currency
In scope:
- Training records
- Qualification matrix
- Currency dashboard
- Flight experience
- Company authorizations

Status: Planned.

### Phase 3 - Flight Operations Integration
In scope:
- Availability
- Duty roster
- Flight assignment links
- FDTL and leave workflows

Status: Planned.

### Phase 4 - Enterprise
In scope:
- Multi-organization extensions
- Advanced analytics
- Dispatch/Aircraft/Maintenance/EFB integrations

Status: Planned.

## Future TODO Inspired by Commercial Platforms
- Duty roster and crew calendar
- FDTL warning engine
- Crew assignment to flights
- Leave and day-off request workflow
- Push and email notification center
- Mobile schedule and qualification views
- Operational document distribution with read acknowledgements
- Duty hotel and travel tracking
- Logbook export
- Deeper integration with maintenance and dispatch modules

## Next Implementation Slice (Recommended)
1. Add pilot-side Android link verification flow for `crew_link_codes`.
2. Add workflow-driven qualification mapping and approval states.
3. Add dashboard-level currency overview and role-based threshold policy controls.
4. Add optional backend verification endpoint for one-time code redemption.
