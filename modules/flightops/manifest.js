export const manifest = {
  path: '/flightops',
  name: 'Flight Operations',
  title: 'Flight Ops',
  icon: 'flight',
  order: 70,
  showInMenu: true,
  permissions: ['operations'],
  subtitle: 'Track active flights, status updates, and turnaround metrics.',
  breadcrumbs: ['Home', 'Flight Operations'],
  html: 'modules/flightops/flightops.html',
  js: 'modules/flightops/flightops.js',
  css: 'modules/flightops/flightops.css'
};
