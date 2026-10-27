# Admin Model Blueprint (Web = Admin, Android = Sync/Read)

## Purpose
This document defines the operator-admin operating model for VyomSena:

- **Web app** is the central control plane. All create, edit, and delete actions happen here.
- **Android app** is a thin client. It syncs data and presents it read-only; it does not drive shared data.
- The same Firebase project and data contract are shared by both platforms, so this is an access/ownership model, not a fork of data.

This document is the blueprint that later modules (flight documents, company document management) follow.

## Product Direction
- One Firebase identity per user.
- Web = company/operator (admin) surface.
- Android = pilot surface (read/sync).
- The operator owns and curates all shared records; pilots consume them.
- Android must tolerate that the web app is authoritative for linked data and must not assume it may create or edit it.

## Data Ownership Map
| Collection | Owner (creates/edits/deletes) | Android client behavior |
| --- | --- | --- |
| `crew_profiles` | Web (operator). Created in Crew Management using Add Pilot or migrated from legacy linked accounts. | Read/sync only. |
| `users/{uid}` | Self-service registration (identity); operator writes `linkedOperator`/`crewProfileId` when assigning. | Reads own profile; preserves additive fields. |
| `user_documents` | Web (operator) uploads and maintains crew documents; `operatorId`, `userId`, `readers[]` identify scope. | Read/sync only; downloads for offline access. |
| `connection_requests` | Legacy request/accept flow. Web no longer creates new requests; kept for migration and history. | No new writes. |
| `crew_link_codes` | Legacy pilot-link path retained for migration only. | Not part of current Company Home access. |
| `admin_users` | Web seeds `admin_users/{operatorUid}` once at workspace creation so the webapp can write. | Read none / ignored. |
| `companies` | Web (operator) creates `companies/{companyId}` with `{ name, base, code, ownerEmail }`. | Read/sync for company context. |
| `company_accounts` | Web (operator) creates `company_accounts/{accountId}` with `{ companyId, role, displayName, email }`. | Read own account. |
| `company_invites` | Legacy six-digit Company Home invite path. | Not used by the current web Linking module. |
| `companies/{companyId}/{module}` | Web (operator) writes module data (crew, aircraft, ...). | Read/sync live. |

## Core Rules
1. The roster's single source of truth is `crew_profiles` scoped by `operatorId`.
2. A pilot becomes rosterable when a `crew_profiles/{uid}` document exists for the operator.
3. Direct assign: the operator enters a registered pilot email; the web app resolves the `users` account, materializes/updates the crew profile, and writes the operator link. No pilot acceptance step.
4. Company Home access is issued only in the Linking module. Pilot credentials bind to a real Crew Management Add Pilot profile; the Company User ID/passcode authenticates through the server callable.
5. Android may read/sync the company modules it is granted, but must not create/edit/delete crew profiles or documents unless a future module explicitly grants an edit capability.
6. Company Home users authenticate through the `verifyCompanyUser` callable. Module grants are included in custom-token claims. `docs/firestorerules.md` is configured in `firebase.json` and deployed to `vyomsena-888` on 2026-10-27.

## Roster Resolution (crew_profiles only)
- `getCrew(operatorUid)` / `onCrewSnapshot(operatorUid, ...)` return **`crew_profiles` only**.
- Migration bridge: linked pilots (`users.linkedOperator`) and legacy accepted requests are **materialized** into `crew_profiles` via `ensureCrewProfileForUser`, then the display reads profiles only.
- Deduplication is by `uid`, `pilotUid`, or lowercase `email`.

## Direct Assign Flow (new)
1. Operator opens Crew > Linking > Assign Pilot.
2. Enters the registered pilot's email.
3. `assignPilotByEmail({ operatorUid, pilotEmail })`:
   - Resolves the `users` account by email (`findUserByEmail`).
   - Validates the account role is `PILOT`.
   - Materializes/updates `crew_profiles/{pilotUid}` (`ensureCrewProfileForUser`).
   - Writes `users/{pilotUid}.linkedOperator` and `crewProfileId`.
4. Roster updates in real time via the crew snapshot; no acceptance required.

## Document Model
- Documents live in `user_documents` with `operatorId` (owning operator), `userId`/`pilotUid` (subject), and `readers[]` (who may view).
- Web maintains and verifies crew documents (compliance, expiry).
- Android syncs the crew member's documents for offline read and download.
- This shape scales to future shared/company documents: introduce a `scope`/`type` field and reuse `readers[]` for sharing.

## Company Workspace Model

The company workspace replaces the legacy bootstrap fields on `users` with dedicated collections:

1. **`admin_users/{uid}`** — seeded once with the operator's UID so the web app is granted write access.
2. **`companies/{companyId}`** — `{ name, base, code, ownerEmail }`, created at workspace registration.
3. **`company_accounts/{accountId}`** — `{ companyId, role, displayName, email }`, one per workspace member.
4. **`company_users/{companyUserId}`** — the Linking module issues `CMU-…` IDs, one-time passcodes, and per-module access grants for pilots and other company staff.
5. **`companies/{companyId}/crew`, `/aircraft`, ...** — module data written under the company so Android syncs it live.

Company Home people and device access are centrally managed in the `/linking` module. It issues Company User IDs and passcodes, binds pilot accounts only to eligible Crew Management Add Pilot records, and stores module grants. See `docs/linking-module.md`.

Registration (`registerWorkspace`) and operator sign-in (`bootstrapCompanyWorkspace`) create the workspace once and are idempotent. Company Home user issuance and module permissions live in `/linking` and `services/companyUserService.js`.

## Rules Roadmap (when Android is read-only ready)
| Phase | Rule |
| --- | --- |
| 1 (now) | Keep existing permissive rules; web-first. |
| 2 | `crew_profiles`: write allowed only for operators owning the profile; Android read-only. |
| 3 | `user_documents`: create/update/delete only by owning `operatorId`; Android read + download. |
| 4 | Storage: write only by owning operator; Android read/download matching `user_documents`. |
| 5 | `connection_requests`: disable new writes from web; archive/migrate to profiles. |

## Module Checklist (applies this admin model to each area)
- [x] Crew profiles: roster is `crew_profiles`-only; direct assign; link-code assign; materialization bridge.
- [ ] Crew documents: web-owned maintenance; Android read/sync (already read-capable).
- [ ] Flight documents: web-created, scoped to crew, shared via `readers[]`.
- [ ] Company document management: new module following the same ownership pattern.

## Non-Goals for This Pass
- Tightening Firestore/Storage rules.
- Changing Android app rules or behavior.
- Removing legacy `connection_requests` data (kept for migration).
