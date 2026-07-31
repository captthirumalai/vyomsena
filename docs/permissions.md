# VAMS V2 Permissions Model

This document defines how roles and route permissions work in the V2 web app.

The same stability principle applies here as in the data layer contract: avoid breaking role or permission field names used by Android and Web.

## Source of truth

- Role is read from the authenticated profile in `users/{uid}` (field: `role`).
- Route permissions are declared in each module manifest (`modules/*/manifest.js`).
- Access checks are enforced in the router and filtered in the sidebar.

## Current implementation

- Permission matching is case-insensitive.
- If a route has no `permissions`, it is treated as public.
- If a route has `permissions`, user must have one matching role.
- Unauthorized routes render an Access Denied state.
- Pilot identities may still exist in shared Firebase auth and data, but pilot users are blocked from entering the web shell and are expected to use the Android app.

## Manifest contract

Each module manifest can declare:

- `path`: hash route path (example: `/crew`)
- `title`: display title used in topbar
- `showInMenu`: whether route appears in sidebar
- `order`: sidebar sort priority
- `permissions`: list of allowed roles

Example:

```js
export const manifest = {
  path: '/crew',
  name: 'Crew',
  title: 'Crew Management',
  showInMenu: true,
  order: 20,
  permissions: ['operations'],
  html: 'modules/crew/crew.html',
  js: 'modules/crew/crew.js',
  css: 'modules/crew/crew.css'
};
```

## Role naming convention

Use lowercase internally for consistency, while allowing mixed-case input in profile data.

Recommended role keys:

- `admin`
- `operations`
- `pilot`
- `ame`
- `training`

Android parity role keys also in active use:

- `OPERATIONS`
- `PILOT`
- `TRAINING_CENTER`

Current product boundary:

- `PILOT` remains a valid shared identity role.
- `PILOT` should not be granted web route access in module manifests.
- Web manifests should target company-facing roles only unless a deliberate exception is introduced later.

Because route checks normalize case, manifests should include aliases where needed
(for example: `training` and `training_center`) until all clients converge.

## Planned expansion

As more modules are added:

- Add role inheritance rules (for example: `admin` can access all routes).
- Add organization-scoped permission overrides.
- Add feature-level permissions (page actions) beyond route-level access.

## Action-level permissions

- Route permissions remain manifest-driven.
- Feature actions are centralized in `services/permissionService.js`.
- Crew module now uses action keys (`view`, `edit`, `delete`, `approve`, `manageLinkRequests`, `respondIncomingRequest`) instead of scattering role checks in UI handlers.

## Testing checklist

- Login with a user role that has route access and confirm route loads.
- Login with a role without access and confirm Access Denied state appears.
- Confirm sidebar only shows routes allowed for the logged-in role.
- Confirm changing role in profile updates route access after next auth refresh.
