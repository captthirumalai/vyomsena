const listeners = new Map();

export function on(eventName, listener) {
  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set());
  }
  listeners.get(eventName).add(listener);
  return () => listeners.get(eventName)?.delete(listener);
}

export function emit(eventName, payload) {
  const handlers = listeners.get(eventName);
  if (!handlers) return;
  handlers.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error(`eventBus error on ${eventName}:`, error);
    }
  });
}

export function clear(eventName) {
  if (eventName) {
    listeners.delete(eventName);
  } else {
    listeners.clear();
  }
}
