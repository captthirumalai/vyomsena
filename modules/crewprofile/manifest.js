export const manifest = {
  path: '/crew-profile',
  name: 'Crew Profile',
  title: 'Crew Profile',
  icon: 'crew',
  order: 21,
  category: 'people',
  showInMenu: true,
  grantable: false,
  permissions: ['operations', 'pilot'],
  subtitle: 'Loading crew profile...',
  breadcrumbs: ['Home', 'Crew Licenses', 'Profile'],
  html: 'modules/crewprofile/crewprofile.html',
  js: 'modules/crewprofile/crewprofile.js',
  css: 'modules/crewprofile/crewprofile.css'
};
