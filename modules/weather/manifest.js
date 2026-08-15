export const manifest = {
  path: '/weather',
  name: 'Weather Briefing',
  title: 'Weather Desk',
  icon: 'weather',
  order: 140,
  showInMenu: true,
  permissions: ['operations'],
  subtitle: 'Operational weather posture using live dispatch constraints.',
  breadcrumbs: ['Home', 'Weather Briefing'],
  html: 'modules/weather/weather.html',
  js: 'modules/weather/weather.js',
  css: 'modules/weather/weather.css'
};
