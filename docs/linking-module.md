# Linking & Access module

The `/linking` module is the operator admin console for Company Home identities and future enrolled devices.

## People and source records

- **Pilots** are selected from `crew_profiles` only when created through this company's Crew Management → Add Pilot flow (`provisioningSource: CREW_ADD_PILOT`), with role `PILOT` and active status.
- **Operations staff** are added by an owner/admin in Flight Ops and stored at `companies/{companyId}/people` with role `OPERATIONS`.
- **Technical staff** are added by an owner/admin in Maintenance and stored in the same subcollection with role `AME`.
- Linking uses one person dropdown. It shows only active records for the selected access type and excludes people already linked to another Company User. If no eligible person exists, it points to the module where that record must be added.
- The server verifies company, role, status, and uniqueness when issuing or changing a link. Account display names come from the selected source record.
- Every Company User receives an opaque `CMU-…` ID and initial passcode. The passcode is returned once, stored only as a scrypt hash, and can be reset by an owner/admin. Five failed attempts lock login for 15 minutes.
- Module view/edit grants are stored in `company_users/{id}.permissions.modules` and included in signed Firebase custom-token claims.
- Pilot accounts use `linkedCrewProfileId`; Operations and Technical accounts use `linkedPersonId`. Legacy accounts without a staff link remain readable, but new and changed accounts require an eligible source record.

## Entry points

- Every registered web account is provisioned as an active company administrator. An existing active company membership scopes the admin to that company; otherwise the account administers its own workspace.
- The left pane opens **Linking & Access** for company administrators.
- Flight Ops → Add Ops User opens the Operations Team source form.
- Maintenance → Add Technical User opens the Technical Team source form.
- Crew Management remains the pilot source. Pilot cards do not issue separate six-digit Company Home invitations.
- Settings retains company identity and notification status. User issuance and credential management live only in Linking.

## Devices

Device linking is planned. Enrollment, revocation, secure device identity, and per-device grants need a separate secure flow. Person credentials must not be reused as device credentials.

## Android Company Home contract

Android sends `{ companyUserId, passcode }` to `verifyCompanyUser`. On success, it signs in with the returned custom token. Claims contain `home`, `companyUserId`, `companyId`, `role`, `displayName`, `linkedCrewProfileId`, `linkedPersonId`, and compact `permissions.modules` grants. The client can show only granted modules; Firestore rules enforce view/edit grants for `companies/{companyId}/{module}/…`. Permission changes take effect when the custom token refreshes or the user signs in again.

This replaces the web-generated `company_invites` six-digit flow for Company Home. Legacy `company_invites` and `company_members` records/rules may remain for earlier clients.

## Deployment

Release V0.4.0 makes registered non-pilot web accounts company administrators through a server-managed callable, scopes each admin to an active member company or their own workspace, and makes admin grants server-only in Firestore rules. Company User access remains limited by the module permissions assigned here. The Android application still needs to implement the documented callable sign-in contract.
