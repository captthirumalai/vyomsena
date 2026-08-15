import { appRoutes, defaultRoute, canAccessRoute } from '../shared/routes.js';
import { authStore, themeStore } from '../stores/index.js';
import { emit as emitEvent } from '../services/eventBus.js';
import { clearModuleActions, setModuleSubtitle } from '../shared/moduleHeader.js';

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

    clearModuleActions();

    const user = authStore.user;
    if (!canAccessRoute(route, user)) {
      view.innerHTML = `<section class="card"><h2>Access denied</h2><p>You do not have permission to access ${route.title || route.name}.</p></section>`;
      emitEvent('navigation:after', { route, user, authorized: false });
      return;
    }

    emitEvent('navigation:before', { route, user });
    await loadModuleCss(route);
    const html = await loadModuleHtml(route);
    view.innerHTML = html;

    const appRouteLabel = document.getElementById('app-route');
    if (appRouteLabel) {
      appRouteLabel.textContent = route.title || route.name;
    }

    setModuleSubtitle(route.subtitle || '');

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

    const module = await importModuleJs(route);
    cleanupActiveModule();

    const context = {
      currentUser: authStore.user,
      stores: {
        authStore,
        themeStore
      },
      route,
      router: {
        navigate(path) {
          window.location.hash = `#${path}`;
        },
        currentPath: route.path
      }
    };

    if (module) {
      const routeInitName = `init${route.name.replace(/\s+/g, '')}`;
      const initFn =
        module.init ||
        module.default?.init ||
        (typeof module.default === 'function' ? module.default : null) ||
        module[routeInitName];

      if (typeof initFn === 'function') {
        const moduleInstance = await initFn(view, context);
        if (moduleInstance && typeof moduleInstance.destroy === 'function') {
          activeModule = moduleInstance;
        }
      } else {
        console.warn(`Route module for ${route.name} has no init function`);
      }
    }

    emitEvent('navigation:after', { route, user, authorized: true });

    document.querySelectorAll('.vs-sidebar-link').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${route.path}`);
    });
  }

  window.addEventListener('hashchange', render);
  await render();
}
