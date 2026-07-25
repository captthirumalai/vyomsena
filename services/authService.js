import {
  initFirebase,
  getAuthInstance,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from './firebaseService.js';
import { doc, getDoc, setDoc, serverTimestamp } from './firestoreService.js';

export function initializeFirebaseAuth() {
  initFirebase();
}

export function authStateObserver(callback) {
  return onAuthStateChanged(getAuthInstance(), callback);
}

export async function signIn(email, password) {
  return await signInWithEmailAndPassword(getAuthInstance(), email, password);
}

export async function registerWorkspace({ name, type, email, password }) {
  const userCredential = await createUserWithEmailAndPassword(getAuthInstance(), email, password);
  const uid = userCredential.user.uid;

  const profile = {
    uid,
    name,
    email,
    role: 'OPERATIONS',
    operatorType: type,
    linkedOperator: null,
    createdAt: serverTimestamp()
  };

  await setDoc(doc('users', uid), profile);
  return profile;
}

export async function sendResetEmail(email) {
  return await sendPasswordResetEmail(getAuthInstance(), email);
}

export async function signOutUser() {
  return await signOut(getAuthInstance());
}

export async function loadUserProfile(uid) {
  const profileRef = doc('users', uid);
  const profileSnapshot = await getDoc(profileRef);
  return profileSnapshot.exists() ? profileSnapshot.data() : null;
}

export async function createUserProfile(uid, profileData) {
  return await setDoc(doc('users', uid), profileData);
}
