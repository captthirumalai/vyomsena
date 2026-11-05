export function getModuleActionsHost() {
  return document.getElementById('app-module-actions');
}

export function mountModuleActions(html) {
  const host = getModuleActionsHost();
  if (!host) return;
  const content = html || '';
  host.innerHTML = content;
  host.parentElement?.classList.toggle('hidden', !content.trim());
}

export function clearModuleActions() {
  mountModuleActions('');
}

export function getModuleAction(id) {
  return document.getElementById(id);
}

export function setModuleTitle(text) {
  const el = document.getElementById('app-route');
  if (el) el.textContent = text;
}

export function setModuleSubtitle(text) {
  const el = document.getElementById('app-route-subtitle');
  if (el) el.textContent = text;
}