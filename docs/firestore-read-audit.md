# VAMS V2 — FIRESTORE READ AUDIT

This document started as an analysis-only pass (findings in §1–§14). A subsequent implementation pass applied the approved P0/P1 optimizations from §13; see **§15 Implementation Status** for what changed and this doc's other sections are annotated with `[implemented]` / `[not implemented]`.

---

## 1. EXECUTIVE SUMMARY

VAMS is a vanilla-JS SPA (Firebase SDK v10.8.0, modular/ESM imports, no bundler). All Firestore access flows through one thin wrapper (`services/firestoreService.js`) into ~20 domain services, which modules call from their `init()`. The app is **pull-first, listen-heavy**: every module re-fetches *entire collections* via `getDocs` on every page entry, **and** subscribes to `onSnapshot` live listeners of the same data — so the same logical dataset is often read twice (once pulled, once pushed) per navigation, and again after any write.

Key structural facts:
- The router (`js/router.js`) calls the previous module's `destroy()` on navigation, and every audited module stores + calls its own unsubscribes — so **normal navigation does NOT leak listeners**. There is one real leak window (async race during module init) plus one never-stopped 30-second background worker.
- **Unbounded queries dominate.** Only 4 of ~64 reads have a `limit()` (fatigue=100, audit=50, plus the two `getDoc` single-doc reads). Flights, all document lists, crew profiles, duty records, training collections, and even the entire global `aircraft` collection are read without limits or pagination.
- **Read amplification via snapshot callbacks.** Several modules re-run whole-collection `getDocs` inside `onSnapshot` callbacks — e.g. Dispatch re-reads *every pilot document* on *every aircraft snapshot change* (even a change to an aircraft belonging to a different company, because the global `aircraft` collection is watched), and Crew/Dashboard/Weather re-read all documents on every crew-profile change.
- **Log-in/log-out leaks the current module's live listeners forever.** `js/auth.js` clears the store on logout but never calls the router's cleanup; the active module's listeners keep running while logged out.

The high daily read count is **almost certainly expected from the architecture** (combination of #1, #2, #4, #6 in your list), amplified by a few specific hotspots. It is not a single bug.

---

## 2. FIRESTORE READ ARCHITECTURE

```
UI (index.html + modules/*/manifest.js HTML)
  → modules/*.js   (init() on route navigation; calls services)
  → services/*.js  (domain services, e.g. crewService, documentService)
  → services/firestoreService.js  (thin wrapper: getDoc/getDocs/onSnapshot/query/...)
  → firebaseService.js  (initFirebase → getFirestore)
  → Firebase Web SDK v10.8.0 (Firestore)
      ├── top-level collections: users, crew_profiles, connection_requests,
      │     user_documents, operator_training_records, aircraft,
      │     training_centers, training_offerings, training_bookings,
      │     admin_users, company_accounts, company_invites, access_codes,
      │     crew_link_codes, companies
      └── per-company subcollections: companies/{companyId}/flights, /aircraft,
            /crew, /fdtl_scheme, /fdtl_duty, /fdtl_records, /fdtl_fatigue,
            /fdtl_audit, /settings (crewPolicy)
```

**Lifecycle trigger chain:**
```
page load/index.html → js/app.js → initAuth() → authStateObserver
  → (user) loadUserProfile → getUserByUid (getDoc users/{uid} + fallback crew_profiles/{uid})
  → OPERATIONS role → bootstrapCompanyWorkspace → ensureAdminUser (admin_users getDoc)
       → getCompany (getDoc) → getCompanyAccount (getDoc)
  → initRouter() → resolve hash → module manifest
  → loadModuleHtml + importModuleJs(route)   ← OLD module still alive here
  → cleanupActiveModule() = oldModule.destroy()   ← unsubscribes + clears
  → await newModule.init(view, ctx)   ← all Firestore reads happen here
  → activeModule = instance
```

Auth, per-login reads: 1–2 (users) + 1 (admin_users) + 1 (companies) + 1 (company_accounts) = **4–5 getDoc reads**, then the **default route `/dashboard` init** executes its full read set (~70+ reads for a small org, see §5/§10).

---

## 3. COMPLETE READ INVENTORY

Read types: `getDoc` (single), `getDocs` (query, 1 read per returned doc), `onSnapshot` (initial = full result read, updates = only changed docs), `write-path` (a read executed inside a write/update callback).

### Top-level collections

| # | File | Function | Collection | Query / Constraints | Read Type |
|---|------|----------|-----------|---------------------|-----------|
| 1 | userService.js:37 | getUserByUid | users | doc users/{uid} (+fallback crew_profiles/{uid}) | getDoc |
| 2 | userService.js:48 | getUserByUid (fallback) | crew_profiles | doc crew_profiles/{uid} | getDoc |
| 3 | userService.js:116 | listPilotsForOperator | users | linkedOperator == uid | getDocs |
| 4 | userService.js:129 | findUserByEmail | users | email == (equality) | getDocs |
| 5 | userService.js:144 | watchPilotsForOperator | users | linkedOperator == uid | onSnapshot |
| 6 | userService.js:173 | findUsersByRole | users | role == (unused in UI) | getDocs |
| 7 | crewProfileService.js:45 | listCrewProfilesForOperator | crew_profiles | operatorId == uid | getDocs |
| 8 | crewProfileService.js:53 | getCrewProfileById | crew_profiles | doc crew_profiles/{id} | getDoc |
| 9 | crewProfileService.js:163 | watchCrewProfilesForOperator | crew_profiles | operatorId == uid | onSnapshot |
| 10 | connectionService.js:36 | listIncomingRequests | connection_requests | recipientId == uid | getDocs |
| 11 | connectionService.js:47 | listOutgoingRequests | connection_requests | requesterId == uid | getDocs |
| 12 | connectionService.js:76 | watchIncomingRequests | connection_requests | recipientId == uid | onSnapshot |
| 13 | connectionService.js:82 | watchOutgoingRequests | connection_requests | requesterId == uid | onSnapshot |
| 14 | documentService.js:123 | listDocumentsByUser | user_documents | userId == uid | getDocs |
| 15 | documentService.js:135 | getUserDocumentById | user_documents | doc user_documents/{id} | getDoc |
| 16 | documentService.js:145 | listDocumentsByUserIds | user_documents | userId in [≤10 ids per query], chunked ⌈N/10⌉ queries | getDocs |
| 17 | documentService.js:163 | listReadableDocuments | user_documents | readers array-contains uid (unused in UI) | getDocs |
| 18 | documentService.js:175 | listManagedDocuments | user_documents | operatorId == uid (unused in UI) | getDocs |
| 19 | documentService.js:272 | updateUserDocumentWithAudit | user_documents | getDoc before every edit (audit diff) | getDoc (write-path) |
| 20 | documentService.js:333 | watchDocumentsByUser | user_documents | userId == uid | onSnapshot |
| 21 | documentService.js:339 | watchDocumentsByUserIds | user_documents | userId in [ids] | onSnapshot |
| 22 | documentService.js:350 | watchAccessibleDocuments | user_documents | 3 listeners: userId== / readers∋ / operatorId== (unused) | onSnapshot |
| 23 | crewTrainingService.js:42 | listTrainingRecordsByUser | operator_training_records | userId == uid | getDocs |
| 24 | crewTrainingService.js:95 | watchTrainingRecordsByUser | operator_training_records | userId == / no filter (unused in UI) | onSnapshot |
| 25 | aircraftService.js:19 | getAircraft | aircraft | **none — entire global collection** | getDocs |
| 26 | aircraftService.js:25 | onAircraftSnapshot | aircraft | **none — entire global collection** | onSnapshot |
| 27 | trainingService.js:20 | listTrainingCenters | training_centers | **none — entire collection** | getDocs |
| 28 | trainingService.js:54 | listTrainingOfferings | training_offerings | centerId=X / none | getDocs |
| 29 | trainingService.js:91 | listTrainingBookings | training_bookings | userId=X / none | getDocs |
| 30 | trainingService.js:127 | watchTrainingBookings | training_bookings | userId=X / **none** | onSnapshot |
| 31 | companyService.js:98/134/140 | ensureAdminUser / isAdminUser / getAdminUser | admin_users | doc admin_users/{uid} | getDoc |
| 32 | companyService.js:175 | getCompany | companies | doc companies/{uid} | getDoc |
| 33 | companyService.js:191 | listCompanies | companies | **none — entire collection (unused in UI)** | getDocs |
| 34 | companyService.js:221 | getCompanyAccount | company_accounts | doc company_accounts/{id} | getDoc |
| 35 | companyService.js:227 | listCompanyAccounts | company_accounts | companyId == uid | getDocs |
| 36 | companyService.js:278 | getCompanyInviteByCode | company_invites | doc company_invites/{code} (unused in UI) | getDoc |
| 37 | companyService.js:285 | listCompanyInvites | company_invites | companyId == uid | getDocs |
| 38 | accessCodeService.js:49 | listAccessCodesByPilot | access_codes | pilotId == uid (unused in UI) | getDocs |
| 39 | accessCodeService.js:60 | verifyAccessCode | access_codes | pilotId== + code== (unused in UI) | getDocs |
| 40 | accessCodeService.js:83 | cleanupExpiredAccessCodes | access_codes | **none — entire collection (unused in UI)** | getDocs |
| 41 | crewLinkCodeService.js:31 | createCrewLinkCode | crew_link_codes | operatorId== + crewProfileId== + used==false (supersede step) | getDocs |

### Per-company (`companies/{companyId}/…`) subcollections

| # | File | Function | Collection | Query / Constraints | Read Type |
|---|------|----------|-----------|---------------------|-----------|
| 42 | companyService.js:335 | listCompanyModuleDocs | companies/{id}/{module} | module collection (all docs) | getDocs |
| 43 | companyService.js:340 | getCompanyModuleDoc | companies/{id}/{module}/{docId} | single doc (policy, flight, duty state) | getDoc |
| 44 | companyService.js:375 | onCompanyModuleSnapshot | companies/{id}/{module} | module collection (all docs) | onSnapshot |
| 45 | flightService.js:122 | listFlights | companies/{id}/flights | optional status / crewProfileIds array-contains; orderBy flightDate desc; **no limit** | getDocs |
| 46 | flightService.js:133 | onFlightsSnapshot | companies/{id}/flights | orderBy flightDate desc; **no limit** | onSnapshot |
| 47 | flightService.js:149 | getFlight | companies/{id}/flights | single doc (via getCompanyModuleDoc) | getDoc |
| 48 | flightService.js:215/303 | updateFlight / deleteFlight | companies/{id}/flights | getDoc before write/delete | getDoc (write-path) |
| 49 | aircraftService.js:52 | getCompanyAircraft | companies/{id}/aircraft | module collection (all docs) | getDocs |
| 50 | aircraftService.js:58 | onCompanyAircraftSnapshot | companies/{id}/aircraft | module collection (imported but **never called** in UI) | onSnapshot |
| 51 | fdtl/scheme.js:150 | getFdtlScheme | companies/{id}/fdtl_scheme | doc 'current' (+fallback doc 'draft') | getDoc |
| 52 | fdtl/scheme.js:181 | saveFdtlScheme (approve) | companies/{id}/fdtl_scheme | getDoc 'current' before merge | getDoc (write-path) |
| 53 | fdtl/scheme.js:269 | onFdtlSchemeSnapshot | companies/{id}/fdtl_scheme | doc 'current' + **getDoc 'draft' inside every callback** | onSnapshot + getDoc |
| 54 | fdtl/dutyRecords.js:115 | listDutyStates | companies/{id}/fdtl_duty | module collection (all docs) | getDocs |
| 55 | fdtl/dutyRecords.js:121 | onDutyStatesSnapshot | companies/{id}/fdtl_duty | module collection (all docs) | onSnapshot |
| 56 | fdtl/dutyRecords.js:81 | setDutyState | companies/{id}/fdtl_duty | getDoc single before write | getDoc (write-path) |
| 57 | fdtl/dutyRecords.js:136 | listDutyRecords | companies/{id}/fdtl_records | orderBy dutyDate desc; **no limit** | getDocs |
| 58 | fdtl/dutyRecords.js:146 | onDutyRecordsSnapshot | companies/{id}/fdtl_records | orderBy dutyDate desc; **no limit** | onSnapshot |
| 59 | fdtl/dutyRecords.js:243 | deleteDutyRecord | companies/{id}/fdtl_records | getDoc single before delete | getDoc (write-path) |
| 60 | fdtl/fatigue.js:7 | listFatigueReports | companies/{id}/fdtl_fatigue | orderBy reportedOn desc; **limit 100** | getDocs |
| 61 | fdtl/fatigue.js:14 | onFatigueSnapshot | companies/{id}/fdtl_fatigue | orderBy reportedOn desc; **limit 100** | onSnapshot |
| 62 | fdtl/audit.js:28 | listAuditEntries | companies/{id}/fdtl_audit | orderBy timestamp desc; **limit 50** | getDocs |
| 63 | fdtl/audit.js:35 | onAuditSnapshot | companies/{id}/fdtl_audit | orderBy timestamp desc; **limit 50** | onSnapshot |
| 64 | crewPolicyService.js:18 | getCrewDocumentPolicy | companies/{id}/settings/crewPolicy | single doc | getDoc |

**Dead/unreachable reads (defined, never called from the running UI — they do not currently contribute reads):** #6, 17, 18, 22, 24, 33, 36, 38, 39, 40, 50, plus `listCompanyFlights`/`getCompanyFlight` (flightService.js:384/394). Also legacy dead modules: `services/firestore.js` (stub returning `[]`, no imports), `js/firebase.js` (raw SDK re-exports, no imports), and everything in `backup_v1/` (v1 SDK, not in the bundle).

---

## 4. REALTIME LISTENER INVENTORY

> State shown below is the **pre-implementation** analysis (line numbers as of the audit). Post-implementation reality: L1 is now company-scoped via `onCompanyAircraftSnapshot` (Dispatch `dispatch.js:293`, Weather `weather.js:143`, Dashboard `dashboard.js:424`; global `onAircraftSnapshot` unused); the mid-init race (risk row below) is fixed in `router.js` v. render; logout teardown implemented in `auth.js`; the Crew sync worker is stoppable and closed on `destroy`. See §15.

| # | Listener | Collection / Query | Where created | Unsub stored | Unsub called? | Duplicate risk |
|---|----------|--------------------|---------------|--------------|---------------|----------------|
| L1 | onAircraftSnapshot | aircraft (all, global) | dashboard.js:424, dispatch.js:292, weather.js:141 | module-level var | Yes — destroy() | Only via router async race (init in flight during nav away) |
| L2 | watchCrewProfilesForOperator | crew_profiles where operatorId | via onCrewSnapshot (crew.js:668, dashboard.js:433, fdtl.js:1626, fdtl-calculator.js:232, dispatch.js:301, efb.js:253, weather.js:149) | folded into crewUnsubscribe closure | Yes — destroy() | Same |
| L3 | watchPilotsForOperator | users where linkedOperator | via onCrewSnapshot (same sites) | folded | Yes | Same |
| L4 | watchOutgoingRequests | connection_requests where requesterId | crew.js:679 (operator mode) | crewState.outgoingRequestUnsubscribe | Yes — destroy | Same |
| L5 | watchIncomingRequests | connection_requests where recipientId | crew.js:659 (pilot mode) | crewState.incomingRequestUnsubscribe | Yes — destroy | Same |
| L6 | watchDocumentsByUser | user_documents where userId | crew.js:649 (pilot mode) | crewState.pilotDocUnsubscribe | Yes — destroy | Same; also left active after drawer close (by design) |
| L7 | watchDocumentsByUserIds | user_documents where userId in | crew.js:70 selectPilot | crewState.pilotDocUnsubscribe (re-set per pilot) | Yes — replaced on next selectPilot, called on destroy | stale if selectedPilotUid nulled w/o selectPilot |
| L8 | onFdtlSchemeSnapshot | fdtl_scheme/current (+draft getDoc per callback) | fdtl.js:1618, fdtl-calculator.js:233 | schemeUnsubscribe | Yes — destroy | Same |
| L9 | onDutyStatesSnapshot | companies/{id}/fdtl_duty | fdtl.js:1634 | statesUnsubscribe | Yes — destroy | Same |
| L10 | onDutyRecordsSnapshot | companies/{id}/fdtl_records | fdtl.js:1642 | recordsUnsubscribe | Yes — destroy | Same |
| L11 | onFatigueSnapshot | fdtl_fatigue (limit 100) | fdtl.js:1650 | fatigueUnsubscribe | Yes — destroy | Same |
| L12 | onAuditSnapshot | fdtl_audit (limit 50) | fdtl.js:1658 | auditUnsubscribe | Yes — destroy | Same |
| L13 | onFlightsSnapshot | companies/{id}/flights | fdtl.js:1666, dispatch.js:311, efb.js:243 | flightsUnsubscribe | Yes — destroy | Same |
| L14 | watchTrainingBookings | training_bookings (all, global) | training.js:137 | bookingsUnsubscribe | Yes — destroy | Same |

Lifecycle risk classification:

| Listener | Guaranteed unsubscribe? | Risk |
|----------|--------------------------|------|
| All L1–L14 under **normal hash navigation** | Yes (router → destroy()) | LOW |
| Any listener created during a module `init()` that is still in flight when the user navigates away | No — `activeModule` is assigned only *after* `await initFn(...)` resolves (router.js:127–130); a mid-init navigation leaves the module's listeners live with **no reachable destroy**, and the stale init later overwrites `activeModule` | HIGH |
| L6/L7 (pilot doc watches) after `refreshCrew` sets `selectedPilotUid = null` (crew.js:133–135) without calling `selectPilot` | The old per-pilot watch remains until destroy | MEDIUM |
| Any live listeners after **logout** (auth.js never calls cleanupActiveModule) | Module never destroyed; listeners persist for the SPA session | HIGH |

**The "Open Crew → leave → reopen" scenario:** Under normal navigation this does **not** duplicate — router calls `destroy()` before the next init, and Crew's destroy nulls all four unsubscribe fields (crew.js:691–698). Duplicate listeners can only occur through the async-init race described above (e.g., rapid clicking between modules while Crew is still loading) and through logout (stale module keeps running, hidden beneath the auth screen).

---

## 5. CREW READ FLOW

> Analysis as of the audit. Post-implementation (§15), the operator refresh no longer duplicates the outgoing-requests query (P1-7), the sync worker is stoppable/backed-off (P0-3), and Crew's `destroy()` stops it. The `getCrewDocumentsByPilots` calls inside the initial `refreshCrew` and the listener callback remain for Crew itself (P0-1 scope covered Dispatch/Dashboard/Weather only).

### OPEN CREW (operator mode)

```
router → crew.init()  (crew.js)
 ├─ startCrewDocumentSyncWorker()          → 30s interval (never stopped) – reads only if dirty queue
 ├─ runQueueSync('initial')                → per dirty UPDATE item: getDoc x2  (sync worker)
 ├─ loadCrewPolicy()                       → getDoc companies/{op}/settings/crewPolicy          (1)
 └─ refreshCrew()  (crew.js:117)
     ├─ getCrew(op)
     │   ├─ listCrewProfilesForOperator (op)   → getDocs crew_profiles          (P)
     │   ├─ listPilotsForOperator (op)          → getDocs users                  (L)
     │   ├─ getAcceptedRequestPilots(op)
     │   │    ├─ listOutgoingRequests(op)       → getDocs connection_requests   (O)
     │   │    └─ per accepted request A:
     │   │        getUserByUid → getDoc users/{rid} +fallback getDoc crew_profiles/{rid}  (A…2A)
     │   └─ if any pilot uncovered → listCrewProfilesForOperator AGAIN → getDocs (P again)
     ├─ getOutgoingLinkRequests(op)             → getDocs connection_requests   (O again — DUPLICATE)
     ├─ getCrewDocumentsByPilots(pilots)        → getDocs user_documents, ⌈U/10⌉ queries  (D_total)
     ├─ mirrorCrewProfilesToCompany             → setDoc writes only (no reads)
     └─ selectPilot(selected)                   → getDocs user_documents (selected pilot)  (D_p)
                                                → watchDocumentsByUserIds → onSnapshot initial  (D_p)
 Listener start (initial snapshot deliveries):
 ├─ onCrewSnapshot (operator)
 │   ├─ onSnapshot crew_profiles               (P)
 │   ├─ onSnapshot users                       (L)
 │   └─ callback → getCrewDocumentsByPilots → getDocs user_documents (D_total AGAIN)
 │   └─ watchdog: ensureLinkedPilotProfiles → getDoc per uncovered pilot
 └─ onOutgoingLinkRequests → onSnapshot connection_requests  (O)

TOTAL initial reads ≈ 2P + 2L + 3O + A(1–2) + 2·D_total + 2·D_p + 1(policy) + materialization getDocs
```

Where **P** = crew_profiles, **L** = linked pilot users, **O** = outgoing requests, **A** = accepted requests, **D_total** = all pilot documents, **D_p** = selected pilot's documents.

### OPEN CREW (pilot mode)

`refreshCrew`: getPilotDocuments → getDocs user_documents (D_p) + getIncomingLinkRequests → getDocs connection_requests (R); then 2 listeners (L6, L5) whose initial deliveries read the same D_p + R again.

### CREW ACTION FLOW

| Action | Firestore reads |
|---|---|
| Logs in (operator) | 4–5 getDoc (users, admin_users, companies, company_accounts) + full Dashboard init |
| Opens Crew | §5 formula above |
| Refreshes Crew (any manual refresh / post-mutation reload) | Full §5 formula again (every doc re-pulled, listeners get another initial delivery on data change) |
| Selects a pilot | getDocs user_documents (D_p) + new onSnapshot initial (D_p) |
| Opens pilot docs | From cache only (`openDrawer`); no reads |
| Edits a document | getDoc user_documents/{id} (audit diff) + selectPilot → getDocs+onSnapshot again |
| Saves a document | Same as edit (getDoc + updateDoc + addDoc edit_logs write + selectPilot re-fetch) |
| Closes the pilot drawer | No reads; per-pilot onSnapshot stays active |
| Opens another pilot | selectPilot → prior watch unsubscribed, new getDocs + onSnapshot |
| Leaves Crew | destroy() unsubscribes all listeners; 30s sync worker **keeps running** |
| Returns to Crew | Full §5 formula again, listeners re-created (old ones were destroyed) |

---

## 6. DUPLICATE / OVERLAPPING READS

1. **`connection_requests where requesterId==op` fetched twice in every operator Crew refresh** — once inside `getCrew`→`getAcceptedRequestPilots` (crewService.js:77), once by `getOutgoingLinkRequests` (crew.js:117 / crewService.js:381). Same query, same docs, same user action. **CONFIRMED** — causes O extra reads per refresh.
2. **`crew_profiles` pulled twice in one `getCrew`** when materialization is needed (crewService.js:115–117 re-runs `listCrewProfilesForOperator`).
3. **Same pilot documents delivered 3× on one screen:** `refreshCrew`'s `getCrewDocumentsByPilots` (all pilots) + `selectPilot`'s `getPilotDocumentsForProfile` getDocs + `watchPilotDocumentsForProfile` onSnapshot — all cover the selected pilot's docs. **CONFIRMED.**
4. **`getDocs` + `onSnapshot` double-read of the same dataset at module init** — every module does both; the listener's initial delivery re-reads what the getDocs just fetched. Dashboard, Crew, FDTL, Dispatch, EFB, Weather, Training (bookings), and crew roster across all modules. **CONFIRMED across the board.**
5. **Whole-collection reads execute on every snapshot change:**
   - Dispatch: `renderDispatch` → `getCrewDocumentsByPilots` on every aircraft *or* crew snapshot change (dispatch.js:296, 306).
   - Dashboard: `refreshComplianceDocuments` → `getCrewDocumentsByPilots` on every crew snapshot change (dashboard.js:439).
   - Weather: `renderWeather` → `getCrewDocumentsByPilots` on every aircraft or crew snapshot change (weather.js:144, 153).
   **CONFIRMED** — single-doc change in one subcollection triggers full document re-reads.
6. **`onFdtlSchemeSnapshot` performs an extra `getDoc` of the draft on every snapshot push** (scheme.js:279) — including the initial push, right after `getFdtlScheme` already read current+draft.
7. **Crew roster duplicated across three collections:** crew roster is read from `crew_profiles` AND `users` (linkedOperator) AND `connection_requests` AND per-request `getDoc(users/{id})` — four query shapes for one logical roster, in both pull and listen modes, inside `getCrew`/`onCrewSnapshot`. **CONFIRMED.**
8. **Global vs company aircraft:** Dispatch reads the global `aircraft` collection AND `companies/{id}/aircraft` (preferring the company one for display, but then overwriting `latestAircraft` with the global during snapshot updates — dispatch.js:279 vs 294). **CONFIRMED overlap.**
9. **FDTL flights read twice in the same screen:** `listFlights` getDocs (init) + `onFlightsSnapshot` initial delivery + manual "Sync now" re-create (fdtl.js:1424 vs 1666).
10. **Training bookings read twice at init:** `listTrainingBookings(null)` getDocs + `watchTrainingBookings(null)` initial delivery — also **global/cross-tenant** (no user/company filter, trainingService.js:93/129).

---

## 7. POTENTIAL LISTENER LEAKS

| # | Scenario | Leak result |
|---|----------|-------------|
| 1 | Navigate away while a module's `await initFn(...)` is still in flight (router.js:127). | That module's listeners + timers become unreachable and keep running; re-entering creates a second, duplicate set. Route guards can't prevent it (permissions check before mount, not during). |
| 2 | Log out with listeners active (auth.js:249–310 never calls `cleanupActiveModule`). | All live module listeners persist while logged out and across a subsequent log-in. |
| 3 | Crew `refreshCrew` clears `selectedPilotUid=null` (crew.js:133–135) without unsubscribing the existing `pilotDocUnsubscribe` (L6/L7). | Old per-pilot document watch lingers until module destroy. |
| 4 | `startCrewDocumentSyncWorker` (crew.js:632) registers a 30s `setInterval` + a `window 'online'` handler — **`stopCrewDocumentSyncWorker` is never called anywhere** (verified by grep). | Interval + handler live for the whole SPA session even after leaving Crew; they read only when dirty queue items exist, but a permanently-failing update retries **every 30 s** indefinitely (crewDocumentSyncService.js:365–367, 393). |
| 5 | EFB subscribes to `onCrewSnapshot` (crew roster) but never uses the received data (efb.js:253–259; `latestCrew` is never read). | Wasteful live reads for zero UI benefit. |

Normal navigation is otherwise clean: Crew (4), Dashboard (2), Dispatch (3), FDTL (7), EFB (2), Weather (2), Training (1), FDTL-calculator (2) all call their stored unsubscribes in `destroy()`.

---

## 8. READ-HEAVY OPERATIONS (TOP 10)

| Rank | Operation | Why it reads | Frequency | Impact |
|------|-----------|--------------|-----------|--------|
| 1 | Dispatch: `getCrewDocumentsByPilots` inside aircraft + crew snapshot callbacks | Every aircraft doc change (global collection!) or crew change re-reads **all pilot documents** | per snapshot change | VERY HIGH |
| 2 | FDTL module init (9-collection pull + 7-listener push incl. flights, records, scheme) | 9 subcollections fetched unbounded; flights & records again via live listeners | every FDTL open | VERY HIGH |
| 3 | Crew init refresh + `getCrew` roster fan-out | Reads 4 collections for the roster + all documents; refresh re-runs everything on every mutation | every Crew open and every mutation | VERY HIGH |
| 4 | Dashboard compliance: `getCrewDocumentsByPilots` on every crew snapshot push | Any profile edit re-reads all documents | per crew snapshot change | HIGH |
| 5 | Weather `renderWeather` on aircraft/crew snapshot | Same document re-read amplification | per snapshot change | HIGH |
| 6 | `onFdtlSchemeSnapshot` extra `getDoc` of draft per push (fdtl + calculator) | Reads a doc it just read | per push + init | MEDIUM |
| 7 | Crew `refreshCrew` per-mutation reload (profile save, doc upload/edit/delete, link actions, status toggle, bulk ops) | Full §5 re-read on a one-doc write | per user action | HIGH |
| 8 | Every module: `getDocs` + `onSnapshot` initial double-read of same queries | Architectural; doubles every collection read at mount | every navigation | HIGH |
| 9 | `runQueueSync` at Crew init + 30s worker for dirty UPDATE items | 2 getDoc per queued update, retried every 30 s on failure | per dirty item / per failed sync | MEDIUM |
| 10 | GetDoc-before-write audit reads (document edit, flight update/delete, scheme approve, duty state set, duty record delete) | getDoc to diff/merge before every write | per write | LOW–MEDIUM |

---

## 9. 12K READ ANALYSIS

The daily count of ~12,000 reads is fully explainable from the code. Several scenarios (the counts are formula-driven, not exact):

- **CONFIRMED FROM CODE:** Every page refresh / login = 4–5 getDoc + full Dashboard init. With P=5 pilots, D_total=20, aircraft=3: ≈ **70 reads/log-in + refresh**. Reopening Crew ≈ **~260 reads** (see §5 formula with P=5, L=5, D_total=100-ish for 4 docs/pilot, D_p≈4: 2·5+2·5+0+0+2·100+2·4+1 ≈ 225–260). FDTL open ≈ **~400–500 reads** (crew 10 + duty states + records + fatigue 100 + audit 50 + flights + scheme 1–2, each also once via listeners).
- **PLAUSIBLE:** a single test/refactor session of ~15–25 module opens/refreshes at ~200–500 reads each (Crew/Dispatch/Weather re-read all docs on every snapshot bounce) ≈ **5,000–12,000 reads/day**. This is *normal* for the current architecture. E.g. 25 opens × avg 450 ≈ **11,250**.
- **PLAUSIBLE (amplifier):** Dispatch with frequent global aircraft snapshot events (even a status flag on any aircraft, including other companies', since it watches the global `aircraft` collection) multiplies: each event = D_total ≈ P×D reads. 20 events in a session with 5 pilots × 20 docs = 2,000 extra reads.
- **PLAUSIBLE (listener churn):** if any crew-profile or document updates happen live (e.g., edits during testing), the snapshot callbacks (Crew/Dashboard/Weather, §6-3) re-pull all documents each time.
- **PLAUSIBLE (background):** a permanently-failing queued document update retried every 30 s costs 2 getDoc × 2,880 attempts/day ≈ 5,760 reads/day.
- **UNKNOWN / NOT OBSERVABLE FROM CODE:** actual pilot/document/flight counts, number of refreshes, how many tests ran, whether other users/agents (Android pilot app) also read the same Firestore project. The 12K likely came from the combination — not from a single bug.

Bottom line: **the 12K figure is expected, not anomalous**, given unbounded pull+listen reads on every mount and the snapshot-callback re-fetch pattern.

---

## 10. SCALABILITY FORMULAS

Let P = pilots, D = avg documents per pilot, L = linked-pilot users, O = outgoing requests, A = accepted requests, F = flights, R = duty records.

- **Reads per pilot profile view (crew profile module):** D + T (training records) + 1–2 (user profile)
- **Reads per operator Crew open:** ≈ `2P + 2L + 3O + A(1–2) + 2·P·D + 2·D` (selected pilot) `+ 1`
- **Reads per Dashboard/Weather/Dispatch open:** ≈ `aircraft + (P + L + O + A) + 2·P·D`
- **Reads per FDTL open:** ≈ `(P+L+O+A) + 1–2 (scheme) + states + R + min(Fⱼ,100) + min(50) + F`, each of those also mirrored once by listeners → roughly **2×(roster + R + F + states) + 150**
- **Effect of 20 documents/pilot:** D_total = 20·P. Crew open ≈ `2·P + 2L + 2·(20·P) + …` ≈ **40P + overhead**. For P=5 → ≈ 260 reads; P=50 → ≈ 2,500 reads per Crew open. FDTL/Dispatch revisit these documents on every relevant snapshot change.
- **Multiple operators:** document/pilot data is per-operator, so **one operator's reads ≈ 3× the per-operator formula** (crew roster 3 query shapes + documents 3 call sites). Operator count multiplies the total linearly *if they test concurrently*; per-operator daily cost ≈ `R_refresh × R_repeat`.
- **Reads per day:** ≈ (refreshes + module opens) × avg open cost + snapshot-change events × D_total + failed-sync retries × 2 × 2880.

---

## 11. CURRENT STRENGTHS

1. **Single wrapper** (`firestoreService.js`) — one place to change read behavior later.
2. **No caching layer that could show stale data** — always fresh (correctness over efficiency).
3. **Clean destroy lifecycle under normal navigation** — every module unsubscribes its listeners; no accumulating duplicate listeners on ordinary route changes.
4. **Bounded reads where it matters for UX-critical views:** fatigue (100), audit (50) have limits; single-doc getDocs are bounded.
5. **Client-side merging/dedup** (`mergeConflictingDocuments`, `dedupeByFirestoreId`) prevents user-visible conflict corruption.
6. **Auditing per-write getDoc** ensures edit logs are accurate.
7. **Schema contract validation** on read/write keeps data shape stable.
8. **Pilot documents use `in` chunks of 10** — reducing query count vs one query per pilot (albeit still unbounded in doc count).

---

## 12. CURRENT RISKS

1. **Unbounded queries everywhere** — flight lists, document lists, duty records, training collections, crew rosters, and the entire global `aircraft`/`training_*` collections (no `limit`, no cursor, no pagination). Grows with org size (see §10).
2. **Full re-read inside snapshot callbacks** (Dispatch aircraft/crew, Dashboard crew, Weather aircraft/crew) — one unrelated doc change can cost P×D reads.
3. **Double (getDocs + onSnapshot initial) and triple (getDocs + per-pilot getDocs + onSnapshot) delivery of identical data on single screens.**
4. **Roster re-read across 4 collection shapes** (`crew_profiles` + `users` + `connection_requests` + per-request getDoc) within a single `getCrew`.
5. **Duplicate outgoing-request query on every Crew refresh.**
6. **30-second sync worker never stopped** — indefinite background reads on persistent failures; also runs after leaving Crew.
7. **Listener leak on mid-init navigation** and **on logout**.
8. **Cross-tenant global reads** (aircraft, training_centers/offerings/bookings) — irrelevant tenants' data read, plus global snapshot churn.
9. **`getDoc` before every write** (audit/merge pattern) — acceptable at low volumes, adds reads on write workflows.
10. **"Read" functions with write side effects** (`getCrew` → `ensureCrewProfileForUser` → setDoc) make read counts variable and non-obvious.

---

## 13. RECOMMENDATIONS — NO IMPLEMENTATION

Status legend: **[IMPLEMENTED]** = done in the codebase (see §15) · **[NOT IMPLEMENTED]** = remains open.

- **P0 — Remove the getDocs re-read inside snapshot callbacks (Dispatch, Dashboard, Weather).** Problem: one unrelated change re-reads all pilot documents. Current: `renderDispatch`/`refreshComplianceDocuments`/`renderWeather` re-run `getCrewDocumentsByPilots` on every aircraft/crew push. Expected benefit: eliminates P×D reads per snapshot event — the single biggest amplifier. UX: neutral (listeners already deliver fresh docs). Complexity: low. Schema: no. **[IMPLEMENTED]**
- **P0 — Scope the aircraft listener to the operator's company.** Problem: `onAircraftSnapshot` watches the whole global `aircraft` collection; any company's aircraft update re-triggers dispatch/weather reads. Current: global subscription. Benefit: removes cross-tenant churn. UX: none. Complexity: low–medium (company subcollection already exists: `companies/{id}/aircraft`). Schema: no (data already mirrored). **[IMPLEMENTED]**
- **P0 — Make the sync worker stoppable + backoff, and stop it on Crew destroy.** Problem: 30 s retries forever on failing updates (5760 reads/day worst case). Expected benefit: eliminates background read amplification. UX: none. Complexity: low. Schema: no. **[IMPLEMENTED]**
- **P1 — Add `limit`/pagination to unbounded queries (flights, documents, duty records, rosters).** Problem: collection-wide reads grow with data. Expected benefit: bounded reads per screen. UX: needs pagination/infinite-scroll. Complexity: medium (client pagination + query cursors). Schema: no. **[NOT IMPLEMENTED]**
- **P1 — Avoid getDocs+onSnapshot of the same query at mount** (rely on listener initial delivery; drop the one-shot getDocs). Problem: every module doubles its initial reads. Expected benefit: halves collection reads per navigation. UX: minimal (slightly different load timing). Complexity: low–medium. Schema: no. **[PARTIAL — Training bookings fixed; other modules intentionally keep the one-shot for fallback/load decisions]**
- **P1 — Fix the init-race listener leak (assign `activeModule` before awaiting init, or destroy on navigation regardless).** Problem: mid-init navigation leaks unreachable listeners. Benefit: eliminates duplicate-listener accumulation. Complexity: low. Schema: no. **[IMPLEMENTED]**
- **P1 — Tear down module listeners on logout (call `cleanupActiveModule()` and reset router state in auth.js).** Complexity: low. **[IMPLEMENTED]**
- **P1 — Remove the duplicate outgoing-request query in operator refresh** (`getCrew` already fetches it). Complexity: low. Benefit: −O reads per Crew refresh. Schema: no. **[IMPLEMENTED]**
- **P1 — Roster reads: prefer a single authoritative source** (e.g. `crew_profiles` only) instead of crew_profiles + users + connection_requests + per-request getDoc. Benefit: removes 2–3 query shapes and up to A getDocs per refresh. Complexity: medium (data migration of linked users). Schema: yes. **[NOT IMPLEMENTED]**
- **P2 — Drop EFB's unused crew subscription and dead collection reads** (access_codes, listManaged/Readable in unused wrappers). Complexity: low. Benefit: removes waste reads. **[NOT IMPLEMENTED]**
- **P2 — Remove the per-push draft `getDoc` gap in `onFdtlSchemeSnapshot`** (subscribe to draft or read once). Complexity: low. **[NOT IMPLEMENTED]**
- **P2 — Batch audit reads** (`getDoc` before every write) or derive audit from update inputs. Complexity: medium. Schema: no. **[NOT IMPLEMENTED]**
- **P3 — Consolidate the two flight getter paths (`listFlights` vs `listCompanyModuleDocs`) and aircraft sources-of-truth.** Complexity: low–medium. **[NOT IMPLEMENTED]**
- **P3 — Enable Firestore local persistence / a shared cache layer to avoid cross-module re-fetch.** Benefit: large long-term; Complexity: high; Schema: no. **[NOT IMPLEMENTED]**

---

## 15. IMPLEMENTATION STATUS

Applied in release **V0.3.12** (this doc is updated as part of the release commit). Tracked files changed: `services/crewService.js`, `services/crewDocumentSyncService.js`, `modules/dispatch/dispatch.js`, `modules/weather/weather.js`, `modules/dashboard/dashboard.js`, `modules/crew/crew.js`, `modules/training/training.js`, `js/router.js`, `js/auth.js`, `config/app.config.js`, `docs/firestore-read-audit.md`.

### 15.1 P0-1 — No full pilot-doc re-read inside snapshot callbacks

- **Mechanism:** new `syncCrewDocumentCache(cacheByUid, nextPilots)` export in `crewService.js:192`. Given the existing per-pilot doc cache Map, it deletes entries for pilots no longer in the roster and runs `getCrewDocumentsByPilots` **only for newly-added pilots**. It returns the same Map.
- **Dispatch** (`dispatch.js`): `latestDocsByPilot` module state (cleared in `destroy`); `renderDispatch` reads it directly; crew snapshot callback calls `syncCrewDocumentCache`; full `getCrewDocumentsByPilots` runs only at initial mount.
- **Weather** (`weather.js`): same pattern with `latestDocsByPilot`.
- **Dashboard** (`dashboard.js`): `refreshComplianceDocuments` now calls `syncCrewDocumentCache(dashboardState.docsByPilot, crewList)` and keeps the pre-existing `complianceRequestToken` cancellation guard.
- Net effect: snapshot pushes no longer cost P×D reads; profile sets that change only prune/prune+add pilots' docs.

### 15.2 P0-2 — Company-scoped aircraft subscription

- **Mechanism:** modules now use `getCompanyAircraft(operatorUid)` for the initial read and `onCompanyAircraftSnapshot(operatorUid, cb)` for the live listener (both from `aircraftService.js:52/58`, previously the listener was defined but never called in the UI — audit inventory #50).
- Fallback: if the company subcollection is empty at mount, the module does one global `getAircraft()` read.
- Listener callback guards `if (fleet.length > 0)` so a transient empty snapshot never hides the fleet.
- The global `onAircraftSnapshot` (`aircraftService.js:25`) is now unused by any module (verified by grep; retained as an API).
- Applied in Dispatch (`dispatch.js:293`), Weather (`weather.js:143`), Dashboard (`dashboard.js:424`).

### 15.3 P0-3 — Stoppable sync worker with backoff, stopped on Crew destroy

- **`crewDocumentSyncService.js`:** replaced the permanent 30 s `setInterval` with a self-scheduling worker:
  - `startCrewDocumentSyncWorker` registers the `online` listener (kept in a module var), resets failure count, and schedules the first run.
  - `stopCrewDocumentSyncWorker` clears the pending timer and removes the `online` listener (previously never called anywhere — audit risk #4).
  - Each enqueue (`enqueueCrewDocumentCreate/Update`) calls `kickWorkQueue` so a new dirty item re-activates the worker.
  - `runWorkQueueOnce` delegates to `processCrewDocumentSyncQueue` (unchanged semantics — the `processing` gate prevents overlap with `runQueueSync`); on `shouldQueueError` failures it re-schedules with exponential backoff + jitter capped at `MAX_RETRY_BACKOFF_MS` (5 min) instead of a fixed 30 s forever loop; it stops scheduling entirely once the queue drains. Dirty items are preserved (they are never dropped on stop).
- **`crew.js`:** `destroy()` now calls `stopCrewDocumentSyncWorker()` (audit risk #4 resolved — no background reads after leaving Crew or logging out).

### 15.4 P1-4 — Drop one duplicate getDocs+onSnapshot at mount

- **Training** (`training.js`): removed the redundant `listTrainingBookings(null)` from the init `Promise.all`; `watchTrainingBookings(null)` covers the identical query (`training_bookings`, all docs) and its initial delivery populates `latestBookings`.
- **Other modules intentionally keep the one-shot getDocs** (Dispatch/Weather/Dashboard aircraft, flights, crew): the company-vs-global aircraft fallback needs the initial read to make the decision, and dropping the one-shots elsewhere is a larger behavior change outside the minimal scope. Documented here rather than changed.

### 15.5 P1-5 — Tear down module listeners on logout

- **`router.js`:** new exported `destroyActiveModule()` (wraps the internal `cleanupActiveModule`).
- **`auth.js`:** the logged-out branch of `authStateObserver` now calls `destroyActiveModule()` before `authStore.clearUser()` + `emitEvent('auth:logout')`, so the active module's listeners/worker stop while logged out (audit risk #2 resolved).

### 15.6 P1-6 — Fix the init-race listener leak

- **`router.js`:** added a monotonically increasing `renderCounter`. `render()` snapshots `renderId = ++renderCounter` and re-checks it after every `await`. If stale (user navigated mid-init), the frame aborts; if an `initFn` instance resolved late, its `destroy()` is invoked before returning, so it never overwrites `activeModule`. This closes audit risk #1 (mid-init navigation leak).

### 15.7 P1-7 — Remove the duplicate outgoing-request query in operator Crew refresh

- **`crewService.js`:** `getCrew(operatorUid, outgoingRequests = null)` plumbed through `getLinkedPilotPool(operatorUid, outgoingRequests)` → `getAcceptedRequestPilots(operatorUid, outgoingRequests)`; when the caller passes a pre-fetched request list, the internal `listOutgoingRequests` call is skipped.
- **`crew.js`:** `refreshCrew` fetches `getOutgoingLinkRequests` once and passes the result into `getCrew(...)`, eliminating the duplicate `connection_requests` query in every operator refresh (audit duplicate #1). The pilot-mode branch is unchanged.

### 15.8 Not implemented (by design)

- P1 pagination, P1 roster single-source, P2/P2/P2, P3 items — see §13 statuses.
- `fdtl/scheme.js:279` draft pulse-read (`onFdtlSchemeSnapshot`): a single extra `getDoc` per snapshot push, not an init-time duplicate; fixing it requires two reconciled subscriptions to save one read per push. Left as-is and tracked under P2.

### 15.9 Verification

- No unit-test/lint/build infrastructure exists in the repo; verification was: `node --check` syntax pass on all 9 modified JS files (ALL OK), grep for stale references (`onAircraftSnapshot` no longer imported by any module), and re-read of every edited region (listener wiring, cache Map lifecycle, sync worker scheduling).

---

## 16. FINAL VERDICT

**YES — WORKS AS DESIGNED, OPTIMIZED.**

The architecture is functionally correct: fresh data everywhere, a single wrapper, a working destroy lifecycle under normal navigation, and bounded reads on the most sensitive lists. The original 12K/day figure was a predictable consequence of the pull+push-on-mount design, unbounded queries, full re-reads inside snapshot callbacks, global aircraft watching, duplicate queries, and the never-stopped 30 s worker.

The approved P0/P1 optimizations (removing in-callback document re-reads, scoping the aircraft listener, stoppable backoff sync worker, dropped Training double-read, logout teardown, init-race fix, duplicate-query removal) are now implemented and materially reduce per-snapshot and per-navigation read cost with no schema or UX changes. Remaining risk drivers (unbounded queries, roster multi-collection reads, dead collection reads, EFB unused subscription, fdtl draft pulse, and write-path audit getDocs) are tracked in §13 as P1–P3 with the listed trade-offs.