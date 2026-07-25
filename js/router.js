import { appConfig } from '../config/app.config.js';
import { initDashboard } from '../modules/dashboard/dashboard.js';
import { initCrew } from '../modules/crew/crew.js';
import { initAircraft } from '../modules/aircraft/aircraft.js';

const routes = {
  '/dashboard': {
    file: 'modules/dashboard/dashboard.html',
    init: initDashboard,
    fallback: `<section class="card"><h2>Dashboard</h2><p>Welcome to the dashboard module.</p></section><section class="card"><h3>Operations Summary</h3><p>Active flights: 12</p><p>Pending maintenance: 3</p></section>`
  },
  '/crew': {
    file: 'modules/crew/crew.html',
    init: initCrew,
    fallback: `<section class="card"><h2>Crew</h2><p>Manage crew records here.</p></section><section class="card"><h3>Crew Status</h3><p>On duty: 18</p><p>Resting: 7</p></section>`
  },
  '/aircraft': {
    file: 'modules/aircraft/aircraft.html',
    init: initAircraft,
    fallback: `<section class="card"><h2>Aircraft</h2><p>Manage fleet and aircraft data here.</p></section><section class="card"><h3>Fleet Snapshot</h3><p>Aircraft in service: 24</p><p>Maintenance due: 2</p></section>`
  }
};

async function loadModuleHtml(route) {
  try {
    const response = await fetch(route.file, { cache: 'no-store' });
    if (!response.ok) throw new Error('Module not found');
    return await response.text();
  } catch (error) {
    console.warn('Falling back to embedded module content:', error);
    return route.fallback;
  }
}

export async function initRouter() {
  const view = document.getElementById('view');
  if (!view) return;

  const render = async () => {
    const hash = window.location.hash.replace('#', '') || appConfig.defaultRoute;
    const route = routes[hash] || routes[appConfig.defaultRoute];

    const html = await loadModuleHtml(route);
    view.innerHTML = html;
    route.init(view);
  };

  window.addEventListener('hashchange', render);
  await render();
}
