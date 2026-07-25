const listeners = new Set();
let state = {
  user: null
};

function emit() {
  listeners.forEach((listener) => listener(state));
}

export const authStore = {
  get user() {
    return state.user;
  },

  subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  },

  setUser(user) {
    state = { ...state, user };
    emit();
  },

  clearUser() {
    state = { ...state, user: null };
    emit();
  }
};
