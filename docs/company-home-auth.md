# Company Home Authentication Contract (Android)

Phase C2 backend contract. No Android source lives in this repository — this
document is the exact integration surface the Android app implements against.
Aviation Home (personal Firebase Auth) is unchanged and fully separate.

## Entry points (Android)

Two explicit entries, no silent fallback between them:

- **Aviation Home** — Google / email Firebase Auth → `users/{uid}` → personal workspace (existing behavior, untouched).
- **Company Home** — Company User ID + passcode → `verifyCompanyUser` callable → Firebase custom token → company workspace + Admin-assigned permissions.

Switching homes is explicit (sign out / sign in). The UI must always label
which home and which organisation is active.

## Login screen contract (Company Home)

Fields: Company User ID (`CMU-XXXXXX`) + passcode. The Company User needs no
Google, email, or Aviation account. Never persist the passcode (no prefs,
storage, logs, or history).

## Callable: verifyCompanyUser

- Request: `{ companyUserId: "CMU-…", passcode: "…" }`
- Success: `{ token, claims }` → `signInWithCustomToken(token)`.
- Claims: `{ home: "company", companyUserId, companyId, role }`.
- Failures (map to these exact UI messages, nothing more specific):
  - unknown ID / wrong passcode / suspended → "Invalid Company User ID or passcode."
  - locked (too many attempts) → "Too many attempts. Try again later."
  - network/other → "Unable to reach the server. Try again."

## Session state (Company Home)

After `signInWithCustomToken`, the session identifies:

- `home = "company"` (from token claims — never infer mode from other data)
- Company User ID, `companyId`, role (claims)
- Permissions: read the `company_users/{companyUserId}` document (Admin-managed
  `{ modules: { name: { view, edit } } }`) after sign-in; refresh on resume.

## Home data separation (hard rules for the client)

- Company Home uses ONLY the company context (`companies/{companyId}/…`,
  linked pilot record if `linkedCrewProfileId` is set). Never fall back to
  Aviation/personal data.
- Aviation Home uses ONLY `users/{uid}` personal data. Never load Company data.
- A person may hold both accounts; they are separate logins and must never
  be merged or auto-linked.

## Backend notes (web repo)

- Issuance (`issueCompanyUser`, OWNER/ADMIN-only) and verification run in
  `functions/` via Admin SDK; passcodes are scrypt hashes, shown once at
  issuance/reset, never stored or logged.
- `company_users` is deny-by-default for direct client access; Phase C2
  management goes through admin-checked callables, so no console rule change
  was required. Company sessions get no direct registry access.
- Firestore org-boundary enforcement for custom-token claims
  (`request.auth.token.companyId == companyId`) is scheduled with the
  security-hardening milestone — documented here, not yet implemented.
