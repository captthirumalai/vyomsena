export const manifest = {
  path: '/dashboard',
  name: 'Dashboard',
  title: 'Operations Dashboard',
  icon: 'dashboard',
  order: 10,
  showInMenu: true,
  permissions: ['operations'],
  subtitle: 'Monitoring fleet, crew, and compliance from Firestore.',
  breadcrumbs: ['Home', 'Dashboard'],
  html: 'modules/dashboard/dashboard.html',
  js: 'modules/dashboard/dashboard.js',
  css: 'modules/dashboard/dashboard.css'
};
