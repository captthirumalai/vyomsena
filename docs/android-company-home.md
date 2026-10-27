# Android Company Home (current contract)

Company Home uses the centralized **Linking & Access** identity contract. The old `users/{uid}.linkedOperator` and `crew_link_codes` flow is for legacy Aviation pilot linking and must not be used to authenticate Company Home.

## Sign-in

1. Show Company User ID (`CMU-…`) and passcode fields.
2. Call the Firebase callable `verifyCompanyUser` with `{ companyUserId, passcode }`.
3. On success, sign in using `FirebaseAuth.signInWithCustomToken(token)`.
4. Read the signed token claims: `home`, `companyUserId`, `companyId`, `role`, `linkedCrewProfileId`, and `permissions.modules`.
5. Persist Firebase's authenticated session only. Never persist the passcode.
6. Keep Company Home and Aviation Home sessions separate if one Firebase Auth instance would replace the other session.

The passcode is displayed once when the web admin creates or resets it. It is not time-limited today; it remains valid until reset or account suspension. Five failed attempts trigger a 15-minute lockout.

## Module access

- Use only `companies/{companyId}/…` for Company Home data; get `companyId` from the signed claim.
- Display a module only if `permissions.modules[module].view == true`.
- Permit edits only if `permissions.modules[module].edit == true`; Firestore rules must independently enforce the same boundary.
- Do not read `company_users` directly from the app. The custom token contains the current permission snapshot. Refresh token or reauthenticate after admin changes.
- A PILOT Company User is linked to an existing Crew Management Add Pilot profile. Read its ID from `linkedCrewProfileId`; do not create or alter the roster record from Android.
- Operations and technical Company Users have no pilot link unless the contract is changed deliberately.
- Keep personal Aviation data out of Company Home and do not silently fall back between workspaces.

## Error handling

- Invalid ID, passcode, inactive account, or ineligible pilot link: generic credential error.
- Lockout: tell the user to try again after the lockout period.
- Network failure: preserve the entered ID, clear the passcode, and offer retry.
- Missing/denied module data: explain that the account lacks access or rules are not deployed; never broaden queries to another company.

## Web issuance and management

The web left pane has a single Linking & Access module for people and future devices. Pilot accounts are issued only for eligible Crew Management records. Flight Ops links to this module with Operations preselected; Maintenance does so with Technical preselected. Settings and pilot cards no longer issue Company Home credentials.

Initial passcodes are hashed with scrypt and returned once from server callables. Admins can edit grants, reset passcodes, and suspend/reactivate accounts. Module grants are signed into custom-token claims.

## EFB devices

Device enrollment is not implemented. Give devices their own enrollment and revocation design with device-scoped grants. Never use a person's Company User ID/passcode as an EFB device credential.

## Deployment dependency

The custom-token organization and module checks are documented in `docs/firestorerules.md`. Firebase CLI rules deployment is not configured in `firebase.json`; verify/deploy those rules before the Android app relies on them.
