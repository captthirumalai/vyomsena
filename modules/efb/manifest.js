export const manifest = {
  path: '/efb',
  name: 'Electronic Flight Bag',
  title: 'EFB Docs',
  icon: 'efb',
  order: 60,
  showInMenu: true,
  permissions: ['operations'],
  subtitle: 'Record actual flight details against dispatched flights. Actuals sync to Firestore and are evaluated by the FDTL module for compliance.',
  breadcrumbs: ['Home', 'Electronic Flight Bag'],
  html: 'modules/efb/efb.html',
  js: 'modules/efb/efb.js',
  css: 'modules/efb/efb.css'
};
