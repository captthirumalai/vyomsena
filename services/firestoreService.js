import {
  doc as docRef,
  getDoc as getDocRef,
  setDoc as setDocRef,
  collection as collectionRef,
  query as queryFn,
  where as whereFn,
  orderBy as orderByFn,
  getDocs as getDocsFn,
  addDoc as addDocFn,
  updateDoc as updateDocFn,
  deleteDoc as deleteDocFn,
  onSnapshot as onSnapshotFn,
  serverTimestamp as firestoreTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getDbInstance } from './firebaseService.js';

export function doc(path, id) {
  return docRef(getDbInstance(), path, id);
}

export async function getDoc(ref) {
  return await getDocRef(ref);
}

export async function setDoc(ref, data) {
  return await setDocRef(ref, data);
}

export function collection(path) {
  return collectionRef(getDbInstance(), path);
}

export function query(source, ...constraints) {
  return queryFn(source, ...constraints);
}

export function where(field, op, value) {
  return whereFn(field, op, value);
}

export function orderBy(field, direction) {
  return orderByFn(field, direction);
}

export async function getDocs(queryRef) {
  return await getDocsFn(queryRef);
}

export async function addDoc(collectionRef, data) {
  return await addDocFn(collectionRef, data);
}

export async function updateDoc(docRef, data) {
  return await updateDocFn(docRef, data);
}

export async function deleteDoc(docRef) {
  return await deleteDocFn(docRef);
}

export function onSnapshot(queryOrRef, onNext, onError) {
  return onSnapshotFn(queryOrRef, onNext, onError);
}

export function serverTimestamp() {
  return firestoreTimestamp();
}
