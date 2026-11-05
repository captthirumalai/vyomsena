import { cpState } from './state.js';
import {
  q,
  clearFormErrors,
  setField,
  setFieldError,
  openFormModal,
  closeModal,
  showToast,
  normalizeRole
} from './ui.js';
import { canPerformCrewAction } from '../../services/permissionService.js';
import { createPilot, updatePilotProfile } from '../../services/crewService.js';
import { uploadCrewProfilePhoto, deleteUserDocumentFile } from '../../services/storageService.js';

export function openProfileForm(pilotUid) {
  cpState.editingUid = pilotUid || null;

  const heading = q('#cp-profile-heading');
  const sub = q('#cp-profile-sub');
  const mode = q('#cp-profile-mode');
  const saveLabel = q('#cp-profile-save-label');
  const form = q('#cp-profile-form');
  const photoPreview = q('#cp-profile-photo-preview');
  const photoInput = q('#cp-field-photo');
  if (photoInput) photoInput.value = '';
  if (photoPreview) {
    photoPreview.style.backgroundImage = '';
    photoPreview.textContent = 'Add photo';
  }

  if (pilotUid) {
    const pilot = cpState.pilots.find((item) => item.uid === pilotUid);
    if (heading) heading.textContent = 'Edit Crew Profile';
    if (sub) sub.textContent = "Update this crew member's operator-level record.";
    if (mode) mode.textContent = 'EDIT';
    if (saveLabel) saveLabel.textContent = 'Save Changes';
    if (pilot) {
      setField('#cp-field-name', pilot.fullName || pilot.name || '');
      setField('#cp-field-email', pilot.email || '');
      setField('#cp-field-phone', pilot.mobile || pilot.companyPhone || '');
      setField('#cp-field-employeeId', pilot.employeeId || '');
      setField('#cp-field-role', normalizeRole(pilot.role || 'PILOT'));
      setField('#cp-field-operator', cpState.operatorUid || '');
      setField('#cp-field-status', pilot.status || 'Active');
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
    setField('#cp-field-operator', cpState.operatorUid || '');
    setField('#cp-field-status', 'Active');
  }

  clearFormErrors();
  if (form) form.dataset.mode = pilotUid ? 'edit' : 'create';
  openFormModal();
}

async function uploadPhotoIfNeeded(pilotUid, file) {
  if (!file) return;
  try {
    const currentPilot = cpState.pilots.find((item) => item.uid === pilotUid);
    const oldPhotoPath = currentPilot?.photoStoragePath || null;
    const uploadResult = await uploadCrewProfilePhoto({ pilotUid, file });
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

export async function saveProfileForm(onSaved) {
  if (!canPerformCrewAction(cpState.currentUser, 'edit')) {
    showToast('You do not have permission to edit crew records.', 'error');
    return;
  }

  clearFormErrors();
  const form = q('#cp-profile-form');
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
  if (hasError) return;

  const submit = q('#cp-profile-save');
  const spinner = submit?.querySelector('.cp-btn-spinner');
  const label = q('#cp-profile-save-label');
  const statusEl = q('#cp-profile-status');
  const photoFile = q('#cp-field-photo')?.files?.[0] || null;
  const editingUid = cpState.editingUid;

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

    if (editingUid) {
      await updatePilotProfile(editingUid, profileUpdates);
      await uploadPhotoIfNeeded(editingUid, photoFile);
      await onSaved?.();
      showToast('Crew profile updated.', 'success');
    } else {
      if (!cpState.operatorUid) throw new Error('Operator context missing.');
      const created = await createPilot({
        name,
        email,
        operatorUid: cpState.operatorUid
      });
      if (created?.uid) {
        await updatePilotProfile(created.uid, {
          mobile: profileUpdates.mobile,
          employeeId: profileUpdates.employeeId,
          role: profileUpdates.role,
          status: profileUpdates.status
        });
        await uploadPhotoIfNeeded(created.uid, photoFile);
      }
      await onSaved?.();
      showToast('Crew profile created.', 'success');
    }

    if (statusEl) {
      statusEl.textContent = editingUid ? `Profile updated for ${name}.` : `Crew profile created for ${name}.`;
      statusEl.classList.add('is-success');
    }
    closeModal();
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
    if (label) label.textContent = cpState.editingUid ? 'Save Changes' : 'Create Crew';
  }
}

export function bindProfileForm(onSaved) {
  q('#cp-profile-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfileForm(onSaved);
  });

  q('#cp-profile-cancel')?.addEventListener('click', () => {
    cpState.editingUid = null;
    closeModal();
  });

  q('#cp-field-photo')?.addEventListener('change', (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const preview = q('#cp-profile-photo-preview');
      if (preview && typeof loadEvent.target?.result === 'string') {
        preview.style.backgroundImage = `url(${loadEvent.target.result})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.textContent = '';
      }
    };
    reader.readAsDataURL(file);
  });
}
