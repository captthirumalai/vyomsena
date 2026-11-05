export const manifest = {
  path: '/training',
  name: 'Training',
  title: 'Training Center',
  icon: 'training',
  order: 30,
  category: 'people',
  showInMenu: true,
  permissions: ['training', 'training_center', 'operations'],
  subtitle: 'Live training center, offering, and booking data from Firestore.',
  breadcrumbs: ['Home', 'Training'],
  html: 'modules/training/training.html',
  js: 'modules/training/training.js',
  css: 'modules/training/training.css'
};
