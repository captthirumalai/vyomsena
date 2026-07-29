# Android and Web Sync Requirements

## Purpose
This document defines what the Android pilot app must support so it stays in sync with the company-focused web application while both platforms continue using the same Firebase project and data contract.

## Product Direction
- One Firebase identity per user.
- Android app is pilot-focused.
- Web app is company-focused.
- Pilot users should not depend on web app access for normal workflows.
- Pilot experience must support two contexts after login:
  - Personal mode
  - Company-linked mode
- The mode is determined from link or membership status after authentication, not from separate user accounts.

## Authentication Requirements
- Support Google Sign-In as the primary pilot-friendly auth path.
- Support future provider linking so the same user can add email/password later if required.
- Keep Firebase UID stable across Android and web for the same user.
- Preserve current Firebase project alignment with web (`vyomsena-888`).
- Assume pilot web shell access is blocked; Android is the supported pilot client.

## User Profile Requirements
Android must continue reading and writing the shared `users/{uid}` profile document with these fields:
- `uid`
- `name`
- `fullName`
- `email`
- `role`
- `linkedOperator`
- `createdAt`

Android should tolerate and preserve these additive company bootstrap fields when present:
- `operatorType`
- `organizationName`
- `organizationCode`
- `organizationBase`
- `companyPhone`
- `lastModified`

## Workspace / Mode Requirements
After login, Android should determine pilot mode from current profile state.

Expected behavior:
- No link present: open personal pilot mode.
- One active operator link: allow switching between personal mode and company mode.
- Multiple future memberships: show a workspace selector.

UI recommendation:
- Personal mode and company mode should have clearly different visual treatment so pilots always know which context they are in.

## Document Sync Requirements
Android must continue using the shared `user_documents` collection and honor web-compatible fields:
- `firestoreId`
- `userId`
- `userName`
- `documentCategory`
- `documentName`
- `licenseOrCertificateNumber`
- `issueDate`
- `expiryDate`
- `issuingAuthorityOrBody`
- `documentUri`
- `storagePath`
- `operatorId`
- `readers`
- `reminderLeadTimeDays`
- `lastEditedBy`
- `lastModified`
- `isDirty`

Android must preserve these interoperability rules:
- Use the same Firebase UID as web for ownership checks.
- Keep `readers` and `operatorId` consistent so company viewers can access documents in web.
- Preserve `storagePath` for shared documents uploaded through web.
- Preserve `documentUri` for Android-local references when applicable.

## Real-Time and Offline Requirements
Android should continue to support:
- optimistic local writes
- background retry for failed sync
- real-time Firestore listeners
- conflict reconciliation using `lastModified`
- edit audit creation in `user_documents/{documentId}/edit_logs`

Expected real-time behavior:
- A document changed on web must refresh in Android without manual reload.
- A document changed on Android must refresh in web without manual reload.

## Access Model Requirements
Current compatibility layer:
- `linkedOperator` is the active company link field.

Future-ready direction:
- Migrate to dedicated `organizations` and `memberships` collections.
- Android should be prepared for eventual mode selection from memberships instead of a single link field.

Until that migration happens:
- Android must continue respecting `linkedOperator` for company-linked pilot behavior.

## Pilot App Scope Recommendation
Android should remain limited to pilot-relevant functions such as:
- personal document management
- expiry tracking and reminders
- company-linked document acknowledgement or sharing flows
- operator-request acceptance and linkage state

Android should not become the primary operator administration surface.

## Validation Checklist
- Same Firebase identity can be used safely across platform services without duplicating user records.
- Pilot documents created on Android are visible in web where rules permit.
- Web edits are reflected in Android in real time.
- Android edits are reflected in web in real time.
- `readers`, `operatorId`, and `userId` stay consistent after edits on both platforms.
- New additive fields in `users` do not break Android profile parsing.