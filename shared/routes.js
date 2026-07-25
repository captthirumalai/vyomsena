import { manifest as dashboardManifest } from '../modules/dashboard/manifest.js';
import { manifest as crewManifest } from '../modules/crew/manifest.js';
import { manifest as aircraftManifest } from '../modules/aircraft/manifest.js';

const normalizeRole = (role) => `${role || ''}`.trim().toLowerCase();

export const appRoutes = [
  dashboardManifest,
  crewManifest,
  aircraftManifest
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
