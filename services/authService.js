import {
  initFirebase,
  getAuthInstance,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from './firebaseService.js';
import { serverTimestamp } from './firestoreService.js';
import { getUserByUid, createUserProfile as createUserProfileRecord } from './userService.js';

export function initializeFirebaseAuth() {
  initFirebase();
}

export function authStateObserver(callback) {
  return onAuthStateChanged(getAuthInstance(), callback);
}

function mapAuthError(error) {
  const code = error?.code || '';

  if (code === 'auth/invalid-credential') {
    return 'Invalid email/password for this account. If this user was registered in Android, use Continue with Google.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Google popup was blocked by the browser. Allow popups for this site and try again.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Google sign-in was cancelled before completion.';
  }
  if (code === 'auth/user-not-found') {
    return 'No account found for this email.';
  }
  if (code === 'auth/wrong-password') {
    return 'Incorrect password for this email.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed attempts. Please wait a while and try again.';
  }

  return error?.message || 'Authentication failed.';
}

export async function signIn(email, password) {
  try {
    return await signInWithEmailAndPassword(getAuthInstance(), email, password);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });

  try {
    return await signInWithPopup(getAuthInstance(), provider);
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

export async function registerWorkspace({ fullName, role, type, email, password }) {
  const userCredential = await createUserWithEmailAndPassword(getAuthInstance(), email, password);
  const uid = userCredential.user.uid;
  const normalizedRole = `${role || 'OPERATIONS'}`.trim().toUpperCase();

  const profile = {
    uid,
    name: fullName,
    fullName,
    email,
    role: normalizedRole,
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
