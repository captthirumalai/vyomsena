export function createSpinner({ size = 40, label = 'Loading...' } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'vs-spinner';
  wrapper.style.setProperty('--spinner-size', `${size}px`);

  const dot = document.createElement('div');
  dot.className = 'vs-spinner__dot';
  wrapper.appendChild(dot);

  if (label) {
    const text = document.createElement('span');
    text.className = 'vs-spinner__label';
    text.textContent = label;
    wrapper.appendChild(text);
  }

  return wrapper;
}
