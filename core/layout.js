export function initLayout() {
  const app = document.getElementById('app');
  if (!app) return;

  const shell = `
    <div class="landing-page">
      <section class="landing-hero">
        <div class="hero-top">
          <span class="hero-badge">Next-gen aviation operations</span>
          <h1 class="hero-title">Aviation management, crew control and DGCA compliance in one secure portal.</h1>
          <p class="hero-text">VyomSena V2 gives operators an elegant landing experience with Firestore-backed authentication and a modular operations shell.</p>
        </div>

        <div class="hero-cards">
          <article class="feature-card">
            <h3>Secure access with Firestore auth</h3>
            <p>Sign in with email, create new operations workspaces, and manage passwords with Firebase Authentication and Firestore user profiles.</p>
          </article>
          <article class="feature-card">
            <h3>Fleet, crew and compliance</h3>
            <p>Bring aircraft status, crew records and audit readiness into one cloud dashboard built for aviation teams.</p>
          </article>
          <article class="feature-card">
            <h3>Modern operations UI</h3>
            <p>Responsive design, clean navigation, and fast routing keep your team moving from dashboard to crew to aircraft views.</p>
          </article>
        </div>
      </section>

      <aside class="auth-panel">
        <div class="auth-intro">
          <div class="brand-row">
            <img src="vams_logo.jpg" alt="VyomSena Logo" class="brand-icon" />
            <span class="brand-name">VyomSena</span>
          </div>
          <h2>Welcome to VAMS V2</h2>
          <p>Sign in to continue, onboard your organization, or recover access securely.</p>
        </div>

        <div id="auth-view" class="auth-container active">
          <div id="login-card" class="auth-card active">
            <div class="card-heading">
              <h2>Sign In</h2>
              <p>Enter your corporate credentials to access the operations portal.</p>
            </div>

            <form id="login-form" class="auth-form">
              <div class="input-group">
                <label for="login-email">Corporate Email</label>
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
                <a href="#" id="go-recover" class="link-action">Forgot Password?</a>
              </div>

              <div id="login-error" class="error-banner hidden"></div>

              <button type="submit" class="btn btn-primary" id="btn-login-submit">
                <span class="btn-text">Sign In</span>
                <span class="btn-spinner hidden"></span>
              </button>
            </form>

            <div class="card-footer">
              <span>New to VAMS?</span>
              <a href="#" id="go-register" class="link-action">Create an organization</a>
            </div>
          </div>

          <div id="register-card" class="auth-card">
            <div class="card-heading">
              <h2>Create Workspace</h2>
              <p>Register your organization and administration account.</p>
            </div>

            <form id="register-form" class="auth-form">
              <div class="input-group">
                <label for="reg-org-name">Organization Name</label>
                <input type="text" id="reg-org-name" required placeholder="e.g., AeroLink Charter Services" />
              </div>

              <div class="input-group">
                <label for="reg-org-type">Operator Category</label>
                <select id="reg-org-type" required>
                  <option value="" disabled selected>Select Organization Type</option>
                  <option value="NSOP">Non-Scheduled Operator (NSOP)</option>
                  <option value="Charter">Charter Operator</option>
                  <option value="FTO">Flying Training Organization (FTO)</option>
                  <option value="Corporate">Corporate Flight Department</option>
                  <option value="MRO">Maintenance Organization (MRO/CAMO)</option>
                  <option value="Government">Government Aviation Agency</option>
                </select>
              </div>

              <div class="input-group">
                <label for="reg-email">Administrator Email</label>
                <input type="email" id="reg-email" required placeholder="admin@operator.com" />
              </div>

              <div class="input-group">
                <label for="reg-password">Password</label>
                <input type="password" id="reg-password" required placeholder="Min 8 characters" />
              </div>

              <div id="register-error" class="error-banner hidden"></div>

              <button type="submit" class="btn btn-primary" id="btn-register-submit">
                <span class="btn-text">Create Workspace</span>
                <span class="btn-spinner hidden"></span>
              </button>
            </form>

            <div class="card-footer">
              <span>Already have an account?</span>
              <a href="#" id="go-login" class="link-action">Return to sign in</a>
            </div>
          </div>

          <div id="recover-card" class="auth-card">
            <div class="card-heading">
              <h2>Recover Access</h2>
              <p>Send a password reset link to your account.</p>
            </div>

            <form id="recover-form" class="auth-form">
              <div class="input-group">
                <label for="recover-email">Email Address</label>
                <input type="email" id="recover-email" required placeholder="admin@yourcompany.com" />
              </div>

              <div id="recover-success" class="success-banner hidden">Password reset link sent. Check your inbox.</div>

              <button type="submit" class="btn btn-primary" id="btn-recover-submit">
                <span class="btn-text">Send Reset Link</span>
                <span class="btn-spinner hidden"></span>
              </button>
            </form>

            <div class="card-footer">
              <span>Remembered your password?</span>
              <a href="#" id="go-login-from-recover" class="link-action">Back to sign in</a>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <section id="app-shell" class="app-shell hidden">
      <header class="app-header">
        <div class="brand-group">
          <img src="vams_logo.jpg" alt="VyomSena logo" />
          <div class="brand-copy">
            <h1>VAMS Portal</h1>
            <p id="app-user">Secure operations dashboard</p>
          </div>
        </div>

        <div class="header-actions">
          <nav class="app-nav">
            <a href="#/dashboard">Dashboard</a>
            <a href="#/crew">Crew</a>
            <a href="#/aircraft">Aircraft</a>
          </nav>
          <button id="btn-logout" class="btn btn-secondary">Sign Out</button>
        </div>
      </header>

      <main id="view" class="app-view"></main>
    </section>
  `;

  app.innerHTML = shell;
  document.body.style.background = 'radial-gradient(circle at top left, rgba(37,99,235,.18), transparent 30%), #eef6ff';
}
