# Milestone 4 - Crew Management (Production Ready)

## Goal
Deliver a fully functional Crew Management module that Android and Web both use against the same Firestore schema.

## Deliverables
- Crew roster with search, compliance filter, role filter, and sorting.
- Crew profile inspection with document-level compliance visibility.
- Live Firestore synchronization for crew profiles, documents, and link requests.
- Connection status workflows for operator-to-pilot and pilot-to-operator flow.
- Role-based action permissions from a centralized permission service.
- Organization context abstraction service for module-level scoping.
- No direct Firestore access from module UI; service layer only.

## Acceptance Criteria
- [x] Crew list with search, filtering, and sorting.
- [ ] Crew profile page with dedicated route.
- [x] Live Firestore synchronization.
- [x] Document summary (valid, expiring, expired).
- [x] Connection status (operator <-> pilot).
- [x] Role-based permissions through service layer.
- [x] Shared services only (no direct Firestore access from UI).
- [x] Works without changing existing Firestore schema.

## Architecture Notes
- `services/organizationService.js`: derives current organization context from logged-in user profile.
- `services/permissionService.js`: central crew action permission map (`view`, `edit`, `delete`, `approve`, request actions).
- `modules/crew/crew.js`: consumes both services and keeps Firestore access routed through `services/crewService.js`, `services/documentService.js`, and sync/storage services.

## Next Sprint Scope
- Add dedicated Crew Profile route and panelized profile view.
- Add action-level permission badges/tooltips in Crew UI.
- Add reusable table component extraction after Crew interactions are stable.
