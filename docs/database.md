# VAMS V2 Firestore Contract

This document defines the shared Firestore schema contract used by both Android and Web.

## Contract rule

Treat Firestore schema as an API contract.

- Keep collection names stable.
- Keep field names stable.
- Additive changes are preferred.
- Breaking changes require coordinated Android + Web updates.

## Top-level collections

- `users`
- `user_documents`
- `connection_requests`
- `access_codes`
- `training_centers`
- `training_offerings`
- `training_bookings`
- `operator_training_records` (web-only, operator managed)
- `crew_profiles` (web-only, operator managed)
- `crew_link_codes` (legacy pilot-link tokens; not used for Company Home)
- `admin_users` (web-only, server-managed administrator role and company scope)
- `companies` (web-only, operator owned)
- `company_accounts` (web-only, operator managed)
- `company_invites` (legacy six-digit invite records; no longer issued by the web app)
- `company_users` (Admin-issued Company User registry for Company Home; opaque `CMU-…` IDs, scrypt passcode hashes, per-module permissions, optional pilot link)
- `companies/{companyId}/people` (company operations and technical staff source records used by Linking)
- `company_members` (legacy anonymous Company Home sessions)

> `company_invites` and `company_members` are legacy paths for the earlier six-digit Company Home invite design. The current web Linking module issues `company_users` credentials and verifies them through a Firebase custom-token callable; see [linking-module.md](linking-module.md).

## users

Document key: `uid`

Required fields:

- `uid`
- `name` (legacy-compatible)
- `fullName` (preferred display field)
- `email`
- `role`
- `linkedOperator`
- `createdAt`

Optional fields:

- `operatorType`
- `organizationName`
- `organizationCode`
- `organizationBase`
- `companyPhone`
- `lastModified`

These workspace bootstrap fields are currently captured during company web registration and can later seed a dedicated `organizations` / `memberships` model without breaking the existing contract.

## user_documents

Document key: generated `firestoreId`

Core fields:

- `userId`
- `userName`
- `documentCategory`
- `documentName`
- `issueDate`
- `expiryDate`
- `issuingAuthorityOrBody`
- `licenseOrCertificateNumber`
- `operatorId`
- `readers`
- `lastEditedBy`
- `lastModified`
- `reminderLeadTimeDays`

Optional audit-read fields (web timeline support under current rules):

- `recentAudit` (array of latest field-change entries)
- `lastEditLog` (latest field-change entry)

Cross-platform file reference fields:

- `documentUri` for Android-local references (for example: `content://...`)
- `storagePath` for shared file access (for example: `documents/pilot123/license.pdf`)

Web upload path convention (parity-safe):

- `documents/{userId}/{documentId}/{fileName}`
- `documentId` matches `user_documents.firestoreId` when web uploads a new file.

Subcollection:

- `user_documents/{documentId}/edit_logs`

Note: under current rules, `edit_logs` is write-only from clients. Web timeline therefore reads `recentAudit`/`lastEditLog` from parent document for audit visibility.

## Crew feature mapping (Android + Web)

Crew is modeled using shared collections with an operator-owned web profile layer.

- Web crew profile source: `crew_profiles`
- Pilot identity source: `users`
- Pilot documents source: `user_documents`

Crew-relevant user fields used by clients:

- `uid`
- `name`
- `email`
- `role` (`PILOT` for pilot profiles)
- `linkedOperator`
- `createdAt`
- `lastModified` (optional)

Crew-relevant document fields used by clients:

- `userId`
- `userName`
- `documentCategory` (for example: `MEDICAL`, `LICENCE`)
- `documentName`
- `licenseOrCertificateNumber`
- `issueDate`
- `expiryDate`
- `issuingAuthorityOrBody`
- `reminderLeadTimeDays`
- `readers`
- `storagePath`
- `documentUri`
- `lastEditedBy`
- `lastModified`

Current web crew coverage:

- Create operator-owned crew profiles.
- Generate short-lived link codes for pilot app linking.
- List and manage crew profiles for current operator.
- Compute compliance states from document expiry (`Valid`, `Expiring`, `Expired`).
- Delink or soft-remove crew profiles.
- Inspect full pilot document metadata from Firestore in module UI.
- Upload/delete pilot documents using shared storage path conventions.
- Send outgoing connection requests as operator.

Current pilot action boundary:

- Pilot-side connection request acceptance and personal document workflows belong to the Android app.
- Pilot users are not expected to enter the web shell.

Rule-constrained behavior in current web UI:

- Hard delete of pilot identity in `users` remains disabled for operator roles.
- Operator-side request cancellation is disabled (`/connection_requests` delete is denied).

## connection_requests

Document key: generated `requestId`

Fields:

- `requesterId`
- `recipientId`
- `requesterName`
- `requesterEmail`
- `recipientEmail`
- `status` (`PENDING`, `ACCEPTED`, `DECLINED`; legacy value `REJECTED` may still appear)
- `createdAt`
- `lastModified`

## access_codes

Document key: generated `accessCodeId` (or app-defined doc id)

Fields:

- `code`
- `pilotId`
- `operatorId` (optional)
- `expiresAt`
- `createdAt`

## training_centers, training_offerings, training_bookings

Training collections are intentionally independent from core operations.

- `training_centers`: provider/master data
- `training_offerings`: courses/programs mapped to centers
- `training_bookings`: user booking records and status

Field compatibility notes for current rules:

- `training_centers` documents are owner-scoped by doc id (`{uid}`).
- `training_offerings` ownership field must include `trainingCenterId`.
- `training_bookings` deletes are disallowed by rules.

## operator_training_records (web-only)

This collection is additive and does not replace Android training collections.

- Purpose: operator-managed crew training records for web workflows.
- Owner field: `operatorId`.
- Crew linkage: `userId` (pilot uid).
- Suggested fields:
	- `operatorId`
	- `userId`
	- `trainingType`
	- `trainingCode` (optional)
	- `completedAt` (optional)
	- `dueAt` (optional)
	- `status`
	- `instructor` (optional)
	- `result` (optional)
	- `certificateNumber` (optional)
	- `notes` (optional)
	- `readers` (optional)
	- `createdAt`
	- `lastModified`

Rule model:

- Operator or active company admin creates/updates/deletes records scoped to their own `operatorId`/company.
- Pilot can read own record.
- Linked operator or active company admin can read pilot records in their company.

## crew_profiles (web-only)

This collection is additive and is the operator-owned roster source for web workflows.

- The owning operator and active web admins for that operator's company can read and manage these profiles.
- Admin access is determined from the server-managed `admin_users/{uid}` grant and is restricted to its `companyId`.

- `crewProfileId`
- `operatorId`
- `pilotUid` (nullable until linked)
- `linkState` (`UNLINKED` / `LINKED`)
- `name`
- `fullName`
- `email`
- `role`
- `status`
- `provisioningSource` (optional; `CREW_ADD_PILOT` marks profiles created through the Crew Management Add Pilot action)
- `designation`
- `organizationBase`
- `mobile`
- `createdAt`
- `lastModified`

## crew_link_codes (web-only)

Short-lived link tokens generated by operator for pilot app linking.

- `tokenId`
- `crewProfileId`
- `operatorId`
- `code`
- `used`
- `status` (`ACTIVE` / `SUPERSEDED` / `USED`)
- `expiresAt`
- `createdAt`
- `lastModified`

## admin_users (web-only)

Document key: `uid` (Firebase Auth UID of the operator)

Created once so the web app can write on behalf of the operator.

- `uid`
- `email`
- `displayName`
- `companyId`
- `role` (`OWNER` / `ADMIN`)
- `status`
- `createdAt`
- `lastModified`

## companies (web-only)

Document key: `companyId` (operator UID for the registering company)

- `companyId`
- `name`
- `base`
- `code`
- `ownerEmail`
- `ownerUid`
- `createdAt`
- `lastModified`

## company_accounts (web-only)

Document key: generated `accountId` (owner uses `{uid}`)

- `accountId`
- `companyId`
- `role` (`OWNER` / `ADMIN` / `OPERATIONS` / `PILOT` / `MEMBER`)
- `displayName`
- `email`
- `uid` (optional, Firebase Auth UID once registered)
- `status`
- `createdAt`
- `lastModified`

## company_invites (legacy)

Legacy collection. The current web app does not create or redeem these records; use `company_users` and the `verifyCompanyUser` callable for Company Home.

Document key: the 6-digit `code` itself

Older six-digit invite records may remain in Firestore. The web app no longer issues or redeems them.

- `code`
- `companyId`
- `accountId`
- `email`
- `role`
- `createdAt`
- `expiresAt` (`now + 5 min`)
- `usedBy` (nullable)
- `usedAt` (nullable)

## company_users (Admin-issued, Company Home auth)

Document key: opaque generated `companyUserId` (`CMU-…`, never an email or Firebase UID)

Separate identity from Aviation accounts (`users/{uid}`) and Pilot records (`crew_profiles/{id}`). Passcode shown once at issuance/reset and stored only as a scrypt hash. Verification is server-side via callables (`verifyCompanyUser` → Firebase custom token); token claims include compact module view/edit permissions. Direct client access is deny-by-default.

- `companyUserId`
- `companyId`
- `displayName`
- `role`
- `permissions` (`{ modules: { name: { view, edit } } }`)
- `linkedCrewProfileId` (nullable reference to an EXISTING `crew_profiles/{id}`)
- `linkedPersonId` (nullable reference to an existing `companies/{companyId}/people/{id}` staff record; required for newly issued Operations/Technical users)
- `status` (`ACTIVE` / `SUSPENDED`)
- `passcodeHash` (scrypt; plaintext never persisted)
- `failedAttempts`, `lockedUntil` (nullable; login throttling)
- `createdBy` (nullable issuing admin uid)
- `createdAt`
- `lastModified`
- `lastLoginAt` (nullable)

## companies/{companyId}/people (Operations and Technical staff)

Document IDs are generated by Firestore. Flight Ops creates `OPERATIONS` records and Maintenance creates `AME` records. Each record includes `companyId`, `displayName`, `role`, `status`, `createdBy`, `createdAt`, and `lastModified`. Linking lists only active records matching the selected access type, and Cloud Functions verify the company, role, and status before issuing or updating an account.

## Company module data (web-only)

Module records are written under `companies/{companyId}/{module}` subcollections so the Android app can sync them live:

- `companies/{companyId}/crew` — crew roster mirror (copied from `crew_profiles`)
- `companies/{companyId}/aircraft` — fleet records
- `companies/{companyId}/flights` — shared operational flights (see contract below)
- `companies/{companyId}/manuals` — EFB controlled manuals (see contract below)
- Additional modules (`dispatch`, `maintenance`, etc.) follow the same subcollection shape.

Field conventions reuse the shared rules from the crew/document model: `companyId`, `createdAt`, `lastModified`, plus module-specific fields.

### companies/{companyId}/flights (web-only, cross-module)

Shared operational flight record used by the Dispatch (creation), EFB (actuals) and FDTL (compliance monitoring) modules.

Document key: generated `flightId`

Fields:

- `flightId`
- `companyId`
- `flightNumber`
- `aircraftReg` (optional)
- `departure` (ICAO code)
- `destination` (ICAO code)
- `route` (optional, free text)
- `flightDate` (ISO date, e.g. `2026-08-14`)
- `scheduledDeparture` / `scheduledArrival` (optional ISO timestamps)
- `distanceNM` (optional number)
- `operationType` (optional; e.g. commercial / positioning / training / test)
- `p1` (object `{ name, crewProfileId, uid? }`)
- `p2` (object `{ name, crewProfileId, uid? }`, optional)
- `crewProfileIds` (array of involved `crewProfileId`s)
- `remarks` (optional)
- `status` (`planned` | `active` | `completed` | `cancelled`)
- `source` (`dispatch` | `efb` | `manual`)
- `fops` (Flight Ops planned times, optional object):
  - `chocksOff`, `chocksOn`, `takeoff`, `landing` (ISO timestamps)
- `efb` (EFB actuals, optional object):
  - `chocksOff`, `chocksOn`, `takeoff`, `landing` (ISO timestamps)
  - `irTimeMinutes`, `xcTimeMinutes` (numbers)
  - `recordedByUid`, `recordedByName` (optional)
  - `recordedAt` (timestamp)
- `reconciliation` (optional object):
  - `status` (`verified` | `mismatch` | `resolved`)
  - `toleranceMinutes` (number, default 5)
  - `field` (the first differing field, when in `mismatch`)
  - `resolution` (`efb` | `fops`), `resolvedAt`, `resolvedByUid`
- `flightTimeMinutes` / `blockTimeMinutes` (optional numbers, computed)
- `createdByUid`
- `createdAt`
- `lastModified`

Subcollections:

- `companies/{companyId}/flights/{flightId}/audit` — per-flight audit entries (who, when, entity, field, before, after, reason, source).

### companies/{companyId}/manuals (EFB Manual Distribution)

Controlled company manuals (EFB → Manual Distribution tab). Master records live in the `manuals` subcollection; each manual owns an immutable revision history in a nested subcollection. Service layer: `services/manualService.js`.

Document key: generated `manualId`

Master fields:

- `companyId`
- `title` (required)
- `documentNumber` (e.g. `OM-001`)
- `category` (one of: Operations Manual, Standard Operating Procedures, Safety Management System, Emergency Response Manual, Training Manual, Maintenance Manual, Security Manual, Aircraft Flight Manual, Aircraft Maintenance Manual, Checklists, Other)
- `description`, `aircraftApplicability`, `department`, `documentOwner` (optional strings)
- `issueNumber`, `revisionNumber` (strings/numbers, mirrored from the current revision on publish)
- `issueDate`, `revisionDate`, `effectiveDate`, `nextReviewDate` (ISO date strings)
- `preparedBy`, `reviewedBy`, `approvedBy` (internal approval — kept separate from regulatory)
- `regulatoryApprovalStatus` (Not Applicable | Pending | Submitted | Approved | Rejected), `approvalReference`, `approvalDate`
- `acknowledgementRequired` (boolean — consumed by M3 acknowledgement generation)
- `distribution` (versioned target object; see Distribution targeting below; omitted legacy values mean company-wide)
- `status` — `draft` | `in_review` | `published` | `archived`
  - **Legacy compat:** V0.4.13 records used `active` (renders as `published`) and `uploading` (renders as `draft`). Existing records remain readable unchanged.
- `currentRevisionId` — latest published revision (null for legacy V0.4.13 manuals)
- `currentRevisionEffectiveDate`, `currentDistribution` — validity date and targeting snapshot of the latest published revision; clients choose this revision/target when its effective date has arrived
- `effectiveRevisionId` — operational revision pointer
- `distribution` — targeting policy for the currently effective revision (legacy missing values mean company-wide)
- `documentUri`, `storagePath`, `fileName`, `size`, `contentType`, `pdfChecksum` (SHA-256), `checksumVerified` — denormalised pointers to the **effective** file (legacy flat-path values for V0.4.13 manuals)
- `archivedAt`, `uploadedBy`, `createdAt`, `lastModified`

Compatibility: persisted fields including `documentNumber`, `documentOwner`, and `documentUri` are retained as-is for existing web, Android, Cloud Function, and historical-data consumers. `user_documents` and `documents/{userId}/{documentId}/{fileName}` belong to pilot-document workflows and are unrelated to EFB Manuals; no collection, field, ID, or Storage path migration is part of the terminology audit.

#### companies/{companyId}/manuals/{manualId}/revisions/{revisionId} (immutable)

Document key: generated `revisionId`. Revision records and their files are never overwritten; corrections create a new revision.

- `manualId`, `revisionNumber`, `issueNumber`
- `issueDate`, `effectiveDate` (ISO date strings)
- `reason` (required to publish), `affectedChapters`, `affectedPages`
- `preparedBy`, `reviewedBy`, `approvedBy`, `regulatoryApprovalStatus`, `approvalReference`, `approvalDate`
- `status` — `draft` | `published` | `superseded` | `withdrawn`
- `distribution` — versioned target object effective for this revision
- `fileName`, `size`, `contentType`, `storagePath`, `documentUri`
- `sha256` (SHA-256 of the uploaded bytes; a revision is accepted only after a re-download verifies it), `checksumVerified` (true for new revisions; null may appear on legacy data)
- `createdBy`, `publishedAt`, `createdAt`, `lastModified`

Storage paths:

- Legacy (V0.4.13, preserved): `manuals/{companyId}/{manualId}/{fileName}`
- Revisions (immutable): `manuals/{companyId}/{manualId}/revisions/{revisionId}/{fileName}`
- Temporary revision attachments (immutable; attachment revision ID is unique for each uploaded file): `manuals/{companyId}/{manualId}/revisions/{attachmentRevisionId}/{fileName}`

Deletion policy: only `draft` masters may be permanently deleted (all revision files + records are cleaned up). Published manuals are archived, never deleted. Firestore rules: the generic `companies/{companyId}/{module}/{document=**}` rule covers both the master and nested revision paths.

#### Distribution targeting (M2)

`distribution` is stored on the manual master and on each permanent revision. A value is versionable and independent of manual ownership:

```json
{
  "version": 1,
  "type": "criteria",
  "roles": ["PILOT"],
  "departments": ["Flight Operations"],
  "aircraftTypes": ["C208B"],
  "aircraftRegistrations": ["VT-IIC"],
  "userIds": []
}
```

- `type`: `company` (entire company), `criteria`, or `users`.
- For `criteria`, selected dimensions are ANDed; multiple values within a dimension are ORed. Empty dimensions do not restrict the audience. At least one resolvable criterion is required.
- For `users`, `userIds` contains stable company-user identifiers (Firebase UIDs, linked crew IDs, or opaque `companyUserId`s), never email addresses.
- `roles`, `departments`, `aircraftTypes`, and `aircraftRegistrations` are arrays of strings. Empty/legacy `distribution` is interpreted as `{ "version": 1, "type": "company", ... }` to preserve M1 behavior.
- The web recipient resolver only uses company-scoped, active records: `company_accounts` members, linked `crew_profiles`, Company Users returned by the admin-checked callable, company people, company aircraft, and flight crew-to-aircraft assignments. Department and aircraft filters are offered only when corresponding data exists. A criterion with no resolvable records is rejected; it is never widened to company-wide. No reliable total is exposed for company-wide targeting.
- Current aircraft targeting is based on company flight assignments (crew profile IDs linked to the active company roster). It does not infer a person's fleet from their role, and does not assume missing department or aircraft data.

Android matching contract: use the authenticated user's stable UID/Company User ID and linked crew identifier(s) to match `userIds`; compare role, department, aircraft type, and registration against the user's company-scoped profile and aircraft assignments. Never match by email or across `companyId`. For a permanent manual with a future current revision, retain the previous `distribution`/`effectiveRevisionId` until `currentRevisionEffectiveDate`; after that date, use `currentDistribution` and the current revision file even if no server-side scheduled pointer mutation has run. The same service-level date rules apply to temporary revisions. A manual or revision is eligible only when its distribution matches and its effective status is `effective`.

#### Temporary revisions

Temporary revision metadata is separate from permanent revision history but remains under its existing parent manual:

`companies/{companyId}/manuals/{manualId}/temporary_revisions/{temporaryRevisionId}`

Fields:

- `companyId`, `manualId`, `title`, `referenceNumber`, `temporaryRevisionNumber`
- `description`, `reason`, `affectedChapters`, `affectedPages`
- `aircraftApplicability`, `department`
- `issueDate`, `effectiveFrom`, `effectiveUntil` (ISO `YYYY-MM-DD`; effective-until is inclusive)
- `preparedBy`, `reviewedBy`, `approvedBy`, `approvalReference`, `regulatoryApprovalStatus`
- `distribution` (same version-1 object and matching semantics as permanent revisions)
- `status`: `draft` | `in_review` | `published` | `withdrawn`. Expiry is derived from the validity dates and does not require a client-side write or scheduled status mutation.
- `attachmentRevisionId`, `fileName`, `size`, `contentType` (`application/pdf`), `storagePath`, `documentUri`, `sha256`, `checksumVerified`
- `attachmentHistory` (prior immutable attachment metadata when a draft attachment is replaced)
- `createdBy`, `publishedAt`, `withdrawnAt`, `createdAt`, `lastModified`

Temporary revision PDF objects use the immutable storage path `manuals/{companyId}/{manualId}/revisions/{attachmentRevisionId}/{fileName}` and are accepted for publication only when the SHA-256 checksum is successfully re-downloaded and verified. The web client hashes the selected bytes, then the authenticated admin-only `verifyManualRevisionChecksum` callable downloads the object with the Firebase Admin SDK and compares its digest; verification does not rely on browser cross-origin media fetch/CORS. Temporary revisions require a published parent manual to publish. Effective-until must be later than effective-from. Publication requires an approver; when regulatory approval is applicable it must be `Approved` and include an approval reference and date.

`evaluateEffectiveStatus(manualRecord, referenceDate)` is the shared service-level date evaluator. It returns `draft`, `in_review`, `published_not_yet_effective`, `effective`, `expired`, `withdrawn`, or `archived`. A published manual or revision is effective on and after its effective date and through its inclusive effective-until/expiry date; it is expired after that date. Withdrawn/archived manuals and revisions are never effective. Reaching an effective date never publishes a draft. Web evaluates temporary revision validity at read/render time; no browser timer or expiry mutation is required. Android should apply the same date rules locally and re-evaluate after refresh.

Temporary revision details, distribution criteria, attachment metadata, and checksums are browser-independent Firestore values so the Android Kotlin client can list eligible manuals, verify downloads, identify future-effective/expired/withdrawn items, and save eligible PDFs for offline use. Android UI, download synchronization, and offline storage are not part of M2.

#### Revision acknowledgement metadata (M3)

The permanent revision snapshots the parent manual's `acknowledgementRequired` setting when the revision is created; a temporary revision snapshots it when published. The server requires the flag on the exact revision document, so older revisions without the snapshot are not retroactively made acknowledgement-required. Later master metadata or distribution changes do not rewrite existing acknowledgement records.

Published revision tracking fields:

- `acknowledgementRequired` (boolean snapshot)
- `distributionVersion` (monotonically increasing integer; starts at 1)
- `acknowledgementGeneration.status` (`not_required` | `processing` | `complete` | `incomplete`)
- `acknowledgementGeneration.total`, `acknowledged`, `pending`, `distributionVersion`, `completedAt`, `lastError`, `redistributionStatus`, `redistributionError` (aggregate state; error text is bounded and contains no recipient data)
- `distributionHistory[]` (explicit redistribution versions, target snapshot, admin UID, and server-side redistribution time)

Manual acknowledgement records are nested under the existing manual; no parallel manual collection is introduced:

`companies/{companyId}/manuals/{manualId}/acknowledgements/{acknowledgementId}`

`acknowledgementId` is deterministic: `v1-` plus the SHA-256 hex digest of `companyId + U+001F + manualId + U+001F + revisionType + U+001F + revisionId + U+001F + userId`. Including `revisionType` avoids collisions between permanent and temporary revision subcollections. This makes requirement creation idempotent and prevents duplicate acknowledgement records for the same recipient and exact revision.

Fields:

- `companyId`, `manualId`, `revisionId`, `revisionType` (`permanent` | `temporary`)
- `documentNumber`, `documentTitle`, `issueNumber`, `revisionNumber` (revision-specific historical snapshot)
- `userId` (authenticated stable Firebase UID or Company User ID; never email), `userNameSnapshot`, `userEmailSnapshot`
- `departmentSnapshot[]`, `aircraftSnapshot[]`
- `distributionVersion`, `acknowledgementRequired` (`true`)
- `status` (`pending` | `acknowledged`), `publishedAt`, `acknowledgedAt`, `acknowledgedBy`, `createdAt`, `lastModified`

The user and revision snapshots intentionally contain only the fields needed for the acknowledgement report and history. `pending`/`acknowledged` are stored states. UI lifecycle labels `superseded`, `withdrawn`, and `expired` are derived from the exact revision and parent manual; these do not delete or overwrite historical records.

Requirement generation resolves the saved M2 target against active company accounts, Company Users, company members, company admins, linked crew profiles, company departments/people, aircraft and flight assignments. The acknowledgement `userId` is the authenticated Firebase UID, not email or a profile ID. The server validates every criterion and fails closed on unresolved or empty targets. It never trusts a client-provided recipient list. Generation is callable-backed, uses deterministic document IDs, a short generation lock and an idempotent writer; retries only create missing records. Initial generation is marked `incomplete` when recipient resolution or writes fail, and an admin can retry. If the callable cannot be reached at all, the dashboard shows an ungenerated/incomplete state and offers retry. Acknowledgement status changes use an authenticated callable transaction; the server derives the user/company from verified auth and checks membership, target record ownership, revision publication state, and acknowledgement requirement. A duplicate submission is an idempotent success and does not change timestamps or counters.

Redistribution is a separate admin action. It increments `distributionVersion`, records the new target in `distributionHistory`, and creates requirements only for additional users not already represented by the deterministic revision/user key. Existing pending or acknowledged recipients and prior versions are preserved. If redistribution fails, the prior completed generation and audience remain usable, uncommitted next-version records are hidden from users, and `redistributionStatus` is marked `incomplete`; an admin can retry the explicit redistribution. A normal metadata edit never rewrites the publication-time audience.

Admin dashboard aggregate counts are stored on each exact revision and updated on successful generation and transactional acknowledgement. Percentages are calculated per revision. Recipient details are loaded on demand in pages of up to 100 and are not maintained as per-recipient listeners. The `acknowledgements` composite index is configured in `firestore.indexes.json`: `revisionId ASC, userId ASC` for the revision recipient query.

Client modules call the `manualService`/`manualAcknowledgementService` layers only. Callable operations are `createManualAcknowledgementRequirements`, `getMyManualAcknowledgements`, `acknowledgeManualRevision`, `getManualAcknowledgementSummary`, `getManualAcknowledgementRecipients`, and `redistributeManualRevision`. Acknowledgement reads use callables rather than broad client listeners so the server can enforce self-only user reads and admin-only company reports. The web client does not queue acknowledgements offline or report success before the server confirms the transaction.

Android contract: query the authenticated user's pending/history records from the server, fetch the exact `manualId + revisionId + revisionType`, show that exact PDF and verify its `sha256` before presenting acknowledgement, then submit only the revision identifiers to the authenticated acknowledgement operation. The server timestamp is authoritative. Offline viewing may use a locally cached verified file, but offline acknowledgements must remain visibly unsent/local-pending and may only be queued for retry; do not display them as server-acknowledged until the authenticated request succeeds. On retry, the deterministic record and transaction make duplicate submissions safe. If a revision becomes withdrawn, expired or superseded before submission, the server rejects it and the client should refresh the revision state. This is an acknowledgement record, not a legally binding electronic signature or regulatory approval.

Security boundary: direct writes to the manuals subtree (including acknowledgement records) are restricted to active company admins; ordinary users submit acknowledgements only through authenticated Cloud Functions. This is a narrow M3 protection, not comprehensive M4 rules hardening. M4 must additionally review all company module write grants, storage rules, publication authorization, callable abuse/rate limits, and Firestore/Storage emulator behavior.

Web service API: `createTemporaryRevision`, `updateTemporaryRevision` (draft only), `listTemporaryRevisions`, `onTemporaryRevisionsSnapshot`, `submitTemporaryRevisionForReview`, `publishTemporaryRevision`, `withdrawTemporaryRevision`, `evaluateEffectiveStatus`, `resolveViewableManual`, `normalizeDistributionTargeting`, `resolveCompanyRecipients`, `resolveMatchingCompanyRecipients`, `validateDistributionTargeting`, and `updateManualDistributionTargeting`, all in `services/manualService.js`. EFB UI code continues to use the service layer only. `resolveViewableDocument` remains a compatibility alias for `resolveViewableManual`.

M3 implements web acknowledgement generation/tracking and per-revision reporting. M4 remains responsible for comprehensive Firestore/Storage rule hardening, publication/audit enforcement, Android contract verification, and emulator/security testing.

## Expiry reminders (server-side, Cloud Functions)

The scheduled job `sendExpiryReminders` (daily 06:00 IST) scans `user_documents`
by `expiryDate` window, escalates through tiers derived from each document's
`reminderLeadTimeDays` (fallback: company default), and mails pilots + an ops
digest. The callable `sendExpiryRemindersNow` runs the same job for one company
on demand from Settings. Full setup: `docs/reminders.md`.

Settings (web-readable/writable by the owning company):

- `companies/{companyId}/reminder_settings/current`
- `enabled` (bool, default true), `defaultLeadDays` (number 1–365, default 30,
  used when a document has no `reminderLeadTimeDays`), `defaultNotifyEmail`
  (ops digest recipient; falls back to company `ownerEmail`), `ccEmails` (array),
  `digestToOps` (bool, default true), `includeExpired` (bool, default true),
  `maxSendsPerDay` (number 1–2000, default 450 — Gmail safety cap),
  `updatedBy`, `lastModified`, `companyId`

Dedupe log (server-only writes; clients must not write):

- `companies/{companyId}/reminder_logs/{docId|expiryMs|tier}`
- `docId`, `userId`, `pilotEmail`, `tier` (`30`/`15`/`7`/`1`/… or `expired`),
  `expiryMs`, `status` (`sent`), `sentAt`, `triggeredBy`
- One mail per (document, tier, expiry) — re-mailing on re-run is impossible
  without deleting the log entry.

Run history (server-written, company-readable; powers the Settings "Last run" card):

- `companies/{companyId}/reminder_runs/{runId}` where runId is a UTC timestamp
  `YYYY-MM-DDTHH-mm-ss`
- `sent` (pilot mails), `skippedNoEmail`, `skippedAlreadySent`, `skippedQuota`
  (deferred by the daily cap — retried next run), `quotaReached` (bool),
  `failed`, `details[]`, `at`, `triggeredBy` (`schedule` or caller uid)

Pilot recipient resolution order: `users/{userId}.email` → `crew_profiles/{userId}.email`
→ `crew_profiles where pilotUid == userId`. Ops digest goes to
`companies/{companyId}.ownerEmail` + settings `ccEmails`.

## Service ownership

UI modules must not query Firestore directly.

Use services:

- `services/userService.js`
- `services/documentService.js`
- `services/connectionService.js`
- `services/trainingService.js`
- `services/firestoreService.js`
- `services/companyService.js` (admin_users, companies, company_accounts, company module subcollections)
- `services/aircraftService.js` (top-level `aircraft` and `companies/{companyId}/aircraft`)
- `services/reminderSettingsService.js` (`reminder_settings`, `reminder_runs` reads, manual-trigger callable)

## Runtime schema validation

Warning-first schema checks are enabled in service-layer reads and writes.

- Validator module: `services/schemaContract.js`
- Behavior: logs contract drift to console, does not block writes yet
- Purpose: detect Android/Web field mismatches early without breaking production flow

When drift is detected, fix service mapping or update this contract document before adding new UI logic.

## Compatibility checklist

Before merging schema-impacting changes:

- Confirm Android app can read/write unchanged required fields.
- Confirm web services still map fields one-to-one.
- Confirm no route/module uses hardcoded ad-hoc field names.
- Document additions in this file and release notes.
