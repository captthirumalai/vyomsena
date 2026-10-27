# Android App Integration Contract

This repository contains the web app and Firebase Functions, not Android source. For current Company Home development, use this document and [company-home-auth.md](company-home-auth.md). The earlier `linkedOperator` / `crew_link_codes` implementation was superseded for Company Home by the centralized Linking & Access module.

## Workspaces

- **Aviation Home** keeps its existing Google/email Firebase Auth and personal pilot workflows.
- **Company Home** uses Company User ID + passcode. It has its own explicit sign-in state and never falls back to Aviation Home data.
- If both homes must remain signed in at once, isolate their Firebase Auth sessions. Do not replace an Aviation session silently when signing into Company Home.

## Company Home sign-in

1. Accept a Company User ID (`CMU-…`) and passcode.
2. Call `verifyCompanyUser` with `{ companyUserId, passcode }`.
3. On success, call `signInWithCustomToken` with the returned token.
4. Use claims `home`, `companyUserId`, `companyId`, `role`, `displayName`, `linkedCrewProfileId`, `linkedPersonId`, and `permissions.modules`.
5. Do not persist or log passcodes. An initial passcode is shown once in the web app; an admin must reset it if lost.
6. After five failed attempts, the account is locked for 15 minutes.

## Permissions and data

- Use `companyId` from the signed token, never a user-entered company ID.
- A module is visible when `permissions.modules[module].view == true`.
- Allow edits only when `permissions.modules[module].edit == true` and deployed Firestore rules grant that operation.
- Do not read `company_users` directly; the list is admin-callable only. Claims are a permission snapshot and should be refreshed after admin changes.
- Pilot Company Users use `linkedCrewProfileId` for an eligible Crew Management Add Pilot record. Operations and technical users use `linkedPersonId` for an active matching-role record in `companies/{companyId}/people`.
- Keep personal and Company Home data isolated.

## Setup and security

- Register the Android package under Firebase project `vyomsena-888` and use the matching `google-services.json`.
- Enable the required Firebase Auth and Functions SDKs. The `verifyCompanyUser` callable is unauthenticated by design; issuance, listing, edits, resets, and suspension are owner/admin-only.
- `docs/firestorerules.md` is the Firebase CLI rules source configured in `firebase.json`. Deploy callable changes for each Company Home contract release. The Android app still needs to implement and verify the Company Home login contract.
- The old `crew_link_codes`, `company_invites`, and `company_members` paths are legacy and are not the current Company Home login mechanism.

## Devices

Future EFB devices need a separate device enrollment identity, revocation, and per-device permission flow. Do not reuse a person's Company User ID or passcode for device sign-in.
