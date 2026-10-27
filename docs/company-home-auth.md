# Company Home Authentication Contract (Android)

The web app's Linking & Access module issues Company Home identities. No Android source lives in this repository; this is the integration contract for the Android project. Aviation Home remains a separate sign-in and workspace.

## Entry points

- **Aviation Home:** existing Google/email Firebase Auth and personal workspace.
- **Company Home:** Company User ID + passcode → `verifyCompanyUser` callable → Firebase custom token → company workspace with admin-assigned module grants.

Switching homes must be explicit. Keep Company Home and Aviation Home sessions isolated if signing into one would otherwise replace the other session.

## Company Home login

Accept a Company User ID (`CMU-…`) and passcode. Do not persist, log, or cache the passcode. The initial passcode is displayed once by the web Linking module; it remains valid until an admin resets it. The backend locks an account after five failed attempts for 15 minutes.

## Callable contract: `verifyCompanyUser`

- Request: `{ companyUserId, passcode }`.
- Success: `{ token, claims }`; call Firebase `signInWithCustomToken(token)`.
- Claims: `home`, `companyUserId`, `companyId`, `role`, `linkedCrewProfileId`, and compact `permissions.modules` grants (`{ view, edit }`).
- Unknown ID, wrong passcode, suspended user, or invalid pilot association: show a generic credential error.
- Lockout: show “Too many attempts. Try again later.”
- Network failure: show a retryable server connection message.

Do not read `company_users/{id}` from Android. The collection is denied to client users; the signed claims are the login permission snapshot. After an admin changes access, refresh the token or sign in again.

## Company scope and module access

- Read company data only under `companies/{companyId}/…` using the verified token's `companyId` claim.
- Show a module only when `permissions.modules[module].view == true`.
- Enable changes only when that module's `edit == true` and Firestore rules permit them.
- A pilot Company User is linked only to an existing eligible `crew_profiles` record created by that company's Crew Management → Add Pilot flow. Other roles cannot be linked to a pilot profile.
- Never fall back to personal `users/{uid}` data for Company Home.

## Web implementation and rules

- `issueCompanyUser` and `verifyCompanyUser` run server-side. Passcodes use scrypt hashes and plaintext is returned only once at issuance/reset.
- `company_users` stores role, status, company ID, optional eligible pilot link, and per-module grants.
- `docs/firestorerules.md` is configured as the Firestore rules source in `firebase.json`; rules and all 11 Cloud Functions were deployed to `vyomsena-888` on 2026-10-27. The Android app still needs to implement and verify this login contract.
- Future EFB device enrollment is a separate identity and security flow. Do not reuse person credentials for devices.
