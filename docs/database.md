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

Crew is modeled using shared collections rather than a dedicated `crew` collection.

- Pilot profile source: `users`
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

- List linked pilots for current operator.
- Compute compliance states from document expiry (`Valid`, `Expiring`, `Expired`).
- Delink pilot from operator.
- Inspect full pilot document metadata from Firestore in module UI.
- Upload/delete pilot documents using shared storage path conventions.
- Send outgoing connection requests as operator.

Current pilot action boundary:

- Pilot-side connection request acceptance and personal document workflows belong to the Android app.
- Pilot users are not expected to enter the web shell.

Rule-constrained behavior in current web UI:

- Operator-side pilot profile creation is disabled (rules require `/users/{uid}` create by matching auth uid).
- Operator-side pilot deregistration is disabled (rules require self-delete on `/users/{uid}`).
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

## Service ownership

UI modules must not query Firestore directly.

Use services:

- `services/userService.js`
- `services/documentService.js`
- `services/connectionService.js`
- `services/trainingService.js`
- `services/firestoreService.js`

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
