# Android Company Home Module (Managed / Corporate Workspace)

## 1. Purpose and placement (Dual-Workspace)

The Android app has two workspaces for a pilot:

| Workspace | Module | Behavior | Audience |
| --- | --- | --- | --- |
| Aviation Home | Personal / Legacy | **Offline-First CRUD** (Add/Edit/Delete) | Independent pilots, AMEs, or pilots tracking personal documents not shared with a company |
| Company Home | Managed / Corporate | **Read/Sync Client** (VAMS V2 spec) | Pilots linked to an operator via the web app |

Rules that never change:
- Both modules use the **same** `users/{uid}` document (shared identity).
- Aviation Home stays exactly as it is today (offline-first, full CRUD, local).
- Company Home is **strictly read/sync** — no create/edit/delete of company data.
- Linking the company is done **from Company Home only** (link-code redemption).

## 2. Module scope and behavior

- Visible only for `PILOT` role users.
- After sign-in / on profile change, branch on `users/{uid}.linkedOperator`:
  - **Unlinked** (`null`): show the **Link to Company** screen (6-digit code entry).
  - **Linked** (operator UID): show the branded company dashboard — operator name, and a **read-only** view of the pilot's synced documents.
- Re-evaluate the branch on every `users` snapshot change:
  - link becomes set → enter company workspace automatically;
  - operator delinks → return to the Link/Personal state automatically.
- No "unlink myself" action. Delink is operator-controlled (web).

## 3. STEP 1 — DocumentCategory alignment (do this first)

Web creates documents with `documentCategory` values the app must not crash on.

### 3.1 Exact category values (match web `modules/crew/documentsConfig.js`)
```
LICENCE, MEDICAL, RATINGS, CHECKS, TRAINING, IDENTITY, GENERAL, CUSTOM
```

### 3.2 Requirements
- Add the full set above to the app's document category enum/type **before** any document UI.
- Treat the stored value as authoritative: preserve it verbatim when syncing; do not coerce to a legacy value.
- **Defensive parsing**: if a document arrives with an unknown `documentCategory` string, do NOT crash. Fall back to the `GENERAL` label (or show the raw value) and keep the raw value in the model.
- Default when absent is `GENERAL`.
- Recommended display labels (web parity):
  - `LICENCE` → Licence
  - `MEDICAL` → Medical
  - `RATINGS` → Ratings & Endorsements
  - `CHECKS` → Checks & Proficiencies
  - `TRAINING` → Training
  - `IDENTITY` → Security & Identity
  - `GENERAL` → General / Operator
  - `CUSTOM` → Other (Custom)
- Reference (optional, read-only): the web master list of `documentName` per category and `reminderDays` lives in `modules/crew/documentsConfig.js`. The app may use it for labels; it must never depend on it for parsing.

## 4. STEP 2 — Linking logic (Link to Company screen)

### 4.1 Entry points
- Company Home when unlinked → code entry screen.
- Aviation Home may show a "Link to company" affordance that deep-links to the Company Home code entry.

### 4.2 Redemption flow (Path B — `crew_link_codes`)
1. Pilot enters the 6-digit code.
2. Query the active code:
   ```
   collection("crew_link_codes")
     .whereEqualTo("code", enteredCode)
     .whereEqualTo("used", false)
   ```
   Accept the first result where `status == "ACTIVE"` and `expiresAt > now`.
3. Read `crewProfileId` and `operatorId` from the code document.
4. Write the pilot link (each step independent, tolerate partial failure, retry on failure):
   - `users/{auth.uid}` → `linkedOperator = operatorId` (allowed by current rules: self-update).
   - `crew_profiles/{crewProfileId}` → `pilotUid = auth.uid`, `linkState = "LINKED"` — requires the rule change in `docs/android-app-build.md` §11.2; until deployed it fails with permission-denied (treat as non-blocking).
   - `crew_link_codes/{tokenId}` → `used = true`, `status = "USED"`, `redeemedBy = auth.uid` — requires the same rule change.
5. On success: refresh the profile and enter the company workspace.

### 4.3 UX states (must be distinct)
- **Idle**: code entry field + "Link to company" button.
- **Validating**: spinner, button disabled, "Checking code..."
- **Success**: toast/screen transition into the company dashboard.
- **Error cases** (each with its own message):
  - invalid/unknown code → "This code is not valid."
  - expired code → "This code has expired. Ask your operator for a new one."
  - already used → "This code was already used."
  - network failure → "Check your connection and try again." + Retry.

### 4.4 Rules dependency (important)
Path B requires two Firestore rule changes (see `docs/android-app-build.md` §11.2) to fully work. Until they are deployed, redemption writes that fail with permission-denied must not corrupt state: keep `linkedOperator` as the source of truth and let the app enter the company workspace once it is set.

## 5. STEP 3 — Mode-specific UI (CompanyHomeViewModel)

Create a dedicated `CompanyHomeViewModel` that:
- Observes the `users/{uid}` document (`linkedOperator`).
- Holds one of three UI states: `Unlinked`, `Loading`, `Linked(company)`.

### 5.1 Linked state (branded read-only dashboard)
- Load company context: read the operator profile `users/{operatorId}` for `organizationName` / `organizationBase` (read rule allows any authenticated read of `users`).
- Load the crew profile: `collection("crew_profiles").whereEqualTo("pilotUid", auth.uid)`.
- Load documents: `collection("user_documents").whereEqualTo("userId", auth.uid)` via real-time listener; cache locally (Room) by `firestoreId`.
- **Disable all Edit and Add buttons within this module.** No create/update/delete document actions exist here by design.
- Show:
  - company name/header and link state badge ("Company Managed"),
  - read-only document list grouped/filterable by `documentCategory`,
  - expiry summary computed from `expiryDate` + `reminderLeadTimeDays` (Valid / Expiring / Expired),
  - document file viewing (see §6).

### 5.2 Unlinked state
- The Link to Company screen (§4). Do not show company documents while unlinked.

## 6. Document viewing (read/sync)

- Storage path convention: `documents/{userId}/{documentId}/{fileName}`.
- Download with `Firebase.storage.reference.child(document.storagePath).getFile(...)` (owner read is allowed by Storage rules).
- Store the downloaded path locally (Room); never write it back to Firestore.
- Fallback when `storagePath` is null but `documentUri` is a URL: open `documentUri` when online.
- Offline: cached documents and files remain viewable.

## 7. Shared identity and Aviation Home interop

- Both workspaces read the same `users/{uid}` document.
- When `users/{uid}.linkedOperator` is set, **Aviation Home shows a "Company Managed" badge** on the pilot's profile and does not stop its offline CRUD for personal documents.
- Documents that came from the company (web-created, present in `user_documents` with `operatorId`) appear read-only; personal documents remain editable in Aviation Home.
- Keep `userId`, `operatorId`, `readers`, `storagePath`, and `documentCategory` verbatim when syncing so web stays consistent.

## 8. Data contract (exact references)

See `docs/android-app-build.md` §4 for full field tables. Company Home reads:
- `users/{uid}` — `linkedOperator`, `organizationName`, `organizationBase`, `crewProfileId`.
- `crew_profiles/{id}` — `operatorId`, `pilotUid`, `linkState`, `name`, `role`, `status`.
- `user_documents/{id}` — all fields incl. `documentCategory`, `documentName`, `issueDate`, `expiryDate`, `storagePath`, `documentUri`, `operatorId`, `readers`.
- `crew_link_codes/{id}` — redemption only (§4.2).
- Storage — `documents/{userId}/{documentId}/{fileName}`.

## 9. Implementation checklist (MUST)

- [ ] Document category enum = exact web values (`LICENCE, MEDICAL, RATINGS, CHECKS, TRAINING, IDENTITY, GENERAL, CUSTOM`), defensive parsing, `GENERAL` default.
- [ ] `CompanyHomeViewModel` with `Unlinked / Loading / Linked` states.
- [ ] Link to Company screen: 6-digit entry + all §4.3 states and messages.
- [ ] Redemption writes per §4.2 with per-step failure tolerance and retry.
- [ ] Linked dashboard: operator name, crew profile, read-only documents, expiry summary.
- [ ] No Edit/Add/Delete in Company Home.
- [ ] Real-time `user_documents` listener + Room cache by `firestoreId`.
- [ ] File download via `storagePath`; local path stored locally only.
- [ ] Aviation Home "Company Managed" badge from `linkedOperator`.
- [ ] Automatic mode switching on link / delink.

## 10. Validation checklist

- [ ] Unlinked pilot opens Company Home → sees Link to Company screen; Aviation Home is unaffected.
- [ ] Operator (web) direct-assigns the pilot → Android auto-enters Company Home (company name shown, read-only docs).
- [ ] Pilot redeems a valid code → linked; an invalid/expired/used code shows the correct error.
- [ ] Documents created on web appear read-only (no edit/add affordances) in real time and offline.
- [ ] Files download and are viewable offline.
- [ ] Delink on web → Company Home returns to Link state; Aviation Home badge disappears.
- [ ] A web-created document with category `TRAINING` or `RATINGS` renders without crash.
