import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from './firestoreService.js';

const COLLECTION = 'connection_requests';

export async function sendConnectionRequest(payload) {
  const requestsRef = collection(COLLECTION);
  const requestData = {
    requesterId: payload.requesterId,
    recipientId: payload.recipientId || null,
    requesterName: payload.requesterName || null,
    requesterEmail: payload.requesterEmail || null,
    recipientEmail: payload.recipientEmail || null,
    status: 'PENDING',
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  };

  const requestRef = await addDoc(requestsRef, requestData);
  await updateDoc(requestRef, { requestId: requestRef.id });
  return { requestId: requestRef.id, ...requestData };
}

export async function listIncomingRequests(recipientId) {
  const requestsRef = collection(COLLECTION);
  const incomingQuery = query(requestsRef, where('recipientId', '==', recipientId));
  const snapshot = await getDocs(incomingQuery);
  return snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
}

export async function listOutgoingRequests(requesterId) {
  const requestsRef = collection(COLLECTION);
  const outgoingQuery = query(requestsRef, where('requesterId', '==', requesterId));
  const snapshot = await getDocs(outgoingQuery);
  return snapshot.docs.map((item) => ({ requestId: item.id, ...item.data() }));
}

export async function acceptConnectionRequest(requestId) {
  await updateDoc(doc(COLLECTION, requestId), {
    status: 'ACCEPTED',
    lastModified: serverTimestamp()
  });
}

export async function rejectConnectionRequest(requestId) {
  await updateDoc(doc(COLLECTION, requestId), {
    status: 'REJECTED',
    lastModified: serverTimestamp()
  });
}

export async function cancelConnectionRequest(requestId) {
  await deleteDoc(doc(COLLECTION, requestId));
}

export function watchIncomingRequests(recipientId, onNext, onError) {
  const requestsRef = collection(COLLECTION);
  const incomingQuery = query(requestsRef, where('recipientId', '==', recipientId));
  return onSnapshot(incomingQuery, onNext, onError);
}
