# VAMS V2 Firebase Storage Rules

Reference for the Firebase Storage security rules used by the shared
`vyomsena-888` bucket. Applies to both Android and Web clients.

## Current root cause fixed (V2.2.3)

Web operators upload files on a pilot's behalf under:

- `documents/{userId}/{documentId}/{fileName}`

Uploading succeeded, but the web code then requested the download URL, which
required `read`. The rules only granted read to the owner, so operators hit
`storage/unauthorized` (`code: storage/unauthorized`).

Two-layer fix:

1. Code: `services/storageService.js` now takes the download token from the
   upload metadata and builds the tokenized URL, so creating a document no
   longer requires `read` at upload time.
2. Rules (below): operators can also read/write pilot files. Owner access
   used by the Android app is preserved unchanged.

## Rules to paste in Firebase Console

Firebase Console -> Storage -> Rules. This is the complete ruleset matching the
deployed rules plus the additive `isCrewProfileOperator` helper. Existing
Android access (`isOwner`, `isLinkedOperator`) is preserved unchanged.

```js
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isLinkedOperator(userId) {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/users/$(userId)) &&
             request.auth.uid == firestore.get(/databases/(default)/documents/users/$(userId)).data.linkedOperator;
    }

    function isCrewProfileOperator(userId) {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/crew_profiles/$(userId)) &&
             request.auth.uid == firestore.get(/databases/(default)/documents/crew_profiles/$(userId)).data.operatorId;
    }

    // Shared Android + Web document path
    // documents/{userId}/{documentId}/{fileName}
    match /documents/{userId}/{documentId}/{fileName} {
      allow read: if isOwner(userId) || isLinkedOperator(userId) || isCrewProfileOperator(userId);
      allow write: if isOwner(userId) || isLinkedOperator(userId) || isCrewProfileOperator(userId);
    }

    // Deny everything else
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## Why both lookups

The first path segment can be either:

- a `crew_profiles` document id (`crewProfileId`) for web-created pilots, or
- a `users` document id (auth `uid`) for Android-origin pilots.

`isCrewProfileOperator` covers the first case via `crew_profiles/{id}.operatorId`.
`isLinkedOperator` covers the second case via `users/{uid}.linkedOperator`.
The `firestore.exists()` guards prevent rules evaluation errors on missing
documents (the same pattern applied to the Firestore rules helpers).

## Compatibility

- Android owner access (`request.auth.uid == userId`) is unchanged.
- Firestore rules are unchanged (see `docs/firestorerules.md`).
- Download URLs returned at upload time are tokenized and work regardless of
  these rules for preview/download.
