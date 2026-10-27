# Linking & Access module

The `/linking` module is the operator admin console for Company Home identities and, later, enrolled devices.

## People

- **Pilots** are selected from `crew_profiles` only. Pilot profiles created by Crew Management → Add Pilot receive `provisioningSource: CREW_ADD_PILOT`. Linking verifies the profile belongs to the issuing company, is an active PILOT, and has this provenance. Existing profiles without the marker must be recreated through Add Pilot before they can receive Company Home credentials.
- **Operations users** are Company Users with role `OPERATIONS`.
- **Technical users** are Company Users with role `AME`.
- Every Company User receives an opaque `CMU-…` ID and an initial passcode. The passcode is returned once, hashed with scrypt at rest, and can be reset by an owner/admin. Five failed attempts lock login for 15 minutes.
- Module view/edit grants are stored in `company_users/{id}.permissions.modules` and included in the signed Firebase custom-token claims returned by `verifyCompanyUser`.
- Pilot Company Users must retain a valid eligible crew profile association. Non-pilot Company Users cannot be associated with a pilot profile.

## Entry points

- The left pane opens **Linking & Access** for company owners/admins.
- Flight Ops → **Add Ops User** opens Linking with Operations selected.
- Maintenance → **Add Technical User** opens Linking with Technical selected.
- Crew Management remains the roster source. Pilot cards no longer issue separate six-digit company invites; credentials for a pilot are issued from Linking after Add Pilot.
- Settings retains company identity and notification status. User issuance and credential management live only in Linking.

## Devices

Device linking is a planned section only. Device enrollment, revocation, secure device identity, and per-device grants must be designed before any device records or credentials are issued. People credentials must not be reused as device credentials.

## Android Company Home contract

Android sends `{ companyUserId, passcode }` to the unauthenticated Firebase callable `verifyCompanyUser`. On success, it signs in with the returned custom token. Claims contain `home`, `companyUserId`, `companyId`, `role`, `linkedCrewProfileId`, and compact `permissions.modules` grants. The client can show only granted modules; server rules enforce view/edit grants throughout `companies/{companyId}/{module}/…`. Permission changes take effect when the custom token refreshes or the user signs in again.

This replaces the web-generated `company_invites` six-digit flow for Company Home access. Existing `company_invites` and `company_members` records/rules may remain for legacy clients but are not used by the current web Linking module.

## Deployment note

`docs/firestorerules.md` is configured as the Firebase CLI Firestore rules source in `firebase.json`. Firestore rules and all 11 Cloud Functions were deployed to `vyomsena-888` on 2026-10-27 for release `V0.3.50`. The Functions deployment completed; Firebase CLI could not configure an Artifact Registry cleanup policy. The Android application still needs to implement the documented callable sign-in contract.
