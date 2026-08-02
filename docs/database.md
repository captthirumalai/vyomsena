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
- `crew_link_codes` (web-only, short-lived link tokens)
- `admin_users` (web-only, operator write grant)
- `companies` (web-only, operator owned)
- `company_accounts` (web-only, operator managed)
- `company_invites` (web-only, short-lived 6-digit invite codes)
- `company_members` (Android-only, anonymous company-session link record created on invite redemption)

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

- Operator creates/updates/deletes their own records.
- Pilot can read own record.
- Linked operator can read pilot records.

## crew_profiles (web-only)

This collection is additive and is the operator-owned roster source for web workflows.

- `crewProfileId`
- `operatorId`
- `pilotUid` (nullable until linked)
- `linkState` (`UNLINKED` / `LINKED`)
- `name`
- `fullName`
- `email`
- `role`
- `status`
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

## company_invites (web-only)

Document key: the 6-digit `code` itself

Written by the invite generator and valid for 5 minutes. Redemption marks `usedBy`/`usedAt`.

- `code`
- `companyId`
- `accountId`
- `email`
- `role`
- `createdAt`
- `expiresAt` (`now + 5 min`)
- `usedBy` (nullable)
- `usedAt` (nullable)

## Company module data (web-only)

Module records are written under `companies/{companyId}/{module}` subcollections so the Android app can sync them live:

- `companies/{companyId}/crew` — crew roster mirror (copied from `crew_profiles`)
- `companies/{companyId}/aircraft` — fleet records
- Additional modules (`dispatch`, `maintenance`, etc.) follow the same subcollection shape.

Field conventions reuse the shared rules from the crew/document model: `companyId`, `createdAt`, `lastModified`, plus module-specific fields.

## Service ownership

UI modules must not query Firestore directly.

Use services:

- `services/userService.js`
- `services/documentService.js`
- `services/connectionService.js`
- `services/trainingService.js`
- `services/firestoreService.js`
- `services/companyService.js` (admin_users, companies, company_accounts, company_invites, company module subcollections)
- `services/aircraftService.js` (top-level `aircraft` and `companies/{companyId}/aircraft`)

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
