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
    // Client compresses images before upload; rules enforce format + size as a backstop.
    match /documents/{userId}/{documentId}/{fileName} {
      function isAllowedDocumentUpload() {
        return request.resource.size <= 10 * 1024 * 1024 &&
               (request.resource.contentType == 'application/pdf' ||
                request.resource.contentType.matches('image/(jpeg|png|webp)'));
      }
      allow read: if isOwner(userId) || isLinkedOperator(userId) || isCrewProfileOperator(userId);
      allow delete: if isOwner(userId) || isLinkedOperator(userId) || isCrewProfileOperator(userId);
      allow create, update: if (isOwner(userId) || isLinkedOperator(userId) || isCrewProfileOperator(userId))
                             && isAllowedDocumentUpload();
    }

    // Crew profile photos
    // crew_photos/{pilotUid}/{fileName}
    match /crew_photos/{pilotUid}/{fileName} {
      function isAllowedPhotoUpload() {
        return request.resource.size <= 5 * 1024 * 1024 &&
               request.resource.contentType.matches('image/(jpeg|png|webp)');
      }
      allow read: if isSignedIn();
      allow delete: if isOwner(pilotUid) || isLinkedOperator(pilotUid) || isCrewProfileOperator(pilotUid);
      allow create, update: if (isOwner(pilotUid) || isLinkedOperator(pilotUid) || isCrewProfileOperator(pilotUid))
                             && isAllowedPhotoUpload();
    }

    // Company manuals (EFB Manual Distribution)
    // Covers both the legacy flat path manuals/{companyId}/{manualId}/{fileName}
    // and immutable revision paths manuals/{companyId}/{manualId}/revisions/{revisionId}/{fileName}.
    // Admin (web) uploads; linked company users (web + Android) read/download.
    function isCompanyAdminUser(companyId) {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/admin_users/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/admin_users/$(request.auth.uid)).data.companyId == companyId;
    }

    function isCompanyAccountUser(companyId) {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/company_accounts/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/company_accounts/$(request.auth.uid)).data.companyId == companyId;
    }

    function isAndroidCompanyMember(companyId) {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/company_members/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/company_members/$(request.auth.uid)).data.companyId == companyId;
    }

    match /manuals/{companyId}/{manualId}/{allPaths=**} {
      function isAllowedManualUpload() {
        return request.resource.size <= 20 * 1024 * 1024 &&
               (request.resource.contentType == 'application/pdf' ||
                request.resource.contentType.matches('image/(jpeg|png|webp)'));
      }
      allow read: if isCompanyAdminUser(companyId) || isCompanyAccountUser(companyId) || isAndroidCompanyMember(companyId);
      allow create, update: if isCompanyAdminUser(companyId) && isAllowedManualUpload();
      allow delete: if isCompanyAdminUser(companyId);
    }

    // Deny everything else
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
