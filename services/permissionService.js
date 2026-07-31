const ROLE_ADMIN = 'ADMIN';
const ROLE_OPERATIONS = 'OPERATIONS';
const ROLE_PILOT = 'PILOT';
const ROLE_TRAINING = 'TRAINING';
const ROLE_AME = 'AME';

const CREW_ACTIONS = {
  view: new Set([ROLE_ADMIN, ROLE_OPERATIONS, ROLE_PILOT, ROLE_TRAINING, ROLE_AME]),
  edit: new Set([ROLE_ADMIN, ROLE_OPERATIONS]),
  delete: new Set([ROLE_ADMIN, ROLE_OPERATIONS]),
  approve: new Set([ROLE_ADMIN, ROLE_OPERATIONS]),
  uploadSelfDocument: new Set([ROLE_ADMIN, ROLE_OPERATIONS, ROLE_PILOT]),
  manageLinkRequests: new Set([ROLE_ADMIN, ROLE_OPERATIONS]),
  respondIncomingRequest: new Set([ROLE_PILOT])
};

function normalizeRole(role) {
  return `${role || ''}`.trim().toUpperCase();
}

function canRolePerform(action, role) {
  const allowed = CREW_ACTIONS[action];
  if (!allowed) return false;
  return allowed.has(normalizeRole(role));
}

export function canPerformCrewAction(user, action) {
  return canRolePerform(action, user?.role);
}

export function getCrewPermissionsForUser(user) {
  const role = normalizeRole(user?.role);
  return {
    role,
    canView: canRolePerform('view', role),
    canEdit: canRolePerform('edit', role),
    canDelete: canRolePerform('delete', role),
    canApprove: canRolePerform('approve', role),
    canUploadSelfDocument: canRolePerform('uploadSelfDocument', role),
    canManageLinkRequests: canRolePerform('manageLinkRequests', role),
    canRespondIncomingRequest: canRolePerform('respondIncomingRequest', role)
  };
}
