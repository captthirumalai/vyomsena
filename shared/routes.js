import { manifest as dashboardManifest } from '../modules/dashboard/manifest.js';
import { manifest as crewManifest } from '../modules/crew/manifest.js';
import { manifest as aircraftManifest } from '../modules/aircraft/manifest.js';

export const appRoutes = [
  dashboardManifest,
  crewManifest,
  aircraftManifest
];

export const defaultRoute = '/dashboard';
