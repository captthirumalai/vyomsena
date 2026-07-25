import { authStore } from '../stores/authStore.js';
import {
  initializeFirebaseAuth,
  authStateObserver,
  signIn,
  registerWorkspace,
  sendResetEmail,
  signOutUser,
  loadUserProfile,
  createUserProfile
} from '../services/authService.js';
import { initRouter } from './router.js';
import { emit as emitEvent } from '../services/eventBus.js';

let routerStarted = false;

function query(selector) {
  return document.querySelector(selector);
}

function setButtonState(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.querySelector('.btn-spinner')?.classList.toggle('hidden', !loading);
  button.querySelector('.btn-text')?.classList.toggle('hidden', loading);
}

function showElement(element) {
  element?.classList.remove('hidden');
}

function hideElement(element) {
  element?.classList.add('hidden');
}

function setActiveCard(cardName) {
  const login = query('#login-card');
  const register = query('#register-card');
  const recover = query('#recover-card');

  login?.classList.remove('active');
  register?.classList.remove('active');
  recover?.classList.remove('active');

  if (cardName === 'login') login?.classList.add('active');
  if (cardName === 'register') register?.classList.add('active');
  if (cardName === 'recover') recover?.classList.add('active');
}

function showLanding() {
  query('#auth-view')?.classList.remove('hidden');
  query('#app-view')?.classList.add('hidden');
  query('#app-topbar')?.classList.add('hidden');
  query('#app-sidebar')?.classList.add('hidden');
  query('#app-footer')?.classList.add('hidden');
}

function showAppShell() {
  query('#auth-view')?.classList.add('hidden');
  query('#app-view')?.classList.remove('hidden');
  query('#app-topbar')?.classList.remove('hidden');
  query('#app-sidebar')?.classList.remove('hidden');
  query('#app-footer')?.classList.remove('hidden');
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  showElement(element);
}

function clearError(element) {
  if (!element) return;
  hideElement(element);
  element.textContent = '';
}

export function initAuth() {
  initializeFirebaseAuth();

  const loginForm = query('#login-form');
  const registerForm = query('#register-form');
  const recoverForm = query('#recover-form');
  const goRegister = query('#go-register');
  const goLogin = query('#go-login');
  const goRecover = query('#go-recover');
  const goLoginFromRecover = query('#go-login-from-recover');
  const logoutButton = query('#btn-logout');
  const logoutMobileButton = query('#btn-signout-mobile');
  const appUserLabel = query('#app-user');
  const loginError = query('#login-error');
  const registerError = query('#register-error');
  const recoverSuccess = query('#recover-success');

  function resetCards() {
    clearError(loginError);
    clearError(registerError);
    hideElement(recoverSuccess);
  }

  goRegister?.addEventListener('click', (event) => {
    event.preventDefault();
    setActiveCard('register');
    resetCards();
  });

  goLogin?.addEventListener('click', (event) => {
    event.preventDefault();
    setActiveCard('login');
    resetCards();
  });

  goRecover?.addEventListener('click', (event) => {
    event.preventDefault();
    setActiveCard('recover');
    resetCards();
  });

  goLoginFromRecover?.addEventListener('click', (event) => {
    event.preventDefault();
    setActiveCard('login');
    resetCards();
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(loginError);

    const email = query('#login-email')?.value.trim();
    const password = query('#login-password')?.value || '';
    const button = query('#btn-login-submit');

    if (!email || !password) {
      showError(loginError, 'Please enter both email and password.');
      return;
    }

    setButtonState(button, true);

    try {
      await signIn(email, password);
    } catch (err) {
      showError(loginError, err.message || 'Unable to sign in.');
    } finally {
      setButtonState(button, false);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(registerError);

    const orgName = query('#reg-org-name')?.value.trim();
    const orgType = query('#reg-org-type')?.value;
    const email = query('#reg-email')?.value.trim();
    const password = query('#reg-password')?.value || '';
    const button = query('#btn-register-submit');

    if (!orgName || !orgType || !email || !password) {
      showError(registerError, 'All fields are required to create an organization.');
      return;
    }

    setButtonState(button, true);

    try {
      await registerWorkspace({ name: orgName, type: orgType, email, password });
    } catch (err) {
      showError(registerError, err.message || 'Unable to create an account.');
    } finally {
      setButtonState(button, false);
    }
  });

  recoverForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(loginError);
    clearError(registerError);
    hideElement(recoverSuccess);

    const email = query('#recover-email')?.value.trim();
    const button = query('#btn-recover-submit');

    if (!email) {
      showError(loginError, 'Enter your email to receive a reset link.');
      return;
    }

    setButtonState(button, true);

    try {
      await sendResetEmail(email);
      showElement(recoverSuccess);
      query('#recover-email').value = '';
    } catch (err) {
      showError(loginError, err.message || 'Unable to send reset email.');
    } finally {
      setButtonState(button, false);
    }
  });

  logoutButton?.addEventListener('click', async () => {
    await signOutUser();
    setActiveCard('login');
  });

  logoutMobileButton?.addEventListener('click', async () => {
    await signOutUser();
    setActiveCard('login');
  });

  authStateObserver(async (user) => {
    if (user) {
      try {
        let profileData = await loadUserProfile(user.uid);

        if (!profileData) {
          profileData = {
            uid: user.uid,
            name: user.displayName || user.email?.split('@')[0] || 'User',
            email: user.email,
            role: 'OPERATIONS',
            createdAt: new Date().toISOString()
          };
          await createUserProfile(user.uid, profileData);
        }

        authStore.setUser(profileData);
        emitEvent('auth:login', profileData);
        appUserLabel.textContent = `Signed in as ${profileData.name || user.email}`;
        showAppShell();

        if (!routerStarted) {
          await initRouter();
          routerStarted = true;
        }
      } catch (err) {
        console.error('Auth profile load failed:', err);
        showError(loginError, 'Unable to load profile. Please try again later.');
        await signOutUser();
      }
    } else {
      authStore.clearUser();
      emitEvent('auth:logout', null);
      appUserLabel.textContent = 'Secure operations dashboard';
      showLanding();
    }
  });
}
