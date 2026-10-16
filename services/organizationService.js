function normalizeText(value) {
  const text = `${value || ''}`.trim();
  return text.length ? text : null;
}

export function getCurrentOrganizationContext(user) {
  if (!user) {
    return {
      organizationId: null,
      organizationName: null,
      organizationCode: null,
      organizationBase: null,
      operatorType: null,
      scopeUserUid: null
    };
  }

  const userRole = `${user.role || ''}`.trim().toUpperCase();
  // Authoritative membership wins. `companyId` is attached to the session user
  // once at login from the server-read company_accounts membership row — it is
  // never taken from form input or any client-supplied value. A valid
  // membership is therefore never replaced by the user's own UID merely
  // because the two differ.
  const memberCompanyId = normalizeText(user.companyId);
  if (memberCompanyId) {
    return {
      organizationId: memberCompanyId,
      organizationName: normalizeText(user.organizationName),
      organizationCode: normalizeText(user.organizationCode),
      organizationBase: normalizeText(user.organizationBase),
      operatorType: normalizeText(user.operatorType),
      scopeUserUid: normalizeText(user.uid)
    };
  }

  const operatorUid = userRole === 'PILOT' ? normalizeText(user.linkedOperator) : normalizeText(user.uid);

  return {
    organizationId: operatorUid,
    organizationName: normalizeText(user.organizationName),
    organizationCode: normalizeText(user.organizationCode),
    organizationBase: normalizeText(user.organizationBase),
    operatorType: normalizeText(user.operatorType),
    scopeUserUid: normalizeText(user.uid)
  };
}

/**
 * Pure clobber-guard for ensureAdminUser: an admin grant's companyId may only
 * be filled when missing — never overwritten. A member's valid company (or a
 * solo owner's own company) therefore survives every subsequent login.
 * Returns the companyId that should be stored (existing wins, else requested).
 */
export function resolveAdminCompanyId(currentCompanyId, requestedCompanyId) {
  const current = normalizeText(currentCompanyId);
  if (current) return { companyId: current, shouldUpdate: false };
  const requested = normalizeText(requestedCompanyId);
  if (requested) return { companyId: requested, shouldUpdate: true };
  return { companyId: null, shouldUpdate: false };
}
