export function showLoader() {
  const loader = document.createElement('div');
  loader.className = 'loader';
  loader.textContent = 'Loading...';
  document.body.appendChild(loader);
  return loader;
}

export function hideLoader(loader) {
  loader?.remove();
}
