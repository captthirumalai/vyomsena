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

Firebase Console -> Storage -> Rules. Replace only the `documents/...` match
block; keep every other match exactly as-is (Android behavior unchanged).

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isLinkedOperator(userId) {
      return request.auth != null
        && get(/databases/(default)/documents/users/$(userId)) != null
        && request.auth.uid == get(/databases/(default)/documents/users/$(userId)).data.linkedOperator;
    }
    function isCrewProfileOperator(userId) {
      return request.auth != null
        && get(/databases/(default)/documents/crew_profiles/$(userId)) != null
        && request.auth.uid == get(/databases/(default)/documents/crew_profiles/$(userId)).data.operatorId;
    }

    match /documents/{userId}/{documentId}/{fileName} {
      allow read, write: if request.auth != null && (
        request.auth.uid == userId ||
        isLinkedOperator(userId) ||
        isCrewProfileOperator(userId)
      );
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
The `!= null` guards prevent rules evaluation errors on missing documents.

## Compatibility

- Android owner access (`request.auth.uid == userId`) is unchanged.
- Firestore rules are unchanged (see `docs/firestorerules.md`).
- Download URLs returned at upload time are tokenized and work regardless of
  these rules for preview/download.
