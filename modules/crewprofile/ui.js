import { cpState } from './state.js';

export function q(selector) {
  return cpState.view?.querySelector(selector) || document.querySelector(selector);
}

export function qa(selector) {
  return cpState.view ? Array.from(cpState.view.querySelectorAll(selector)) : [];
}

export function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeText(value) {
  return `${value || ''}`.trim();
}

export function normalizeRole(role) {
  return `${role || 'PILOT'}`.toUpperCase();
}

export function toProfileName(profile) {
  return profile?.fullName || profile?.name || profile?.email || profile?.uid || 'Unknown';
}

export function getInitials(name) {
  return `${name || 'U'}`
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function getPilotRoleLabel(pilot) {
  return normalizeRole(pilot?.role || 'PILOT');
}

export function getPilotBase(pilot) {
  return `${pilot?.organizationBase || pilot?.base || ''}`.toUpperCase();
}

export function isActivePilot(pilot) {
  return `${pilot?.status || 'Active'}` === 'Active';
}

export function getProfileStatusBadgeHtml(status) {
  const current = `${status || 'Active'}`;
  if (current === 'Active') return '<span class="cp-badge cp-badge-green">Active</span>';
  if (current === 'Inactive') return '<span class="cp-badge cp-badge-muted">Inactive</span>';
  if (current === 'Suspended') return '<span class="cp-badge cp-badge-red">Suspended</span>';
  if (current === 'Deleted') return '<span class="cp-badge cp-badge-red">Deleted</span>';
  return '<span class="cp-badge cp-badge-amber">On Leave</span>';
}

export function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function formatDate(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString() : 'N/A';
}

export function showToast(message, tone = 'success') {
  const toast = q('#cp-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden', 'is-success', 'is-error', 'is-warning');
  toast.classList.add(tone === 'error' ? 'is-error' : tone === 'warning' ? 'is-warning' : 'is-success');
  clearTimeout(cpState.toastTimer);
  cpState.toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

export function openModal(contentHtml, { title = '', subtitle = '' } = {}) {
  const backdrop = q('#cp-modal-backdrop');
  const content = q('#cp-modal-content');
  if (!backdrop || !content) return;
  const formWrap = q('#cp-profile-form-wrap');
  if (formWrap) formWrap.classList.add('hidden');
  content.classList.remove('hidden');
  content.innerHTML = `
    ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
    ${subtitle ? `<p class="cp-modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
    ${contentHtml}
  `;
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => q('#cp-modal-close')?.focus());
}

export function openFormModal() {
  const backdrop = q('#cp-modal-backdrop');
  const content = q('#cp-modal-content');
  const formWrap = q('#cp-profile-form-wrap');
  if (!backdrop || !formWrap) return;
  if (content) content.classList.add('hidden');
  formWrap.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => q('#cp-profile-heading')?.focus());
}

export function closeModal() {
  const backdrop = q('#cp-modal-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
  cpState.modalUid = null;
}

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  openModal(`
    <p>${escapeHtml(message)}</p>
    <div class="cp-modal-actions">
      <button type="button" class="cp-btn cp-btn-ghost cp-btn-md" id="cp-modal-cancel">Cancel</button>
      <button type="button" class="cp-btn ${danger ? 'cp-btn-danger' : 'cp-btn-primary'} cp-btn-md" id="cp-modal-confirm">${escapeHtml(confirmLabel)}</button>
    </div>
  `, { title });
  q('#cp-modal-cancel')?.addEventListener('click', closeModal);
  q('#cp-modal-confirm')?.addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

export function setField(selector, value) {
  const input = q(selector);
  if (input) input.value = value ?? '';
}

export function clearFormErrors() {
  qa('.cp-error').forEach((element) => {
    element.textContent = '';
  });
  const status = q('#cp-profile-status');
  if (status) {
    status.textContent = '';
    status.classList.remove('is-success', 'is-error');
  }
}

export function setFieldError(fieldName, message) {
  const error = q(`#cp-error-${fieldName}`);
  if (error) error.textContent = message;
}
