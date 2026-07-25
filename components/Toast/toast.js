export function createToast(message, { duration = 4000 } = {}) {
  const toast = document.createElement('div');
  toast.className = 'vs-toast';
  toast.textContent = message;

  setTimeout(() => {
    toast.classList.add('vs-toast--hide');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);

  return toast;
}
