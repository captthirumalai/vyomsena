import { getMenuRoutesForUser } from '../shared/routes.js';
import { authStore } from '../stores/authStore.js';
import { themeStore } from '../stores/themeStore.js';

function query(selector) {
  return document.querySelector(selector);
}

function getUserLabel(user) {
  if (!user) return 'Secure operations dashboard';
  return `Signed in as ${user.name || user.email || user.uid}`;
}

function renderSidebar(user) {
  const nav = query('#app-sidebar-nav');
  if (!nav) return;

  const routes = getMenuRoutesForUser(user);
  if (!routes.length) {
    nav.innerHTML = '<p class="vs-sidebar-empty">No modules available for your role.</p>';
    return;
  }

  nav.innerHTML = routes
    .map(
      (route) => `
        <a href="#${route.path}" class="vs-sidebar-link" data-route="${route.path}" aria-label="${route.title || route.name}">
          <span class="vs-nav-icon">${route.icon || '•'}</span>
          <span>${route.title || route.name}</span>
        </a>
      `
    )
    .join('');
}

function updateUserPanel(user) {
  const label = query('#app-user');
  if (label) label.textContent = getUserLabel(user);
  renderSidebar(user);
}

function updateThemeButton(theme) {
  const button = query('#btn-theme-toggle');
  if (!button) return;
  button.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function setActiveSidebarLink(path) {
  document.querySelectorAll('.vs-sidebar-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `#${path}`);
  });
}

function initShellActions() {
  query('#btn-theme-toggle')?.addEventListener('click', () => {
    themeStore.toggleTheme();
  });
}

export function initLayout() {
  const app = document.getElementById('app');
  if (!app) return;

  const shell = `
    <div class="vs-shell">
      <aside class="vs-sidebar hidden" id="app-sidebar">
        <div class="vs-brand-panel">
          <div class="vs-brand-logo">V</div>
          <div>
            <span class="vs-brand-name">VyomSena</span>
            <p class="vs-brand-tag">Aviation Management System</p>
          </div>
        </div>

        <nav class="vs-sidebar-nav" id="app-sidebar-nav"></nav>

        <div class="vs-sidebar-footer">
          <button id="btn-signout-mobile" class="vs-button vs-button--secondary vs-button--sm">Sign out</button>
        </div>
      </aside>

      <div class="vs-main">
        <header class="vs-topbar hidden" id="app-topbar">
          <div class="vs-topbar-title">
            <div class="brand-copy">
              <h1>VAMS Portal</h1>
              <p id="app-user">Secure operations dashboard</p>
            </div>
            <div class="route-copy">
              <p class="route-label">Current section</p>
              <h2 id="app-route">Dashboard</h2>
              <nav class="route-breadcrumbs" aria-label="Breadcrumb">
                <ol id="app-breadcrumbs" class="breadcrumb-list"></ol>
              </nav>
            </div>
          </div>
          <div class="vs-topbar-actions">
            <button id="btn-theme-toggle" class="vs-button vs-button--secondary vs-button--sm" type="button">🌙</button>
            <button id="btn-logout" class="vs-button vs-button--secondary vs-button--sm">Sign Out</button>
          </div>
        </header>

        <div id="app-notification" class="vs-notification hidden"></div>

        <main class="vs-content">
          <section id="auth-view" class="vs-auth-shell">
            <div class="vs-auth-grid">
              <aside class="vs-hero-panel">
                <div class="vs-hero-overlay"></div>
                <div class="vs-hero-content">
                  <div class="logo-wrapper">
                    <img src="vams_logo.jpg" alt="VyomSena Logo" class="brand-logo" />
                    <span class="brand-title">VyomSena</span>
                  </div>
                  <h1 class="brand-tagline">Digital Aviation Operations Platform</h1>
                  <p class="brand-desc">Integrate operations, crew management, DGCA compliance, and fleet oversight into a single intelligent platform for aviation teams.</p>

                  <div class="features-list">
                    <div class="feature-item">
                      <span class="feature-icon">⌛</span>
                      <div>
                        <h3>Licence & Expiry Tracking</h3>
                        <p>Monitor pilot certifications, medicals and training currency in real time.</p>
                      </div>
                    </div>
                    <div class="feature-item">
                      <span class="feature-icon">✈️</span>
                      <div>
                        <h3>Fleet Operations</h3>
                        <p>Track aircraft status, inspections, dispatch readiness and maintenance cycles.</p>
                      </div>
                    </div>
                    <div class="feature-item">
                      <span class="feature-icon">✅</span>
                      <div>
                        <h3>Regulatory Compliance</h3>
                        <p>Stay aligned with DGCA audit readiness and safety oversight requirements.</p>
                      </div>
                    </div>
                  </div>

                  <div class="positioning-quote">
                    <p class="quote-text">"VyomSena transforms aviation administration into a modern, operational control center for crew, aircraft, and compliance."</p>
                  </div>
                </div>
              </aside>

              <div class="vs-form-panel">
                <div class="vs-form-inner">
                  <div class="vs-auth-card active" id="login-card">
                    <div class="card-heading">
                      <h2>Sign In</h2>
                      <p>Use your company workspace credentials to access VAMS. Pilots should use the Android app.</p>
                    </div>
                    <form id="login-form" class="auth-form">
                      <div class="input-group">
                        <label for="login-email">Email</label>
                        <input type="email" id="login-email" required placeholder="admin@airvyom.com" autocomplete="email" />
                      </div>
                      <div class="input-group">
                        <label for="login-password">Password</label>
                        <input type="password" id="login-password" required placeholder="••••••••" autocomplete="current-password" />
                      </div>
                      <div class="actions-row">
                        <label class="checkbox">
                          <input type="checkbox" id="login-remember" />
                          <span>Remember me</span>
                        </label>
                        <a href="#" id="go-recover" class="link-action">Forgot password?</a>
                      </div>
                      <div id="login-error" class="error-banner hidden"></div>
                      <button type="submit" class="vs-button vs-button--primary vs-button--md" id="btn-login-submit">
                        <span class="btn-text">Sign In</span>
                        <span class="btn-spinner hidden"></span>
                      </button>
                      <div class="auth-divider" aria-hidden="true"><span>or</span></div>
                      <button type="button" class="vs-button vs-button--secondary vs-button--md" id="btn-login-google">
                        <span class="btn-text">Continue with Google</span>
                        <span class="btn-spinner hidden"></span>
                      </button>
                    </form>
                    <div class="card-footer">
                      <span>Need a company workspace?</span>
                      <a href="#" id="go-register" class="link-action">Create workspace</a>
                    </div>
                  </div>

                  <div class="vs-auth-card" id="register-card">
                    <div class="card-heading">
                      <h2>Create Company Workspace</h2>
                      <p>Register your company operations workspace. Pilots continue to use the Android app and can be linked later.</p>
                    </div>
                    <form id="register-form" class="auth-form">
                      <div class="input-group">
                        <label for="reg-full-name">Primary Operations Contact</label>
                        <input type="text" id="reg-full-name" required placeholder="e.g. Captain Aryan Mehta" />
                      </div>
                      <div class="input-group">
                        <label for="reg-company-name">Company / Operator Name</label>
                        <input type="text" id="reg-company-name" required placeholder="e.g. VyomSena Aviation Pvt Ltd" />
                      </div>
                      <div class="input-group">
                        <label for="reg-org-type">Operator Category</label>
                        <select id="reg-org-type" required>
                          <option value="" selected disabled>Select operator category</option>
                          <option value="NSOP">NSOP</option>
                          <option value="Charter">Charter</option>
                          <option value="FTO">FTO</option>
                          <option value="Corporate">Corporate</option>
                          <option value="MRO">MRO/CAMO</option>
                          <option value="Government">Government</option>
                        </select>
                      </div>
                      <div class="input-group">
                        <label for="reg-company-code">Company Code</label>
                        <input type="text" id="reg-company-code" placeholder="Optional short code, e.g. VSA" />
                      </div>
                      <div class="input-group">
                        <label for="reg-base-location">Primary Base / HQ</label>
                        <input type="text" id="reg-base-location" required placeholder="e.g. Bengaluru / VOBL" />
                      </div>
                      <div class="input-group">
                        <label for="reg-contact-phone">Operations Contact Number</label>
                        <input type="tel" id="reg-contact-phone" required placeholder="e.g. +91 98765 43210" />
                      </div>
                      <div class="input-group">
                        <label for="reg-email">Company Login Email</label>
                        <input type="email" id="reg-email" required placeholder="ops@operator.com" />
                      </div>
                      <div class="input-group">
                        <label for="reg-password">Password</label>
                        <input type="password" id="reg-password" required placeholder="Min 8 characters" />
                      </div>
                      <div id="register-error" class="error-banner hidden"></div>
                      <button type="submit" class="vs-button vs-button--primary vs-button--md" id="btn-register-submit">
                        <span class="btn-text">Create workspace</span>
                        <span class="btn-spinner hidden"></span>
                      </button>
                    </form>
                    <div class="card-footer">
                      <span>Already have a company workspace?</span>
                      <a href="#" id="go-login" class="link-action">Sign in</a>
                    </div>
                  </div>

                  <div class="vs-auth-card" id="recover-card">
                    <div class="card-heading">
                      <h2>Recover Access</h2>
                      <p>Send a password reset link to your email.</p>
                    </div>
                    <form id="recover-form" class="auth-form">
                      <div class="input-group">
                        <label for="recover-email">Email</label>
                        <input type="email" id="recover-email" required placeholder="admin@yourcompany.com" />
                      </div>
                      <div id="recover-success" class="success-banner hidden">Password reset link sent.</div>
                      <button type="submit" class="vs-button vs-button--primary vs-button--md" id="btn-recover-submit">
                        <span class="btn-text">Send reset link</span>
                        <span class="btn-spinner hidden"></span>
                      </button>
                    </form>
                    <div class="card-footer">
                      <span>Remembered it?</span>
                      <a href="#" id="go-login-from-recover" class="link-action">Sign in</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="app-view" class="vs-app-view hidden">
            <div id="view"></div>
          </section>
        </main>

        <footer class="vs-footer hidden" id="app-footer">
          <p>VyomSena — Aviation Management System</p>
        </footer>
      </div>
    </div>
  `;

  app.innerHTML = shell;
  initShellActions();
  authStore.subscribe((state) => {
    updateUserPanel(state.user);
    setActiveSidebarLink(window.location.hash.replace('#', '') || '/dashboard');
  });
  themeStore.subscribe((state) => updateThemeButton(state.theme));

  window.addEventListener('hashchange', () => {
    setActiveSidebarLink(window.location.hash.replace('#', '') || '/dashboard');
  });
}
