import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

export async function ensureWebAdminViaCallable() {
  const call = httpsCallable(getFunctions(), 'ensureWebAdmin');
  const result = await call({});
  return result?.data ?? null;
}
