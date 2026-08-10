# Crew V2 — Single-Screen UX (Design Spec)

Status: **Implemented in `modules/crew/*` (web).**
Applies to: `modules/crew/*` (web). The Firestore / service / offline-queue architecture is **unchanged**.

---

## 1. Why V2

V1 (Crew Management) split one operational job — *"I manage my pilots and make sure their documents are valid"* — across six tabs plus a seven-tab profile page. That violates the **Convenience** principle.

V2 philosophy:

> **One screen → see my pilots → immediately know who needs attention → click a pilot → manage everything about that pilot.**

Compliance is not a destination; it is a **property of every pilot**. Documents are not a destination; they live **on the pilot**. Linking is not a concept the operator thinks about; it is **"Add Pilot"**. Bulk actions are not a tab; they appear **only when something is selected**.

Everything the V1 module can do still exists. It is just reached differently.

---

## 2. Screen Map (V1 → V2)

| V1 | V2 |
| --- | --- |
| Header "Crew Management" + 6 tabs | Single "Crew" screen |
| Crew Directory tab (table) | Pilot list: **cards by default, switchable to table** |
| KPI row (5 cards) | Compact **Attention strip** (3 stats, clickable filters) |
| Compliance tab | **Needs Attention** section + per-pilot compliance reason |
| Documents tab | Documents inside the **Pilot drawer** + document detail modal |
| Pilot Linking tab | **Add Pilot modal** (invite existing / create record) + Invite Code action in drawer |
| Pending Requests (linking tab) | **Pending requests banner** near the top |
| Crew Profile tab (create/edit form) | **Add Pilot modal** (create) + **Edit** action in drawer |
| Bulk Actions tab | **Contextual bulk toolbar** (appears only when ≥1 selected) |
| Quick-view drawer (read-only) | **Full pilot drawer** (Overview / Documents / More) |
| Compliance category rings (tab) | Deferred: per-category compliance card in drawer Overview (Slice 10, optional) |
| Training / Flight Experience / Notes / Connections / History (profile page) | Drawer → **More ▾** (read-only, graceful empty states) |

The three interaction levels are now strictly:

```
Level 1 — Crew   : list, search, attention, add pilot
Level 2 — Pilot  : drawer (identity, compliance reason, documents, actions)
Level 3 — Document: detail modal (metadata, file, edit/replace/delete)
```

---

## 3. The One Screen (wireframe with element IDs)

```
<section class="cm-shell" id="cm-shell">
┌────────────────────────────────────────────────────────────────────────┐
│  VAMS Portal / Crew                                            (breadcrumb)
│  CREW                                                     [+ Add Pilot] │
│  Manage your pilots and keep their documents current.                   │
│  [🔍 search] (cm-search)      [Filter ▾] (cm-filter-toggle)  [👤 user]  │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ sync strip (cm-sync-count / cm-last-sync / cm-sync-flash /          │ │
│ │          cm-sync-error / cm-status)  — moved up, always visible     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ 🔔 2 pilot requests waiting                      (cm-pending-banner)    │
│                                                                         │
│ ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐       │
│ │ 👥 13 Pilots  │  │ 🟠 3 Attention    │  │ 🔴 2 Non-Compliant     │       │
│ └──────────────┘  └──────────────────┘  └───────────────────────┘       │
│                    (cm-attention-strip — each stat filters the list)     │
│                                                                         │
│ NEEDS ATTENTION                              (cm-attention-section)     │
│ 🔴 Capt. Suresh   Medical expired 3d ago                  [View] →      │
│ 🟠 Capt. Ravi     PPC expires in 18 days                  [View] →      │
│                                    (cm-attention-list, compact rows)    │
│                                                                         │
│ YOUR PILOTS · 13        [▤ cards] [☰ list]  (cm-view-toggle)            │
│ ┌────────────────────────────────────────────────────────────┐          │
│ │ ☐  👨✈️ Capt. Arun Kumar    C208B · Hyderabad   🟢 COMPLIANT  │          │
│ │     Licence ✓  Medical ✓  PPC ✓  IR ✓        8 documents  │          │
│ │     Next expiry: PPC — 14 Feb 2027                        │          │
│ └────────────────────────────────────────────────────────────┘          │
│ ┌────────────────────────────────────────────────────────────┐          │
│ │ ☐  👨✈️ Capt. Ravi Kumar    C208B · Chennai   🟠 ACTION     │          │
│ │     Licence ✓  Medical ⚠  PPC ✓  CRM ✓     7 documents   │          │
│ │     Medical expires in 18 days                            │          │
│ └────────────────────────────────────────────────────────────┘          │
│            (cm-pilot-grid — cards; or cm-crew-table in list mode)       │
│                                                                         │
│ ⬚ Empty state when no results  (cm-empty-state)                         │
└────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────┐   ┌────────────────────────┐
│ cm-bulk-toolbar (fixed bottom, shown     │   │ cm-drawer  (right side │
│ when selectedRows.size > 0)              │   │  full pilot drawer,    │
│ 3 selected · [Reminder][Export][Set      │   │  Level 2)              │
│  Active][Set Inactive][Assign][Delete]   │   │                        │
│  [Clear]                                 │   │ cm-modal (generic,     │
└──────────────────────────────────────────┘   │  used for Level 3 doc  │
                                               │  detail, Add Pilot,    │
                                               │  confirms)             │
                                               └────────────────────────┘
```

Rules that make this "one screen":
- **No tab bar.** The `cm-tabs` element is removed. `setActiveTab` / `renderTabContent` (directory.js:80,113) are replaced by `renderCrewScreen()`.
- All overlay surfaces (drawer, modals, bulk toolbar) are positioned over this single screen; the underlying list never changes context while they are open.
- The sync strip (queue.js) is module-level, not buried in the directory panel.

---

## 4. Component Specs

### 4.1 Header
- Title: **Crew** (drop "Management"). Subtitle: *Manage your pilots and keep their documents current.*
- Breadcrumb: `VAMS Portal / Crew`.
- Right side: user chip (unchanged: `cm-user-name`, `cm-user-role`, `cm-user-avatar`), notifications bell `cm-btn-notifications` (unchanged behaviour, links to pending banner instead of a tab), primary button **`+ Add Pilot`** (`cm-btn-add-crew`) → opens Add Pilot modal (4.12).
- `cm-global-search` in the header is **removed** — one search box only, at `cm-search` (4.5).

### 4.2 Sync strip (persistent)
Move the existing `cm-sync-strip` block (currently inside the directory panel, crew.html:161) to module level, directly under the header. Wiring unchanged: `renderQueueSyncState()` from `queue.js`, `cm-status` from `setStatus` (utils.js:165).

### 4.3 Pending requests banner — `cm-pending-banner`
- Visible when there are **pending** requests in the current user's direction:
  - Operator view: `crewState.outgoingRequestsCache` filtered to `PENDING` (resend/cancel).
  - Pilot view: `crewState.incomingRequestsCache` filtered to `PENDING` (accept/decline).
- Header line: `🔔 N pilot requests waiting` (button to expand/collapse the list).
- List `cm-pending-list` renders compact rows reusing the payload shapes already produced by `renderOutgoingRequests` (linking.js:117) and `renderIncomingRequests` (linking.js:203). Action buttons reuse the same handlers as today (`assignPilotByEmail` resend, `withdrawConnectionRequest`, `acceptIncomingLinkRequest`, `declineConnectionRequest`) — see crew.js:329-430.
- Notif dot `cm-notif-dot` keeps counting the same pending set via `updateNotifDot` (directory.js:42).
- After any accept/decline/cancel, call `refreshCrew()` (crew.js:99) as today.

### 4.4 Attention strip — `cm-attention-strip`
Three compact clickable stats (replaces the 5-card KPI row):
1. **👥 N Pilots** (`cm-stat-total`) — no filter.
2. **🟠 M Need Attention** (`cm-stat-attention`) — sets compliance filter to `ACTION` (includes non-compliant crew too, i.e. "everyone not green").
3. **🔴 K Non-Compliant** (`cm-stat-noncompliant`) — sets compliance filter to `NONCOMPLIANT`.

Clicking a stat toggles that filter and re-renders the list + attention section. Counts come from the Attention engine (Section 5).

### 4.5 Toolbar — search + filter popover
```
<div class="cm-toolbar">
  <div class="cm-search-wrap"> [🔍] <input type="search" id="cm-search"> </div>
  <button id="cm-filter-toggle">Filter ▾</button>   (badge shows active filter count)
  <div class="cm-filter-popover hidden" id="cm-filter-popover">
    Status    ☐ Active ☐ Inactive ☐ Suspended ☐ On Leave
    Compliance ☐ Compliant ☐ Action needed ☐ Non-compliant
    Role      ☐ Pilot ☐ AME ☐ Operations ☐ Training
    Base      ☐ <each distinct base in cache>
    [Apply Filters] [Clear]
  </div>
</div>
```
- **Search**: single input, live, debounced ~250ms. Uses the Search spec (Section 6). Resets to page 1 on change.
- **Filters**: multi-select checkbox groups (the user's wireframe). State lives in `crewListState` as `Set`s (Section 7). `Apply` commits them and closes the popover; `Clear` empties all and closes. The toggle button shows a count badge, e.g. `Filter (2)`, when any filter is active.
- Base options are derived dynamically from `crewState.pilotsCache` (`pilot.organizationBase || pilot.base`, unique, sorted).

### 4.6 Needs Attention section — `cm-attention-section`
- **Hidden entirely** when every pilot is `COMPLIANT` and there are no `No Documents` pilots. (Green is not news.)
- When visible: heading **Needs Attention**, then compact rows (`cm-attention-list`) for every pilot with level `ACTION` or `NONCOMPLIANT`, sorted by *most urgent first* (lowest `daysUntil`), limited to 5 with a `+N more` footer.
- Each row: status dot (🟠/🔴), `Name — reason text` (Section 5), and a `[View]` button that opens the pilot drawer for that pilot.
- Clicking the section heading sets the compliance filter to `ACTION` and scrolls to the list, so the full set is one tap away.

### 4.7 Pilot list — cards ↔ table toggle
Default **cards** (`cm-pilot-grid`); `cm-view-toggle` swaps to a **table** view and back. Choice persisted in `localStorage` (`vs-crew-list-view`). State: `crewListState.view`.

**Card** (per pilot, click anywhere → drawer; checkbox `cm-card-check` for selection):
```
┌────────────────────────────────────────────────────┐
│ ☐  [avatar]  Capt. Arun Kumar            🟢 COMPLIANT │
│               C208B · Hyderabad   ·   PILOT           │
│               Licence ✓  Medical ✓  PPC ⚠            │
│               Next expiry: PPC — 14 Feb 2027    →     │
└────────────────────────────────────────────────────┘
```
- Avatar: existing `getInitials` (utils.js:255).
- Subtitle line: `{aircraft || designation} · {base}` — aircraft is optional (`pilot.fleetAssignments` / `pilot.aircraftType`, **not** added by V2); fall back to base only, then role label.
- Status badge: `🟢 COMPLIANT` / `🟠 ACTION NEEDED` / `🔴 NON-COMPLIANT` / neutral `NO DOCUMENTS` (grey).
- Doc chips: `getPrimaryDocChips(docs)` — up to 4 short labels derived from `documentCategory`/`documentName`: LICENCE→"Licence", MEDICAL→"Medical", RATINGS/CHECKS→"PPC"/"IR"/"IPC" (matched by name keywords), TRAINING→"CRM"/"DG". Each chip gets ✓ (valid), ⚠ (expiring), ✕ (expired) via `getDocumentComplianceState`.
- Footer line: **Next expiry** = the earliest expiring/expired doc, text from `formatExpiry().rel` (utils.js:41), or "No documents yet."
- Rendered count in section heading: `YOUR PILOTS · 13`.

**Table** view: reuse the existing `renderCrewTable` (directory.js:129) and `cm-crew-table` markup, but driven by the same filtered set and the new multi-select filter state. Clicking a row still opens the drawer; checkbox column feeds `selectedRows`.

### 4.8 Empty state — `cm-empty-state`
- No pilots at all: icon + *"No crew yet. Add your first pilot."* + `[+ Add Pilot]`.
- No matches: icon + *"No pilots match your search or filters."* + `[Clear filters]`.

### 4.9 Bulk toolbar — `cm-bulk-toolbar`
- Fixed/sticky bottom bar. **Hidden** when `crewState.selectedRows.size === 0`; animates in when ≥1.
- Content: `N selected` + actions reusing `applyBulkAction` (bulk.js:36): `Reminder`, `Export`, `Set Active`, `Set Inactive`, `Assign`, `Delete`, and `[Clear]` (clears `selectedRows`).
- Hidden entirely for pilot-role users (see 4.13).

### 4.10 Pilot drawer (Level 2) — `cm-drawer`
Evolves the existing `openDrawer` (directory.js:208). Structure:

```
<header class="cm-drawer-head">
  [avatar]  Capt. Arun Kumar
            C208B · Hyderabad · PILOT
            🟢 COMPLIANT  —  "All documents valid"
</header>
<div class="cm-drawer-actions">
  [Edit] [Invite Code] [Set Inactive] [Delink] [Delete]   ← existing handlers
</div>
<nav class="cm-drawer-nav">  [Overview] [Documents] [More ▾]  </nav>

── OVERVIEW (default) ──────────────────────────────
  • Compliance reason card (Section 5, always visible)
  • Personal KV: Employee ID, Phone, Base, Operator, Link State, Status
  • Summary: Licence # · Medical expiry · Compliance %
  • Optional Slice 10: compliance-by-category mini rings

── DOCUMENTS ───────────────────────────────────────
  [+ Upload Document]  (cm-drawer-upload)
  doc rows: [name + status badge] [number] [expiry rel] → click opens Level 3
  (rendered from docsByPilotCache; empty state: "No documents yet.")

── MORE ▾ ──────────────────────────────────────────
  Training · Flight Experience · Connections · Activity
  Read-only, graceful empty states ("Coming in Phase 2" for training/
  experience flows). Reuses data already read by V1:
    • Connections: pilot.linkedOperator / operatorId
    • Activity: recentAudit + doc lastEditedBy/lastModified (as in
      directory.js:356-360 compliance history section)
```
- Default open tab: `documents` when arriving from an attention row or a doc-related action; otherwise `overview`. Persist `crewState.drawerView` per session.
- Actions row is gated by the same permissions as today (`canPerformCrewAction`, permissionService).
- `[Invite Code]` → `issueCompanyInvite(pilotUid)` (linking.js:300); the code + countdown render inline in the drawer (small box), reusing `setActiveLinkCode`/`renderLinkCode` timer logic (linking.js:35-90).
- `[Edit]` → opens the profile form **in the modal** (not a tab) pre-filled via the existing field-mapping in `openProfileForm` (profile.js:23), saved via `saveProfileForm` (profile.js:65).

### 4.11 Document detail modal (Level 3) — via `cm-modal`
Opening from a drawer doc row (or an attention row's doc):
```
PPC                                 🟠 EXPIRING
Number: PPC-12345
Issue date: 12 Jan 2025
Expiry: 28 Aug 2026  (in 18 days)
Issued by: DGCA
Reminder: 30 days
Notes: ...
[View / Preview]   [Edit]   [Replace]   [Delete]
```
- `View / Preview` → `previewDocument` (documents.js:210).
- `Edit` → inline swap to the existing edit form (reuse `editDocumentWithForm` logic, documents.js:398) with `updatePilotDocumentWithAudit` + offline queue fallback (unchanged).
- `Replace` → file picker + upload via `uploadUserDocumentFile`, then `updatePilotDocumentWithAudit` with the new `documentUri`/`storagePath`; offline fallback: enqueue update (unchanged path, documents.js:439-495).
- `Delete` → `deleteDocument` (documents.js:500) with the existing confirm + queue fallback.

### 4.12 Add Pilot modal — `cm-modal`
Opened from `+ Add Pilot` header button or empty-state button. Two-step:

```
ADD PILOT
  ┌─────────────────────────────┐  ┌─────────────────────────────┐
  │ 🔗 Invite existing pilot    │  │ ✚ Create crew record        │
  │ Send invitation to a pilot  │  │ Add pilot manually          │
  │ who already has an account  │  │ (no pilot account needed)   │
  └─────────────────────────────┘  └─────────────────────────────┘
```
- **Invite existing pilot**: email field → `assignPilotByEmail` (linking.js:245 flow). On success `refreshCrew()` + toast.
- **Create crew record**: renders the existing profile form fields (name, email, phone, employee id, role, licence #, medical expiry, licence expiry, status — crew.html:218-294) → `createPilot` (profile.js:155). On success `refreshCrew()` + toast.
- Both paths keep the operator field auto-filled (`crewState.activeOperatorUid`).
- Also surfaces a collapsed **Requests** accordion reusing `renderOutgoingRequests`/`renderIncomingRequests` so nothing from the old Linking tab is lost.

### 4.13 Pilot-role variant
`applyRoleLayout` (crew.js:458) extended:
- Hide `+ Add Pilot`, bulk toolbar, and the card checkboxes.
- List shows a single card for the current user (`crewState.activeCurrentUser`).
- Pending requests banner shows **incoming** requests only (accept/decline), as today.
- Drawer = the pilot's own profile (Overview/Documents/More), same component.

---

## 5. Attention Engine

Replaces the tab-based compliance UI. New pure helpers in `utils.js` (kept beside existing `getCompliance` utils.js:180):

```js
// level: 'COMPLIANT' | 'ACTION' | 'NONCOMPLIANT' | 'NODOCS'
function getCrewAttentionLevel(docs):
  if !docs.length                      → 'NODOCS'
  if any doc expired (days < 0)        → 'NONCOMPLIANT'
  if any doc expiring (0 <= days < 30) → 'ACTION'
  else                                 → 'COMPLIANT'

function getAttentionReasons(pilot, docs) ->
  [{ doc, state, days }]   // every doc that is expired or expiring within 30d, plus
                           // a synthetic { reason: 'No documents yet.' } when NODOCS

function getAttentionSummary(level) ->
  { level, primary, text }
  // primary  = earliest-expiring non-valid doc
  // text     = "Medical expired 3 days ago"
  //            "PPC expires in 18 days"
  //            "All documents valid"
  //            "No documents uploaded yet."
```

Thresholds (align with existing KPI/compliance semantics):
- `days < 0` → expired → **NON-COMPLIANT (🔴)**
- `0 ≤ days < 30` → expiring → **ACTION NEEDED (🟠)**
- else → **COMPLIANT (🟢)**
- no docs → **NO DOCUMENTS (grey, ⚪)**

Consumers:
- Attention strip counts (4.4).
- Needs Attention list (4.6).
- Card status badge + footer line (4.7).
- Drawer header reason card (4.10).
- Optional: sort the default list by urgency instead of name when the attention filter is active.

The existing `getCompliance`/`summarizeCrewDocumentCompliance` stay for backward compat and table view.

---

## 6. Search Spec

Single input `cm-search`. Replace the current `getPilotSearchText` (utils.js:88) with a tokenized index:

```js
function buildPilotSearchIndex(pilot, docs) {
  return [
    toProfileName(pilot), pilot.email, pilot.employeeId, pilot.designation,
    getPilotRoleLabel(pilot), pilot.organizationBase, pilot.base,
    ...docs.flatMap(d => [ d.documentName, d.documentCategory,
                           d.licenseOrCertificateNumber, d.issuingAuthorityOrBody ])
  ].join(' ').toLowerCase()
}
```

Semantic tokens (matched even when the text index has no hit):
- `expired` → level `NONCOMPLIANT` or any expired doc
- `expiring` / `due` → level `ACTION`
- `valid` / `compliant` → level `COMPLIANT`
- `attention` → level is `ACTION` or `NONCOMPLIANT`
- `no docs` / `nodocs` → level `NODOCS`

Behaviour:
- Query tokens are ANDed; each token must match the index text or a semantic predicate.
- Matching a pilot keeps their docs visible in the drawer unchanged (search only filters the list).
- Debounce 250ms; re-render cards/table + attention section.
- Examples: `Arun` → that pilot; `ATPL`/`CPL` → pilots whose licence doc mentions it; `PPC` → pilots with a checks/proficiency doc; `expired` → non-compliant pilots; `VT-IIC` → pilots whose doc number/registration mentions it (registration indexing is best-effort until aircraft data lands).

---

## 7. State Model Changes (`modules/crew/state.js`)

```js
// REMOVE (tabs are gone)
CREW_TAB_STORAGE_KEY            // replaced by nothing
crewState.activeTab

// ADD
export const CREW_LIST_VIEW_KEY = 'vs-crew-list-view';
crewState.screen = 'crew';                          // reserved; single screen
crewState.drawerView = 'overview';                  // 'overview'|'documents'|'training'|'experience'|'connections'|'activity'
crewState.activeDocument = null;                    // doc currently in Level 3 modal

// EXTEND crewListState (existing single-value fields removed → Sets)
crewListState.view = 'cards';                       // 'cards' | 'table' (persisted)
crewListState.statuses = new Set();                 // 'Active','Inactive','Suspended','On Leave'
crewListState.compliances = new Set();              // 'COMPLIANT','ACTION','NONCOMPLIANT','NODOCS'
crewListState.roles = new Set();                    // 'PILOT','AME','OPERATIONS','TRAINING'
crewListState.bases = new Set();                    // base names
crewListState.filterOpen = false;                   // popover visibility
```

`selectedPilotUid`, `selectedRows`, `pilotsCache`, `docsByPilotCache`, `incomingRequestsCache`, `outgoingRequestsCache`, queue state, and all `*Unsubscribe` fields are **unchanged**.

`getSortedAndFilteredPilots` (utils.js:108) is updated to the new Set-based filters; `complianceRank` (utils.js:78) maps `NONCOMPLIANT=3, ACTION=2, COMPLIANT=1, NODOCS=0`.

---

## 8. Code Mapping — reuse, replace, delete

### Reuse as-is (service/data layer — untouched)
`crewService.js`, `documentService.js`, `companyService.js`, `storageService.js`, `permissionService.js`, `organizationService.js`, `crewDocumentSyncService.js`, `queue.js`, all Firestore listeners in `crew.js`.

### Reuse with re-wiring
| Existing | V2 use |
| --- | --- |
| `refreshCrew` (crew.js:99) | unchanged; calls `renderCrewScreen()` instead of `renderTabContent` |
| `selectPilot` (crew.js:64) | unchanged; also refreshes drawer if open |
| `getSortedAndFilteredPilots` (utils.js:108) | drives cards, table, attention |
| `getCompliance`/`getCompliancePercent` (utils.js:180/215) | table view, drawer summary |
| `renderMiniRing`/`renderExpiryCell` (utils.js:238/265) | table view, drawer |
| `renderCrewTable` (directory.js:129) | table view of pilot list |
| `renderPilotDocuments` (documents.js:71) | drawer DOCUMENTS tab |
| `submitDocumentUpload` (documents.js:237) | drawer upload |
| `editDocumentWithForm` (documents.js:398) | Level 3 Edit |
| `deleteDocument` (documents.js:500), `previewDocument` (documents.js:210) | Level 3 |
| `renderOutgoingRequests`/`renderIncomingRequests` (linking.js:117/203) | pending banner + Add Pilot accordion |
| `issueCompanyInvite` (linking.js:300), `setActiveLinkCode` (linking.js:35) | drawer Invite Code + timer |
| `sendPilotLinkRequest` flow (linking.js:245) | Add Pilot → invite |
| `applyBulkAction`/`getSelectedPilots`/`exportCrewCsv` (bulk.js:36/32/174) | bulk toolbar |
| `openProfileForm`/`saveProfileForm` (profile.js:23/65) | Add Pilot create + drawer Edit (rendered in modal) |
| `openModal`/`confirmModal` (utils.js:288/306) | all overlays |

### Replace
- `setActiveTab` / `renderTabContent` / `positionTabUnderline` (directory.js:80-125) → `renderCrewScreen()` (new).
- `updateKPIs` (directory.js:48) → attention strip renderer + `updateNotifDot` kept.
- `openDrawer` (directory.js:208) → rebuilt drawer with sub-nav.
- `renderComplianceTab` (compliance.js:14) → attention engine (Section 5).
- `renderBulkTab` (bulk.js:26) → bulk toolbar.
- `renderLinkingTab` (linking.js:102) → Add Pilot modal + pending banner.

### Delete from `crew.html`
`cm-tabs`, all six `cm-panel-*` sections, the header `cm-global-search`. Their JS entry points are removed; the underlying helpers survive (Section 8 reuse).

---

## 9. Implementation Slices (each independently testable)

1. **Shell** — rewrite `crew.html` to the single-screen skeleton (4.1-4.3); remove tabs; `init` (crew.js:470) calls `renderCrewScreen()`; state.js tab removal; keep a stub that renders the existing table into the list region so nothing breaks mid-flight.
2. **Pilot list** — cards (4.7) + view toggle + empty state; `getSortedAndFilteredPilots` → new Set filters.
3. **Attention engine** — helpers (Section 5), attention strip (4.4), Needs Attention section (4.6), stat clicks.
4. **Search** — single input, index + semantic tokens (Section 6).
5. **Drawer rebuild** — Overview/Documents/More (4.10) on top of existing `openDrawer`; doc rows open Level 3.
6. **Document modal** — Level 3 (4.11), upload/replace/edit/delete wiring.
7. **Add Pilot** — modal (4.12) with invite/create paths; retire profile tab.
8. **Pending banner** — (4.3) for operator and pilot roles.
9. **Bulk toolbar** — (4.9), retire bulk tab.
10. **Optional** — compliance-by-category rings in drawer Overview.

After each slice: `renderQueueSyncState` stays live, all offline-queue paths untouched.

---

## 10. Acceptance Criteria

1. The crew module renders as **one screen**: no tab bar anywhere.
2. Every V1 capability still reachable: create pilot, invite/link pilot, view/edit/upload/replace/delete documents, bulk status/reminder/export/delete, accept/decline requests, invite codes with countdown, offline queue retry.
3. Compliance is visible on every pilot (badge + reason) and aggregated in Needs Attention — never as a separate page.
4. All overlays (drawer, doc modal, Add Pilot, bulk toolbar) open over the list without changing list context.
5. Search handles name, email, licence #, doc name/number, base, and the semantic tokens (`expired`, `expiring`, `valid`, `attention`).
6. Filters are multi-select checkboxes behind one `[Filter ▾]` button; the button shows an active-filter count.
7. List view toggle (cards/table) persists across reloads.
8. Pilot-role users see only their own profile card, no Add Pilot, no bulk actions, and incoming-request banner.
9. Live Firestore snapshots still update the list, attention strip, and drawer in place.
10. `docs/modules/crew.md` gets a "V2" pointer paragraph to this spec (Section 11).

---

## 11. Docs update

Add a pointer at the top of `docs/modules/crew.md`:

> **Crew V2 (single-screen UX) has been designed and approved. See `crew-v2-ux.md`. V1 remains feature-complete/UX-overloaded and is frozen until V2 replaces it.**
