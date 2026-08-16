import { getMenuRoutesForUser } from '../shared/routes.js';
import { authStore } from '../stores/authStore.js';
import { themeStore } from '../stores/themeStore.js';
import { appConfig } from '../config/app.config.js';
import { openUserProfileEditor } from '../shared/userProfileEditor.js';

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
          <span>${route.title || route.name}</span>
        </a>
      `
    )
    .join('');
}

function updateUserPanel(user) {
  const label = query('#app-user');
  if (label) label.textContent = getUserLabel(user);
  const userInfoName = query('#btn-user-info-name');
  if (userInfoName) userInfoName.textContent = user?.name || user?.email || 'User';
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

  query('#btn-user-info')?.addEventListener('click', () => {
    openUserProfileEditor(authStore.user);
  });

  const shellEl = query('#app-shell');
  const menuButton = query('#btn-menu-toggle');
  const backdrop = query('#app-sidebar-backdrop');

  function setSidebarOpen(open) {
    shellEl?.classList.toggle('sidebar-open', open);
    menuButton?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('sidebar-lock', open);
  }

  menuButton?.addEventListener('click', () => {
    setSidebarOpen(!shellEl?.classList.contains('sidebar-open'));
  });

  backdrop?.addEventListener('click', () => {
    setSidebarOpen(false);
  });
}

export function initLayout() {
  const app = document.getElementById('app');
  if (!app) return;

  const shell = `
    <div class="vs-shell auth-mode" id="app-shell">
      <div class="vs-sidebar-backdrop" id="app-sidebar-backdrop" aria-hidden="true"></div>
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
            <button id="btn-menu-toggle" class="vs-icon-btn vs-btn-menu" type="button" aria-label="Toggle navigation" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <div class="brand-copy">
              <h1>VAMS Portal</h1>
              <p id="app-user">Secure operations dashboard</p>
            </div>
          </div>
          <div class="vs-module-header">
            <nav class="vs-module-breadcrumb" aria-label="Breadcrumb">
              <ol id="app-breadcrumbs" class="breadcrumb-list"></ol>
            </nav>
            <div class="vs-module-header-row">
              <h2 id="app-route">Dashboard</h2>
              <p id="app-route-subtitle" class="vs-module-subtitle"></p>
            </div>
          </div>
          <div class="vs-topbar-actions">
            <div id="app-module-actions" class="vs-module-actions"></div>
            <div class="vs-topbar-user-actions">
              <button id="btn-theme-toggle" class="vs-button vs-button--secondary vs-button--sm" type="button">🌙</button>
              <button id="btn-user-info" class="vs-button vs-button--secondary vs-button--sm" type="button">
                <span class="vs-user-icon">👤</span>
                <span class="vs-user-info-name" id="btn-user-info-name">User</span>
              </button>
              <button id="btn-logout" class="vs-button vs-button--secondary vs-button--sm">Sign Out</button>
            </div>
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
                    <span class="hero-kicker hero-kicker-muted">Made by a pilot · for the pilots</span>
                  </div>

                  <div class="logo-wrapper">
                    <img src="vams_logo.jpg" alt="VyomSena Logo" class="brand-logo" />
                    <div>
                      <span class="brand-title">VyomSena</span>
                      <p class="brand-subtitle">Aviation operations management for operators, compliance teams, and flight operations.</p>
                    </div>
                  </div>

                  <div class="hero-headline-block">
                    <h1 class="brand-tagline">Run aviation company operations from one command surface.</h1>
                    <p class="brand-desc">VyomSena is building practical aviation technology for pilots, operators and aviation teams — bringing crew compliance, documents, operational readiness and flight information into one connected workspace.</p>
                  </div>

                  <div class="hero-metrics">
                    <div class="hero-metric-card">
                      <strong>Real-time operational visibility</strong>
                      <span>Crew and profile updates stay synchronized so teams can work from current operational information.</span>
                    </div>
                    <div class="hero-metric-card">
                      <strong>One source of truth</strong>
                      <span>Keep crew records, documents and operational information connected instead of scattered across spreadsheets, folders and messages.</span>
                    </div>
                    <div class="hero-metric-card">
                      <strong>Compliance visibility</strong>
                      <span>Track crew compliance, document status, training and operational records with a clear history of changes.</span>
                    </div>
                  </div>

                  <div class="features-list">
                    <div class="feature-item">
                      <span class="feature-icon">01</span>
                      <div>
                        <h3>Crew Compliance Command</h3>
                        <p>Track licence validity, medicals, required documents and pilot-readiness exceptions without spreadsheet-driven follow-up.</p>
                      </div>
                    </div>
                    <div class="feature-item">
                      <span class="feature-icon">02</span>
                      <div>
                        <h3>Company Document Control</h3>
                        <p>Manage shared crew records, operator visibility and time-sensitive renewals from one workspace.</p>
                      </div>
                    </div>
                    <div class="feature-item">
                      <span class="feature-icon">03</span>
                      <div>
                        <h3>Operational Readiness</h3>
                        <p>Bring dispatch, flight documents and operator-side information together around the operational record.</p>
                      </div>
                    </div>
                  </div>

                  <div class="hero-bottom-grid">
                    <div class="positioning-quote">
                      <p class="quote-label">Why this exists</p>
                      <p class="quote-text">Aviation operations generate information across licences, crew records, documents, training, flights and compliance workflows. VyomSena exists to bring these fragmented workflows into a connected operational workspace.</p>
                    </div>
                    <div class="founder-card">
                      <p class="quote-label">Built by a pilot</p>
                      <h3>Capt. Thirumalai Kumaran</h3>
                      <p>An airline pilot with more than a decade of NSOP operational experience, who experienced this operational problem first and began building VyomSena around the way aviation teams actually work. The objective is not to replace aviation expertise with software, but to give aviation professionals better tools to manage the information around their operations.</p>
                    </div>
                    <div class="pilot-callout-card">
                      <p class="pilot-callout-label">Pilot Access</p>
                      <h3>Pilots use the Android app</h3>
                      <p>Pilots use the Android app to manage their own aviation records and, where connected to an operator, access company-linked workflows.</p>
                    </div>
                    <div class="coming-soon-card">
                      <p class="pilot-callout-label">Coming Soon <span class="soon-badge">Under development</span></p>
                      <h3>Handheld e-ink EFB</h3>
                      <p>Purpose-built electronic flight bag technology for cockpit and ramp use — designed around practical operational workflows.</p>
                    </div>
                  </div>

                  <div class="hero-mission">
                    <div class="mission-card">
                      <p class="quote-label">Our Mission</p>
                      <h3>Make aviation operations more organised, connected and accessible</h3>
                      <p>Through practical technology — while keeping safety, compliance and operational simplicity at the centre.</p>
                    </div>
                    <div class="mission-card">
                      <p class="quote-label">Our Vision</p>
                      <h3>A connected digital operating environment for aviation</h3>
                      <p>Where pilots, operators, training teams and operational information can work together through one reliable platform.</p>
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
          <span class="vs-release-chip" id="app-release-chip">${appConfig.releaseVersion || 'V2.x'}</span>
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
    const shellEl = query('#app-shell');
    if (shellEl?.classList.contains('sidebar-open')) {
      shellEl.classList.remove('sidebar-open');
      query('#btn-menu-toggle')?.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('sidebar-lock');
    }
  });
}
