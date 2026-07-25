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

        <nav class="vs-sidebar-nav">
          <a href="#/dashboard" class="vs-sidebar-link">Dashboard</a>
          <a href="#/crew" class="vs-sidebar-link">Crew</a>
          <a href="#/aircraft" class="vs-sidebar-link">Aircraft</a>
        </nav>

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
            <button id="btn-logout" class="vs-button vs-button--secondary vs-button--sm">Sign Out</button>
          </div>
        </header>

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
                      <p>Use your organization credentials to access VAMS.</p>
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
                    </form>
                    <div class="card-footer">
                      <span>New to VAMS?</span>
                      <a href="#" id="go-register" class="link-action">Create workspace</a>
                    </div>
                  </div>

                  <div class="vs-auth-card" id="register-card">
                    <div class="card-heading">
                      <h2>Create Workspace</h2>
                      <p>Register your organization and admin account.</p>
                    </div>
                    <form id="register-form" class="auth-form">
                      <div class="input-group">
                        <label for="reg-org-name">Organization Name</label>
                        <input type="text" id="reg-org-name" required placeholder="e.g. AeroLink Charter Services" />
                      </div>
                      <div class="input-group">
                        <label for="reg-org-type">Operator Category</label>
                        <select id="reg-org-type" required>
                          <option value="" disabled selected>Select type</option>
                          <option value="NSOP">NSOP</option>
                          <option value="Charter">Charter</option>
                          <option value="FTO">FTO</option>
                          <option value="Corporate">Corporate</option>
                          <option value="MRO">MRO/CAMO</option>
                          <option value="Government">Government</option>
                        </select>
                      </div>
                      <div class="input-group">
                        <label for="reg-email">Email</label>
                        <input type="email" id="reg-email" required placeholder="admin@operator.com" />
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
                      <span>Already registered?</span>
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
      </div>
    </div>
  `;

  app.innerHTML = shell;
}
