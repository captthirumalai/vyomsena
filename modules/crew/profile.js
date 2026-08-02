import { crewState } from './state.js';
import {
  query,
  setFormField,
  setFormValue,
  toInputDate,
  clearFormErrors,
  setFieldError,
  toTimestampCandidate,
  normalizeRole,
  getLicenseNumber,
  getMedicalExpiry,
  getLicenceExpiry,
  findPrimaryDoc,
  setStatus,
  showToast
} from './utils.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { updatePilotProfile, createPilot, updatePilotDocumentWithAudit } from '../../services/crewService.js';
import { refreshCrew } from './crew.js';
import { setActiveTab } from './directory.js';

export function openProfileForm(pilotUid) {
  setActiveTab('profile');
  crewState.profileEditUid = pilotUid || null;

  const heading = query('#cm-profile-heading');
  const sub = query('#cm-profile-sub');
  const mode = query('#cm-profile-mode');
  const saveLabel = query('#cm-profile-save-label');
  const form = query('#cm-profile-form');

  if (pilotUid) {
    const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
    const docs = crewState.docsByPilotCache.get(pilotUid) || [];
    if (pilot) {
      if (heading) heading.textContent = 'Edit Crew Profile';
      if (sub) sub.textContent = 'Update this crew member\'s operator-level record.';
      if (mode) mode.textContent = 'EDIT';
      if (saveLabel) saveLabel.textContent = 'Save Changes';
      setFormField('#cm-field-name', pilot.fullName || pilot.name || '');
      setFormField('#cm-field-email', pilot.email || '');
      setFormField('#cm-field-phone', pilot.mobile || pilot.companyPhone || '');
      setFormField('#cm-field-employeeId', pilot.employeeId || '');
      setFormValue('#cm-field-role', normalizeRole(pilot.role || 'PILOT'));
      setFormField('#cm-field-license', getLicenseNumber(docs) === 'N/A' ? '' : getLicenseNumber(docs));
      setFormField('#cm-field-medicalExpiry', toInputDate(getMedicalExpiry(docs)));
      setFormField('#cm-field-licenseExpiry', toInputDate(getLicenceExpiry(docs)));
      setFormField('#cm-field-operator', crewState.activeOperatorUid || '');
      setFormValue('#cm-field-status', pilot.status || 'Active');
    }
  } else {
    if (heading) heading.textContent = 'Create Crew Profile';
    if (sub) sub.textContent = 'Add a new crew member or update their operator-level record.';
    if (mode) mode.textContent = 'NEW';
    if (saveLabel) saveLabel.textContent = 'Create Crew';
    form?.reset();
    setFormField('#cm-field-operator', crewState.activeOperatorUid || '');
  }

  clearFormErrors();
  if (form) form.dataset.mode = pilotUid ? 'edit' : 'create';
}

export async function saveProfileForm() {
  if (!canPerformCrewAction(crewState.activeCurrentUser, 'edit')) {
    showToast('You do not have permission to edit crew records.', 'error');
    return;
  }

  clearFormErrors();
  const form = query('#cm-profile-form');
  if (!form) return;

  const name = form.name?.value?.trim();
  const email = form.email?.value?.trim().toLowerCase();
  const phone = form.phone?.value?.trim();
  const employeeId = form.employeeId?.value?.trim();
  const role = form.role?.value?.trim();
  const license = form.license?.value?.trim();
  const medicalExpiryDate = toTimestampCandidate(form.medicalExpiry?.value || null);
  const licenseExpiryDate = toTimestampCandidate(form.licenseExpiry?.value || null);
  const statusValue = form.status?.value?.trim() || 'Active';

  let hasError = false;
  if (!name) {
    setFieldError('name', 'Name is required.');
    hasError = true;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError('email', 'A valid email is required.');
    hasError = true;
  }
  if (form.dataset.mode === 'create' && !license) {
    setFieldError('license', 'Licence number is required for a new crew member.');
    hasError = true;
  }
  if (hasError) {
    setStatus('Please fix the highlighted fields.');
    return;
  }

  const submit = query('#cm-profile-save');
  const spinner = submit?.querySelector('.cm-btn-spinner');
  const label = query('#cm-profile-save-label');
  const statusEl = query('#cm-profile-status');

  try {
    if (submit) submit.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (label) label.textContent = 'Saving...';

    const profileUpdates = {
      fullName: name,
      name,
      email,
      mobile: phone || null,
      employeeId: employeeId || null,
      role: normalizeRole(role || 'PILOT'),
      status: statusValue
    };

    if (crewState.profileEditUid) {
      await updatePilotProfile(crewState.profileEditUid, profileUpdates);

      const docs = crewState.docsByPilotCache.get(crewState.profileEditUid) || [];
      const licenceDoc = findPrimaryDoc(
        docs,
        (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'LICENCE' || `${doc.documentName || ''}`.toLowerCase().includes('license')
      );
      const medicalDoc = findPrimaryDoc(
        docs,
        (doc) => `${doc.documentCategory || ''}`.toUpperCase() === 'MEDICAL' || `${doc.documentName || ''}`.toLowerCase().includes('medical')
      );

      if (licenceDoc) {
        const next = {
          licenseOrCertificateNumber: license ? license : licenceDoc.licenseOrCertificateNumber || null,
          ...(licenseExpiryDate ? { expiryDate: licenseExpiryDate } : {})
        };
        await updatePilotDocumentWithAudit(licenceDoc.firestoreId, next, crewState.activeCurrentUser?.uid || null);
      }
      if (medicalDoc && medicalExpiryDate) {
        await updatePilotDocumentWithAudit(medicalDoc.firestoreId, { expiryDate: medicalExpiryDate }, crewState.activeCurrentUser?.uid || null);
      }

      await refreshCrew();
      if (statusEl) {
        statusEl.textContent = `Profile updated for ${name}.`;
        statusEl.classList.add('is-success');
      }
      showToast('Crew profile updated.', 'success');
    } else {
      if (!crewState.activeOperatorUid) throw new Error('Operator context missing.');
      await createPilot({
        name,
        email,
        licenseNum: license,
        medicalExpiryDate,
        licenseExpiryDate,
        operatorUid: crewState.activeOperatorUid
      });
      await refreshCrew();
      if (statusEl) {
        statusEl.textContent = `Crew profile created for ${name}.`;
        statusEl.classList.add('is-success');
      }
      showToast('Crew profile created.', 'success');
      form.reset();
      setFormField('#cm-field-operator', crewState.activeOperatorUid || '');
      setActiveTab('directory');
    }
  } catch (error) {
    console.error('Save crew profile failed:', error);
    if (statusEl) {
      statusEl.textContent = error.message || 'Unable to save crew profile.';
      statusEl.classList.add('is-error');
    }
    showToast(error.message || 'Unable to save crew profile.', 'error');
  } finally {
    if (submit) submit.disabled = false;
    if (spinner) spinner.classList.add('hidden');
    if (label) label.textContent = crewState.profileEditUid ? 'Save Changes' : 'Create Crew';
  }
}
