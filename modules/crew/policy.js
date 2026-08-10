import { crewState } from './state.js';
import { query, queryAll, escapeHtml, openModal, closeModal, showToast, setStatus } from './utils.js';
import { DOCUMENT_CATEGORIES, DOCUMENT_MASTER_LIST } from './documentsConfig.js';
import { getCrewDocumentPolicy, setCrewDocumentPolicy } from '../../services/crewPolicyService.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { renderCrewScreen } from './directory.js';

export async function loadCrewPolicy() {
  if (!crewState.activeOperatorUid) return;
  try {
    crewState.requiredDocumentPolicy = await getCrewDocumentPolicy(crewState.activeOperatorUid);
  } catch (error) {
    console.warn('Crew policy load failed:', error);
    crewState.requiredDocumentPolicy = { requiredDocumentNames: [], enabled: false };
  }
}

function updatePolicyCount() {
  const count = query('#cm-policy-count');
  if (!count) return;
  const total = queryAll('input[name="cm-required-doc"]:checked').length;
  count.textContent = `${total} required`;
}

function bindPolicyModalEvents() {
  query('#cm-policy-cancel')?.addEventListener('click', closeModal);

  queryAll('input[name="cm-required-doc"]').forEach((box) => {
    box.addEventListener('change', updatePolicyCount);
  });

  queryAll('[data-policy-group-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.getAttribute('data-policy-group-toggle');
      const boxes = queryAll(`[data-policy-group="${escapeHtml(group)}"] input[name="cm-required-doc"]`);
      if (!boxes.length) return;
      const allChecked = boxes.every((box) => box.checked);
      boxes.forEach((box) => {
        box.checked = !allChecked;
      });
      updatePolicyCount();
    });
  });

  query('#cm-policy-select-all')?.addEventListener('click', () => {
    queryAll('input[name="cm-required-doc"]').forEach((box) => {
      box.checked = true;
    });
    updatePolicyCount();
  });

  query('#cm-policy-clear-all')?.addEventListener('click', () => {
    queryAll('input[name="cm-required-doc"]').forEach((box) => {
      box.checked = false;
    });
    updatePolicyCount();
  });

  query('#cm-policy-save')?.addEventListener('click', saveCompanyPolicy);
}

export function openCompanyPolicyModal() {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'edit')) return;
  if (!crewState.activeOperatorUid) {
    showToast('Operator context is required to set the policy.', 'error');
    return;
  }

  const selected = new Set(crewState.requiredDocumentPolicy?.requiredDocumentNames || []);

  const groups = DOCUMENT_CATEGORIES.map((category) => {
    const items = DOCUMENT_MASTER_LIST[category.key] || [];
    if (!items.length) return '';
    return `
      <fieldset class="cm-policy-group" data-policy-group="${escapeHtml(category.key)}">
        <legend>
          <span>${escapeHtml(category.label)}</span>
          <button type="button" class="cm-btn cm-btn-ghost cm-btn-sm" data-policy-group-toggle="${escapeHtml(category.key)}">Toggle group</button>
        </legend>
        <div class="cm-policy-options">
          ${items
            .map(
              (item) => `<label class="cm-policy-option">
                <input type="checkbox" name="cm-required-doc" value="${escapeHtml(item.name)}" ${selected.has(item.name) ? 'checked' : ''} />
                <span>
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(item.authority)}</small>
                </span>
              </label>`
            )
            .join('')}
        </div>
      </fieldset>`;
  }).join('');

  openModal(
    `
    <div class="cm-policy-toolbar">
      <span class="cm-policy-count" id="cm-policy-count">0 required</span>
      <button type="button" class="cm-btn cm-btn-ghost cm-btn-sm" id="cm-policy-select-all">Select all</button>
      <button type="button" class="cm-btn cm-btn-ghost cm-btn-sm" id="cm-policy-clear-all">Clear all</button>
    </div>
    <div class="cm-policy-groups">${groups}</div>
    <p class="cm-form-status" id="cm-policy-status"></p>
    <div class="cm-modal-actions">
      <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-policy-cancel">Cancel</button>
      <button type="button" class="cm-btn cm-btn-primary cm-btn-md" id="cm-policy-save">Save Policy</button>
    </div>
    `,
    {
      title: 'Required Documents Policy',
      subtitle: 'Select the licences and trainings every pilot must hold. Pilots missing any of these will show a count on their card.'
    }
  );

  updatePolicyCount();
  bindPolicyModalEvents();
}

async function saveCompanyPolicy() {
  const names = queryAll('input[name="cm-required-doc"]:checked').map((box) => box.value);
  const saveButton = query('#cm-policy-save');
  if (saveButton) saveButton.disabled = true;
  try {
    crewState.requiredDocumentPolicy = await setCrewDocumentPolicy(
      crewState.activeOperatorUid,
      names,
      crewState.activeCurrentUser?.uid
    );
    showToast(names.length ? `Policy saved: ${names.length} required document(s).` : 'Policy cleared. No required documents set.', 'success');
    closeModal();
    renderCrewScreen();
  } catch (error) {
    console.error('Crew policy save failed:', error);
    showToast(error.message || 'Failed to save policy.', 'error');
    setStatus(error.message || 'Failed to save the crew document policy.');
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}
