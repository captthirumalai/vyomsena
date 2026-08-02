rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isOwner(doc) {
      return request.auth != null && request.auth.uid == doc.userId;
    }

    function isLinkedOperator(docOwnerId) {
      return request.auth != null
        && exists(/databases/$(database)/documents/users/$(docOwnerId))
        && request.auth.uid == get(/databases/$(database)/documents/users/$(docOwnerId)).data.linkedOperator;
    }

    function isOperatorTrainingOwner(record) {
      return request.auth != null && request.auth.uid == record.operatorId;
    }

    function isCrewProfileOwnerById(crewProfileId) {
      return request.auth != null
        && exists(/databases/$(database)/documents/crew_profiles/$(crewProfileId))
        && request.auth.uid == get(/databases/$(database)/documents/crew_profiles/$(crewProfileId)).data.operatorId;
    }

    function isCrewProfileLinkedPilot(crewProfileId) {
      return request.auth != null
        && exists(/databases/$(database)/documents/crew_profiles/$(crewProfileId))
        && request.auth.uid == get(/databases/$(database)/documents/crew_profiles/$(crewProfileId)).data.pilotUid;
    }

    // USERS COLLECTION
    match /users/{userId} {
      allow read: if request.auth != null;
      allow create, delete: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && (
        request.auth.uid == userId ||
        resource.data.linkedOperator == request.auth.uid
      );
    }

    // TRAINING CENTERS (Android path - unchanged behavior)
    match /training_centers/{userId} {
      allow read, create, update: if request.auth != null && request.auth.uid == userId;
    }

    // TRAINING OFFERINGS (Android path - unchanged behavior)
    match /training_offerings/{offeringId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.trainingCenterId;
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.trainingCenterId;
    }

    // TRAINING BOOKINGS (Android path - unchanged behavior)
    match /training_bookings/{bookingId} {
      allow read: if request.auth != null && (
        request.auth.uid == resource.data.userId ||
        request.auth.uid == resource.data.trainingCenterId ||
        isLinkedOperator(resource.data.userId)
      );
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.userId
        && request.resource.data.userId != request.resource.data.trainingCenterId;
      allow update: if request.auth != null && request.auth.uid == resource.data.trainingCenterId;
      allow delete: if false;
    }

    // OPERATOR TRAINING RECORDS (Web-only additive path)
    match /operator_training_records/{recordId} {
      allow read: if request.auth != null && (
        isOperatorTrainingOwner(resource.data) ||
        isCrewProfileLinkedPilot(resource.data.userId)
      );

      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.operatorId
        && isCrewProfileOwnerById(request.resource.data.userId);

      allow update: if request.auth != null
        && isOperatorTrainingOwner(resource.data)
        && request.resource.data.operatorId == resource.data.operatorId
        && request.resource.data.userId == resource.data.userId;

      allow delete: if request.auth != null && isOperatorTrainingOwner(resource.data);
    }

    // CREW PROFILES (Web operator-owned source of truth)
    match /crew_profiles/{crewProfileId} {
      allow read: if request.auth != null && (
        request.auth.uid == resource.data.operatorId ||
        request.auth.uid == resource.data.pilotUid
      );

      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.operatorId;

      allow update: if request.auth != null
        && request.auth.uid == resource.data.operatorId
        && request.resource.data.operatorId == resource.data.operatorId;

      allow delete: if request.auth != null
        && request.auth.uid == resource.data.operatorId;
    }

    // CREW LINK CODES (Web operator-generated 5-minute linking codes)
    match /crew_link_codes/{tokenId} {
      allow read: if request.auth != null && (
        request.auth.uid == resource.data.operatorId ||
        isCrewProfileLinkedPilot(resource.data.crewProfileId)
      );

      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.operatorId
        && isCrewProfileOwnerById(request.resource.data.crewProfileId);

      allow update: if request.auth != null
        && request.auth.uid == resource.data.operatorId
        && request.resource.data.operatorId == resource.data.operatorId
        && request.resource.data.crewProfileId == resource.data.crewProfileId;

      allow delete: if request.auth != null
        && request.auth.uid == resource.data.operatorId;
    }

    // USER DOCUMENTS
    match /user_documents/{docId} {
      allow read: if request.auth != null;

      allow delete: if request.auth != null
        && (isOwner(resource.data) || isLinkedOperator(resource.data.userId) || isCrewProfileOwnerById(resource.data.userId));

      allow create: if request.auth != null
        && (isOwner(request.resource.data) || isLinkedOperator(request.resource.data.userId) || isCrewProfileOwnerById(request.resource.data.userId));

      allow update: if request.auth != null
        && (isOwner(resource.data) || isLinkedOperator(resource.data.userId) || isCrewProfileOwnerById(resource.data.userId))
        && request.resource.data.userId == resource.data.userId;

      // Subcollection for immutable edit logs
      match /edit_logs/{logId} {
        allow create: if request.auth != null && (
          isOwner(get(/databases/$(database)/documents/user_documents/$(docId)).data) ||
          isLinkedOperator(get(/databases/$(database)/documents/user_documents/$(docId)).data.userId) ||
          isCrewProfileOwnerById(get(/databases/$(database)/documents/user_documents/$(docId)).data.userId)
        );
        allow read, update, delete: if false;
      }
    }

    // CONNECTION REQUESTS
    match /connection_requests/{requestId} {
      allow create: if request.auth != null
        && request.resource.data.requesterId == request.auth.uid;

      allow read: if request.auth != null && (
        request.auth.uid == resource.data.recipientId ||
        request.auth.uid == resource.data.requesterId
      );

      allow update: if request.auth != null
        && request.auth.uid == resource.data.recipientId;

      allow delete: if false;
    }

    // ACCESS CODES
    match /access_codes/{codeId} {
      allow read: if request.auth != null && (
        request.auth.uid == resource.data.pilotId ||
        isLinkedOperator(resource.data.pilotId)
      );

      allow create: if request.auth != null && (
        request.auth.uid == request.resource.data.pilotId ||
        isLinkedOperator(request.resource.data.pilotId)
      );

      allow update: if false;

      allow delete: if request.auth != null && (
        request.auth.uid == resource.data.pilotId ||
        isLinkedOperator(resource.data.pilotId)
      );
    }

    // AIRCRAFT (FLEET) COLLECTION
    match /aircraft/{reg} {
      allow read, write: if request.auth != null;
    }

    // ================= COMPANY WORKSPACE MODEL =================

    // Helpers
    function isCompanyAdmin(companyId) {
      return request.auth != null
        && exists(/databases/$(database)/documents/admin_users/$(request.auth.uid))
        && get(/databases/$(database)/documents/admin_users/$(request.auth.uid)).data.companyId == companyId;
    }

    function isCompanyAccountMember(companyId) {
      return request.auth != null
        && exists(/databases/$(database)/documents/company_accounts/$(request.auth.uid))
        && get(/databases/$(database)/documents/company_accounts/$(request.auth.uid)).data.companyId == companyId;
    }

    // ADMIN USERS (web write grant, seeded once)
    match /admin_users/{uid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == uid && !exists(/databases/$(database)/documents/admin_users/$(uid));
      allow update: if request.auth != null && request.auth.uid == uid;
      allow delete: if false;
    }

    // COMPANIES (owner writes)
    match /companies/{companyId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == companyId;
      allow update, delete: if request.auth != null && request.auth.uid == companyId;
    }

    // COMPANY ACCOUNTS
    match /company_accounts/{accountId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && isCompanyAdmin(request.resource.data.companyId);
      allow update: if request.auth != null && isCompanyAdmin(resource.data.companyId);
      allow delete: if request.auth != null && isCompanyAdmin(resource.data.companyId);
    }

    // COMPANY INVITES (5-minute 6-digit codes)
    match /company_invites/{code} {
      allow read: if request.auth != null && (
        isCompanyAdmin(resource.data.companyId) ||
        resource.data.usedBy == null
      );
      allow create: if request.auth != null && isCompanyAdmin(request.resource.data.companyId);
      allow update: if request.auth != null && (
        (isCompanyAdmin(resource.data.companyId) && resource.data.usedBy == null) ||
        (resource.data.usedBy == null && request.resource.data.usedBy != null && request.resource.data.usedAt != null)
      );
      allow delete: if request.auth != null && isCompanyAdmin(resource.data.companyId);
    }

    // COMPANY MODULE SUBCOLLECTIONS: companies/{companyId}/{module}/{docId}
    match /companies/{companyId}/{module}/{docId} {
      allow read: if request.auth != null && (
        isCompanyAdmin(companyId) || isCompanyAccountMember(companyId)
      );
      allow create, update, delete: if request.auth != null && isCompanyAdmin(companyId);
    }
  }
}