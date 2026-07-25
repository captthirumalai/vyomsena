export function createButton({
  label = 'Button',
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick = null,
  className = ''
} = {}) {
  const button = document.createElement('button');
  button.type = type;
  button.className = `vs-button vs-button--${variant} vs-button--${size} ${className}`.trim();
  button.textContent = label;
  button.disabled = disabled;

  if (typeof onClick === 'function') {
    button.addEventListener('click', onClick);
  }

  return button;
}
