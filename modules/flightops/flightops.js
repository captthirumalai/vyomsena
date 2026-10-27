import { mountModuleActions } from '../../shared/moduleHeader.js';

export async function init(view, context) {
  const heading = view.querySelector('h2');
  if (heading) heading.textContent = 'Flight Operations';
  const content = view.querySelector('#flightops-content');
  const operatorUid = context?.currentUser?.uid || null;
  const userRole = `${context?.currentUser?.role || ''}`.toUpperCase();
  const canManageUsers = ['OWNER', 'ADMIN'].includes(userRole);
  mountModuleActions(canManageUsers ? '<a href="#/linking" id="fo-add-ops-user" class="vs-button vs-button--secondary vs-button--sm">+ Add Ops User</a>' : '');
  const addUserButton = document.getElementById('fo-add-ops-user');
  const setRequestedRole = () => sessionStorage.setItem('vs-linking-prefill-role', 'OPERATIONS');
  addUserButton?.addEventListener('click', setRequestedRole);

  if (!operatorUid) {
    if (content) content.textContent = 'No authorized operator found.';
    return { destroy() { addUserButton?.removeEventListener('click', setRequestedRole); } };
  }
  if (content) content.textContent = `Module ready for operator ${operatorUid}.`;
  return { destroy() { addUserButton?.removeEventListener('click', setRequestedRole); } };
}
