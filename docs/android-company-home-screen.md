# Android Company Home Screen — Requirements

Scope: **the landing screen only**. This is the linked pilot's home after sign-in. It shows the company header and a grid of **module tiles that mirror the web app modules**. Tapping a tile navigates to that module's screen, which is built in future releases (placeholders for now). Document sync, linking, and module internals are covered separately in `docs/android-company-home.md` and `docs/android-app-build.md`.

## 1. Purpose

- Company Home is the **Managed / Corporate workspace** for pilots linked to an operator (via the web app).
- It is the **navigation hub**: a data-driven grid of module tiles matching the web app's modules (`/dashboard`, `/crew`, `/aircraft`, `/training`, `/weather`, `/notam`, `/flightops`, `/dispatch`, `/efb`, `/maintenance`, `/reports`, `/sms`, `/ai`, `/settings`).
- It remains **read/sync**: no create/edit/delete anywhere on this screen.

## 2. Screen layout

- **Header**: company name (`organizationName`), company base (`organizationBase`), and a "Company Managed" link-status badge.
- **Body**: a grid of module tiles. Each tile = icon + label.
- **Footer/utility**: sync status indicator, profile/account entry, logout.

## 3. Module tiles (mirror the web app)

Tiles are **data-driven** — one config entry per module (icon key, label, destination route, `enabled` flag, optional badge). New web modules are added later by adding a tile config, never by changing navigation.

| Tile | Web module it maps to | Web route | Icon key (web) | Status |
| --- | --- | --- | --- | --- |
| My Documents | Pilot synced documents (`user_documents`) | — (Company Home core) | `documents` | Built now |
| Dashboard | Operations Dashboard | `/dashboard` | `dashboard` | Future |
| Crew | Crew Management | `/crew` | `crew` | Future |
| Aircraft / Fleet | Fleet | `/aircraft` | `aircraft` | Future |
| Dispatch Control | Dispatch Board | `/dispatch` | `dispatch` | Future |
| Electronic Flight Bag | EFB Docs | `/efb` | `efb` | Future |
| Flight Operations | Flight Ops | `/flightops` | `flight` | Future |
| Maintenance | Maintenance Hub | `/maintenance` | `maintenance` | Future |
| NOTAM Center | NOTAMs | `/notam` | `notam` | Future |
| Reports | Reports Hub | `/reports` | `reports` | Future |
| Safety (SMS) | Safety Management | `/sms` | `sms` | Future |
| Training | Training Center | `/training` | `training` | Future |
| Weather Briefing | Weather Desk | `/weather` | `weather` | Future |
| AI Operations | AI Assistant | `/ai` | `ai` | Future |
| Settings | Workspace Settings | `/settings` | `settings` | Future (admin-gated if needed) |

Notes:
- "My Documents" is the one tile implemented now (read-only synced document list).
- All other tiles are placeholders: tapping shows a **"Coming soon"** state with the module name; the tile remains visible so the home screen does not need to change as modules ship.
- If a module should be hidden for pilots (e.g. Settings), keep its config but set `enabled = false` or gate it by role — do not remove the tile infrastructure.

## 4. User actions on this screen

| Action | Behavior |
| --- | --- |
| Tap a tile | Navigate to that module's screen. Built module → open it. Unbuilt module → "Coming soon" placeholder screen. |
| System back | Return to Company Home from any module screen. |
| Pull-to-refresh / sync button | Re-fetch company context and re-sync documents; show sync state (Syncing / Synced / Offline). |
| View company info | Tap company name in header → company details (operator name, base, code). |
| Profile / account | Open the pilot's profile; shows link state and the "Company Managed" badge. |
| Logout | Sign out of Firebase; returns to the auth screen. |
| Notifications (future) | Optional bell icon reserved for expiry/company reminders. |

## 5. Navigation contract

- Single navigation stack: Company Home is the root; every tile pushes a screen; back pops to Company Home.
- Tile destinations are **declarative strings** (e.g. `crew`, `training`) matching the web route concept — kept stable so future web modules map 1:1.
- The home screen must not hard-code tile ordering beyond the config list; order follows the web app's module order.

## 6. Screen states

| State | What the user sees |
| --- | --- |
| Loading | Skeleton/splash while fetching company context. |
| Linked | Company header + module tile grid + sync status. |
| Unlinked | **Link to Company** screen (6-digit code) instead of the tile grid (see `docs/android-company-home.md` §4). |
| Offline | Tile grid still renders (cached); sync status shows "Offline"; only cached documents open. |

## 7. Data used on this screen

- `users/{auth.uid}` → `linkedOperator`, `organizationName`, `organizationBase`, `crewProfileId`.
- `users/{operatorId}` → `organizationName`, `organizationBase`, `organizationCode` (for the company details view).
- No other collections are read by the home screen itself (document content is the My Documents tile's concern).

## 8. Explicit non-actions

The user CANNOT do these on Company Home:
- Create, edit, or delete any company data.
- Unlink themselves (delink is operator-controlled in web).
- Access operator-only admin functions (Settings unless explicitly granted).

## 9. Implementation checklist (MUST)

- [ ] Data-driven tile config: icon key, label, destination, enabled flag.
- [ ] Tile grid matching the web module list above, ordered like the web app.
- [ ] My Documents tile opens the read-only synced document screen.
- [ ] All other tiles show a "Coming soon" placeholder (no blank screens, no crash).
- [ ] Company header from `users/{operatorId}` (name + base) + "Company Managed" badge.
- [ ] Sync status indicator (Syncing / Synced / Offline) and pull-to-refresh.
- [ ] Unlinked state routes to Link to Company screen.
- [ ] Profile/account entry + logout.
- [ ] No create/edit/delete affordances on the home screen.
- [ ] Back always returns to Company Home.

## 10. Validation checklist

- [ ] Linked pilot lands on Company Home with company name and module tiles.
- [ ] Tapping "My Documents" opens the read-only document list.
- [ ] Tapping any unbuilt tile shows "Coming soon" and back returns home.
- [ ] Offline: tiles render, status shows Offline, cached docs open.
- [ ] Unlinked pilot sees the Link to Company screen, not tiles.
- [ ] Logout returns to auth.
