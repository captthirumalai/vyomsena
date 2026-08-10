import { crewState } from './state.js';
import {
  query,
  setFormField,
  setFormValue,
  clearFormErrors,
  setFieldError,
  normalizeRole,
  setStatus,
  showToast,
  closeModal,
  openProfileModal
} from './utils.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { updatePilotProfile, createPilot } from '../../services/crewService.js';
import { uploadCrewProfilePhoto, deleteUserDocumentFile } from '../../services/storageService.js';
import { refreshCrew } from './crew.js';

export function openProfileForm(pilotUid) {
  crewState.profileEditUid = pilotUid || null;

  const heading = query('#cm-profile-heading');
  const sub = query('#cm-profile-sub');
  const mode = query('#cm-profile-mode');
  const saveLabel = query('#cm-profile-save-label');
  const form = query('#cm-profile-form');
  const photoPreview = query('#cm-profile-photo-preview');
  const photoInput = query('#cm-field-photo');
  if (photoInput) photoInput.value = '';
  if (photoPreview) {
    photoPreview.style.backgroundImage = '';
    photoPreview.textContent = 'Add photo';
  }

  if (pilotUid) {
    const pilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
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
      setFormField('#cm-field-operator', crewState.activeOperatorUid || '');
      setFormValue('#cm-field-status', pilot.status || 'Active');
      const photo = pilot.photoUri || pilot.photoUrl || null;
      if (photo && photoPreview) {
        photoPreview.style.backgroundImage = `url(${photo})`;
        photoPreview.style.backgroundSize = 'cover';
        photoPreview.style.backgroundPosition = 'center';
        photoPreview.textContent = '';
      }
    }
  } else {
    if (heading) heading.textContent = 'Create Crew Profile';
    if (sub) sub.textContent = 'Add a new crew member or update their operator-level record.';
    if (mode) mode.textContent = 'NEW';
    if (saveLabel) saveLabel.textContent = 'Create Crew';
    form?.reset();
    setFormField('#cm-field-operator', crewState.activeOperatorUid || '');
    setFormValue('#cm-field-status', 'Active');
  }

  clearFormErrors();
  if (form) form.dataset.mode = pilotUid ? 'edit' : 'create';
  openProfileModal();
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
  if (hasError) {
    setStatus('Please fix the highlighted fields.');
    return;
  }

  const submit = query('#cm-profile-save');
  const spinner = submit?.querySelector('.cm-btn-spinner');
  const label = query('#cm-profile-save-label');
  const statusEl = query('#cm-profile-status');
  const photoFile = query('#cm-field-photo')?.files?.[0] || null;

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
      const pilotUid = crewState.profileEditUid;
      await updatePilotProfile(pilotUid, profileUpdates);

      if (photoFile) {
        try {
          const currentPilot = crewState.pilotsCache.find((item) => item.uid === pilotUid);
          const oldPhotoPath = currentPilot?.photoStoragePath || null;
          const uploadResult = await uploadCrewProfilePhoto({ pilotUid, file: photoFile });
          await updatePilotProfile(pilotUid, {
            photoUri: uploadResult.photoUri,
            photoStoragePath: uploadResult.storagePath
          });
          if (oldPhotoPath && oldPhotoPath !== uploadResult.storagePath) {
            try {
              await deleteUserDocumentFile(oldPhotoPath);
            } catch (cleanupError) {
              console.warn('Crew photo cleanup skipped:', cleanupError);
            }
          }
        } catch (photoError) {
          console.warn('Crew photo upload failed; profile still saved.', photoError);
        }
      }

      await refreshCrew();
      if (statusEl) {
        statusEl.textContent = `Profile updated for ${name}.`;
        statusEl.classList.add('is-success');
      }
      showToast('Crew profile updated.', 'success');
      closeModal();
    } else {
      if (!crewState.activeOperatorUid) throw new Error('Operator context missing.');
      const created = await createPilot({
        name,
        email,
        operatorUid: crewState.activeOperatorUid
      });

      if (photoFile && created?.uid) {
        try {
          const uploadResult = await uploadCrewProfilePhoto({ pilotUid: created.uid, file: photoFile });
          await updatePilotProfile(created.uid, {
            photoUri: uploadResult.photoUri,
            photoStoragePath: uploadResult.storagePath
          });
        } catch (photoError) {
          console.warn('Crew photo upload failed; profile still created.', photoError);
        }
      }

      await refreshCrew();
      if (statusEl) {
        statusEl.textContent = `Crew profile created for ${name}.`;
        statusEl.classList.add('is-success');
      }
      showToast('Crew profile created.', 'success');
      closeModal();
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
