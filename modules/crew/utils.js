import { crewState, crewListState } from './state.js';
import { summarizeCrewDocumentCompliance } from '../../services/crewService.js';
import { getDocumentComplianceState } from '../../services/documentService.js';

export function query(selector) {
  return crewState.activeView?.querySelector(selector) || document.querySelector(selector);
}

export function queryAll(selector) {
  return crewState.activeView ? Array.from(crewState.activeView.querySelectorAll(selector)) : [];
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

export function formatDateTime(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleString() : 'N/A';
}

export function formatShortDate(value) {
  const date = toDateValue(value);
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysUntil(value) {
  const date = toDateValue(value);
  if (!date) return null;
  return Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function formatExpiry(value) {
  const date = toDateValue(value);
  if (!date) return 'No expiry';
  const days = daysUntil(value);
  let rel = '';
  if (days === null) rel = '';
  else if (days < 0) rel = `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  else if (days === 0) rel = 'expires today';
  else rel = `in ${days} day${days === 1 ? '' : 's'}`;
  return { date: formatShortDate(value), days, rel };
}

export function toTimestampCandidate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function generateId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function normalizeRole(role) {
  return `${role || 'PILOT'}`.toUpperCase();
}

export function isPilotRole() {
  return crewState.activeRole === 'PILOT';
}

export function normalizeSearchText(value) {
  return `${value || ''}`.trim().toLowerCase();
}

export function complianceRank(level) {
  if (level === 'NONCOMPLIANT') return 0;
  if (level === 'ACTION') return 1;
  if (level === 'COMPLIANT') return 2;
  return 3;
}

export function getPilotRoleLabel(pilot) {
  return normalizeRole(pilot?.role || 'PILOT');
}

export function buildPilotSearchIndex(pilot, docs) {
  return [
    toProfileName(pilot),
    pilot?.email || '',
    pilot?.employeeId || '',
    pilot?.designation || '',
    getPilotRoleLabel(pilot),
    pilot?.organizationBase || '',
    pilot?.base || '',
    pilot?.operatorId || '',
    ...(docs || []).flatMap((doc) => [
      doc?.documentName || '',
      doc?.documentCategory || '',
      doc?.licenseOrCertificateNumber || '',
      doc?.issuingAuthorityOrBody || ''
    ])
  ].join(' ').toLowerCase();
}

function matchesSemanticToken(token, level, docs) {
  if (token === 'expired') return level === 'NONCOMPLIANT' || (docs || []).some((doc) => getDocumentComplianceState(doc) === 'Expired');
  if (token === 'expiring' || token === 'due') return level === 'ACTION';
  if (token === 'valid') return level === 'COMPLIANT';
  if (token === 'attention' || token === 'needs-attention') return level === 'ACTION' || level === 'NONCOMPLIANT';
  if (token === 'nodocs' || token === 'no-docs' || token === 'no-documents') return level === 'NODOCS';
  return false;
}

export function getPilotBase(pilot) {
  return `${pilot?.organizationBase || pilot?.base || ''}`.toUpperCase();
}

export function getEarliestDocExpiry(docs) {
  const days = (docs || [])
    .map((doc) => daysUntil(doc.expiryDate))
    .filter((value) => value !== null);
  if (!days.length) return null;
  return Math.min(...days);
}

export function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return `${left}`.localeCompare(`${right}`);
}

export function isActivePilot(pilot) {
  return `${pilot?.status || 'Active'}` === 'Active';
}

export function getSortedAndFilteredPilots() {
  const normalizedSearch = normalizeSearchText(crewListState.searchText);
  const tokens = normalizedSearch ? normalizedSearch.split(/\s+/) : [];

  const filtered = crewState.pilotsCache.filter((pilot) => {
    if (!isActivePilot(pilot)) return false;

    const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
    const level = getCrewAttentionLevel(docs);
    const index = buildPilotSearchIndex(pilot, docs);
    const pilotRole = getPilotRoleLabel(pilot);
    const pilotStatus = `${pilot.status || 'Active'}`;
    const pilotBase = getPilotBase(pilot);

    const matchesSearch = tokens.every((token) => index.includes(token) || matchesSemanticToken(token, level, docs));
    const matchesStatus = crewListState.statuses.size === 0 || crewListState.statuses.has(pilotStatus);
    const matchesCompliance = crewListState.compliances.size === 0 || crewListState.compliances.has(level);
    const matchesRole = crewListState.roles.size === 0 || crewListState.roles.has(pilotRole);
    const matchesBase = crewListState.bases.size === 0 || crewListState.bases.has(pilotBase);

    return matchesSearch && matchesStatus && matchesCompliance && matchesRole && matchesBase;
  });

  const sorted = filtered.slice().sort((leftPilot, rightPilot) => {
    const leftDocs = crewState.docsByPilotCache.get(leftPilot.uid) || [];
    const rightDocs = crewState.docsByPilotCache.get(rightPilot.uid) || [];

    let comparison = 0;
    if (crewListState.sortField === 'compliance') {
      comparison = complianceRank(getCrewAttentionLevel(leftDocs)) - complianceRank(getCrewAttentionLevel(rightDocs));
    } else if (crewListState.sortField === 'documents') {
      comparison = leftDocs.length - rightDocs.length;
    } else if (crewListState.sortField === 'nextExpiry') {
      const leftDays = getEarliestDocExpiry(leftDocs);
      const rightDays = getEarliestDocExpiry(rightDocs);
      if (leftDays === null && rightDays === null) comparison = 0;
      else if (leftDays === null) comparison = 1;
      else if (rightDays === null) comparison = -1;
      else comparison = leftDays - rightDays;
    } else {
      comparison = compareValues(toProfileName(leftPilot).toLowerCase(), toProfileName(rightPilot).toLowerCase());
    }

    return crewListState.sortDirection === 'desc' ? comparison * -1 : comparison;
  });

  return sorted;
}

export function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toProfileName(profile) {
  return profile?.fullName || profile?.name || profile?.email || profile?.uid || 'Unknown';
}

export function setStatus(message) {
  const status = query('#cm-status');
  if (status) status.textContent = message;
}

export function showToast(message, tone = 'success') {
  const toast = query('#cm-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden', 'is-success', 'is-error', 'is-warning');
  toast.classList.add(tone === 'error' ? 'is-error' : tone === 'warning' ? 'is-warning' : 'is-success');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

export function getCompliance(docs) {
  const compliance = summarizeCrewDocumentCompliance(docs || []);
  if (compliance.expired > 0) return 'Expired';
  if (compliance.expiring > 0) return 'Expiring';
  return 'Valid';
}

export function findPrimaryDoc(docs, matcher) {
  return (docs || []).find((doc) => matcher(doc)) || null;
}

export function getLicenseNumber(docs) {
  const licenseDoc = findPrimaryDoc(
    docs,
    (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'LICENCE' || `${doc.documentName || ''}`.toLowerCase().includes('license')
  );
  return licenseDoc?.licenseOrCertificateNumber || 'N/A';
}

export function getMedicalExpiry(docs) {
  const medicalDoc = findPrimaryDoc(
    docs,
    (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'MEDICAL' || `${doc.documentName || ''}`.toLowerCase().includes('medical')
  );
  return medicalDoc?.expiryDate || null;
}

export function getLicenceExpiry(docs) {
  const licenseDoc = findPrimaryDoc(
    docs,
    (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'LICENCE' || `${doc.documentName || ''}`.toLowerCase().includes('license')
  );
  return licenseDoc?.expiryDate || null;
}

export function getCompliancePercent(docs) {
  const list = docs || [];
  if (!list.length) return 0;
  const valid = list.filter((doc) => getDocumentComplianceState(doc) === 'Valid').length;
  return Math.round((valid / list.length) * 100);
}

export function getStatusBadgeHtml(status) {
  if (status === 'Expired') return '<span class="cm-badge cm-badge-red">Expired</span>';
  if (status === 'Expiring') return '<span class="cm-badge cm-badge-amber">Expiring</span>';
  return '<span class="cm-badge cm-badge-green">Valid</span>';
}

export function getProfileStatusBadgeHtml(status) {
  const current = `${status || 'Active'}`;
  if (current === 'Active') return '<span class="cm-badge cm-badge-green">Active</span>';
  if (current === 'Inactive') return '<span class="cm-badge cm-badge-muted">Inactive</span>';
  if (current === 'Suspended') return '<span class="cm-badge cm-badge-red">Suspended</span>';
  if (current === 'Deleted') return '<span class="cm-badge cm-badge-red">Deleted</span>';
  return '<span class="cm-badge cm-badge-amber">On Leave</span>';
}

export function getCrewAttentionLevel(docs) {
  const list = docs || [];
  if (!list.length) return 'NODOCS';
  const hasExpired = list.some((doc) => {
    const days = daysUntil(doc.expiryDate);
    return days !== null && days < 0;
  });
  if (hasExpired) return 'NONCOMPLIANT';
  const hasExpiring = list.some((doc) => {
    const days = daysUntil(doc.expiryDate);
    return days !== null && days >= 0 && days < 30;
  });
  if (hasExpiring) return 'ACTION';
  return 'COMPLIANT';
}

export function getAttentionReasons(pilot, docs) {
  const list = docs || [];
  if (!list.length) return [{ reason: 'No documents uploaded yet.', days: null, state: 'NODOCS' }];
  return list
    .map((doc) => {
      const days = daysUntil(doc.expiryDate);
      const name = doc?.documentName || 'Document';
      let reason;
      if (days === null) reason = `${name}: no expiry date set.`;
      else if (days < 0) reason = `${name} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`;
      else if (days === 0) reason = `${name} expires today.`;
      else reason = `${name} expires in ${days} day${days === 1 ? '' : 's'}.`;
      return { doc, days, state: getDocumentComplianceState(doc), reason };
    })
    .filter((item) => item.days !== null && item.days < 30)
    .sort((a, b) => a.days - b.days);
}

export function getAttentionSummary(pilot, docs) {
  const level = getCrewAttentionLevel(docs);
  if (level === 'NODOCS') return { level, primary: null, text: 'No documents uploaded yet.' };
  const reasons = getAttentionReasons(pilot, docs);
  if (!reasons.length) return { level, primary: null, text: 'All documents valid.' };
  const primary = reasons[0];
  const name = primary.doc?.documentName || 'Document';
  const days = primary.days;
  let text;
  if (days < 0) text = `${name} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  else if (days === 0) text = `${name} expires today`;
  else text = `${name} expires in ${days} day${days === 1 ? '' : 's'}`;
  return { level, primary, text };
}

export function getAttentionBadgeHtml(level) {
  if (level === 'NONCOMPLIANT') return '<span class="cm-badge cm-badge-red">Non-Compliant</span>';
  if (level === 'ACTION') return '<span class="cm-badge cm-badge-amber">Action Needed</span>';
  if (level === 'NODOCS') return '<span class="cm-badge cm-badge-muted">No Documents</span>';
  return '<span class="cm-badge cm-badge-green">Compliant</span>';
}

export function getAttentionTone(level) {
  if (level === 'NONCOMPLIANT') return 'is-red';
  if (level === 'ACTION') return 'is-amber';
  if (level === 'NODOCS') return 'is-muted';
  return 'is-green';
}

export function getMissingRequiredDocs(docs, requiredNames) {
  const names = (requiredNames || []).map((name) => `${name}`.trim()).filter(Boolean);
  if (!names.length) return [];
  const present = new Set((docs || []).map((doc) => `${doc?.documentName || ''}`.trim().toLowerCase()));
  return names.filter((name) => !present.has(`${name}`.toLowerCase()));
}

const CHIP_RULES = [
  { key: 'LICENCE', label: 'Licence' },
  { key: 'MEDICAL', label: 'Medical' },
  { match: /ppc/i, label: 'PPC' },
  { match: /instrument rating check/i, label: 'IR Check' },
  { match: /ipc/i, label: 'IPC' },
  { match: /opc/i, label: 'OPC' },
  { match: /instrument rating/i, label: 'IR' },
  { match: /crm/i, label: 'CRM' },
  { match: /dangerous goods/i, label: 'DG' },
  { match: /passport/i, label: 'Passport' },
  { match: /rtr/i, label: 'RTR' }
];

export function getDocChipState(doc) {
  const state = getDocumentComplianceState(doc);
  if (state === 'Expired') return { tone: 'is-danger', mark: '✕' };
  if (state === 'Expiring') return { tone: 'is-warn', mark: '⚠' };
  if (state === 'Valid') return { tone: 'is-valid', mark: '✓' };
  return { tone: '', mark: '·' };
}

export function getPrimaryDocChips(docs, max = 4) {
  const chips = [];
  const used = new Set();
  (docs || []).forEach((doc) => {
    const category = `${doc?.documentCategory || ''}`.toUpperCase();
    const name = `${doc?.documentName || ''}`;
    const rule = CHIP_RULES.find((r) => r.key === category || (r.match && r.match.test(name)));
    if (!rule || used.has(rule.label)) return;
    used.add(rule.label);
    const chip = getDocChipState(doc);
    chips.push({ label: rule.label, tone: chip.tone, mark: chip.mark });
  });
  return chips.slice(0, max);
}

export const CIRC = (r) => 2 * Math.PI * r;

export function renderMiniRing(percent, status) {
  const r = 17;
  const circumference = CIRC(r);
  const offset = circumference * (1 - percent / 100);
  const tone = status === 'Expired' ? 'is-red' : status === 'Expiring' ? 'is-amber' : '';
  return `
    <span class="cm-ring" role="img" aria-label="${percent}% compliance">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle class="cm-ring-track" cx="22" cy="22" r="${r}"></circle>
        <circle class="cm-ring-bar ${tone}" cx="22" cy="22" r="${r}" style="stroke-dasharray: ${circumference.toFixed(2)}; stroke-dashoffset: ${offset.toFixed(2)}"></circle>
      </svg>
      <strong>${percent}%</strong>
    </span>
    <span class="cm-badge ${status === 'Expired' ? 'cm-badge-red' : status === 'Expiring' ? 'cm-badge-amber' : 'cm-badge-green'}">${status}</span>
  `;
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

export function renderExpiryCell(value) {
  const parsed = formatExpiry(value);
  const days = parsed.days;
  const toneClass = days !== null && days < 0 ? 'is-danger' : days !== null && days < 30 ? 'is-warn' : '';
  return `
    <span class="cm-expiry">
      <span class="cm-expiry-date">${escapeHtml(parsed.date)}</span>
      ${days !== null && days !== undefined ? `<span class="cm-expiry-in ${toneClass}">${escapeHtml(parsed.rel)}</span>` : ''}
    </span>
  `;
}

export function setText(selector, text) {
  const element = query(selector);
  if (element) element.textContent = text;
}

export function updateNotifDot(pendingCount) {
  const dot = query('#cm-notif-dot');
  if (!dot) return;
  dot.hidden = pendingCount === 0;
}

export function openModal(contentHtml, { title = '', subtitle = '' } = {}) {
  const backdrop = query('#cm-modal-backdrop');
  const content = query('#cm-modal-content');
  if (!backdrop || !content) return;
  const profileWrap = query('#cm-profile-form-wrap');
  if (profileWrap) profileWrap.classList.add('hidden');
  content.classList.remove('hidden');
  content.innerHTML = `
    ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    ${contentHtml}
  `;
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => query('#cm-modal-close')?.focus());
}

export function openProfileModal() {
  const backdrop = query('#cm-modal-backdrop');
  const content = query('#cm-modal-content');
  const profileWrap = query('#cm-profile-form-wrap');
  if (!backdrop || !profileWrap) return;
  if (content) content.classList.add('hidden');
  profileWrap.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => query('#cm-profile-heading')?.focus());
}

export function closeModal() {
  const backdrop = query('#cm-modal-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
}

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  openModal(`
    <p>${escapeHtml(message)}</p>
    <div class="cm-modal-actions">
      <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-modal-cancel">Cancel</button>
      <button type="button" class="cm-btn ${danger ? 'cm-btn-danger' : 'cm-btn-primary'} cm-btn-md" id="cm-modal-confirm">${escapeHtml(confirmLabel)}</button>
    </div>
  `, { title });
  query('#cm-modal-cancel')?.addEventListener('click', closeModal);
  query('#cm-modal-confirm')?.addEventListener('click', async () => {
    closeModal();
    await onConfirm();
  });
}

export function setFormField(selector, value) {
  const input = query(selector);
  if (input) input.value = value ?? '';
}

export function setFormValue(selector, value) {
  const input = query(selector);
  if (input) input.value = value ?? '';
}

export function toInputDate(value) {
  const date = toDateValue(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

export function clearFormErrors() {
  queryAll('.cm-error').forEach((el) => (el.textContent = ''));
  const status = query('#cm-profile-status');
  if (status) {
    status.textContent = '';
    status.classList.remove('is-success', 'is-error');
  }
}

export function setFieldError(fieldName, message) {
  const error = query(`#cm-error-${fieldName}`);
  if (error) error.textContent = message;
}
