# Crew Management Module

Route: /crew
Title: Crew Management

## Current Build Snapshot
- Live crew roster with real-time Firestore sync.
- Search, filter, and sort controls in roster list.
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

Current: Dedicated Crew Profile route/page now includes Personal, Documents, Training, Flight Experience, Connections, and History tabs.
Next: Add Notes tab and richer timeline detail from edit logs.

### 4. Qualifications and Documents
Target:
- Licence, Medical, RTR, Passport, Visa, Endorsements, Ratings, authorizations, custom docs.
- Issue/expiry/status/reminders/attachments/history/editor metadata.

Current: Strong baseline already in place with audit and sync queue.
Next: Template categories, status matrix, and qualification mapping.

### 5. Training Management
Target:
- PPC, IPC, OPC, Simulator, Ground, CRM, DG, Security, HF, Emergency, Line Check, Recurrent.
- Due/completed/instructor/result/certificate fields.

Current: Training tab added in Crew Profile using existing document records.
Next: Add dedicated training record model, reminders, and instructor/result fields.

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

Current: Document compliance only.
Next: Add currency matrix with green/amber/red logic.

### 9. Crew Connections
Target:
- Operator connected pilot graph.
- Connection lifecycle and actions.

Current: Implemented and operational with live status.
Next: Add disconnect history and connection timeline.

### 10. Activity Timeline
Target:
- Chronological crew activity stream based on document and training events.

Current: Edit logs available at data layer.
Next: Surface edit_logs and request events as unified timeline UI.

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
1. Add Notes tab and internal review fields to Crew Profile.
2. Add richer timeline detail from edit_logs field-level changes.
3. Add qualification matrix and document template presets.
4. Add training due reminders and currency indicators.
