import { getCompany, updateCompany } from '../services/companyService.js';
import { updateUserProfile } from '../services/userService.js';
import { getCurrentOrganizationContext } from '../services/organizationService.js';
import { authStore } from '../stores/authStore.js';

const OPERATOR_TYPES = ['NSOP', 'Charter', 'FTO', 'Corporate', 'MRO', 'Government'];

function query(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildModalMarkup(user, company, canEditCompany) {
  const operatorTypeOptions = OPERATOR_TYPES.map((type) => {
    const selected = `${user?.operatorType || ''}`.trim().toUpperCase() === type.toUpperCase() ? ' selected' : '';
    return `<option value="${escapeHtml(type)}"${selected}>${escapeHtml(type)}</option>`;
  }).join('');

  const companySection = canEditCompany
    ? `
    <h4>Company profile</h4>
    <div class="vs-profile-grid">
      <label class="vs-field">
        <span>Company name</span>
        <input type="text" id="up-company-name" value="${escapeHtml(company?.name || user?.organizationName || '')}" placeholder="e.g. VyomSena Aviation Pvt Ltd" />
      </label>
      <label class="vs-field">
        <span>Base / HQ</span>
        <input type="text" id="up-company-base" value="${escapeHtml(company?.base || user?.organizationBase || '')}" placeholder="e.g. Bengaluru / VOBL" />
      </label>
      <label class="vs-field">
        <span>Company code</span>
        <input type="text" id="up-company-code" value="${escapeHtml(company?.code || user?.organizationCode || '')}" placeholder="e.g. VSA" />
      </label>
      <label class="vs-field">
        <span>Operator category</span>
        <select id="up-operator-type">${operatorTypeOptions}</select>
      </label>
    </div>`
    : '';

  return `
    <div class="vs-profile-modal">
      <div class="vs-profile-head">
        <h3>User &amp; Company Profile</h3>
        <button type="button" class="vs-profile-close" id="up-close" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
        </button>
      </div>
      <form id="up-form" novalidate>
        <h4>Your details</h4>
        <div class="vs-profile-grid">
          <label class="vs-field">
            <span>Full name</span>
            <input type="text" id="up-user-name" value="${escapeHtml(user?.name || user?.fullName || '')}" placeholder="e.g. Captain Aryan Mehta" />
          </label>
          <label class="vs-field">
            <span>Email (read-only)</span>
            <input type="email" value="${escapeHtml(user?.email || '')}" disabled />
          </label>
          <label class="vs-field">
            <span>Operations contact number</span>
            <input type="tel" id="up-user-phone" value="${escapeHtml(user?.companyPhone || '')}" placeholder="e.g. +91 98765 43210" />
          </label>
        </div>
        ${companySection}
        <p class="vs-profile-status" id="up-status" role="status"></p>
        <div class="vs-profile-actions">
          <button type="button" class="vs-button vs-button--ghost vs-button--sm" id="up-cancel">Cancel</button>
          <button type="submit" class="vs-button vs-button--primary vs-button--sm" id="up-save">
            Save changes
          </button>
        </div>
      </form>
    </div>
  `;
}

export async function openUserProfileEditor(user) {
  closeUserProfileEditor();
  if (!user?.uid) return;

  const orgContext = getCurrentOrganizationContext(user);
  const companyId = orgContext.organizationId || user.uid;

  let company = null;
  try {
    company = await getCompany(companyId);
  } catch (error) {
    console.warn('Company load failed for profile editor:', error);
  }

  const canEditCompany = Boolean(companyId);

  const backdrop = document.createElement('div');
  backdrop.className = 'vs-profile-backdrop hidden';
  backdrop.innerHTML = buildModalMarkup(user, company, canEditCompany);
  document.body.appendChild(backdrop);
  backdrop.classList.remove('hidden');

  const statusEl = query('#up-status');
  const setStatus = (message, tone) => {
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-success', tone === 'success');
    statusEl.classList.toggle('is-error', tone === 'error');
  };

  function onBackdropClick(event) {
    if (event.target === backdrop) closeUserProfileEditor();
  }
  function onEscape(event) {
    if (event.key === 'Escape') closeUserProfileEditor();
  }
  function onClose() {
    closeUserProfileEditor();
  }

  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onEscape);
  query('#up-close')?.addEventListener('click', onClose);
  query('#up-cancel')?.addEventListener('click', onClose);

  const form = query('#up-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userName = query('#up-user-name')?.value?.trim();
    if (!userName) {
      setStatus('Full name is required.', 'error');
      return;
    }

    setStatus('Saving...', '');
    try {
      const userUpdates = {
        name: userName,
        fullName: userName,
        companyPhone: query('#up-user-phone')?.value?.trim() || null,
        operatorType: query('#up-operator-type')?.value?.trim() || null,
        organizationName: canEditCompany
          ? query('#up-company-name')?.value?.trim() || null
          : user?.organizationName || null,
        organizationBase: canEditCompany
          ? query('#up-company-base')?.value?.trim() || null
          : user?.organizationBase || null,
        organizationCode: canEditCompany
          ? query('#up-company-code')?.value?.trim() || null
          : user?.organizationCode || null
      };

      await updateUserProfile(user.uid, userUpdates);

      if (canEditCompany) {
        await updateCompany(companyId, {
          name: query('#up-company-name')?.value?.trim() || '',
          base: query('#up-company-base')?.value?.trim() || null,
          code: query('#up-company-code')?.value?.trim() || null
        });
      }

      const updatedUser = {
        ...(authStore.user || user),
        ...userUpdates
      };
      authStore.setUser(updatedUser);
      closeUserProfileEditor();
      return;
    } catch (error) {
      console.error('Profile save failed:', error);
      setStatus(error?.message || 'Unable to save profile. Please try again.', 'error');
    }
  });
}

export function closeUserProfileEditor() {
  const backdrop = document.querySelector('.vs-profile-backdrop');
  if (!backdrop) return;
  backdrop.classList.add('hidden');
  backdrop.remove();
}