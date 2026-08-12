import { manifest as dashboardManifest } from '../modules/dashboard/manifest.js';
import { manifest as crewManifest } from '../modules/crew/manifest.js';
import { manifest as crewProfileManifest } from '../modules/crewprofile/manifest.js';
import { manifest as fdtlManifest } from '../modules/fdtl/manifest.js';
import { manifest as aiManifest } from '../modules/ai/manifest.js';
import { manifest as dispatchManifest } from '../modules/dispatch/manifest.js';
import { manifest as efbManifest } from '../modules/efb/manifest.js';
import { manifest as flightOpsManifest } from '../modules/flightops/manifest.js';
import { manifest as maintenanceManifest } from '../modules/maintenance/manifest.js';
import { manifest as notamManifest } from '../modules/notam/manifest.js';
import { manifest as reportsManifest } from '../modules/reports/manifest.js';
import { manifest as settingsManifest } from '../modules/settings/manifest.js';
import { manifest as smsManifest } from '../modules/sms/manifest.js';
import { manifest as trainingManifest } from '../modules/training/manifest.js';
import { manifest as weatherManifest } from '../modules/weather/manifest.js';

const normalizeRole = (role) => `${role || ''}`.trim().toLowerCase();

export const appRoutes = [
  dashboardManifest,
  crewManifest,
  crewProfileManifest,
  fdtlManifest,
  aiManifest,
  dispatchManifest,
  efbManifest,
  flightOpsManifest,
  maintenanceManifest,
  notamManifest,
  reportsManifest,
  settingsManifest,
  smsManifest,
  trainingManifest,
  weatherManifest
];

export const defaultRoute = '/dashboard';

export function getRouteByPath(path) {
  return appRoutes.find((route) => route.path === path);
}

export function canAccessRoute(route, user) {
  if (!route.permissions || route.permissions.length === 0) return true;
  if (!user) return false;
  const role = normalizeRole(user.role);
  return route.permissions.some((permission) => normalizeRole(permission) === role);
}

export function getMenuRoutesForUser(user) {
  return appRoutes
    .filter((route) => route.showInMenu !== false && canAccessRoute(route, user))
    .sort((left, right) => (left.order || 0) - (right.order || 0));
}
