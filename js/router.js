import { appRoutes, defaultRoute } from '../shared/routes.js';

async function loadModuleHtml(route) {
  try {
    const response = await fetch(route.html, { cache: 'no-store' });
    if (!response.ok) throw new Error('Module HTML not found');
    return await response.text();
  } catch (error) {
    console.warn('Module HTML load failed:', error);
    return `<section class="card"><h2>Module load failed</h2><p>Unable to load ${route.name}. Please refresh or try again later.</p></section>`;
  }
}

async function loadModuleCss(route) {
  if (!route.css) return;

  const existingLink = document.querySelector('link[data-module-css]');
  if (existingLink) {
    existingLink.remove();
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = route.css;
  link.dataset.moduleCss = route.path;
  document.head.appendChild(link);
}

async function importModuleJs(route) {
  if (!route.js) return;

  try {
    const module = await import(`../${route.js}`);
    return module;
  } catch (error) {
    console.warn('Failed to import module JS:', error);
    return null;
  }
}

let activeModule = null;

function cleanupActiveModule() {
  if (activeModule && typeof activeModule.destroy === 'function') {
    activeModule.destroy();
  }
  activeModule = null;
}

function getRouteFromHash() {
  const hash = window.location.hash.replace('#', '') || defaultRoute;
  return appRoutes.find((route) => route.path === hash) || appRoutes.find((route) => route.path === defaultRoute);
}

export async function initRouter() {
  const view = document.getElementById('view');
  if (!view) return;

  async function render() {
    const route = getRouteFromHash();
    if (!route) return;

    await loadModuleCss(route);
    const html = await loadModuleHtml(route);
    view.innerHTML = html;

    const module = await importModuleJs(route);
    cleanupActiveModule();

    if (module) {
      const routeInitName = `init${route.name.replace(/\s+/g, '')}`;
      const initFn =
        module.init ||
        module.default?.init ||
        (typeof module.default === 'function' ? module.default : null) ||
        module[routeInitName];

      if (typeof initFn === 'function') {
        const moduleInstance = initFn(view);
        if (moduleInstance && typeof moduleInstance.destroy === 'function') {
          activeModule = moduleInstance;
        }
      } else {
        console.warn(`Route module for ${route.name} has no init function`);
      }
    }

    const appRouteLabel = document.getElementById('app-route');
    if (appRouteLabel) {
      appRouteLabel.textContent = route.title || route.name;
    }

    const breadcrumbContainer = document.getElementById('app-breadcrumbs');
    if (breadcrumbContainer) {
      const crumbs = route.breadcrumbs || ['Home', route.name];
      breadcrumbContainer.innerHTML = crumbs
        .map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return `<li class="breadcrumb-item${isLast ? ' active' : ''}" aria-current="${isLast ? 'page' : 'false'}">${crumb}</li>`;
        })
        .join('');
    }

    document.title = `${route.title || route.name} — VAMS Portal`;

    document.querySelectorAll('.vs-sidebar-link').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${route.path}`);
    });
  }

  window.addEventListener('hashchange', render);
  await render();
}
