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
