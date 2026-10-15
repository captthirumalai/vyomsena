import { appRoutes, defaultRoute, canAccessRoute } from '../shared/routes.js';
import { authStore, themeStore } from '../stores/index.js';
import { emit as emitEvent } from '../services/eventBus.js';
import { clearModuleActions, setModuleSubtitle } from '../shared/moduleHeader.js';
import { appConfig } from '../config/app.config.js';

// Version-pinned asset URLs: module JS/CSS are cached per release, so a new
// deploy can never keep executing a stale (or truncated mid-deploy) copy.
const assetSuffix = `v=${encodeURIComponent(appConfig.releaseVersion || 'dev')}`;

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
  link.href = `${route.css}?${moduleSuffix()}`;
  link.dataset.moduleCss = route.path;
  document.head.appendChild(link);
}

async function importModuleJs(route) {
  if (!route.js) return;

  try {
    const module = await import(`../${route.js}?${moduleSuffix()}`);
    return module;
  } catch (firstError) {
    // A stale or truncated cached copy can fail to parse; retry once
    // bypassing the HTTP cache before giving up, so one poisoned entry
    // can never wedge a module permanently.
    try {
      return await import(`../${route.js}?${moduleSuffix()}&retry=${Date.now()}`);
    } catch (error) {
      console.warn('Failed to import module JS:', error);
      return { __loadError: error };
    }
  }
}

let activeModule = null;
let renderCounter = 0;
let loadGeneration = 0;

function moduleSuffix() {
  return `${assetSuffix}&gen=${loadGeneration}`;
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function moduleErrorCard(route, user, title, detail) {
  return `<section class="card">
    <h2>${escapeHtml(route.title || route.name)} failed to load</h2>
    <p>${escapeHtml(title)}</p>
    <p class="muted">App ${escapeHtml(appConfig.releaseVersion || '')} · signed in as ${escapeHtml(user?.uid || 'unknown')} (${escapeHtml(user?.role || 'no role')})</p>
    <p class="muted">Detail: ${escapeHtml(detail || 'no detail')}</p>
    <button type="button" id="route-retry" class="vs-button vs-button--primary">Retry fresh load</button>
  </section>`;
}

function cleanupActiveModule() {
  if (activeModule && typeof activeModule.destroy === 'function') {
    activeModule.destroy();
  }
  activeModule = null;
}

export function destroyActiveModule() {
  cleanupActiveModule();
}

function getRouteFromHash() {
  const hash = window.location.hash.replace('#', '') || defaultRoute;
  return appRoutes.find((route) => route.path === hash) || appRoutes.find((route) => route.path === defaultRoute);
}

export async function initRouter() {
  const view = document.getElementById('view');
  if (!view) return;

  async function render() {
    const renderId = ++renderCounter;
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
    if (renderId !== renderCounter) return;
    const html = await loadModuleHtml(route);
    if (renderId !== renderCounter) return;
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
    if (renderId !== renderCounter) return;

    const wireRetry = () => {
      view.querySelector('#route-retry')?.addEventListener('click', () => {
        loadGeneration += 1;
        render();
      });
    };

    if (module?.__loadError) {
      cleanupActiveModule();
      const detail = module.__loadError?.message || `${module.__loadError}`;
      view.innerHTML = moduleErrorCard(route, user, 'The module file could not be loaded. This is usually a stuck browser cache — retry forces a fresh load.', detail);
      wireRetry();
      return;
    }

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
        try {
          const moduleInstance = await initFn(view, context);
          if (renderId !== renderCounter) {
            if (moduleInstance && typeof moduleInstance.destroy === 'function') {
              moduleInstance.destroy();
            }
            return;
          }
          if (moduleInstance && typeof moduleInstance.destroy === 'function') {
            activeModule = moduleInstance;
          }
        } catch (initError) {
          console.error(`Module init failed for ${route.name}:`, initError);
          if (renderId !== renderCounter) return;
          cleanupActiveModule();
          view.innerHTML = moduleErrorCard(
            route,
            user,
            'The module started but crashed during setup. Nothing on this page is live.',
            initError?.message || `${initError}`
          );
          wireRetry();
          return;
        }
      } else {
        console.warn(`Route module for ${route.name} has no init function`);
      }
    }

    if (renderId !== renderCounter) return;

    emitEvent('navigation:after', { route, user, authorized: true });

    document.querySelectorAll('.vs-sidebar-link').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${route.path}`);
    });
  }

  window.addEventListener('hashchange', render);
  await render();
}
