rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ──────────────
    // Helper functions
    // ──────────────
    function isOwner(doc) {
      return request.auth.uid == doc.userId;
    }

    function isLinkedOperator(docOwnerId) {
      // Check if the authenticated user is the linked operator of this pilot
      return request.auth.uid == get(/databases/$(database)/documents/users/$(docOwnerId)).data.linkedOperator;
    }

    // ──────────────
    // USERS COLLECTION
    // ──────────────
    match /users/{userId} {
      // Any authenticated user can read user profiles (for connections, search, etc.)
      allow read: if request.auth != null;

      // Pilot creates their own profile, can delete only their own account
      allow create, delete: if request.auth.uid == userId;

      // Pilot OR linked operator can update (linking or delinking)
      allow update: if request.auth != null && (
        request.auth.uid == userId ||
        resource.data.linkedOperator == request.auth.uid
      );
    }

    // ──────────────
    // TRAINING CENTERS
    // ──────────────
    match /training_centers/{userId} {
      // Allow a logged-in user to create, read, or update their own document
      allow read, create, update: if request.auth != null && request.auth.uid == userId;
    }

    // ──────────────
    // TRAINING OFFERINGS
    // ──────────────
    match /training_offerings/{offeringId} {
      // Allow any authenticated user to read training offerings
      allow read: if request.auth != null;

      // Offerings can be created by the training center that owns them.
      allow create: if request.auth != null && request.auth.uid == request.resource.data.trainingCenterId;

      // Offerings can be updated or deleted by the training center that owns them.
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.trainingCenterId;
    }

    // ──────────────
    // TRAINING BOOKINGS
    // ──────────────
    match /training_bookings/{bookingId} {
      // User can read their own bookings, a training center can read theirs, or a linked operator can read the bookings of their pilots.
      allow read: if request.auth != null && (request.auth.uid == resource.data.userId || request.auth.uid == resource.data.trainingCenterId || isLinkedOperator(resource.data.userId));
      // User can create their own bookings, but not for their own offerings
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId && request.resource.data.userId != request.resource.data.trainingCenterId;
      // Training center can update the booking to accept or reject.
      allow update: if request.auth != null && request.auth.uid == resource.data.trainingCenterId;
      // Bookings are not deletable for now.
      allow delete: if false;
    }

    // ──────────────
    // USER DOCUMENTS
    // ──────────────
    match /user_documents/{docId} {

      // READ: Allow all authenticated users (keeps autosync/live updates working)
      allow read: if request.auth != null;

      // DELETE: Owner or linked operator
      allow delete: if request.auth != null &&
                       (isOwner(resource.data) || isLinkedOperator(resource.data.userId));

      // CREATE: Owner or linked operator creating for pilot
      allow create: if request.auth != null &&
                       (isOwner(request.resource.data) || isLinkedOperator(request.resource.data.userId));

      // UPDATE: Owner or linked operator, and cannot reassign userId
      allow update: if request.auth != null &&
                       (isOwner(resource.data) || isLinkedOperator(resource.data.userId)) &&
                       request.resource.data.userId == resource.data.userId;

      // Subcollection for edit logs
      match /edit_logs/{logId} {
        allow create: if request.auth != null &&
                         (isOwner(get(/databases/$(database)/documents/user_documents/$(docId)).data) ||
                          isLinkedOperator(get(/databases/$(database)/documents/user_documents/$(docId)).data.userId));
        // Logs are immutable
        allow read, update, delete: if false;
      }
    }

    // ──────────────
    // CONNECTION REQUESTS
    // ──────────────
    match /connection_requests/{requestId} {
      allow create: if request.auth != null &&
                      request.resource.data.requesterId == request.auth.uid;

      allow read: if request.auth != null &&
                    (request.auth.uid == resource.data.recipientId ||
                     request.auth.uid == resource.data.requesterId);

      // Recipient can approve or reject
      allow update: if request.auth != null &&
                      request.auth.uid == resource.data.recipientId;

      // No one deletes requests manually
      allow delete: if false;
    }

    // ──────────────
    // AIRCRAFT (FLEET) COLLECTION
    // ──────────────
    match /aircraft/{reg} {
      // Allows any authenticated user to manage aircraft fleet data
      allow read, write: if request.auth != null;
    }
  }
}