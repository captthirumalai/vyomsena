# VAMS V2 Permissions Model

This document defines how roles and route permissions work in the V2 web app.

## Source of truth

- Role is read from the authenticated profile in `users/{uid}` (field: `role`).
- Route permissions are declared in each module manifest (`modules/*/manifest.js`).
- Access checks are enforced in the router and filtered in the sidebar.

## Current implementation

- Permission matching is case-insensitive.
- If a route has no `permissions`, it is treated as public.
- If a route has `permissions`, user must have one matching role.
- Unauthorized routes render an Access Denied state.

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

## Planned expansion

As more modules are added:

- Add role inheritance rules (for example: `admin` can access all routes).
- Add organization-scoped permission overrides.
- Add feature-level permissions (page actions) beyond route-level access.

## Testing checklist

- Login with a user role that has route access and confirm route loads.
- Login with a role without access and confirm Access Denied state appears.
- Confirm sidebar only shows routes allowed for the logged-in role.
- Confirm changing role in profile updates route access after next auth refresh.
