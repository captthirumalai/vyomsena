const listeners = new Set();
let state = {
  theme: 'light'
};

function emit() {
  listeners.forEach((listener) => listener(state));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
}

export const themeStore = {
  init() {
    const persisted = window.localStorage.getItem('vs-theme');
    const theme = persisted === 'dark' ? 'dark' : 'light';
    state = { theme };
    applyTheme(theme);
    emit();
  },

  get theme() {
    return state.theme;
  },

  setTheme(theme) {
    state = { ...state, theme };
    window.localStorage.setItem('vs-theme', theme);
    applyTheme(theme);
    emit();
  },

  toggleTheme() {
    this.setTheme(state.theme === 'dark' ? 'light' : 'dark');
  },

  subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }
};
