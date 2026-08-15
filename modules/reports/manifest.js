export const manifest = {
  path: '/reports',
  name: 'Reports',
  title: 'Reports Hub',
  icon: 'reports',
  order: 100,
  showInMenu: true,
  permissions: ['admin', 'operations', 'training'],
  subtitle: 'Generate and review fleet, crew, and compliance reports.',
  breadcrumbs: ['Home', 'Reports'],
  html: 'modules/reports/reports.html',
  js: 'modules/reports/reports.js',
  css: 'modules/reports/reports.css'
};
