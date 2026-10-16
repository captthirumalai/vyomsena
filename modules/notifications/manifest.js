export const manifest = {
  path: '/notifications',
  name: 'Notifications',
  title: 'Notification Centre',
  icon: 'notifications',
  order: 106,
  showInMenu: true,
  permissions: ['admin', 'operations'],
  subtitle: 'Manage everyday expiry reminder mails: schedule, lead time, recipients, tests and history.',
  breadcrumbs: ['Home', 'Notifications'],
  html: 'modules/notifications/notifications.html',
  js: 'modules/notifications/centre.js',
  css: 'modules/notifications/notifications.css'
};
