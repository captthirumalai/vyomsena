# Android App Build Specification (VAMS V2)

## How to use this document
This is the complete build spec for the **Android pilot client**. Feed this document to the AI coding agent (e.g. Gemini in Android Studio) and instruct it to implement **every** requirement marked `MUST`. The web app (vyomsena.com) is the operator/admin surface; this Android app is the **pilot, read/sync client**.

All Firestore references, field names, and query patterns in this document are the exact contracts the web app already uses. Do not rename, re-map, or "improve" them.

---

## 1. Product role and scope

- **Android app = pilot app.** It lets a pilot:
  - sign in,
  - link to one operating company (the "operator"),
  - see their own crew profile and their own documents,
  - sync documents offline and view them,
  - track document expiry.
- **Android is read/sync only for shared data.** It does **NOT** create, edit, or delete:
  - `crew_profiles`,
  - `user_documents` document records (read-only),
  - `connection_requests` (legacy; no new requests from Android),
  - `operator_training_records`.
- The only write the pilot performs is **self-service linking** (setting `linkedOperator` on their own `users/{uid}` doc and redeeming a link code) — see section 7.
- The web app is authoritative for all roster and document records. Android must tolerate web-only creation and editing and never assume it may edit.

---

## 2. Firebase project setup (one-time)

### 2.1 Project identity (shared with web)
| Setting | Value |
| --- | --- |
| Firebase project id | `vyomsena-888` |
| Default bucket | `vyomsena-888.firebasestorage.app` |
| Auth domain | `vyomsena-888.firebaseapp.com` |
| Sender ID | `984698850091` |
| API key | `AIzaSyA73fU9NASXcZ4qiaqOyYWB-at-aiI1cis` |
| Web app ID | `1:984698850091:web:5d2a6a8bc8f7c9e0a0f1d` |

MUST steps (in Firebase console):
1. Add the Android app: choose a stable application id (e.g. `com.captv.vyomsena`).
2. Download `google-services.json` and place it in `app/` of the Android project. It must reference `project_id = vyomsena-888`.
3. Register the **SHA-1** (and SHA-256) debug and release certificate fingerprints of the signing keystore in the Android app settings. Required for Google Sign-In to work.
4. In **Authentication > Sign-in methods**, confirm `Google` and `Email/Password` are enabled.
5. In **Authentication > Authorized domains**, ensure the web domains (`vyomsena.com`) are present; this matters for web sign-in, not Android.
6. Use Firebase SDK versions compatible with the Firestore **security rules** shown in section 10. The web app uses the modular SDK; Android uses the standard Android SDK (`com.google.firebase:firebase-firestore-ktx`, `firebase-auth-ktx`, `firebase-storage-ktx`).

### 2.2 Firebase module initialization
Initialize a single shared `FirebaseApp` and obtain the shared instances. The same Firebase user identity is used by web and Android — the **Firebase Auth UID is the primary key across platforms**.

---

## 3. Roles and mode detection

### 3.1 Roles
`users/{uid}.role` is stored **uppercase**:
- `PILOT` — pilot account (Android).
- `OPERATIONS` — operator account (web admin).

### 3.2 App modes after login
A pilot has two contexts:
- **Personal mode**: no company link.
- **Company-linked mode**: `users/{uid}.linkedOperator` is a non-null operator UID.

The mode is derived from the profile after login — not from a separate account. If `linkedOperator` is set, show the company workspace; otherwise show personal mode. (Future: multiple memberships will come from dedicated `memberships`; ignore until then and keep reading `linkedOperator`.)

---

## 4. Firestore data contract (exact references)

All `Date`-like fields are written by the web app with `firebase.firestore.Timestamp` / `serverTimestamp()`. Read them as `Timestamp` and convert to `Date`.

### 4.1 `users/{uid}`
Document key = Firebase Auth UID.

| Field | Type | Notes |
| --- | --- | --- |
| `uid` | string | = document id |
| `name` | string | legacy-compatible |
| `fullName` | string | preferred display name |
| `email` | string | **always lowercase** |
| `role` | string | `PILOT` or `OPERATIONS` (uppercase) |
| `linkedOperator` | string \| null | operator UID when linked |
| `createdAt` | Timestamp | |
| `lastModified` | Timestamp (optional) | |
| `operatorType`, `organizationName`, `organizationCode`, `organizationBase`, `companyPhone` | string (optional) | company bootstrap fields — preserve if present |
| `crewProfileId` | string (optional) | set by web direct-assign; equals the crew profile doc id |

Queries used by Android:
- Read own profile: `doc("users/{auth.uid}")`.
- After linking, the pilot may also read the operator by UID if needed: `doc("users/{operatorId}")` (rules allow any authenticated read of `users`).

### 4.2 `crew_profiles/{crewProfileId}`
Operator-owned roster record. **Read-only for Android.** Document key = pilot Auth UID when the pilot is linked.

| Field | Type | Notes |
| --- | --- | --- |
| `crewProfileId` | string | = document id |
| `uid` | string | = pilot uid |
| `operatorId` | string | owning operator uid |
| `pilotUid` | string \| null | pilot auth uid when linked |
| `linkState` | string | `UNLINKED` / `LINKED` |
| `name`, `fullName` | string | |
| `email` | string | lowercase |
| `role` | string | `PILOT` |
| `status` | string | `Active`, `Deleted`, etc. |
| `designation` | string \| null | |
| `organizationBase`, `base` | string \| null | |
| `mobile` | string \| null | |
| `createdAt`, `lastModified` | Timestamp | |

Query used by Android (company mode): `collection("crew_profiles").whereEqualTo("pilotUid", auth.uid)` — the read rule permits the pilot whose UID equals `pilotUid`.

### 4.3 `user_documents/{docId}` — the documents the pilot syncs
Generated key `firestoreId` (also stored as a field).

| Field | Type | Notes |
| --- | --- | --- |
| `firestoreId` | string | = document id |
| `userId` | string | pilot auth uid (owner/subject) |
| `userName` | string | display name of the pilot |
| `documentCategory` | string | one of: `LICENCE`, `MEDICAL`, `RATINGS`, `CHECKS`, `TRAINING`, `IDENTITY`, `GENERAL`, `CUSTOM` |
| `documentName` | string | e.g. `Commercial Pilot Licence (CPL)` |
| `licenseOrCertificateNumber` | string \| null | |
| `issueDate` | Timestamp \| null | |
| `expiryDate` | Timestamp \| null | |
| `issuingAuthorityOrBody` | string \| null | |
| `notesOrRemarks` | string \| null | (create payload field) |
| `notesOrDetails` | string \| null | (audit-tracking field on Android legacy) |
| `operatorId` | string \| null | owning operator |
| `readers` | array of strings | UIDs allowed to view |
| `reminderLeadTimeDays` | number | default `30` |
| `documentUri` | string \| null | local file ref (e.g. `content://…`); for web-uploaded docs this is the Firebase download URL |
| `storagePath` | string \| null | Storage path, e.g. `documents/{userId}/{docId}/{fileName}` |
| `lastEditedBy` | string \| null | editor UID |
| `lastModified` | Timestamp | |
| `isDirty` | boolean | legacy Android sync flag |
| `recentAudit` | array (optional) | latest field-change entries (read-only reference) |
| `lastEditLog` | object (optional) | latest field-change entry |

Subcollection (write-only audit log, Android must not read it): `user_documents/{docId}/edit_logs`.

Queries used by Android (read-only):
- Own documents: `collection("user_documents").whereEqualTo("userId", auth.uid)`.
- Optionally docs shared with the pilot: `collection("user_documents").whereArrayContains("readers", auth.uid)`.
- Real-time: attach a `snapshotListener` on the same query.

### 4.4 `crew_link_codes/{tokenId}` — linking codes (see section 7)
| Field | Type | Notes |
| --- | --- | --- |
| `tokenId` | string | = document id |
| `crewProfileId` | string | the crew profile (= pilot uid) this code links |
| `operatorId` | string | operator uid |
| `code` | string | 6-digit |
| `used` | boolean | |
| `status` | string | `ACTIVE` / `SUPERSEDED` / `USED` |
| `expiresAt` | Timestamp | valid for 5 minutes |
| `createdAt`, `lastModified` | Timestamp | |

### 4.5 Legacy / ignored collections (Android must not write)
- `connection_requests` — legacy request/accept flow (web de-emphasized it). Android must not create new requests.
- `access_codes` — separate 15-minute access codes; do not confuse with `crew_link_codes`.
- `operator_training_records`, `training_centers`, `training_offerings`, `training_bookings` — out of scope for this pilot build.

---

## 5. Authentication flow

MUST implement:
1. **Google Sign-In** as the primary path using `com.google.firebase.auth.FirebaseAuth` + `GoogleSignInOptions` (request id token) + `GoogleAuthProvider.getCredential(...)` → `signInWithCredential`.
2. **Email/Password** as a secondary path (`createUserWithEmailAndPassword` / `signInWithEmailAndPassword`), so a pilot can register directly on Android if no Google account is linked.
3. `addAuthStateListener` → on signed-in, load `users/{uid}` and drive the UI.

Behavior:
- First sign-in with a brand-new account: **bootstrap the profile document** `users/{uid}` (self-create is allowed by rules):
  ```json
  {
    "uid": "<auth.uid>",
    "name": "<display name>",
    "fullName": "<display name>",
    "email": "<email, lowercased>",
    "role": "PILOT",
    "linkedOperator": null,
    "createdAt": "<serverTimestamp>"
  }
  ```
  Use `set()` with `merge = false` only if the doc does not exist (check first, then `setData(..., merge = true)` to be safe). Never overwrite an existing `linkedOperator`.
- If the doc exists, read it and preserve all additive fields.

---

## 6. Document sync (read/sync)

### 6.1 Local cache
MUST keep a local copy so documents are visible offline:
- Store `UserDocument` rows locally (Room database).
- Primary key locally: `firestoreId`.
- Map Firestore `Timestamp` fields (`issueDate`, `expiryDate`, `lastModified`) to local `Long`/`Date`.

### 6.2 Sync rules
- Read + listen: attach a `snapshotListener` to the own-documents query (`userId == auth.uid`). On every snapshot, replace the local cache for that user.
- **No writes.** Do not implement create/update/delete document actions. Web is the editor.
- If a document is modified on web, it must appear on Android without manual refresh (real-time listener) and also on next cold start (initial fetch).
- Handle `documentChanges` to add/remove/modify rows incrementally. Guard against duplicates: key everything by `firestoreId`.
- For shared documents (`readers` contains the pilot) that are not owned by the pilot, sync them read-only into the same list if the app wants to show shared docs. The primary feed remains `userId == auth.uid`.

### 6.3 File download (Storage)
- Storage bucket: `vyomsena-888.firebasestorage.app`.
- Path convention (exact): `documents/{userId}/{documentId}/{fileName}`.
- On Android, when a document has `storagePath`, download the file:
  ```
  Firebase.storage.reference.child(document.storagePath).getFile(localFile)
  ```
  (Storage rules allow the owner pilot to read `documents/{userId}/...`.)
- Store the downloaded local file path **locally** (Room column, e.g. `localFilePath`). Do **not** write it back to Firestore.
- If `storagePath` is null but `documentUri` is a Firebase download URL, use that URL as a fallback for viewing when online.
- Show a placeholder when offline and the file has not been cached.

### 6.4 Compliance / expiry
- Compute expiry state locally from `expiryDate`:
  - `Valid` — expiry in more than `reminderLeadTimeDays` days (default 30).
  - `Expiring` — within `reminderLeadTimeDays`.
  - `Expired` — past `expiryDate`.
- Show these states on the document list and a summary count (e.g. "3 expiring, 1 expired").

---

## 7. Linking flows

A pilot becomes company-linked when `users/{uid}.linkedOperator` is set and a `crew_profiles` record exists. There are two supported paths.

### 7.1 Path A — Direct assign (operator-initiated, no Android action)
The operator (web) enters the pilot's email in **Crew > Linking > Assign Pilot**. Web writes:
- `crew_profiles/{pilotUid}` (creates if missing),
- `users/{pilotUid}.linkedOperator = operatorId`,
- `users/{pilotUid}.crewProfileId = pilotUid`.

Android behavior: after sign-in / on profile change, if `linkedOperator` becomes non-null, enter **company-linked mode** automatically and show the company workspace. No user action required. This is how most pilots will get linked.

### 7.2 Path B — Link code redemption (pilot-initiated)
The operator generates a 6-digit code in **Crew > Generate Link Code** (valid 5 minutes, single use, supersedes previous active codes for that crew profile). The pilot enters the code in Android.

MUST implement the redemption sequence:
1. Pilot enters the 6-digit `code` in a "Link to company" screen.
2. Query the active code:
   ```
   collection("crew_link_codes")
     .whereEqualTo("code", enteredCode)
     .whereEqualTo("used", false)
   ```
   Take the first result where `status == "ACTIVE"` and `expiresAt > now`.
3. If found, read `crewProfileId` and `operatorId` from the code document.
4. Write the pilot link (best-effort, tolerate partial failures and retry):
   - `users/{auth.uid}` → `linkedOperator = operatorId` (allowed: self-update).
   - `crew_profiles/{crewProfileId}` → `pilotUid = auth.uid`, `linkState = "LINKED"` — **requires the rule updates in section 10.2**; until deployed this write will fail with permission-denied. Treat it as non-blocking: if it fails, the link still works via `linkedOperator` for the profile records that already carry `pilotUid`.
   - `crew_link_codes/{tokenId}` → `used = true`, `status = "USED"`, `redeemedBy = auth.uid` — **also requires the rule updates in section 10.2**.
5. On any failure, show a clear error and let the pilot retry. On success, refresh the profile and enter company-linked mode.

Rules dependency note (important for the agent): with the current deployed rules (section 10.1), a not-yet-linked pilot **cannot** read an `ACTIVE` code doc nor update a code doc. Before Path B works end-to-end, the two rule changes in section 10.2 must be deployed. Path A works with current rules unchanged. Build both; ship Path A first.

### 7.3 Unlinking
If the operator delinks the pilot (web), web clears `users/{uid}.linkedOperator` (and sets crew profile `linkState = "UNLINKED"`). Android MUST react to this on the `users` snapshot and return to **personal mode**.

---

## 8. UI structure (recommended)

- **Auth**: Google / email-password sign-in screen.
- **Personal mode**: pilot's own documents, expiry summary, "Link to company" entry point (link-code entry).
- **Company-linked mode**: company header (operator name), pilot's documents (same set), expiry summary, link status indicator, "unlink/leave" is not offered (delink is operator-controlled).
- Keep personal and company modes visually distinct.

---

## 9. Concurrency, retries, and conflicts

- Single `FirebaseApp`; do not initialize Firebase twice.
- Use Firestore SDK offline persistence (default `FirebaseFirestore` offline support) for the document feed.
- Do not implement optimistic document writes (Android does not write documents).
- If a network operation fails (link redemption, bootstrap), surface a retry action. Do not silently drop.

---

## 10. Future web modules and Android extensibility

The web app is the operator platform and will grow many modules over time: crew management, flight documents, company document management, scheduling/dispatch, training/compliance, and more (see `docs/database.md` and `docs/admin-model.md`). The Android app MUST be built so each new web module can surface as a feature without a rewrite.

### 10.1 Architecture MUSTs (future-proofing)
- Build the app in **feature modules**: one package per domain (`auth`, `profile`, `documents`, `crew`, and later `flightdocs`, `companydocs`, `scheduling`, `training`, `notifications`). A new web module maps to a new Android feature, never a modification of an existing one.
- Use a **home/dashboard screen with dynamic tiles or menu items**. Each feature registers a tile; adding a web module means adding a tile, not changing navigation.
- Keep the **data layer generic and contract-driven** (section 10.2) so new collections are consumed by adding a model + a repository, not by reworking shared infrastructure.
- Design for **one pilot identity across all modules**: the `users/{uid}` doc remains the anchor; every module keys data by the same UID.

### 10.2 Shared field conventions (reuse these for future collections)
Web modules will keep these conventions (already used today). Build reusable helpers around them so future collections are automatically parseable:
- Owner/scoping fields: `operatorId`, `userId` / `pilotUid`.
- Sharing field: `readers` (array of UIDs) — a generic "shared with me" reader (`whereArrayContains("readers", auth.uid)`) will surface documents from future modules too.
- Lifecycle fields: `status`, `createdAt`, `lastModified`, `firestoreId` (document id stored as a field).
- Additive-only evolution: new modules add new collections and new fields. Android MUST tolerate unknown fields and never fail to parse a document because of an extra field. Use defensive parsing with sensible defaults for every field.

### 10.3 Known future collections to design against
- `organizations` + `memberships` (planned) — replaces the single `linkedOperator` field with multi-company membership. Android should already treat the "workspace selector" as a possible future state (section 3.2 notes this); prepare a `memberships`-style list model internally.
- Flight documents (planned) — operator-scoped documents shared with crew via `readers[]`; reuse the same sync/download pattern as `user_documents`.
- Company document management (planned) — a new collection owned by the operator following the same ownership/sharing pattern.
- Push notifications (planned) — reserve a `notificationToken`/`fcmToken` field on `users/{uid}` and a notification permission flow in the auth bootstrap so reminders can be pushed later.

### 10.4 Behavior invariant for all future modules
Even as web modules grow, Android remains a **read/sync client for shared data**. For every future module the rule is: the web app creates/edits/deletes; Android reads, syncs offline, and surfaces the data. Only self-data (own `users` doc) and link-code redemption are writable from Android. If a future module would require a new Android write, that is a deliberate product decision and must be documented before implementation.

---

## 11. Security rules reference and required changes

### 11.1 Current deployed rules (what Android can do today)
- `users`:
  - read: any authenticated.
  - create/delete: only self (`auth.uid == doc id`).
  - update: self OR the linked operator.
- `crew_profiles`:
  - read: the operator (`operatorId`) or the linked pilot (`pilotUid`).
  - create/update/delete: the operator only.
- `user_documents`:
  - read: any authenticated.
  - create/update/delete: owner (`userId`), linked operator, or crew-profile operator. (Android: read-only by design.)
- `crew_link_codes`:
  - read: the operator or the linked pilot.
  - create/update/delete: the operator only.
- `connection_requests`: create by requester, read by requester/recipient, update by recipient, delete denied.
- Storage `documents/{userId}/{documentId}/{fileName}`:
  - read/write: owner, linked operator, or crew-profile operator.

### 11.2 Required rule changes for Path B (link-code redemption)
Deploy these when Path B must work (web-first currently):

```
// crew_profiles: allow a pilot to claim a still-unlinked profile via a link code
allow update: if request.auth != null
  && request.auth.uid == request.resource.data.pilotUid
  && request.resource.data.operatorId == resource.data.operatorId
  && resource.data.pilotUid == null;

// crew_link_codes: allow the redeeming pilot to read the ACTIVE code and mark it used
allow read: if request.auth != null && resource.data.used == false;
allow update: if request.auth != null && resource.data.used == false
  && request.resource.data.used == true;
```

Trade-off: read of `ACTIVE` codes is exposed to any signed-in user; acceptable because codes are 6-digit, valid 5 minutes, and single-use. A stricter option is to store a hash of the code as the document id and use `get()` (then no query exposure); if you choose that, the Android lookup becomes `get("crew_link_codes/{hash}")`.

---

## 12. Implementation checklist (MUST)

- [ ] Add Firebase modules (`firebase-auth`, `firebase-firestore`, `firebase-storage`) and `google-services.json`.
- [ ] Google Sign-In with SHA-1/SHA-256 registered; email/password fallback.
- [ ] On sign-in, read `users/{uid}`; bootstrap the doc if missing (fields exactly as section 4.1, `role: "PILOT"`).
- [ ] Mode detection from `users/{uid}.linkedOperator`; react to snapshot changes (link on, delink → personal mode).
- [ ] Company mode: listen to `crew_profiles where pilotUid == auth.uid`.
- [ ] Documents: listen to `user_documents where userId == auth.uid`; cache locally by `firestoreId`; read-only.
- [ ] File viewing: `storage.reference.child(storagePath).getFile(...)`; local cache path stored locally; fallback to `documentUri`.
- [ ] Expiry summary computed locally from `expiryDate` + `reminderLeadTimeDays` (Valid/Expiring/Expired).
- [ ] Link-code redemption flow (section 7.2) with retry and clear errors; degrades gracefully if rules not yet updated.
- [ ] No create/update/delete on `crew_profiles`, `user_documents`, `connection_requests`, `operator_training_records`.
- [ ] Preserve all additive fields; never rename existing fields.
- [ ] Single Firebase init; no duplicate app initialization.

## 13. Validation checklist (run at the end)

- [ ] Pilot signs in on Android with Google → personal mode; `users/{uid}` created with `role: "PILOT"`.
- [ ] Operator (web) uses **Assign Pilot** with the same email → Android flips to company-linked mode automatically.
- [ ] Operator uploads documents on web → they appear on Android in real time and offline after caching.
- [ ] Pilot enters a valid, unexpired link code → `linkedOperator` set; company mode entered (after rules update for Path B).
- [ ] Delink on web → Android returns to personal mode.
- [ ] Expired/expiring documents are highlighted with correct counts.
- [ ] Reopen the app offline → cached documents and files still viewable.
- [ ] No duplicates appear after multiple listener events or reconnects.
