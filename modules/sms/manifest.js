export const manifest = {
  path: '/sms',
  name: 'Safety Management',
  title: 'Safety (SMS)',
  icon: 'sms',
  order: 30,
  category: 'compliance',
  showInMenu: true,
  permissions: ['admin', 'operations'],
  subtitle: 'Record safety observations and monitor mitigation actions.',
  breadcrumbs: ['Home', 'Safety Management'],
  html: 'modules/sms/sms.html',
  js: 'modules/sms/sms.js',
  css: 'modules/sms/sms.css'
};
