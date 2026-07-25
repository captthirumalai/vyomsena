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
- `training_centers`
- `training_offerings`
- `training_bookings`

## users

Document key: `uid`

Required fields:

- `uid`
- `name`
- `email`
- `role`
- `linkedOperator`
- `createdAt`

Optional fields:

- `operatorType`
- `lastModified`

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

Cross-platform file reference fields:

- `documentUri` for Android-local references (for example: `content://...`)
- `storagePath` for shared file access (for example: `documents/pilot123/license.pdf`)

Subcollection:

- `user_documents/{documentId}/edit_logs`

## connection_requests

Document key: generated `requestId`

Fields:

- `requesterId`
- `recipientId`
- `requesterName`
- `requesterEmail`
- `recipientEmail`
- `status` (`PENDING`, `ACCEPTED`, `REJECTED`)
- `createdAt`
- `lastModified`

## training_centers, training_offerings, training_bookings

Training collections are intentionally independent from core operations.

- `training_centers`: provider/master data
- `training_offerings`: courses/programs mapped to centers
- `training_bookings`: user booking records and status

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
