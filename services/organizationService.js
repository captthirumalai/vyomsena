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
