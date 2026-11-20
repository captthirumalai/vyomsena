# EFB

Route: /efb
Title: EFB

## Current Build Snapshot

The EFB module lets crew or operations record **actual flight details** against flights planned by Dispatch. Actuals are written to the shared `companies/{companyId}/flights` collection via `recordEfbActuals`, then evaluated by the FDTL module for compliance.

### Completed features
- **Flight Assignments** table: live list of planned flights (date, flight number, route, P1, status, EFB actuals state) via `onFlightsSnapshot`.
- **Record Actuals** form: chocks off/on, takeoff/landing (times), IR and XC time (minutes), with auto-computed block time.
- Saving actuals sets the EFB source block, transitions status to `completed`, and triggers reconciliation against the Flight Ops planned times in FDTL.
- Selecting a row pre-fills the form with any previously recorded actuals.
- **Manual Distribution** tab (Milestone 1 — controlled documents): see below.

### Data flow
```
Dispatch (planned flight) → EFB (record actuals) → companies/{companyId}/flights
        → FDTL (compliance evaluation + mismatch reconciliation)

Admin (web) → EFB Manual Distribution → companies/{companyId}/manuals (+ /revisions)
        + Storage manuals/{companyId}/{manualId}/revisions/{revisionId}/…
        → Linked users (Android) view + download the effective revision
```

## Console Layout

```
EFB console
├── Tab 1: Flights              (Flight Assignments + Record Actuals — unchanged)
└── Tab 2: Manual Distribution
    ├── Section: Manuals Library        (M1 — implemented)
    ├── Section: Temporary Revisions    (M2 — implemented)
    └── Section: Acknowledgements      (M3 — implemented)
```

- Tab pattern mirrors `crewprofile` (`.efb-tab` / `.efb-tab-panel` + `setTab()` in `modules/efb/efb.js`).

## Manual Distribution (Milestone 1 implemented)

**Terminology:** document distribution in EFB is called **Manual Distribution**.

**Purpose:** Admin (web app user) manages controlled company manuals. All linked users can view and download them to their devices for offline use. Consumers are Android-only (separate repo; contract documented in `docs/database.md`).

### Manuals Library (M1)
- **Stats:** Total, Published, Draft (incl. In Review), Review Due (published, next review within 30 days), Archived.
- **Toolbar:** search (title/doc number), category filter, status filter, sort (newest/oldest/title/effective), Add Manual (admin only).
- **Table:** Doc #, Title, Category, Aircraft, Issue, Rev, Effective, Status, Actions.
- **Actions:** View (details + PDF preview + download), History (immutable revision list with SHA-256), Edit Metadata, Upload Revision, Archive/Restore, Delete (drafts only).
- **Add Manual form:** document identification, issue/revision dates, approval block (internal vs regulatory kept separate), acknowledgement flag (consumed by M3), file. Buttons: Save Draft / Submit for Review / Publish (publish requires a file + confirmation).
- **Revision upload:** prefills master metadata, suggests the next revision number, requires a reason; Save Draft Revision or Upload & Publish (publish requires confirmation).

### Document rules (M1)
- **Legacy compat:** V0.4.13 records (`status: 'active'`, flat fields, files at `manuals/{companyId}/{manualId}/{fileName}`) render as **Published** and stay readable/downloadable. First revision starts history without touching the old file.
- **Immutable revisions:** every upload goes to a new `manuals/{companyId}/{manualId}/revisions/{revisionId}/{fileName}` path; metadata + files are never overwritten. SHA-256 is computed from the actual bytes before upload and verified against a re-download afterwards (mismatch aborts and removes the object).
- **current vs effective:** a published revision always becomes `currentRevisionId`; it becomes `effectiveRevisionId` only when its `effectiveDate ≤ today`. Future-effective revisions publish without replacing the operational revision. Effective file pointers are denormalised onto the master for Android.
- **Deletion:** only `draft` masters can be permanently deleted (revision files + records cleaned up). Published manuals are **archived**, never deleted; archived manuals can be restored.

## M2 — Temporary Revisions & Distribution Targeting

### Distribution targeting
- Manual masters, permanent revisions, and temporary revisions store the same versioned `distribution` object.
- Target types: Entire company, selected criteria, or specific users. Criteria dimensions include role, department, aircraft type, and aircraft registration. Selected criteria are ANDed; values inside one dimension are ORed.
- The publisher reviews a recipient summary and matching user count before publish. Company-wide distribution is clearly labeled; a reliable total is not available from the current roster.
- Stable IDs (Firebase UIDs, linked crew IDs, or opaque Company User IDs) are used for individual targets; email is never an authorization key.
- Matching uses company-scoped active roster/account data, explicit department fields, and aircraft assignments from company flights. Unknown dimensions or empty matches produce a validation error, never a company-wide fallback.
- Existing M1/legacy manuals without a target remain company-wide for compatibility.

### Temporary revision workflow
- Temporary revisions are children of an existing parent manual at `companies/{companyId}/manuals/{manualId}/temporary_revisions/{id}`.
- Drafts can be created without a file and edited while in draft. Review submission requires an uploaded, checksum-verified PDF. Published revisions can be withdrawn; expiry is calculated from their validity dates and does not mutate or publish the record.
- Effective-until is inclusive; the document expires the following day. Effective-until must be later than effective-from. A temporary revision requires an active published parent manual and approver to publish. If regulatory approval applies, it must be approved and include its reference and date.
- Every attachment uses a unique immutable path under `manuals/{companyId}/{manualId}/revisions/{attachmentRevisionId}/{fileName}`. Replacing a draft attachment retains its prior attachment metadata.
- `evaluateEffectiveStatus()` is shared service logic for drafts, review, future-effective, effective, expired, withdrawn, and archived states. A date arriving never publishes a draft. Android must apply the same date and status rules.
- The Manual Library has effectiveness, aircraft, department, and temporary-revision filters; details show targeting and validity without adding more table columns. The Temporary Revisions section supports search/filter, add/edit draft, review, publish, view/download, and withdraw.

### M2 implementation
- `services/manualService.js` owns temporary revision CRUD/publication/subscriptions, shared date evaluation, versioned targeting, and company-scoped recipient matching.
- `modules/efb/manuals.js` contains the section UI and invokes service APIs only. `modules/efb/efb.js` passes the authenticated role/UID context.
- Recipient source coverage depends on currently available company accounts, linked crew profiles, Company Users, people, aircraft, and scheduled flight assignments. Aircraft targeting is limited to crew profiles assigned through company flights; department targeting requires an explicit department field. Missing data fails validation rather than widening access.
- No Firestore/Storage rules, Android screens/sync, or acknowledgements were added in M2.

## M3 — Document Acknowledgements

- Each permanent revision snapshots the parent manual's acknowledgement flag when created; each temporary revision snapshots it from its parent when published. Only exact revisions with the snapshot set to `true` require acknowledgement; older revisions are not retroactively included. Requirements point to the exact `manualId`, `revisionId`, `revisionType`, and authenticated Firebase UID.
- Acknowledgement documents live at `companies/{companyId}/manuals/{manualId}/acknowledgements/{acknowledgementId}`. The ID is deterministic (versioned SHA-256 of company, manual, type, revision, and user identity), so retries do not duplicate requirements or overwrite a prior acknowledgement.
- Publication invokes an admin-checked Cloud Function to resolve the saved M2 target from active company records and generate requirements. Unresolved audiences fail closed; an incomplete generation is marked and can be retried from the admin dashboard. Permanent and temporary revisions have independent counts and histories.
- Ordinary users see their own pending/history records from an authenticated callable. They can open or download the exact revision and explicitly submit **I Acknowledge This Revision**. Opening or downloading is not acknowledgement. The callable derives identity from Firebase Auth, verifies membership and recipient ownership, and transactionally timestamps the first acknowledgement; duplicate submissions are idempotent.
- ADMIN/OWNER users get per-revision recipient, pending, acknowledged, and completion counts; recipient details are loaded on demand in pages. Filters cover manual, revision type/status, applicability, department, aircraft, and publication date. CSV export includes the currently loaded recipient rows.
- Explicit redistribution increments a `distributionVersion`, records its target history, and creates requirements only for additional recipients; previous records remain unchanged. A failed redistribution leaves the previous audience and completed requirements usable, hides uncommitted next-version records, and marks redistribution incomplete for an admin to retry. Revision withdrawal/supersession/expiry affect whether pending acknowledgement is actionable, not historical records.
- Direct writes to the manuals subtree (including acknowledgement records) are restricted to active company admins. User acknowledgements and reports use authenticated Cloud Functions. This narrow M3 rule is not comprehensive M4 rules hardening.
- Web acknowledgements are online-only. The Android contract requires displaying the exact revision, verifying the file checksum, and waiting for server confirmation before marking acknowledged. Offline queueing is future Android work; a queued acknowledgement is not server-acknowledged. These records are not a legally binding signature or regulatory approval.
- Admin functions: `createManualAcknowledgementRequirements`, `getManualAcknowledgementSummary`, `getManualAcknowledgementRecipients`, and `redistributeManualRevision`. User functions: `getMyManualAcknowledgements` and `acknowledgeManualRevision`. The dashboard uses bounded recipient pages; no per-recipient listeners are opened.

### Implementation (files)
- `modules/efb/efb.html` — tabs + Flights panel + Manual Distribution panel (sections nav, stats, toolbar, table, modal container).
- `modules/efb/efb.js` — flights logic + `setTab()`; delegates manuals to `initManuals()`.
- `modules/efb/manuals.js` — Manual Distribution UI (render, filters, modals, actions). Calls `manualService` only.
- `modules/efb/efb.css` — tabs, library stats/toolbar, modal, form, preview styles.
- `services/manualService.js` — M1 master/revision workflow plus M2 targeting, recipient resolution, temporary revision lifecycle/subscriptions, and effective status evaluation.
- `services/manualAcknowledgementService.js` — authenticated callable client operations for requirement generation, user acknowledgement, reports, recipient paging, and redistribution.
- `functions/lib/manualAcknowledgements.js` + `functions/index.js` — server-side recipient resolution, deterministic/idempotent generation, membership checks, transactional acknowledgement, admin reports, and redistribution.
- `firestore.indexes.json` — composite revision-recipient index.
- `docs/firestorerules.md` — direct manuals-subtree writes limited to company admins; acknowledgements are written through callables.
- `services/storageService.js` — `buildManualRevisionStoragePath()`, `computeSha256()`, `verifyRemoteChecksum()`, `uploadManualRevision()` (immutable path + checksum verification), legacy `uploadCompanyManual()` retained.
- `services/uploadLimits.js` — `MANUAL_MAX_SIZE_BYTES` (20 MB), `validateManualFile()` / `prepareManualFile()`.
- `docs/database.md` — full `companies/{companyId}/manuals` + `/revisions` schema contract.
- `docs/storagerules.md` + `firebase.json` — `manuals/` storage rules (company-scoped, admin write, ≤20 MB) deployed via CLI.

### Security (current state)
- Firestore: the manuals-specific rule allows company-member reads and active company-admin writes; the generic module `edit` grant explicitly excludes `manuals`. Target filtering in the web UI is not a read-security boundary.
- Storage: `manuals/…` read for company admin/account/Android members; create/update/delete for company admin only.
- Non-admin EFB views show published manuals only; draft/in-review/archived records and revision history are hidden in the UI. This is a presentation restriction, not a security boundary; Firestore/Storage rule hardening remains M4.
- **M4 will tighten:** enforce `status`/`isMember` in storage helpers, verify the manuals-specific rule does not leave broader nested-path grants, and add server-side publication/audit enforcement.

### Acceptance criteria
- [x] EFB console shows two tabs; Flights/Dispatch/FDTL behaviour unchanged.
- [x] Legacy V0.4.13 manuals display as Published and remain viewable/downloadable.
- [x] New manuals: draft/review/publish workflow with structured metadata + PDF.
- [x] Revisions are immutable (new storage path, history retained, checksum verified).
- [x] current/effective revision separation incl. future-effective dates.
- [x] Published manuals archive (never delete); drafts delete with file cleanup.
- [x] Service layer only — no Firebase SDK imports in module files.
- [x] M2 temporary revision lifecycle, PDF checksum verification, inclusive validity dates, and withdrawal.
- [x] Versioned targeting for masters and permanent/temporary revisions, with company-scoped match validation and recipient preview.
- [x] Library effectiveness/temporary/aircraft/department filters and recipient-aware non-admin views.
- [x] M3 exact-revision acknowledgement requirements, authenticated user submission, duplicate prevention, admin summary/detail dashboard, recipient paging, and explicit redistribution.
- [x] Linked web users can list/view/download their acknowledgement requirements through authenticated callables; Android UI and synchronization remain deferred.

### Status
**M1, M2, and M3 web implementation complete.** Final JavaScript syntax, Firebase JSON, and whitespace checks passed. Revision and temporary attachment uploads still require Firebase Storage SHA-256 re-download verification. Browser/Firebase/Storage/Android smoke testing has not been run.

### Deferred
- **Android:** UI, offline file synchronization, and offline acknowledgement queue/retry.
- **M4:** comprehensive Firestore/Storage rule hardening, publication/audit enforcement, callable abuse controls, Android contract verification, and emulator/security tests.

### Browser smoke-test checklist (not yet executed)
1. Create a temporary revision linked to a published parent manual.
2. Save it as draft with no attachment and verify draft status.
3. Edit the draft, upload a PDF, and confirm the SHA-256 checksum is marked verified.
4. Publish it with an effective-from date in the future and a valid effective-until date.
5. Confirm it shows Published · Not yet effective and is not shown to non-targeted users.
6. With the service evaluator/reference date set to the effective date, confirm it evaluates as effective (without changing draft records to published).
7. With the reference date one day after effective-until, confirm it evaluates and displays as expired.
8. Withdraw a published temporary revision and confirm it is no longer presented as effective.
9. Test company-wide, role/department/aircraft criteria, and individual stable-ID targeting; confirm matching summaries and unresolved criteria errors.
10. Sign in as a non-targeted user and confirm neither the permanent nor temporary targeted document appears in the UI.
11. Confirm M1 master creation/editing, immutable revision history, publishing, and archive/restore still work.
12. Confirm the Flights tab and flight actuals workflow remain unaffected.

### M3 acknowledgement smoke-test checklist (not yet executed)
1. Publish a manual with acknowledgement required.
2. Confirm requirements are generated for exactly the selected M2 recipients.
3. Sign in as a non-recipient and confirm no requirement is returned.
4. Open the requirement and confirm it identifies the exact permanent or temporary revision.
5. Download the exact revision file and verify its checksum metadata.
6. Submit **I Acknowledge This Revision** and confirm the server timestamp/status updates.
7. Submit the same acknowledgement again and confirm it is idempotent.
8. Confirm another user cannot submit on the first user's behalf.
9. Publish a new revision and confirm independent requirements are generated.
10. Confirm acknowledgement history for the previous revision is preserved.
11. Withdraw a temporary revision and confirm pending acknowledgement is no longer actionable.
12. Redistribute a published revision and confirm only additional recipients are added under the next distribution version.
13. Confirm dashboard totals and per-revision completion percentages.
14. Confirm recipient pages, pending/acknowledged views, filters, and CSV export.
15. Re-run M1 and M2 manual publication, temporary revision, targeting, and history workflows.
16. Confirm Flights, Dispatch, and FDTL remain unaffected.

## Remaining Enhancements (backlog)
- Push planned flight assignments to the crew member's EFB session.
- Versioned briefing packs with expiry windows.
