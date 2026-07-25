export function createModal({ title = '', content = '', onClose = null } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'vs-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'vs-modal';

  const header = document.createElement('div');
  header.className = 'vs-modal__header';

  const heading = document.createElement('h2');
  heading.className = 'vs-modal__title';
  heading.textContent = title;

  const closeButton = document.createElement('button');
  closeButton.className = 'vs-button vs-button--secondary vs-button--sm vs-modal__close';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => {
    overlay.remove();
    if (typeof onClose === 'function') onClose();
  });

  header.appendChild(heading);
  header.appendChild(closeButton);

  const body = document.createElement('div');
  body.className = 'vs-modal__body';
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  }

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  return overlay;
}
