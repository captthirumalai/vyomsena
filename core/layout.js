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
    <div class="vs-shell auth-mode" id="app-shell">
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
                  <div class="hero-kicker-row">
                    <span class="hero-kicker">Company Workspace</span>
                    <span class="hero-kicker hero-kicker-muted">Live crew and compliance control</span>
                  </div>

                  <div class="logo-wrapper">
                    <img src="vams_logo.jpg" alt="VyomSena Logo" class="brand-logo" />
                    <div>
                      <span class="brand-title">VyomSena</span>
                      <p class="brand-subtitle">Aviation management for operators, compliance teams, and flight operations.</p>
                    </div>
                  </div>

                  <div class="hero-headline-block">
                    <h1 class="brand-tagline">Run aviation company workflows from one operational control surface.</h1>
                    <p class="brand-desc">Coordinate crew validity, fleet readiness, document sharing, and audit-critical oversight from a single workspace built for operator teams with AI-enhanced capability.</p>
                  </div>

                  <div class="hero-metrics">
                    <div class="hero-metric-card">
                      <strong>Real-time</strong>
                      <span>Document and profile updates sync instantly with the pilot app.</span>
                    </div>
                    <div class="hero-metric-card">
                      <strong>Shared source</strong>
                      <span>Web and Android use one Firebase-backed contract for crew compliance data.</span>
                    </div>
                    <div class="hero-metric-card">
                      <strong>Audit-ready</strong>
                      <span>Centralize expiry tracking, trainings, operator linkage, and regulated document change history.</span>
                    </div>
                  </div>

                  <div class="features-list">
                    <div class="feature-item">
                      <span class="feature-icon">01</span>
                      <div>
                        <h3>Crew Compliance Command</h3>
                        <p>Track licence validity, medicals, and pilot-readiness exceptions without spreadsheet drift.</p>
                      </div>
                    </div>
                    <div class="feature-item">
                      <span class="feature-icon">02</span>
                      <div>
                        <h3>Company Document Control</h3>
                        <p>Manage shared crew records, operator visibility, and time-sensitive renewals from one web workspace.</p>
                      </div>
                    </div>
                    <div class="feature-item">
                      <span class="feature-icon">03</span>
                      <div>
                        <h3>Operational Readiness</h3>
                        <p>Build the foundation for dispatch, flight documents, and operator-side oversight modules in a single system.</p>
                      </div>
                    </div>
                  </div>

                  <div class="hero-bottom-grid">
                    <div class="positioning-quote">
                      <p class="quote-label">Why this exists</p>
                      <p class="quote-text">VyomSena turns fragmented aviation administration into a single, operator-grade command layer for crew, documents, and compliance visibility.</p>
                    </div>
                    <div class="pilot-callout-card">
                      <p class="pilot-callout-label">Pilot Access</p>
                      <h3>Pilots use the Android app</h3>
                      <p>Individual and company-linked pilots access their workflows on mobile. This web workspace is reserved for company-side operations teams.</p>
                    </div>
                  </div>
                </div>
              </aside>

              <div class="vs-form-panel">
                <div class="vs-form-inner">
                  <div class="vs-auth-card active" id="login-card">
                    <div class="auth-panel-badge">Operations Workspace</div>
                    <div class="card-heading">
                      <h2>Sign In</h2>
                      <p>Access your company workspace for crew oversight, compliance tracking, and operational coordination.</p>
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
                    <div class="auth-side-note">
                      <strong>Pilot account?</strong>
                      <span>Use the Android app for personal and company-linked pilot workflows.</span>
                    </div>
                    <div class="card-footer">
                      <span>Need a company workspace?</span>
                      <a href="#" id="go-register" class="link-action">Create workspace</a>
                    </div>
                  </div>

                  <div class="vs-auth-card" id="register-card">
                    <div class="auth-panel-badge">Workspace Setup</div>
                    <div class="card-heading">
                      <h2>Create Company Workspace</h2>
                      <p>Set up your operator workspace with the details your operations team needs from day one. Pilots can be linked later through the mobile-first flow.</p>
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
                    <div class="auth-panel-badge">Access Recovery</div>
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
