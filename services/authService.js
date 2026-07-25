import {
  initFirebase,
  getAuthInstance,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from './firebaseService.js';
import { serverTimestamp } from './firestoreService.js';
import { getUserByUid, createUserProfile as createUserProfileRecord } from './userService.js';

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

  await createUserProfileRecord(profile);
  return profile;
}

export async function sendResetEmail(email) {
  return await sendPasswordResetEmail(getAuthInstance(), email);
}

export async function signOutUser() {
  return await signOut(getAuthInstance());
}

export async function loadUserProfile(uid) {
  return await getUserByUid(uid);
}

export async function createUserProfile(uid, profileData) {
  return await createUserProfileRecord({ uid, ...profileData });
}
