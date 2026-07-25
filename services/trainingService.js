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

const CENTERS = 'training_centers';
const OFFERINGS = 'training_offerings';
const BOOKINGS = 'training_bookings';

export async function listTrainingCenters() {
  const snapshot = await getDocs(collection(CENTERS));
  return snapshot.docs.map((item) => ({ centerId: item.id, ...item.data() }));
}

export async function createTrainingCenter(payload) {
  const ref = await addDoc(collection(CENTERS), {
    ...payload,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });
  await updateDoc(ref, { centerId: ref.id });
  return { centerId: ref.id, ...payload };
}

export async function listTrainingOfferings(centerId = null) {
  const offeringsRef = collection(OFFERINGS);
  const targetQuery = centerId ? query(offeringsRef, where('centerId', '==', centerId)) : offeringsRef;
  const snapshot = await getDocs(targetQuery);
  return snapshot.docs.map((item) => ({ offeringId: item.id, ...item.data() }));
}

export async function createTrainingOffering(payload) {
  const ref = await addDoc(collection(OFFERINGS), {
    ...payload,
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });
  await updateDoc(ref, { offeringId: ref.id });
  return { offeringId: ref.id, ...payload };
}

export async function listTrainingBookings(userId = null) {
  const bookingsRef = collection(BOOKINGS);
  const targetQuery = userId ? query(bookingsRef, where('userId', '==', userId)) : bookingsRef;
  const snapshot = await getDocs(targetQuery);
  return snapshot.docs.map((item) => ({ bookingId: item.id, ...item.data() }));
}

export async function createTrainingBooking(payload) {
  const ref = await addDoc(collection(BOOKINGS), {
    ...payload,
    status: payload.status || 'PENDING',
    createdAt: serverTimestamp(),
    lastModified: serverTimestamp()
  });
  await updateDoc(ref, { bookingId: ref.id });
  return { bookingId: ref.id, ...payload };
}

export async function updateTrainingBooking(bookingId, updates) {
  await updateDoc(doc(BOOKINGS, bookingId), {
    ...updates,
    lastModified: serverTimestamp()
  });
}

export async function deleteTrainingBooking(bookingId) {
  await deleteDoc(doc(BOOKINGS, bookingId));
}

export function watchTrainingBookings(userId, onNext, onError) {
  const bookingsRef = collection(BOOKINGS);
  const bookingQuery = userId ? query(bookingsRef, where('userId', '==', userId)) : bookingsRef;
  return onSnapshot(bookingQuery, onNext, onError);
}
