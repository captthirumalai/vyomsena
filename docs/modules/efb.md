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
- **Manual Distribution** tab: admin uploads company manuals for linked users to view/download (see below).

### Data flow
```
Dispatch (planned flight) → EFB (record actuals) → companies/{companyId}/flights
        → FDTL (compliance evaluation + mismatch reconciliation)

Admin (web) → EFB Manual Distribution tab → Storage manuals/ + companies/{companyId}/manuals
        → Linked users (Android) view + download for offline use
```

## Console Layout

The EFB console is a tabbed view:

```
EFB console
├── Tab 1: Flights              (Flight Assignments + Record Actuals)
└── Tab 2: Manual Distribution  (company manuals upload + list)
```

- Tab pattern mirrors `crewprofile`: `role="tablist"` buttons (`.efb-tab`) + `.efb-tab-panel` sections + `setTab()` in `modules/efb/efb.js`, styles in `efb.css`.

## Manual Distribution

**Terminology:** document distribution in EFB is henceforth called **Manual Distribution**.

**Purpose:** Admin (web app user) uploads company manuals. All linked users can view and download them to their devices for offline use.

**Audience:** all consumers are Android app users only. The Android-side setup is being developed separately (this repo holds no Android source; see `docs/android-*.md`).

### How it works
1. Admin opens EFB → **Manual Distribution** tab → uploads a manual (title, file).
2. File bytes go to **Firebase Storage under `manuals/`**:
   `manuals/{companyId}/{manualId}/{fileName}`
3. Manual metadata is written to Firestore at `companies/{companyId}/manuals` (per the company module subcollection convention in `docs/database.md`), with `companyId`, `createdAt`, `lastModified`, `title`, `fileName`, `storagePath`, `documentUri`, `size`, `contentType`, `status`, `uploadedBy`.
4. Linked users (Android) list manuals via the shared `companies/{companyId}/manuals` collection, view and download the file for offline storage on device.
5. Web side is upload/manage (view/download/delete, admin only for upload/delete); consumption is Android-only.

### Implementation (files)
- `modules/efb/efb.html` — tab bar + Flights panel (existing cards) + Manual Distribution panel (upload form + manuals table).
- `modules/efb/efb.js` — `setTab()`; upload/delete orchestration; `onCompanyModuleSnapshot('manuals')` live list; blob download with open-in-new-tab fallback.
- `modules/efb/efb.css` — `.efb-tabs` / `.efb-tab` / `.efb-tab-panel` styles (mirroring crewprofile) + manual status/action styles.
- `modules/efb/manifest.js` — title/name/breadcrumbs renamed to **EFB**.
- `services/uploadLimits.js` — `MANUAL_MAX_SIZE_BYTES` (20 MB), `validateManualFile()` / `prepareManualFile()` (PDF + JPG/PNG/WebP, image compression).
- `services/storageService.js` — `buildCompanyManualStoragePath()`, `uploadCompanyManual()`, `deleteCompanyManualFile()`.
- `docs/storagerules.md` — `match /manuals/{companyId}/{manualId}/{fileName}`: read for company admin/account members/Android company members; create/update for company admin only (≤20 MB, `application/pdf` + `image/(jpeg|png|webp)`); delete for company admin.
- `firebase.json` — `storage.rules` entry added so storage rules deploy with the CLI (previously storage rules were doc-only).
- Firestore rules: no change needed — the generic `companies/{companyId}/{module}/{document=**}` rule already covers `manuals` (read for company members, write for admins).

### Acceptance criteria
- [x] EFB console shows two tabs: Flights, Manual Distribution; existing flight features unchanged.
- [x] Admin can upload a company manual; file lands in Storage `manuals/…`, metadata in `companies/{companyId}/manuals`.
- [ ] Linked users can list, view, and download manuals (Android scope — pending Android work).
- [x] Storage rules deny access to non-linked users.
- [x] Service layer only (no direct Firebase SDK imports from module files).

### Status
**Web side implemented (pending approval review).** Remaining: deploy storage rules (`firebase:deploy`), Android app work — list/view/download manuals + offline storage — scoped with the Android setup.

## Remaining Enhancements (backlog)
- Read acknowledgement tracking by pilot.
- Versioned briefing packs with expiry windows.
- Push planned flight assignments to the crew member's EFB session.
