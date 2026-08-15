export const manifest = {
  path: '/dispatch',
  name: 'Dispatch Control',
  title: 'Dispatch Board',
  icon: 'dispatch',
  order: 50,
  showInMenu: true,
  permissions: ['operations'],
  subtitle: 'Create planned flights that flow to the EFB (actuals) and FDTL (compliance) modules via the shared flight record.',
  breadcrumbs: ['Home', 'Dispatch Control'],
  html: 'modules/dispatch/dispatch.html',
  js: 'modules/dispatch/dispatch.js',
  css: 'modules/dispatch/dispatch.css'
};
