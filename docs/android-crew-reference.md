# Android Crew Module Reference

## Purpose
This document captures Android implementation details relevant to the web crew module so future parity work can be completed without re-discovery.

## Scope
- Crew document lifecycle (create, edit, delete, list)
- Operator-pilot connection request flow
- Offline sync, merge, and retry behavior
- Firestore collections and field conventions used by crew flows

## Core Android Data Models
- `UserDocument`
  - Room primary key: `id` (local only)
  - Firestore key: `firestoreId`
  - Owner: `userId` (pilot)
  - Access fields: `operatorId`, `readers`
  - Sync field: `isDirty`
  - Audit metadata: `lastEditedBy`, `lastModified`
- `ConnectionRequest`
  - IDs and emails for requester/recipient
  - Status enum: `PENDING`, `ACCEPTED`, `DECLINED`
- `EditLog`
  - Stores field-level changes in `user_documents/{documentId}/edit_logs`

## Crew-Relevant Android Files
- Data model
  - `app/src/main/java/com/captv/validityvyom/core/data/model/UserDocument.kt`
  - `app/src/main/java/com/captv/validityvyom/core/data/model/ConnectionRequest.kt`
  - `app/src/main/java/com/captv/validityvyom/core/data/model/EditLog.kt`
- Repository and data source
  - `app/src/main/java/com/captv/validityvyom/core/data/repository/UserDocumentRepository.kt`
  - `app/src/main/java/com/captv/validityvyom/core/data/repository/UserDocumentFirestoreDataSource.kt`
  - `app/src/main/java/com/captv/validityvyom/core/data/repository/ConnectionRepository.kt`
- Local persistence and worker
  - `app/src/main/java/com/captv/validityvyom/core/data/dao/UserDocumentDao.kt`
  - `app/src/main/java/com/captv/validityvyom/core/data/worker/FirestoreSyncWorker.kt`
- Crew UI flow
  - `app/src/main/java/com/captv/validityvyom/features/pilot/AddEditUserDocumentViewModel.kt`
  - `app/src/main/java/com/captv/validityvyom/features/pilot/UserDocumentListViewModel.kt`
  - `app/src/main/java/com/captv/validityvyom/core/ui/profile/viewmodel/ConnectionRequestsViewModel.kt`
  - `app/src/main/java/com/captv/validityvyom/core/ui/profile/viewmodel/SendConnectionRequestViewModel.kt`

## Firestore Collections Used by Crew
- `users`
  - Pilot profile includes `linkedOperator`.
- `connection_requests`
  - Request state transitions by recipient response.
- `user_documents`
  - Document ownership and sharing metadata.
- `user_documents/{documentId}/edit_logs`
  - Field-level audit trail entries.

## Android Sync Behavior to Preserve in Web
- Optimistic local write first (`isDirty = true`) for create/update.
- Immediate best-effort Firestore push.
- Background retry (`FirestoreSyncWorker`) if network/push fails.
- Realtime listener merges server updates into local cache.
- Conflict strategy favors:
  - Newer temporal fields (`issueDate`, `expiryDate`)
  - Local user edits for selected editable fields (for example license details and notes)
  - Shared access and ownership metadata from remote when needed
- Deduplication logic prevents duplicate records when offline-created docs later appear from Firestore.

## Android Audit Log Fields
Android change logging tracks edits to:
- `licenseOrCertificateNumber`
- `issueDate`
- `expiryDate`
- `issuingAuthorityOrBody`
- `notesOrDetails`

## Web Crew Parity Notes
- Keep role gates strict for `PILOT` and `OPERATIONS` actions.
- Keep Firestore rule compatibility primary; do not expose disallowed actions in UI.
- Use service-layer APIs instead of direct Firebase SDK usage in module files.
- Keep document storage path convention aligned with current project contract.

## Suggested Validation Checklist
- Pilot can accept/decline incoming operator request.
- Operator can send request and see status updates.
- Pilot and operator both see allowed crew documents only.
- Offline update queues and retries after reconnect.
- Edit logs are created only for changed audited fields.
- No duplicate document rows appear after reconnect/realtime refresh.
