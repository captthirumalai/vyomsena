import { crewState } from './state.js';
import {
  query,
  setText,
  toProfileName,
  getCompliance,
  formatShortDate,
  getLicenseNumber,
  getMedicalExpiry,
  getLicenceExpiry,
  getPilotRoleLabel,
  daysUntil,
  formatExpiry,
  escapeHtml,
  confirmModal,
  openModal,
  closeModal,
  showToast
} from './utils.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { getDocumentComplianceState } from '../../services/documentService.js';
import { updatePilotProfile, delinkPilot } from '../../services/crewService.js';
import { findUserByEmail } from '../../services/userService.js';
import { refreshCrew } from './crew.js';

export function renderBulkTab() {
  const count = query('#cm-bulk-count');
  if (count) count.textContent = `${crewState.selectedRows.size} selected`;
  setText('#cm-bulk-status', '');
}

export function getSelectedPilots() {
  return crewState.pilotsCache.filter((pilot) => crewState.selectedRows.has(pilot.uid));
}

export async function applyBulkAction(action) {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'edit')) {
    showToast('You do not have permission to modify crew records.', 'error');
    return;
  }

  const selected = getSelectedPilots();
  const statusEl = query('#cm-bulk-status');

  if (!selected.length) {
    if (statusEl) {
      statusEl.textContent = 'Select crew members in the directory first (use the checkboxes).';
      statusEl.classList.add('is-error');
    }
    showToast('No crew members selected.', 'warning');
    return;
  }

  const names = selected.slice(0, 3).map((pilot) => toProfileName(pilot)).join(', ') + (selected.length > 3 ? ` +${selected.length - 3} more` : '');

  if (action === 'active' || action === 'inactive') {
    const next = action === 'active' ? 'Active' : 'Inactive';
    confirmModal({
      title: `Set ${next}`,
      message: `Set status to "${next}" for ${selected.length} selected crew member(s)? (${names})`,
      confirmLabel: `Set ${next}`,
      onConfirm: async () => {
        await Promise.all(selected.map((pilot) => updatePilotProfile(pilot.uid, { status: next })));
        selected.forEach((pilot) => crewState.selectedRows.delete(pilot.uid));
        if (statusEl) {
          statusEl.textContent = `Applied status ${next} to ${selected.length} crew record(s).`;
          statusEl.classList.add('is-success');
        }
        showToast(`Status set to ${next} for ${selected.length} crew.`, 'success');
        await refreshCrew();
      }
    });
  } else if (action === 'assign-operator') {
    openModal(`
      <label class="cm-field">
        <span>Operator UID or email</span>
        <input type="text" id="cm-assign-operator-input" placeholder="Operator UID or registered operator email" />
      </label>
      <div class="cm-modal-actions">
        <button type="button" class="cm-btn cm-btn-ghost cm-btn-md" id="cm-assign-cancel">Cancel</button>
        <button type="button" class="cm-btn cm-btn-primary cm-btn-md" id="cm-assign-confirm">Assign Operator</button>
      </div>
    `, { title: 'Assign Operator', subtitle: `Assign ${selected.length} selected crew member(s) to an operator.` });

    query('#cm-assign-cancel')?.addEventListener('click', closeModal);
    query('#cm-assign-confirm')?.addEventListener('click', async () => {
      const input = query('#cm-assign-operator-input')?.value?.trim();
      if (!input) return;
      closeModal();
      try {
        const isEmail = input.includes('@');
        let targetOperator = input;
        if (isEmail) {
          const found = await findUserByEmail(input);
          if (!found) throw new Error('No registered user with that email was found.');
          targetOperator = found.uid;
        }
        await Promise.all(selected.map((pilot) => updatePilotProfile(pilot.uid, { operatorId: targetOperator })));
        if (statusEl) {
          statusEl.textContent = `Assigned ${selected.length} crew record(s) to operator ${targetOperator}.`;
          statusEl.classList.add('is-success');
        }
        showToast(`Assigned ${selected.length} crew to operator.`, 'success');
        await refreshCrew();
      } catch (error) {
        console.error('Assign operator failed:', error);
        if (statusEl) {
          statusEl.textContent = error.message || 'Unable to assign operator.';
          statusEl.classList.add('is-error');
        }
        showToast(error.message || 'Unable to assign operator.', 'error');
      }
    });
  } else if (action === 'reminder') {
    const reminders = selected.flatMap((pilot) => {
      const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
      return docs
        .filter((doc) => getDocumentComplianceState(doc) !== 'Valid')
        .map((doc) => ({ pilot, doc, days: daysUntil(doc.expiryDate) }));
    }).sort((a, b) => a.days - b.days);

    openModal(
      reminders.length
        ? `<ul class="cm-alerts">${reminders.slice(0, 10).map((item) => `
            <li class="cm-alert-item">
              <span class="cm-alert-dot ${item.days < 0 ? 'is-red' : 'is-amber'}"></span>
              <span class="cm-alert-text">
                <strong>${escapeHtml(toProfileName(item.pilot))} — ${escapeHtml(item.doc.documentName || 'Document')}</strong>
                <span>${escapeHtml(item.doc.expiryDate ? formatExpiry(item.doc.expiryDate).rel : '')}</span>
              </span>
            </li>`).join('')}</ul>
          ${reminders.length > 10 ? `<p class="cm-form-status">+${reminders.length - 10} more reminders</p>` : ''}`
        : '<p>All selected crew members are compliant. No reminders needed.</p>',
      { title: 'Reminder Preview', subtitle: `${reminders.length} document(s) need attention across ${selected.length} selected crew member(s).` }
    );
  } else if (action === 'reports') {
    const total = selected.length;
    const withIssues = selected.filter((pilot) => getCompliance(crewState.docsByPilotCache.get(pilot.uid) || []) !== 'Valid').length;
    const active = selected.filter((pilot) => `${pilot.status || 'Active'}` === 'Active').length;
    const inactive = total - active;
    openModal(`
      <div class="cm-comp-windows" style="grid-template-columns:repeat(3,1fr);gap:0.6rem">
        <div class="cm-comp-window"><strong>${total}</strong><span>Selected</span></div>
        <div class="cm-comp-window"><strong>${withIssues}</strong><span>Needs action</span></div>
        <div class="cm-comp-window"><strong>${active}</strong><span>Active</span></div>
      </div>
    `, { title: 'Crew Report', subtitle: `Summary for ${total} selected crew member(s). Use Export CSV for a full extract.` });
  } else if (action === 'export') {
    exportCrewCsv(selected);
  } else if (action === 'delete') {
    confirmModal({
      title: 'Move to Inactive',
      message: `Move ${selected.length} selected crew member(s) to Inactive Pilots? (${names}) This unlinks them and sets status=Deleted. You can restore or permanently delete them from the inactive section.`,
      confirmLabel: 'Move to Inactive',
      danger: true,
      onConfirm: async () => {
        await Promise.all(
          selected.map(async (pilot) => {
            await updatePilotProfile(pilot.uid, { status: 'Deleted' });
            await delinkPilot(pilot.uid);
            crewState.selectedRows.delete(pilot.uid);
          })
        );
        if (statusEl) {
          statusEl.textContent = `Moved ${selected.length} crew record(s) to inactive.`;
          statusEl.classList.add('is-success');
        }
        showToast(`${selected.length} crew members moved to inactive.`, 'success');
        await refreshCrew();
      }
    });
  }
}

export function exportCrewCsv(crewList) {
  const rows = [['Name', 'Email', 'Role', 'Employee ID', 'Status', 'Licence Number', 'Medical Expiry', 'Licence Expiry', 'Compliance', 'Documents']];
  crewList.forEach((pilot) => {
    const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
    rows.push([
      toProfileName(pilot),
      pilot.email || '',
      getPilotRoleLabel(pilot),
      pilot.employeeId || '',
      pilot.status || 'Active',
      getLicenseNumber(docs),
      formatShortDate(getMedicalExpiry(docs)),
      formatShortDate(getLicenceExpiry(docs)),
      getCompliance(docs),
      `${docs.length}`
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${`${cell ?? ''}`.replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crew-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`Exported ${crewList.length} crew records.`, 'success');
}
