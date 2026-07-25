export function createNotification(message) {
  const el = document.createElement('div');
  el.className = 'component-notification';
  el.textContent = message;
  return el;
}
