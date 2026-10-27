import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

// Company-user records are managed only through admin-checked Cloud Functions.
// Direct client reads and writes to company_users are intentionally disabled.

async function callCompanyUserFn(name, payload) {
  const call = httpsCallable(getFunctions(), name);
  const result = await call(payload);
  return result?.data ?? null;
}

export async function issueCompanyUserViaCallable({ role, permissions, linkedCrewProfileId = null, linkedPersonId = null, status = 'ACTIVE' }) {
  // Returns { companyUserId, ..., passcode }; the passcode is shown once and
  // is never persisted by the client or server.
  return callCompanyUserFn('issueCompanyUser', {
    role,
    permissions,
    linkedCrewProfileId,
    linkedPersonId,
    status
  });
}

export async function listCompanyUsersViaCallable() {
  const users = await callCompanyUserFn('listCompanyUsers', {});
  return Array.isArray(users) ? users : [];
}

export async function updateCompanyUserViaCallable(companyUserId, patch) {
  return callCompanyUserFn('updateCompanyUser', { companyUserId, ...(patch || {}) });
}

export async function resetCompanyUserPasscodeViaCallable(companyUserId) {
  return callCompanyUserFn('resetCompanyUserPasscode', { companyUserId });
}
