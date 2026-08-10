/* VyomSena Crew Management - Upload limits + client-side image compression.
   Enforced by services/storageService.js before any file reaches Firebase Storage. */

export const DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const COMPRESSED_IMAGE_CAP_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_IMAGE_MAX_DIMENSION = 1800;
export const DOCUMENT_IMAGE_QUALITY = 0.82;
export const PROFILE_PHOTO_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_MAX_DIMENSION = 600;
export const PROFILE_PHOTO_QUALITY = 0.85;

const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

function getExtension(file) {
  const name = `${file?.name || ''}`;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isImageFile(file) {
  return `${file?.type || ''}`.toLowerCase().startsWith('image/') || IMAGE_EXTENSIONS.includes(getExtension(file));
}

function isAllowedDocumentType(file) {
  const mime = `${file?.type || ''}`.toLowerCase();
  if (ALLOWED_DOCUMENT_TYPES.includes(mime)) return true;
  return ALLOWED_DOCUMENT_EXTENSIONS.includes(getExtension(file));
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function validateDocumentFile(file) {
  if (!file) return { ok: false, error: 'No file selected.' };
  if (!isAllowedDocumentType(file)) {
    return { ok: false, error: 'Only PDF and image files (JPG, PNG, WebP) are allowed.' };
  }
  if (file.size > DOCUMENT_MAX_SIZE_BYTES) {
    return {
      ok: false,
      error: `File is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(DOCUMENT_MAX_SIZE_BYTES)}.`
    };
  }
  return { ok: true };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to read the selected image.'));
    img.src = src;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function compressImageFile(file, { maxDimension, quality }) {
  if (!isImageFile(file)) return file;
  try {
    const dataUrl = await readAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, quality);
    if (!blob || blob.size >= file.size) return file;

    const baseName = `${file.name || 'image'}`.replace(/\.[^./\\]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (error) {
    console.warn('Image compression skipped:', error);
    return file;
  }
}

export async function prepareDocumentFile(file) {
  const check = validateDocumentFile(file);
  if (!check.ok) throw new Error(check.error);

  let prepared = file;
  if (isImageFile(file)) {
    prepared = await compressImageFile(file, {
      maxDimension: DOCUMENT_IMAGE_MAX_DIMENSION,
      quality: DOCUMENT_IMAGE_QUALITY
    });
  }
  if (prepared.size > COMPRESSED_IMAGE_CAP_BYTES) {
    throw new Error(
      `Image is still too large after compression (${formatBytes(prepared.size)}). Maximum size is ${formatBytes(COMPRESSED_IMAGE_CAP_BYTES)}.`
    );
  }
  return prepared;
}

export async function prepareProfilePhoto(file) {
  if (!file) throw new Error('No photo selected.');
  if (!isImageFile(file)) {
    throw new Error('Profile photo must be an image file (JPG, PNG, WebP).');
  }
  if (file.size > PROFILE_PHOTO_MAX_SIZE_BYTES) {
    throw new Error(
      `Photo is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(PROFILE_PHOTO_MAX_SIZE_BYTES)}.`
    );
  }
  return compressImageFile(file, {
    maxDimension: PROFILE_PHOTO_MAX_DIMENSION,
    quality: PROFILE_PHOTO_QUALITY
  });
}
