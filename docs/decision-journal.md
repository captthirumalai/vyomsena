# VyomSena Decision Journal

This file is a diary of product, architecture, and engineering decisions for VyomSena.

**Purpose:** Years from now, if you (or a newcomer) ask "why did we do it this way and not that way?", this file is the answer. It records what we decided, why we chose it, what we explicitly rejected, and what happened as a result.

**How to write new entries:** append at the bottom with date. Keep the same structure: Context → Decision → Why → Alternatives we rejected → Consequences → Status. Honesty over optimism — back-filled and future entries should be as candid as live ones.

---

## Snapshot of the project (2026-08-15)

- Product: **VyomSena** — aviation management system.
- Two platforms sharing **one Firebase project + one schema contract**:
  - **Web app** (this repo) — the operator/company control plane.
  - **Android app** — the pilot surface, sync/read-thin.
- Current version: **V0.3.11** (web).
- Stack: static HTML/CSS/JS ES-modules SPA, Firebase Auth + Firestore + Storage, Google-hosted Firebase JS SDK v10.8.0.
- Observed Firestore usage at this point: **12K reads/day max**, 1.2K writes/day, 29 peak snapshot listeners, 6 peak connections (dev).

---

## 1. Web = Company Admin, Android = Pilot Read/Sync

**Date:** early (formative), reaffirmed 2026-07-29.

**Context:** A pilot-focused Android app already existed with personal + company modes. We needed a company/operator surface and decided what the division of labour is.

**Decision:**
- Web is the **control plane**: create/edit/delete everything (crew, documents, flights, modules).
- Android is the **thin client**: syncs and presents data read-only, does not drive shared data.
- Pilots are blocked from the web shell (role-gated) and must use Android.
- One Firebase identity per real person, shared across Android + web; personal vs company mode resolved *after* login from link/membership status, never by creating separate accounts.

**Why:**
- Avoids two apps fighting over the same data with different assumptions.
- Operators typically work on desktop for management tasks; pilots are in the field on phones/tablets.
- One identity model keeps linkage clean (pilot ↔ operator) and avoids account sprawl.

**Alternatives rejected:**
- "Both apps fully read-write" — high conflict potential, harder rules, double the UI complexity.
- "Separate accounts for personal vs company mode" — identity drift, duplicate data, poor UX.

**Consequences:**
- Rules are intentionally **not tightened yet** (permissive, web-first) — see entry 5.
- Android must *tolerate* that web is authoritative for linked data and never assume it can create/edit shared records.
- This division is documented in `docs/admin-model.md`.

**Status:** Active, stable.

---

## 2. Modular SPA with dynamic route manifest

**Date:** 2026-07-26 onward.

**Context:** The web app grew module-by-module (dashboard, crew, aircraft, FDTL, dispatch, EFB, ...). We wanted a structure that made adding a module cheap and keeping the shell clean mandatory.

**Decision:**
- Single-page app: shared shell (`core/layout.js`) + content area (`#view`).
- `shared/routes.js` is the single **route manifest**; each module registers `{ path, title, icon, order, permissions, html, js, css, showInMenu }`.
- `js/router.js` loads module HTML/CSS/JS dynamically, enforces role-based access, and calls `destroy()` on the previous module (cleanup lifecycle).
- Modules are isolated; they only touch `#view`. Shared UI lives in `components/`, shared data access lives in `services/`.
- Topbar is global (`core/layout.js` + `shared/moduleHeader.js`); modules publish status/chips into it via `mountModuleActions()`.

**Why:**
- Adding a feature = new folder + one manifest line; no shell surgery.
- Route permissions come from manifests, not hardcoded in pages — one place to govern access.
- `destroy()` guarantees listeners/timers are cleaned up on navigation (important for the read story in entry 7).

**Alternatives rejected:**
- Monolithic `app.js` with everything inline — rejected ("do not bulge app.js" is an explicit guardrail).
- Full framework (React/Vue/etc.) — rejected to keep things dependency-light and matching the existing Android-shared plain-JS style.

**Consequences:**
- Modules sometimes re-derive shared logic; services exist to prevent direct Firestore access from modules (contract in `docs/database.md`).
- Set the stage for the per-module churn described in entry 7.

**Status:** Active.

---

## 3. Firestore schema as an API contract

**Date:** ongoing since first web/Android sharing.

**Context:** Two platforms write and read the same Firestore. Schema drift between them is the #1 silent killer.

**Decision:**
- Collection + field names are **stable, additive**; breaking changes require coordinated Android + Web release.
- Runtime **warning-first** schema validation in service-layer reads/writes (`services/schemaContract.js`) — logs drift without blocking writes (yet).
- Services exist per domain (`userService`, `documentService`, `companyService`, `flightService`, ...); modules must not query Firestore directly.
- Documented in `docs/database.md`.

**Why:**
- Firestore has no migration tool — the *contract + validation* is our migration safety net.
- Warning-first (not blocking) lets us detect drift in production without breaking flows during heavy iteration.

**Consequences:**
- Legacies tolerated (e.g. `name` vs `fullName`, `REJECTED` legacy request status) — the contract records them.
- When drift is found we fix the mapping or update the contract doc first, before adding UI.

**Status:** Active.

---

## 4. Company workspace & admin model (web = owner)

**Date:** 2026-07-29 onward. Blueprint in `docs/admin-model.md`.

**Context:** Companies need their own workspace: roster ownership, invites, module data, and member accounts — all under the operator.

**Decision:**
- Workspace collections: `admin_users/{uid}` (write-grant seed), `companies/{companyId}`, `company_accounts`, `company_invites` (6-digit, 5-min codes).
- Roster single source of truth = `crew_profiles` scoped by `operatorId`; linked `users` and legacy accepted `connection_requests` are **materialized** into profiles via `ensureCrewProfileForUser` (bridge, not source).
- Module data lives in **company subcollections** `companies/{companyId}/crew|aircraft|flights|...` so Android can live-sync it.
- Flights are cross-module: Dispatch creates, EFB records actuals, FDTL monitors compliance — one shared `companies/{companyId}/flights` record with fops/efb/reconciliation fields (see `docs/database.md`).

**Why:**
- Crew/documents/flights are inherently company-scoped; subcollections keep them isolated and sync-friendly.
- The materialization bridge lets us migrate from the older `users.linkedOperator` model without a breaking cutover.
- Flights-as-one-record avoids three silos the modules would have to re-merge.

**Alternatives rejected:**
- Keep roster on `users.linkedOperator` only — couldn't hold operator-managed metadata (designation, base, status) cleanly.
- Per-module flight stores — reconciliation/mismatch UI would be impossible; single record won.

**Consequences:**
- Legacy `connection_requests` are write-disabled going forward but kept for history/migration.
- `crew_profiles` + `users` are both read every time we resolve the crew — this is a big part of the read cost in entry 7.

**Status:** Active.

---

## 5. Rules intentionally left permissive (for now)

**Date:** ongoing.

**Context:** Firestore/Storage rules govern who can read/write what. We knew tightening is ideal but costly and risky mid-iteration.

**Decision:** Keep existing permissive rules; **web-first**. A phased rules roadmap exists (see `docs/admin-model.md` "Rules Roadmap") to tighten when Android is read-only-verified.

**Why:**
- Tight rules too early break workflows during active development (every refresh/feature needs testing).
- Android behavior must be verified read-only before enforcement lands.

**Consequences / Risk:**
- This is a **known open security debt**. Cheap to maintain early, expensive if left too long. Revisit before any real multi-company rollout.
- Cross-tenant leakage risk if we ever go shared-DB multi-tenant (see entry 8) — another reason per-tenant isolation looks attractive.

**Status:** Accepted debt, roadmap exists.

---

## 6. Realtime-first UI (snapshot listeners everywhere)

**Date:** ongoing, and the origin of our read-budget discussion.

**Context:** The UI is "live": dashboard, crew, dispatch, EFB, and FDTL all attach `onSnapshot` listeners and, on every change, re-render.

**Decision:** Live updates via realtime listeners are the UX standard; data loads fresh from Firestore on every module mount.

**Why:** "Live update: N pilot profile(s)" and instant cross-device visibility is a core product promise — operators see EFB recorded actuals appear in FDTL without refreshing.

**Costs we now know (2026-08):**
- Every module mount re-fetches overlapping collections (crew, docs, flights) with several `getDocs` + several fresh listeners.
- Every snapshot delivery bills reads; listeners stay live while a module's open.
- Estimated cost: **~550 reads per realistic operator session** (~10 pilots, 3 docs each, 10 flights) vs ~55 if we cached.
- 12K reads/day observed ≈ ~35-45 sessions; a single dev refresh burst produced 23K in one day.
- This is **over-fetching**, not real work — write:read ratio observed 1.2K:23K.

**Status:** Active, intentional. See next entry for why we're not fixing it yet.

---

## 7. Decision: do NOT add caching yet — keep current state

**Date:** 2026-08-15.

**Context:** We discussed a full change (Firestore offline persistence / IndexedDB cache + incremental listeners + "Sync All" button) to cut reads ~10x.

**Decision:**
- **Keep the current state** — no local cache layer for now. Let the first real users run on the current architecture.
- Do not optimise reads until we have real usage data.
- Revisit this decision when either (a) a single tenant approaches their daily budget, or (b) the user base stabilises and usage patterns are known.

**Why "no cache now":**
1. **Staleness vs the product promise.** The UI is built on "live" — caching FDTL/flights/duty states means screens can lie. Choosing what's fresh vs cached per collection is product work, not plumbing.
2. **Invalidation is the hard part.** Data has `serverTimestamp` but nothing uses `lastModified >= cursor` sync watermarks. Adding this per collection is the real engineering; without it, "refresh" = full re-read, which saves nothing.
3. **Multi-tab/multi-device conflicts.** Real usage includes several tabs + phone + web. Firestore `enableIndexedDbPersistence` errors on >1 tab unless `synchronizeTabs` is configured, and offline writes from two devices can conflict (we already feel this in `mergeConflictingDocuments` in the crew doc queue).
4. **Storage limits/growth.** `localStorage` (used by the crew doc sync queue) caps ~5-10 MB; a year of flights/duty/audit data overflows it. IndexedDB lifts the cap but grows unbounded without pruning/TTL.
5. **Security-rule changes don't propagate to stale caches.** A cached doc outlives a permission revocation until invalidated — bad for a future multi-company world.
6. **Debug overhead during active development.** Stale-cache bugs ("why isn't my change showing up?") are the worst kind to chase while we iterate and refresh constantly.

**Alternatives rejected / deferred:**
- *Full cache layer now* — rejected for the reasons above; scheduled for a future "optimise reads" phase.
- *Partial cache (crew profiles + scheme only, keep FDTL/flights live)* — attractive middle ground we did NOT take yet; keep it in mind before implementing any cache.
- *Leaner queries now (pagination, date-window filters instead of full table loads)* — this is cheap and low-risk and the top candidate for the "only what's needed" ask; intentionally deferred so we stay "current state".

**Consequences:**
- We accept ~550 reads/session for now; daily 50K budget has comfortable headroom (~24% at 12K/day).
- The read cost scales linearly with crew/flight count and active tabs — the budget *will* be hit as usage grows. This entry is the marker that says "yes, we saw it coming, and we chose launch-speed over read-efficiency."

**Status:** Decided. Revisit triggers documented above.

---

## 8. Multi-tenancy direction: separate Firebase per company (own domain / own app instance)

**Date:** 2026-08-15 (decision in progress — record the reasoning now).

**Context:** Assumption of the day: each company will have a lot of its own data flowing across devices + web. Shared single project may burst the 50K/day read budget, and "my app serves everyone" feels like a single point of failure for quota AND customisation.

**Planned direction (validating):**
- Each company gets its **own Firebase project** (own DB + storage/instance) — quota isolation, data isolation, per-company future-proofing.
- Each company may get its **own domain/subdomain** — branding + company-specific customisation.
- Separate webapp instance per user (own domain) to allow company-specific needs & heavy customisation per company.

**Why this direction looks right:**
1. **Quota isolation:** one company's 12K/day usage no longer depletes a shared pool; each gets its own 50K/day budget.
2. **Data isolation:** a rules screw-up in one tenant can't leak another's data; matches "company data moves between devices" future.
3. **Customisation:** per-company instances allow truly different feature sets/workflows the shared app can't offer cleanly.
4. **Future-proofing:** dedicated stores make per-company export/backup/migration easy.

**Costs/risks we MUST respect (recorded so we don't fool ourselves later):**
- **Per-tenant budget still bursts within a tenant.** Isolation multiplies budgets but does *not* fix the ~10x over-fetching (entry 7). One large company with 15+ operators or heavy FDTL/EFB traffic can still exhaust ITS OWN 50K/day. The ceiling moves per-company, it does not disappear.
- **Operational burden multiplies.** N companies = N projects to provision, secure, back up, update rules for, and watch for anomalies. Needs automation (a provisioning/admin flow that creates project + rules + admin account + returns tenant config).
- **Project limits.** GCP caps projects (~30/org default; extendable via quota request). Must monitor.
- **Billing wiring per project.** Each tenant project needs billing wiring if they exceed free tier (or intentionally stay Spark and accept outage on heavy days).

**The one hard line we are drawing (from discussion):**
- **One codebase, one app build. Never fork the code per company.** Company differences must be *config + feature flags + per-tenant Firebase*, NOT copies of the repo. Forking per company = a maintenance death-spiral: 50 companies = 50 builds to patch, test, deploy; security/schema fixes must be ported to every fork; versions drift. A *custom-domain subdomain* (`<company>.vyomsena.<tld>`, CNAME to a customer's own domain) gives branding with zero forking.
- If the business ever insists on per-company *custom code*, the survival rule is: every company instance forks from one shared core repo and all customisations are **additive (no edits to shared code)**, so upgrades stay pull-and-merge.

**Status:** Direction chosen philosophically; engineering backlog item. Do not start building provisioning tooling until entry 7's decision is revisited and real usage is known.

---

## 9. What we deliberately did NOT decide (open items)

- **When to tighten Firestore/Storage rules** (entry 5 roadmap). Do this *before* any real multi-company rollout.
- **Cache / lean-query plan** (entry 7). Revisit on the documented triggers.
- **Provisioning automation design** for per-tenant Firebase (entry 8).
- **Billing model** (Spark vs Blaze) per tenant; who pays for quota growth.
- **Long-term org model**: we captured bootstrap fields on `users` during registration; a dedicated `organizations`/`memberships` model is planned and the fields were designed to seed it without a breaking change (`docs/database.md`).
- **Company documents / flight documents modules** — roadmap exists in `docs/admin-model.md` checklist, not built.

---

## Release log (web, recent)

- **V0.3.8** — per-module headers merged into global topbar (breadcrumb/title/subtitle + module-actions).
- **V0.3.9** — crew notifications/sync/Add Pilot into topbar module-actions; global user-info button opening user + company profile editor.
- **V0.3.10** — FDTL flight details became a selectable popup overlay (backdrop + Close), full-width records table.
- **V0.3.11** — Add Pilot moved into crew module toolbar next to search/filter; sync-only topbar mount. Removed dead `js/config.js` (version chip reads `config/app.config.js`).
- **V0.3.12** — Firestore read optimizations (P0-1..P0-3, P1-4..P1-7): incremental crew-doc cache in snapshot callbacks, company-scoped aircraft subscription, stoppable backoff sync worker stopped on Crew destroy/logout, dropped Training double-read, router init-race fix, logout listener teardown, duplicate outgoing-request query removal. See `docs/firestore-read-audit.md` §15.
- **V0.3.13** — topbar cleanup: removed useless Retry Sync button from crew global header (auto-sync worker covers it); grouped theme/user/Sign Out buttons so Sign Out stays inline beside the user button; widened pilot-profile drawer (420→560px) and let document-row columns shrink/wrap so expired/expiring info is never hidden behind a horizontal scroll.

---

## How to add a future entry

1. Append with the current date.
2. Structure: **Context → Decision → Why → Alternatives rejected → Consequences → Status**.
3. If a past decision now looks wrong, **annotate the old entry** with a pointer to the new one rather than rewriting history.
4. Record what was *rejected*, not just what won — the rejected list is where the reasoning lives.