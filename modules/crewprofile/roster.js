import { cpState } from './state.js';
import {
  q,
  escapeHtml,
  getInitials,
  toProfileName,
  getPilotRoleLabel,
  getProfileStatusBadgeHtml,
  getPilotBase,
  isActivePilot
} from './ui.js';
import {
  getCrewAttentionLevel,
  getAttentionBadgeHtml,
  getAttentionSummary
} from '../crew/utils.js';
import { canPerformCrewAction } from '../../services/permissionService.js';

function getDocs(uid) {
  return cpState.docsByUid.get(uid) || [];
}

function normalizeSearch(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function matchesSearch(pilot) {
  const search = normalizeSearch(cpState.searchText);
  if (!search) return true;
  const docs = getDocs(pilot.uid);
  const haystack = [
    toProfileName(pilot),
    pilot.email,
    pilot.employeeId,
    pilot.designation,
    getPilotRoleLabel(pilot),
    getPilotBase(pilot),
    ...docs.flatMap((document) => [
      document.documentName,
      document.documentCategory,
      document.licenseOrCertificateNumber
    ])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return search.split(/\s+/).every((token) => haystack.includes(token));
}

export function avatarHtml(pilot, extraClass = '') {
  const name = toProfileName(pilot);
  const initials = escapeHtml(getInitials(name));
  const photo = pilot?.photoUri || pilot?.photoUrl || null;
  if (photo) {
    return `<span class="cp-avatar cp-avatar-photo ${extraClass}"><img src="${escapeHtml(photo)}" alt="${initials}" loading="lazy" referrerpolicy="no-referrer" /></span>`;
  }
  return `<span class="cp-avatar ${extraClass}">${initials}</span>`;
}

export function getActivePilots() {
  return cpState.pilots
    .filter((pilot) => isActivePilot(pilot))
    .filter(matchesSearch)
    .slice()
    .sort((left, right) => toProfileName(left).localeCompare(toProfileName(right)));
}

export function getInactivePilots() {
  return cpState.pilots
    .filter((pilot) => !isActivePilot(pilot))
    .slice()
    .sort((left, right) => toProfileName(left).localeCompare(toProfileName(right)));
}

function renderCard(pilot) {
  const docs = getDocs(pilot.uid);
  const level = getCrewAttentionLevel(docs);
  const summary = getAttentionSummary(pilot, docs);
  const base = getPilotBase(pilot);

  return `
    <article class="cp-card" data-cp-uid="${escapeHtml(pilot.uid)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(toProfileName(pilot))} overview">
      <div class="cp-card-head">
        ${avatarHtml(pilot)}
        <div class="cp-card-identity">
          <strong class="cp-card-name">${escapeHtml(toProfileName(pilot))}</strong>
          <span class="cp-card-email">${escapeHtml(pilot.email || 'No email')}</span>
        </div>
        ${getProfileStatusBadgeHtml(pilot.status)}
      </div>
      <div class="cp-card-meta">
        <span class="cp-badge cp-badge-muted">${escapeHtml(getPilotRoleLabel(pilot))}</span>
        <span class="cp-card-base">${escapeHtml(base || 'No base')}</span>
        <span class="cp-card-docs">${docs.length} doc${docs.length === 1 ? '' : 's'}</span>
      </div>
      <div class="cp-card-foot">
        ${getAttentionBadgeHtml(level)}
        <span class="cp-card-summary">${escapeHtml(summary.text)}</span>
      </div>
    </article>`;
}

export function renderRoster() {
  const grid = q('#cp-grid');
  const empty = q('#cp-empty');
  const count = q('#cp-roster-count');
  if (!grid || !empty) return;

  const canEdit = canPerformCrewAction(cpState.currentUser, 'edit');
  cpState.view?.querySelectorAll('[data-cp-add]').forEach((button) => {
    button.classList.toggle('hidden', !canEdit);
  });

  const pilots = getActivePilots();
  if (count) count.textContent = `${pilots.length} pilot${pilots.length === 1 ? '' : 's'}`;

  if (!pilots.length) {
    grid.innerHTML = '';
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    const noCrew = cpState.pilots.length === 0;
    const title = q('#cp-empty-title');
    const message = q('#cp-empty-message');
    if (title) title.textContent = noCrew ? 'No pilots yet' : 'No pilots match';
    if (message) {
      message.textContent = noCrew
        ? 'Add your first pilot to start managing their profile and documents.'
        : 'Try adjusting your search.';
    }
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = pilots.map((pilot) => renderCard(pilot)).join('');
}

export function renderInactive() {
  const section = q('#cp-inactive-section');
  const list = q('#cp-inactive-list');
  const count = q('#cp-inactive-count');
  if (!section || !list) return;

  const inactive = getInactivePilots();
  const canEdit = canPerformCrewAction(cpState.currentUser, 'edit');
  const canDelete = canPerformCrewAction(cpState.currentUser, 'delete');
  if (!inactive.length) {
    section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  if (count) count.textContent = `${inactive.length} pilot${inactive.length === 1 ? '' : 's'}`;
  list.innerHTML = inactive
    .map(
      (pilot) => `
        <div class="cp-inactive-row" data-cp-uid="${escapeHtml(pilot.uid)}">
          ${avatarHtml(pilot)}
          <div class="cp-inactive-identity">
            <strong>${escapeHtml(toProfileName(pilot))}</strong>
            <span>${escapeHtml(pilot.email || 'No email')} · ${escapeHtml(getPilotRoleLabel(pilot))}</span>
          </div>
          ${getProfileStatusBadgeHtml(pilot.status)}
          ${canEdit || canDelete
            ? `<span class="cp-inactive-actions">
                ${canEdit ? `<button type="button" class="cp-btn cp-btn-ghost cp-btn-sm" data-cp-inactive-action="restore" data-cp-uid="${escapeHtml(pilot.uid)}">Set Active</button>` : ''}
                ${canDelete ? `<button type="button" class="cp-btn cp-btn-danger cp-btn-sm" data-cp-inactive-action="delete-permanent" data-cp-uid="${escapeHtml(pilot.uid)}">Delete Forever</button>` : ''}
              </span>`
            : ''}
        </div>`
    )
    .join('');
}
